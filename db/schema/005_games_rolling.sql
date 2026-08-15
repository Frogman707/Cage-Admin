-- =============================================================================
-- 005. 케이지 — 게임 · 롤링 · 정산 · 메인케이지 · 칩재고
-- =============================================================================
-- 현행 대응:
--   games/{gameId}                index.html:6794
--   rollingEvents/{id}            :4538   memo 가 의미론 캐리어
--   g.checkpoints[]               :7241   중간정산 이력 (배열 → 정규 테이블)
--   mainCageLedger/{id}           :4742
--   shiftEvents 9필드             :4828   → 폐기. 원장·재고에서 파생 (008)
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 게임
-- -----------------------------------------------------------------------------
CREATE TABLE cage.games (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id         UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  game_no             TEXT NOT NULL UNIQUE,        -- 현행 'YYMMDD'+3자리 (index.html:6791)
  branch              TEXT NOT NULL REFERENCES ledger.branches(code),

  member_party_id     BIGINT NOT NULL REFERENCES ledger.parties,
  game_party_id       BIGINT NOT NULL REFERENCES ledger.parties,   -- 'GAME-{game_no}'
  chips_account_id    BIGINT NOT NULL REFERENCES ledger.accounts,  -- chips_outstanding

  table_code          TEXT,
  currency            TEXT NOT NULL REFERENCES ledger.currencies(code),

  -- 표시용 라벨이다. 현행 games.type 은 "Rolling 1.45%" 같은 문자열이고
  -- 정산 화면이 여기서 정규식으로 요율을 뽑아 썼다 (design-review-9.md DR-84).
  -- 이 컬럼을 파싱해 금액을 계산하는 코드는 만들지 않는다. 요율의 권위는
  -- 아래 commission_rate_bp 다.
  bet_type            TEXT,

  -- 롤링 커미션 요율 스냅샷. 게임 개설 시점의 계좌 요율을 bp(1/100 %)로
  -- 고정한다 — 145 = 1.45%. 계좌 요율이 나중에 바뀌어도 이미 시작한 게임의
  -- 정산 근거는 흔들리지 않는다 (design-review-8.md DR-77 의 bp 규약).
  -- NULL 은 "이 게임에 요율이 정해지지 않았다" 는 뜻이고, 그 상태에서는
  -- op_settle_commission 이 자동 산출을 하지 않는다.
  commission_rate_bp  INT CHECK (commission_rate_bp BETWEEN 0 AND 10000),

  start_type          cage.game_start_type NOT NULL,
  start_kind          cage.game_start_kind NOT NULL,

  buyin_minor         BIGINT NOT NULL DEFAULT 0 CHECK (buyin_minor >= 0),
  working_chip_minor  BIGINT NOT NULL DEFAULT 0 CHECK (working_chip_minor >= 0),

  -- 프로젝션. rolling_events 합과 상시 대조한다 (010 R4)
  rolling_total_minor BIGINT NOT NULL DEFAULT 0
    CONSTRAINT games_rolling_nonneg CHECK (rolling_total_minor >= 0),

  status              cage.game_status NOT NULL DEFAULT 'ongoing',
  win_loss_minor      BIGINT,

  started_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  ended_at            TIMESTAMPTZ,
  opened_by           BIGINT NOT NULL REFERENCES identity.staff,
  closed_by           BIGINT REFERENCES identity.staff,
  business_date       DATE NOT NULL,

  CONSTRAINT games_no_format CHECK (game_no ~ '^[A-Z0-9-]{4,32}$'),
  CONSTRAINT games_ended_fields CHECK (
    (status = 'ongoing'   AND ended_at IS NULL) OR
    (status <> 'ongoing'  AND ended_at IS NOT NULL)
  )
);

CREATE INDEX games_branch_status_idx ON cage.games (branch, status, started_at DESC);
CREATE INDEX games_member_idx        ON cage.games (member_party_id, started_at DESC);

COMMENT ON CONSTRAINT games_rolling_nonneg ON cage.games IS
  '현행 게임종료 검증 "(g.rolling + netNN) < 0"(index.html:7434)을 상시 제약으로 승격.';

-- -----------------------------------------------------------------------------
-- 롤링
-- -----------------------------------------------------------------------------
-- 롤링은 턴오버 지표이지 자금이 아니다. 원장에 넣지 않는다.
-- 현행 memo 문자열 관례를 source 컬럼으로 승격해 모호성을 제거한다.
CREATE TABLE cage.rolling_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id        BIGINT NOT NULL REFERENCES cage.games,
  amount_minor   BIGINT NOT NULL CHECK (amount_minor <> 0),   -- 정정은 음수
  source         cage.rolling_source NOT NULL,
  counts_toward_branch_total BOOLEAN NOT NULL,
  transaction_id BIGINT REFERENCES ledger.transactions,       -- 자금 이동 동반 시
  staff_id       BIGINT NOT NULL REFERENCES identity.staff,
  business_date  DATE NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX rolling_events_game_idx ON cage.rolling_events (game_id, id);
CREATE INDEX rolling_events_branch_total_idx
  ON cage.rolling_events (business_date) WHERE counts_toward_branch_total;

-- source 와 지점누계 산입 여부의 조합을 고정한다.
-- 현행은 '' 와 'rolling' 을 같이 취급했다(index.html:4553). 그 모호성을 없앤다.
CREATE FUNCTION cage.assert_rolling_source_consistent() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  v_expected BOOLEAN;
BEGIN
  -- 'correction' 은 예외다. 취소 상쇄는 원본이 지점 누계에 산입됐는지에 따라
  -- 두 값이 모두 필요하다 (010 의 op_cancel_game 이 값별로 나눠 기록한다).
  -- 그러지 않으면 지점 롤링 누계가 취소 후에도 복구되지 않는다.
  IF NEW.source = 'correction' THEN
    RETURN NEW;
  END IF;

  v_expected := (NEW.source = 'manual');
  IF NEW.counts_toward_branch_total <> v_expected THEN
    RAISE EXCEPTION
      'rolling source % requires counts_toward_branch_total=%, got %',
      NEW.source, v_expected, NEW.counts_toward_branch_total
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rolling_events_source_consistent
  BEFORE INSERT ON cage.rolling_events
  FOR EACH ROW EXECUTE FUNCTION cage.assert_rolling_source_consistent();

-- 종료·취소된 게임에는 아무것도 붙일 수 없다.
-- FK 만으로는 게임 상태를 보지 못하므로 롤링·정산이 사후에 추가될 수 있었다.
-- FOR SHARE 로 잠근다: 다른 트랜잭션이 동시에 게임을 종료하려 하면 대기한다.
-- (게임 종료 정산과 취소 상쇄는 상태를 바꾸기 '전'에 기록하므로 통과한다.)
CREATE FUNCTION cage.assert_game_ongoing() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  v_status cage.game_status;
  v_no     TEXT;
BEGIN
  SELECT g.status, g.game_no INTO v_status, v_no
    FROM cage.games g WHERE g.id = NEW.game_id FOR SHARE;

  IF v_status <> 'ongoing' THEN
    RAISE EXCEPTION 'game % is % — 진행 중이 아닌 게임에는 기록할 수 없다', v_no, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rolling_events_game_ongoing
  BEFORE INSERT ON cage.rolling_events
  FOR EACH ROW EXECUTE FUNCTION cage.assert_game_ongoing();

CREATE TRIGGER rolling_events_immutable
  BEFORE UPDATE OR DELETE ON cage.rolling_events
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- 게임 롤링 총액 프로젝션 갱신
CREATE FUNCTION cage.apply_rolling_projection() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
BEGIN
  UPDATE cage.games
     SET rolling_total_minor = rolling_total_minor + NEW.amount_minor
   WHERE id = NEW.game_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER rolling_events_project
  AFTER INSERT ON cage.rolling_events
  FOR EACH ROW EXECUTE FUNCTION cage.apply_rolling_projection();

-- -----------------------------------------------------------------------------
-- 정산 (중간정산 · 게임종료)
-- -----------------------------------------------------------------------------
-- 현행 g.checkpoints 배열(index.html:7241)과 종료 시 cc/nn 객체를 정규화한 것.
CREATE TABLE cage.game_settlements (
  id                    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id               BIGINT NOT NULL REFERENCES cage.games,
  seq                   INT NOT NULL,
  kind                  cage.settlement_kind NOT NULL,
  transaction_id        BIGINT NOT NULL REFERENCES ledger.transactions,

  cc_deposit_minor      BIGINT NOT NULL DEFAULT 0 CHECK (cc_deposit_minor      >= 0),
  cc_cashout_minor      BIGINT NOT NULL DEFAULT 0 CHECK (cc_cashout_minor      >= 0),
  cc_marker_minor       BIGINT NOT NULL DEFAULT 0 CHECK (cc_marker_minor       >= 0),
  cc_dealer_tips_minor  BIGINT NOT NULL DEFAULT 0 CHECK (cc_dealer_tips_minor  >= 0),
  cc_house_tips_minor   BIGINT NOT NULL DEFAULT 0 CHECK (cc_house_tips_minor   >= 0),

  nn_deposit_minor      BIGINT NOT NULL DEFAULT 0 CHECK (nn_deposit_minor      >= 0),
  nn_cashout_minor      BIGINT NOT NULL DEFAULT 0 CHECK (nn_cashout_minor      >= 0),
  nn_marker_minor       BIGINT NOT NULL DEFAULT 0 CHECK (nn_marker_minor       >= 0),
  nn_working_minor      BIGINT NOT NULL DEFAULT 0 CHECK (nn_working_minor      >= 0),

  -- 현행 index.html:7237  added = -(nn.deposit + nn.cashout + nn.marker + nn.working)
  rolling_delta_minor   BIGINT GENERATED ALWAYS AS (
    -(nn_deposit_minor + nn_cashout_minor + nn_marker_minor + nn_working_minor)
  ) STORED,

  staff_id              BIGINT NOT NULL REFERENCES identity.staff,
  business_date         DATE NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  UNIQUE (game_id, seq),
  CONSTRAINT settlement_not_empty CHECK (
    cc_deposit_minor + cc_cashout_minor + cc_marker_minor
  + cc_dealer_tips_minor + cc_house_tips_minor
  + nn_deposit_minor + nn_cashout_minor + nn_marker_minor + nn_working_minor > 0
  )
);

CREATE UNIQUE INDEX game_settlements_one_final_idx
  ON cage.game_settlements (game_id) WHERE kind = 'final';

CREATE TRIGGER game_settlements_game_ongoing
  BEFORE INSERT ON cage.game_settlements
  FOR EACH ROW EXECUTE FUNCTION cage.assert_game_ongoing();

CREATE TRIGGER game_settlements_immutable
  BEFORE UPDATE OR DELETE ON cage.game_settlements
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

COMMENT ON COLUMN cage.game_settlements.rolling_delta_minor IS
  '현행 index.html:7237 공식 그대로. 생성 열이라 코드가 다시 계산하지 않는다.';

-- -----------------------------------------------------------------------------
-- 롤링 커미션 정산 (design-review-6.md DR-66)
-- -----------------------------------------------------------------------------
-- 위 game_settlements 와 다른 조작이다. 저쪽은 칩을 회수하고, 이쪽은 손님에게
-- 롤링 커미션을 **지급한다.** 현행 _doSettleGame(index.html:7218-7267) 이 매 정산마다
-- 실제 돈을 계좌로 넣는데 01·04·05·DDL 어디에도 서술이 없었다.
-- 현행 DB.settled 레코드({gameId, account, branch, dt, buyin, cashout, winLoss,
-- rolling, commission, fb, result, staff}) 가 이 테이블의 원형이다.
--
-- 한 게임에 여러 번 지급할 수 있다 (현행도 진행 중 게임을 반복 정산할 수 있다).
-- 위험한 것은 "두 번" 이 아니라 "같은 롤링에 두 번" 이므로, 아래 트리거가
-- 게임별 rolling_base_minor 합이 games.rolling_total_minor 를 넘지 못하게 막는다.
CREATE TABLE cage.commission_settlements (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id         UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  game_id             BIGINT NOT NULL REFERENCES cage.games,
  seq                 INT NOT NULL,

  -- 순지급액이 0이면 원장 거래를 만들지 않는다 (entries_amount_nonzero).
  -- 그래도 정산 이력은 남긴다 — "정산했고 지급액이 0이었다" 와 "정산한 적 없다" 는
  -- 다른 사실이다. 현행은 result<=0 이면 아무 기록도 남기지 않았다.
  transaction_id      BIGINT REFERENCES ledger.transactions,

  -- 이번 정산이 대상으로 삼은 롤링 구간
  rolling_base_minor  BIGINT NOT NULL CHECK (rolling_base_minor >= 0),

  -- 산출 근거. games.commission_rate_bp 스냅샷을 다시 복사한다 —
  -- 게임 행이 나중에 어떻게 되든 이 정산의 근거는 이 행 안에서 닫힌다.
  commission_rate_bp  INT NOT NULL CHECK (commission_rate_bp BETWEEN 0 AND 10000),

  -- 총커미션. 운영자가 산출값을 덮어쓸 수 있으므로(현행 스펙) 별도 컬럼이다.
  -- rate_overridden 이 참이면 rate_bp 와 금액이 일치하지 않는다는 뜻이고,
  -- 그 자체가 감사 대상 사실이다.
  commission_minor    BIGINT NOT NULL CHECK (commission_minor >= 0),
  rate_overridden     BOOLEAN NOT NULL DEFAULT FALSE,

  fb_deduction_minor  BIGINT NOT NULL DEFAULT 0 CHECK (fb_deduction_minor >= 0),
  payout_minor        BIGINT NOT NULL CHECK (payout_minor >= 0),

  staff_id            BIGINT NOT NULL REFERENCES identity.staff,
  business_date       DATE NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  UNIQUE (game_id, seq),

  -- 커미션은 롤링을 넘지 못한다. 현행 Share 40% 프리셋이 롤링의 40%를 커미션으로
  -- 프리필하던 사고(design-review-9.md DR-84)는 이 제약만으로는 안 막히지만,
  -- 자릿수 단위 오지급은 여기서 걸린다.
  CONSTRAINT commission_within_rolling CHECK (commission_minor <= rolling_base_minor),

  -- F&B 차감은 커미션을 넘지 못한다. 현행은 넘으면 result<=0 이 되어 조용히
  -- 아무것도 하지 않았다 — 차감분이 어디로 갔는지 기록이 남지 않았다.
  CONSTRAINT commission_payout_arith CHECK (payout_minor = commission_minor - fb_deduction_minor)
);

CREATE INDEX commission_settlements_game_idx
  ON cage.commission_settlements (game_id, seq);
CREATE INDEX commission_settlements_date_idx
  ON cage.commission_settlements (business_date, game_id);

CREATE TRIGGER commission_settlements_immutable
  BEFORE UPDATE OR DELETE ON cage.commission_settlements
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- 같은 롤링에 두 번 커미션을 주지 못한다.
CREATE FUNCTION cage.assert_commission_base_available() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  v_rolling_total BIGINT;
  v_already       BIGINT;
BEGIN
  -- op_settle_commission 이 이미 games 행을 FOR UPDATE 로 잠근 뒤에 들어온다.
  -- 그 잠금이 이 검사를 check-then-act 가 아니게 만든다. 잠금 없이 이 테이블에
  -- 직접 쓰는 경로는 012 가 막는다 (ledger_app 은 INSERT 권한이 없다).
  SELECT g.rolling_total_minor INTO v_rolling_total
    FROM cage.games g WHERE g.id = NEW.game_id;

  SELECT COALESCE(sum(cs.rolling_base_minor), 0) INTO v_already
    FROM cage.commission_settlements cs WHERE cs.game_id = NEW.game_id;

  IF v_already + NEW.rolling_base_minor > v_rolling_total THEN
    RAISE EXCEPTION
      'commission base % exceeds unsettled rolling (total %, already settled %)',
      NEW.rolling_base_minor, v_rolling_total, v_already
      USING ERRCODE = 'object_not_in_prerequisite_state',
            HINT = '이미 커미션을 지급한 롤링에 다시 지급하려 한다';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commission_settlements_base_available
  BEFORE INSERT ON cage.commission_settlements
  FOR EACH ROW EXECUTE FUNCTION cage.assert_commission_base_available();

COMMENT ON TABLE cage.commission_settlements IS
  '롤링 커미션 지급 이력. 현행 DB.settled(localStorage) 의 목표 대응. design-review-6.md DR-66.';
COMMENT ON COLUMN cage.commission_settlements.rolling_base_minor IS
  '이번 지급이 소진한 롤링. 게임별 합이 games.rolling_total_minor 를 넘을 수 없다.';

-- -----------------------------------------------------------------------------
-- 게임 종료 불변식 — chips_outstanding 잔액 = 0
-- -----------------------------------------------------------------------------
-- 현행 워킹칩 반환 검증(index.html:7449-7453)보다 강하다.
-- 발행한 칩이 전부 회수되지 않으면 게임을 종료할 수 없다.
CREATE FUNCTION cage.assert_chips_settled() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  IF NEW.status = 'ongoing' OR OLD.status <> 'ongoing' THEN
    RETURN NEW;
  END IF;

  SELECT balance_minor INTO v_balance
    FROM ledger.account_balances WHERE account_id = NEW.chips_account_id;

  IF v_balance <> 0 THEN
    RAISE EXCEPTION
      'game % cannot close: chips_outstanding balance is % (must be 0). 미회수 칩이 있다.',
      NEW.game_no, v_balance
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  RETURN NEW;
END;
$$;

-- 지연 제약 트리거로 건다. 종료 정산 분개가 같은 트랜잭션 안에서
-- 아직 다 들어오지 않은 시점에 검사하면 안 되기 때문이다.
CREATE CONSTRAINT TRIGGER games_chips_settled
  AFTER UPDATE ON cage.games
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cage.assert_chips_settled();

-- -----------------------------------------------------------------------------
-- 메인 케이지 (자금 원장 아님)
-- -----------------------------------------------------------------------------
-- 현행 mainCageSignedEffect(index.html:4695)는 읽을 때 부호를 적용한다.
-- 신규는 저장 시점에 부호를 확정해 읽는 쪽이 규칙을 다시 알 필요가 없게 한다.
CREATE TABLE cage.main_cage_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch        TEXT NOT NULL REFERENCES ledger.branches(code),
  kind          cage.main_cage_kind NOT NULL,
  amount_minor  BIGINT NOT NULL,             -- 부호 적용 완료 (redeem 은 음수)
  staff_id      BIGINT NOT NULL REFERENCES identity.staff,
  business_date DATE NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT main_cage_sign_convention CHECK (
    (kind = 'redeem' AND amount_minor <= 0) OR
    (kind = 'reset') OR
    (kind IN ('buyin','rolling_cc','marker') AND amount_minor >= 0)
  )
);

CREATE INDEX main_cage_branch_idx ON cage.main_cage_events (branch, business_date, id);

CREATE TRIGGER main_cage_immutable
  BEFORE UPDATE OR DELETE ON cage.main_cage_events
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- -----------------------------------------------------------------------------
-- 칩 재고 (물리 재고 — 자금 원장 아님)
-- -----------------------------------------------------------------------------
-- 금고에 있는 미발행 칩은 부채가 아니므로 원장 계정이 아니다.
-- 현행 nnChipInShift · ccChipInShift 등이 여기로 매핑된다.
CREATE TABLE cage.chip_inventory_events (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch         TEXT NOT NULL REFERENCES ledger.branches(code),
  chip_type      cage.chip_type NOT NULL,
  delta_minor    BIGINT NOT NULL CHECK (delta_minor <> 0),
  reason         ledger.entry_category NOT NULL,
  transaction_id BIGINT REFERENCES ledger.transactions,
  staff_id       BIGINT NOT NULL REFERENCES identity.staff,
  business_date  DATE NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX chip_inventory_branch_idx
  ON cage.chip_inventory_events (branch, chip_type, business_date);

CREATE TRIGGER chip_inventory_immutable
  BEFORE UPDATE OR DELETE ON cage.chip_inventory_events
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

COMMIT;
