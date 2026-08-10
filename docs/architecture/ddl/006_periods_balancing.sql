-- =============================================================================
-- 006. 밸런싱(실사) · 기간 마감
-- =============================================================================
-- 현행 대응:
--   cageConfig.{cash,nn,cc}BreakdownCounts   권종별 매수 (index.html:4937)
--   memberCompanyDiffVal                     차액을 스칼라에 숫자만 저장
--   lastBalancingDt · lastCutoffDt · lastMonthSettleDt
--
-- 신규: 실사 결과를 기록하고, 차액은 반드시 명시적 adjustment 거래로 흡수한다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE cage.balancing_counts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch              ledger.branch_code NOT NULL,
  business_date       DATE NOT NULL,
  count_kind          cage.count_kind NOT NULL,

  -- 현행 breakdownCounts 구조 유지: { "1000": 25, "500": 40, ... }
  denomination_counts JSONB NOT NULL,
  counted_total_minor BIGINT NOT NULL CHECK (counted_total_minor >= 0),
  system_total_minor  BIGINT NOT NULL,

  variance_minor      BIGINT GENERATED ALWAYS AS
                        (counted_total_minor - system_total_minor) STORED,

  adjustment_tx_id    BIGINT REFERENCES ledger.transactions,

  counted_by          BIGINT NOT NULL REFERENCES identity.staff,
  verified_by         BIGINT REFERENCES identity.staff,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  UNIQUE (branch, business_date, count_kind),

  -- 4-eyes: 실사자와 검증자가 달라야 한다
  CONSTRAINT balancing_four_eyes CHECK (verified_by IS NULL OR verified_by <> counted_by)
);

CREATE INDEX balancing_variance_idx
  ON cage.balancing_counts (branch, business_date) WHERE variance_minor <> 0;

COMMENT ON COLUMN cage.balancing_counts.variance_minor IS
  '0이 아니면 adjustment_tx_id 가 반드시 있어야 한다. 차액이 조용히 묻히지 않는다.';

-- 차액이 있으면 조정 거래 없이 검증 완료할 수 없다
CREATE FUNCTION cage.assert_variance_adjusted() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
BEGIN
  IF NEW.verified_by IS NOT NULL
     AND NEW.variance_minor <> 0
     AND NEW.adjustment_tx_id IS NULL THEN
    RAISE EXCEPTION
      'balancing variance % 가 있는데 조정 거래가 없다. adjustment 거래를 먼저 기록하라.',
      NEW.variance_minor
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER balancing_variance_adjusted
  BEFORE INSERT OR UPDATE ON cage.balancing_counts
  FOR EACH ROW EXECUTE FUNCTION cage.assert_variance_adjusted();

-- -----------------------------------------------------------------------------
-- 기간 행 확보
-- -----------------------------------------------------------------------------
-- 이름에 주의: 이 함수는 기간 '행'이 있게만 한다. 열려 있는지는 보지 않는다.
-- 개폐 여부 판정은 004 의 assert_period_open() 트리거가 FOR SHARE 잠금과 함께 한다.
-- (이전 이름 ensure_period_open 은 검사를 하는 것처럼 읽혀 오해를 낳았다.)
CREATE FUNCTION ledger.ensure_period_row(
  p_branch        ledger.branch_code,
  p_business_date DATE
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  INSERT INTO ledger.accounting_periods (branch, business_date)
  VALUES (p_branch, p_business_date)
  ON CONFLICT (branch, business_date) DO NOTHING;
END;
$$;

COMMENT ON FUNCTION ledger.ensure_period_row IS
  '해당 영업일의 기간 행을 확보하기만 한다. 상태 검사는 assert_period_open() 이 한다.';

-- 기간 마감(freeze / settle)은 4-eyes 승인과 FOR UPDATE 잠금 프로토콜이 필요하므로
-- 연산 함수 계층에 있다 → 011_operations_admin.sql

COMMIT;
