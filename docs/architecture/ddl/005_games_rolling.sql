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
  branch              ledger.branch_code NOT NULL,

  member_party_id     BIGINT NOT NULL REFERENCES ledger.parties,
  game_party_id       BIGINT NOT NULL REFERENCES ledger.parties,   -- 'GAME-{game_no}'
  chips_account_id    BIGINT NOT NULL REFERENCES ledger.accounts,  -- chips_outstanding

  table_code          TEXT,
  currency            TEXT NOT NULL REFERENCES ledger.currencies(code),
  bet_type            TEXT,                                        -- 현행 type
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
  branch        ledger.branch_code NOT NULL,
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
  branch         ledger.branch_code NOT NULL,
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
