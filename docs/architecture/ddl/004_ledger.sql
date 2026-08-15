-- =============================================================================
-- 004. 원장 — transactions · entries · 불변식 · 회계기간 · 해시체인 · 멱등성
-- =============================================================================
-- 03-ledger-model.md §7 의 불변식 I1~I8 을 여기서 구현한다.
--
-- 핵심 설계 근거:
--   I1 분개 합 = 0      → 지연 제약 트리거. 분개는 여러 행에 나뉘어 삽입되므로
--                         커밋 시점 검사가 필수다.
--   I2 잔액 하한        → 지연 제약 트리거. PostgreSQL 에서 CHECK 는 DEFERRABLE 이
--                         될 수 없다(UNIQUE·PK·EXCLUDE·REFERENCES 만 가능). 즉시
--                         평가하면 분개 삽입 순서에 의존하는 스키마가 된다.
--   I3 불변성           → BEFORE UPDATE/DELETE 트리거 + 009 의 권한 회수
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 회계 기간  (현행 cageConfig 의 *Baseline 스칼라 6종을 대체)
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.accounting_periods (
  branch        ledger.branch_code NOT NULL,
  business_date DATE NOT NULL,
  status        ledger.period_status NOT NULL DEFAULT 'open',
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  frozen_at     TIMESTAMPTZ,
  settled_at    TIMESTAMPTZ,
  closed_by     BIGINT REFERENCES identity.staff,
  PRIMARY KEY (branch, business_date),

  CONSTRAINT periods_status_timestamps CHECK (
    (status = 'open'    AND frozen_at IS NULL  AND settled_at IS NULL) OR
    (status = 'frozen'  AND frozen_at IS NOT NULL AND settled_at IS NULL) OR
    (status = 'settled' AND frozen_at IS NOT NULL AND settled_at IS NOT NULL)
  )
);

COMMENT ON TABLE ledger.accounting_periods IS
  '월정산이 데이터 리셋(index.html:8274-8280)이 아니라 기간 마감이 되게 한다.';

-- -----------------------------------------------------------------------------
-- 해시 체인 헤드 (지점별)
-- -----------------------------------------------------------------------------
-- 전역 단일 체인은 모든 거래를 직렬화한다. 지점별로 나눠 병렬성을 확보한다.
-- 08-adr.md ADR-006.
CREATE TABLE ledger.chain_heads (
  branch     ledger.branch_code PRIMARY KEY,
  last_tx_id BIGINT,
  last_hash  BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO ledger.chain_heads (branch, last_hash)
SELECT b, sha256(('cage-admin-genesis:' || b::text)::bytea)
  FROM unnest(ARRAY['HANN','NUSTAR','ONLINE']::ledger.branch_code[]) AS b;

-- -----------------------------------------------------------------------------
-- 거래
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.transactions (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id     UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,                    -- I4
  kind            ledger.tx_kind NOT NULL,
  branch          ledger.branch_code NOT NULL,
  business_date   DATE NOT NULL,                           -- 서버 계산 (001 의 함수)

  actor_staff_id  BIGINT REFERENCES identity.staff,
  auth_method     identity.auth_method NOT NULL,
  device_id       TEXT NOT NULL,
  memo            TEXT,

  reverses_tx_id  BIGINT REFERENCES ledger.transactions,   -- 정정 = 역분개
  approval_id     BIGINT REFERENCES identity.approvals,    -- 4-eyes 승인 근거

  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),   -- I5

  -- NULL 을 허용하는 이유: 해시는 분개까지 다 들어온 뒤에 봉인한다.
  -- 그래야 기록 경로와 검증 경로가 같은 canonical_digest() 를 쓸 수 있다
  -- (분개는 transactions FK 때문에 거래보다 먼저 삽입할 수 없다).
  -- 커밋 시점 NOT NULL 은 아래 transactions_sealed 지연 제약 트리거가 보장한다.
  prev_hash       BYTEA,
  hash            BYTEA,

  FOREIGN KEY (branch, business_date)
    REFERENCES ledger.accounting_periods (branch, business_date),

  -- 시스템 거래를 제외하면 행위자가 반드시 있어야 한다
  CONSTRAINT tx_actor_required
    CHECK (auth_method = 'system' OR actor_staff_id IS NOT NULL)
);

CREATE INDEX transactions_branch_date_idx ON ledger.transactions (branch, business_date, id);
CREATE INDEX transactions_kind_idx        ON ledger.transactions (kind, recorded_at);

-- UNIQUE 여야 한다. 일반 인덱스면 "이미 역분개됐는가" 검사가 Read Committed 의
-- check-then-act 가 되어 동시 요청 두 건이 같은 거래를 각각 역분개한다 (잔액 과복구).
-- 두 번째 삽입이 이 인덱스에서 막힌다.
CREATE UNIQUE INDEX transactions_reverses_uq ON ledger.transactions (reverses_tx_id)
  WHERE reverses_tx_id IS NOT NULL;

COMMENT ON COLUMN ledger.transactions.recorded_at IS
  '서버 권위 시각. 현행 phNow()(index.html:4153) 클라이언트 문자열의 대체.';
COMMENT ON COLUMN ledger.transactions.auth_method IS
  '어떤 인증으로 승인된 거래인지 사후 감사할 수 있게 한다.';

-- -----------------------------------------------------------------------------
-- 분개
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.entries (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES ledger.transactions,
  account_id     BIGINT NOT NULL REFERENCES ledger.accounts,
  currency       TEXT NOT NULL REFERENCES ledger.currencies(code),
  amount_minor   BIGINT NOT NULL,          -- 차변 +, 대변 −
  category       ledger.entry_category NOT NULL,

  -- 부모 거래의 지점을 비정규화해 둔다. RLS 정책을 단순 컬럼 비교로 쓸 수 있고
  -- (상관 서브쿼리 정책은 분개 스캔마다 실행된다) 파생 뷰에서 조인이 하나 준다.
  -- 부모와의 일치는 013 의 R6 가 상시 대조한다.
  branch         ledger.branch_code NOT NULL,

  CONSTRAINT entries_amount_nonzero CHECK (amount_minor <> 0)
);

CREATE INDEX entries_account_idx ON ledger.entries (account_id, id);
CREATE INDEX entries_tx_idx      ON ledger.entries (transaction_id);
CREATE INDEX entries_category_idx ON ledger.entries (branch, category, id);

COMMENT ON COLUMN ledger.entries.amount_minor IS
  '부호 있는 최소 단위 정수. 거래별·통화별 합이 항상 0 (I1).';

-- 분개 통화가 계정 통화와 일치해야 한다
CREATE FUNCTION ledger.assert_entry_currency() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_account_currency TEXT;
BEGIN
  SELECT currency INTO v_account_currency FROM ledger.accounts WHERE id = NEW.account_id;
  IF v_account_currency <> NEW.currency THEN
    RAISE EXCEPTION 'entry currency % does not match account % currency %',
      NEW.currency, NEW.account_id, v_account_currency
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entries_currency_match
  BEFORE INSERT ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_entry_currency();

-- -----------------------------------------------------------------------------
-- 분개 정의표 — 04-posting-rules.md 를 데이터로 옮긴 것
-- -----------------------------------------------------------------------------
-- "표에 없는 분개를 만드는 코드는 리뷰에서 반려한다"를 주석이 아니라 제약으로 만든다.
-- (거래종류, 분개범주, 계정종류, 부호) 조합이 이 표에 없으면 커밋이 실패한다.
--
-- 잔액 합이 0이라는 것만으로는 도둑질을 막지 못한다. 예: member_deposit 을
-- 대변 기록하고 suspense 를 차변 기록하면 합은 0이지만 돈이 창조된다.
-- 이 표가 그 조합을 존재하지 않게 만든다.
CREATE TABLE ledger.posting_rules (
  kind         ledger.tx_kind        NOT NULL,
  category     ledger.entry_category NOT NULL,
  account_kind ledger.account_kind   NOT NULL,
  sign         SMALLINT              NOT NULL CHECK (sign IN (-1, 1)),
  PRIMARY KEY (kind, category, account_kind, sign)
);

COMMENT ON TABLE ledger.posting_rules IS
  '04-posting-rules.md 의 각 표가 여기 행으로 들어온다. 문서와 DB 가 갈라지지 않는다.';

-- -----------------------------------------------------------------------------
-- 해시 체인 대상 판정 (design-review.md DR-05)
-- -----------------------------------------------------------------------------
-- 03-ledger-model.md §7-5 와 04-posting-rules.md §13 이 "베팅은 체인 대상에서
-- 제외하고 일 단위 머클 앵커링으로 대체한다"(ADR-006) 고 명시했는데 DDL 에 그
-- 예외가 없었다. post_transaction 이 p_kind 를 보지 않고 무조건 chain_heads 를
-- FOR UPDATE 로 잠갔다.
--
-- chain_heads 는 **지점당 1행**이다. ONLINE 지점의 모든 자금 거래가 그 한 행 뒤에
-- 직렬화된다. 아바타 39초 · 스피드 21초 루프에서 라운드마다 bet + payout 이
-- 발생하므로, 테이블 수 x 회원 수만큼의 거래가 전역 단일 잠금을 통과해야 했다.
--
-- posting_rules 와 같은 방식으로 데이터화한다 — tx_kind 에 값이 추가될 때
-- 정책을 빠뜨릴 수 없다.
CREATE TABLE ledger.chain_policy (
  kind    ledger.tx_kind PRIMARY KEY,
  chained BOOLEAN NOT NULL
);

INSERT INTO ledger.chain_policy
SELECT k, k NOT IN ('bet', 'payout')
  FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k;

COMMENT ON TABLE ledger.chain_policy IS
  'chained=false 인 거래는 해시 체인에 넣지 않는다. 무결성은 일 단위 머클 앵커(audit.merkle_anchors)가 담당한다. ADR-006 · design-review.md DR-05.';

INSERT INTO ledger.posting_rules (kind, category, account_kind, sign) VALUES
  -- §1 입금
  ('deposit',         'deposit_cash',         'house_cash',         1),
  ('deposit',         'deposit_cash',         'member_deposit',    -1),
  -- §2 출금
  ('withdraw',        'withdraw_cash',        'member_deposit',     1),
  ('withdraw',        'withdraw_cash',        'house_cash',        -1),
  -- §3 계좌 간 이체
  ('transfer',        'transfer_out',         'member_deposit',     1),
  ('transfer',        'transfer_in',          'member_deposit',    -1),
  -- §4 지점 간 이체
  ('branch_transfer', 'branch_transfer_in',   'house_cash',         1),
  ('branch_transfer', 'branch_transfer_out',  'house_cash',        -1),
  -- §5 바이인
  ('game_buyin',      'buyin_account',        'member_deposit',     1),
  ('game_buyin',      'buyin_cash',           'house_cash',         1),
  ('game_buyin',      'buyin_marker',         'marker_receivable',  1),
  ('game_buyin',      'working_chip_issue',   'promo_expense',      1),
  ('game_buyin',      'chips_issue',          'chips_outstanding', -1),
  -- §7 중간정산 · §8 게임종료 (분개 동일, kind 만 다르다)
  ('mid_settle',      'chips_redeem',         'chips_outstanding',  1),
  ('mid_settle',      'settle_deposit',       'member_deposit',    -1),
  ('mid_settle',      'settle_cashout',       'house_cash',        -1),
  ('mid_settle',      'settle_marker_redeem', 'marker_receivable', -1),
  ('mid_settle',      'settle_dealer_tip',    'tips_dealer',       -1),
  ('mid_settle',      'settle_house_tip',     'tips_house',        -1),
  ('mid_settle',      'working_chip_return',  'promo_expense',     -1),
  ('game_end',        'chips_redeem',         'chips_outstanding',  1),
  ('game_end',        'settle_deposit',       'member_deposit',    -1),
  ('game_end',        'settle_cashout',       'house_cash',        -1),
  ('game_end',        'settle_marker_redeem', 'marker_receivable', -1),
  ('game_end',        'settle_dealer_tip',    'tips_dealer',       -1),
  ('game_end',        'settle_house_tip',     'tips_house',        -1),
  ('game_end',        'working_chip_return',  'promo_expense',     -1),
  -- §11 밸런싱 차액 (양방향)
  ('adjustment',      'adjustment',           'house_cash',         1),
  ('adjustment',      'adjustment',           'house_cash',        -1),
  ('adjustment',      'adjustment',           'suspense',           1),
  ('adjustment',      'adjustment',           'suspense',          -1),
  -- §11-2 차액 확정 해소 (design-review.md DR-01)
  -- suspense 다리는 언제나 suspense_resolve_out, 종착지는 suspense_resolve_in.
  -- 부족분(suspense 차변 잔액)은 shortage_expense 로, 과잉분(대변)은 overage_income 으로.
  ('suspense_resolve','suspense_resolve_out', 'suspense',          -1),
  ('suspense_resolve','suspense_resolve_in',  'shortage_expense',   1),
  ('suspense_resolve','suspense_resolve_out', 'suspense',           1),
  ('suspense_resolve','suspense_resolve_in',  'overage_income',    -1),
  -- §12 케이지 계좌 <-> 회원 보유금 (양방향)
  ('wallet_transfer', 'wallet_transfer_out',  'member_deposit',     1),
  ('wallet_transfer', 'wallet_transfer_in',   'player_wallet',     -1),
  ('wallet_transfer', 'wallet_transfer_out',  'player_wallet',      1),
  ('wallet_transfer', 'wallet_transfer_in',   'member_deposit',    -1),
  -- §13 베팅 · 페이아웃
  ('bet',             'bet',                  'player_wallet',      1),
  ('bet',             'bet',                  'house_gaming',      -1),
  ('payout',          'payout',               'house_gaming',       1),
  ('payout',          'payout',               'player_wallet',     -1),
  -- §13-2 포인트 — 적립은 프로모션 비용, 전환은 포인트에서 보유금으로
  ('point_earn',      'point_earn',           'promo_expense',         1),
  ('point_earn',      'point_earn',           'player_points',        -1),
  ('point_convert',   'point_convert_out',    'player_points',         1),
  ('point_convert',   'point_convert_in',     'player_wallet',        -1),
  -- §13-3 파트너 쉐어 — 적립은 커미션 비용, 지급은 현금 유출
  ('share_accrue',    'share_accrue',         'commission_expense',    1),
  ('share_accrue',    'share_accrue',         'partner_share_payable',-1),
  ('share_settle',    'share_settle',         'partner_share_payable', 1),
  ('share_settle',    'share_settle',         'house_cash',           -1),
  -- §6-1 롤링 커미션 정산 지급 (design-review-6.md DR-66)
  -- 차변 커미션 비용 / 대변 손님 예치금. 현행 _doSettleGame(index.html:7240)의
  -- applyAccountTransaction(account,'IN',result) 가 이 두 행이 된다.
  -- 원장에 들어가는 금액은 F&B 차감 후 **순지급액**이다. 총커미션과 F&B 차감액은
  -- cage.commission_settlements 가 따로 보존한다 — F&B 매출 인식에는 전용 계정
  -- 종류가 필요하고 이번 범위 밖이다 (README 미확정).
  ('commission_payout','commission_payout',   'commission_expense',    1),
  ('commission_payout','commission_payout',   'member_deposit',       -1);

-- §14 기초 잔액 — 전 계정 종류가 양방향으로 가능하다 (마이그레이션 전용)
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT 'opening_balance', 'opening_balance', k, s
  FROM unnest(enum_range(NULL::ledger.account_kind)) AS k,
       unnest(ARRAY[1, -1]::SMALLINT[])              AS s;

-- §9 게임취소 · 일반 역분개 — 원 분개의 거울상이다.
-- 중요: 역분개는 원 category 를 그대로 유지한다. 'reversal' 로 덮으면
-- category 기준 파생 뷰(013 의 교대 카운터 · 윈로스)가 정정을 반영하지 못한다.
-- 역분개 여부는 transactions.kind='reversal' 과 reverses_tx_id 로 구분한다.
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT DISTINCT rk, r.category, r.account_kind, (-r.sign)::SMALLINT
  FROM ledger.posting_rules r,
       unnest(ARRAY['reversal','game_cancel']::ledger.tx_kind[]) AS rk
 WHERE r.kind NOT IN ('reversal', 'game_cancel')
ON CONFLICT DO NOTHING;

CREATE FUNCTION ledger.assert_posting_rule() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_kind         ledger.tx_kind;
  v_account_kind ledger.account_kind;
BEGIN
  SELECT t.kind INTO v_kind FROM ledger.transactions t WHERE t.id = NEW.transaction_id;
  SELECT a.kind INTO v_account_kind FROM ledger.accounts a WHERE a.id = NEW.account_id;

  IF NOT EXISTS (
    SELECT 1 FROM ledger.posting_rules r
     WHERE r.kind = v_kind
       AND r.category = NEW.category
       AND r.account_kind = v_account_kind
       AND r.sign = sign(NEW.amount_minor)
  ) THEN
    RAISE EXCEPTION
      'posting rule violation: kind=% category=% account_kind=% sign=% 는 04-posting-rules.md 에 없다',
      v_kind, NEW.category, v_account_kind, sign(NEW.amount_minor)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER entries_posting_rule
  BEFORE INSERT ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_posting_rule();

-- -----------------------------------------------------------------------------
-- I1 · 분개 균형 — 지연 제약 트리거
-- -----------------------------------------------------------------------------
-- PostgreSQL 문서:
--   "They can be fired either at the end of the statement causing the triggering
--    event, or at the end of the containing transaction; in the latter case they
--    are said to be deferred."
--   "Constraint triggers are expected to raise an exception when the constraints
--    they implement are violated."
-- 제약: AFTER 만 가능, FOR EACH ROW 만 가능, 일반 테이블만 가능.
CREATE FUNCTION ledger.assert_transaction_balanced() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_currency TEXT;
  v_sum      BIGINT;
  v_legs     INT;
BEGIN
  SELECT count(*) INTO v_legs
    FROM ledger.entries WHERE transaction_id = NEW.transaction_id;

  IF v_legs < 2 THEN
    RAISE EXCEPTION 'transaction % has % entry(ies); double-entry requires at least 2',
      NEW.transaction_id, v_legs
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  FOR v_currency, v_sum IN
    SELECT currency, sum(amount_minor)
      FROM ledger.entries
     WHERE transaction_id = NEW.transaction_id
     GROUP BY currency
  LOOP
    IF v_sum <> 0 THEN
      RAISE EXCEPTION
        'unbalanced transaction %: currency % sums to % (must be 0)',
        NEW.transaction_id, v_currency, v_sum
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER entries_balanced
  AFTER INSERT ON ledger.entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_transaction_balanced();

-- -----------------------------------------------------------------------------
-- I2 · 잔액 하한 — 지연 제약 트리거
-- -----------------------------------------------------------------------------
-- CHECK 를 쓸 수 없는 이유: PostgreSQL 에서 CHECK 제약은 DEFERRABLE 이 될 수 없다.
-- 게임 종료 정산은 최대 7개 계정에 걸치므로, 즉시 평가는 분개 삽입 순서에
-- 의존하는 스키마를 만든다.
CREATE FUNCTION ledger.assert_balance_within_limit() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_kind    ledger.account_kind;
  v_normal  ledger.normal_balance;
  v_negok   BOOLEAN;
  v_code    TEXT;
BEGIN
  SELECT a.kind, a.normal_balance, a.allow_negative, p.code
    INTO v_kind, v_normal, v_negok, v_code
    FROM ledger.accounts a
    JOIN ledger.parties p ON p.id = a.party_id
   WHERE a.id = NEW.account_id;

  IF v_negok THEN
    RETURN NULL;
  END IF;

  IF v_normal = 'debit' AND NEW.balance_minor < 0 THEN
    RAISE EXCEPTION
      'insufficient balance: %[%] would go to % (debit account lower bound is 0)',
      v_kind, v_code, NEW.balance_minor
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_normal = 'credit' AND NEW.balance_minor > 0 THEN
    RAISE EXCEPTION
      'insufficient balance: %[%] would go to % (credit account upper bound is 0; display balance would be negative)',
      v_kind, v_code, NEW.balance_minor
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER balances_within_limit
  AFTER INSERT OR UPDATE ON ledger.account_balances
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_balance_within_limit();

-- -----------------------------------------------------------------------------
-- I6 · 동결 기간 보호
-- -----------------------------------------------------------------------------
CREATE FUNCTION ledger.assert_period_open() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_status ledger.period_status;
BEGIN
  -- FOR SHARE 가 필수다. 잠금 없이 읽으면 다음이 성립한다:
  --   T1 이 status='open' 을 읽는다 → T2 가 동결하고 커밋한다 → T1 이 커밋한다
  --   결과: 동결된 기간에 거래가 들어간다.
  -- FOR SHARE 는 freeze_period() 의 FOR UPDATE 와 충돌하므로 둘 중 하나가 대기한다.
  -- (외래키가 자동으로 잡는 FOR KEY SHARE 는 비키 컬럼 UPDATE 와 충돌하지 않아
  --  이 경합을 막지 못한다 — status 는 키가 아니다.)
  SELECT status INTO v_status
    FROM ledger.accounting_periods
   WHERE branch = NEW.branch AND business_date = NEW.business_date
     FOR SHARE;

  IF v_status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION
      'period %/% is % — 동결 이후 정정은 다음 기간의 adjustment 거래로 처리한다',
      NEW.branch, NEW.business_date, COALESCE(v_status::text, 'missing')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_period_open
  BEFORE INSERT ON ledger.transactions
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_period_open();

-- -----------------------------------------------------------------------------
-- I3 · 불변성 — 단, 해시 봉인 1회는 허용한다
-- -----------------------------------------------------------------------------
-- 거래는 삽입 시점에 아직 분개가 없으므로 해시를 계산할 수 없다.
-- 분개를 다 넣은 뒤 딱 한 번 hash/prev_hash 를 채우는 UPDATE 만 통과시킨다.
-- 이미 봉인된 행(hash IS NOT NULL)은 어떤 UPDATE 도 거부된다.
CREATE FUNCTION ledger.transactions_seal_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_probe ledger.transactions;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only violation: DELETE on ledger.transactions is forbidden'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.hash IS NOT NULL OR OLD.prev_hash IS NOT NULL THEN
    RAISE EXCEPTION
      'transaction % is already sealed — 정정은 역분개(reverses_tx_id)로만 가능하다', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- 봉인 UPDATE 는 해시 두 컬럼 외에는 아무것도 바꿀 수 없다.
  -- 컬럼을 나열해 비교하면 나중에 컬럼이 추가될 때 검사에서 조용히 빠진다.
  -- NEW 에서 해시 두 개만 OLD 값으로 되돌린 뒤 행 전체를 비교한다.
  v_probe           := NEW;
  v_probe.prev_hash := OLD.prev_hash;
  v_probe.hash      := OLD.hash;

  IF v_probe IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'seal update may only set prev_hash and hash'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.hash IS NULL OR NEW.prev_hash IS NULL THEN
    RAISE EXCEPTION 'seal update must set both prev_hash and hash'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER transactions_seal_only
  BEFORE UPDATE OR DELETE ON ledger.transactions
  FOR EACH ROW EXECUTE FUNCTION ledger.transactions_seal_guard();

CREATE TRIGGER entries_immutable
  BEFORE UPDATE OR DELETE ON ledger.entries
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- 봉인되지 않은 거래는 커밋될 수 없다. NOT NULL 제약을 커밋 시점으로 미룬 것이다.
CREATE FUNCTION ledger.assert_transaction_sealed() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_hash    BYTEA;
  v_chained BOOLEAN;
BEGIN
  -- 체인 밖 거래(chain_policy.chained = false)는 hash 가 NULL 인 것이 정상이다
  -- (design-review.md DR-05). 이 분기를 빠뜨리면 bet · payout 이 전부 커밋 거부된다.
  SELECT cp.chained INTO v_chained
    FROM ledger.transactions t
    JOIN ledger.chain_policy cp ON cp.kind = t.kind
   WHERE t.id = NEW.id;

  IF NOT COALESCE(v_chained, TRUE) THEN
    RETURN NULL;
  END IF;

  SELECT hash INTO v_hash FROM ledger.transactions WHERE id = NEW.id;
  IF v_hash IS NULL THEN
    RAISE EXCEPTION 'transaction % was never sealed (hash is NULL)', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER transactions_sealed
  AFTER INSERT ON ledger.transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_transaction_sealed();

-- -----------------------------------------------------------------------------
-- 멱등성 (05-api-contract.md §2)
-- -----------------------------------------------------------------------------
-- IETF draft-ietf-httpapi-idempotency-key-header-07 대응:
--   같은 키 + 같은 페이로드 + 완료   → 저장된 응답 재생
--   같은 키 + 같은 페이로드 + 진행중 → 409
--   같은 키 + 다른 페이로드          → 422
CREATE TABLE ledger.idempotency_keys (
  key                 TEXT PRIMARY KEY,
  request_fingerprint BYTEA NOT NULL,        -- SHA-256(method || path || canonical body)
  state               ledger.idempotency_state NOT NULL DEFAULT 'in_progress',
  response_status     INT,
  response_body       JSONB,
  transaction_id      BIGINT REFERENCES ledger.transactions,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (clock_timestamp() + INTERVAL '24 hours'),

  CONSTRAINT idem_completed_has_response
    CHECK (state <> 'completed' OR response_status IS NOT NULL)
);

CREATE INDEX idempotency_expiry_idx ON ledger.idempotency_keys (expires_at);

COMMENT ON TABLE ledger.idempotency_keys IS
  '보존 24시간. 초안이 만료 정책을 문서화하도록 요구한다.';

-- -----------------------------------------------------------------------------
-- 감사 조회 뷰
-- -----------------------------------------------------------------------------
-- security_invoker = true — 003 의 v_account_balances 와 같은 이유다.
-- 기본값이면 이 뷰가 소유자 권한으로 실행되어 transactions 의 지점 RLS 정책을
-- 통째로 우회한다 (012 는 FORCE ROW LEVEL SECURITY 를 쓰지 않는다).
CREATE VIEW ledger.v_transaction_detail WITH (security_invoker = true) AS
SELECT
  t.external_id,
  t.kind,
  t.branch,
  t.business_date,
  t.recorded_at,
  t.memo,
  t.auth_method,
  s.code                       AS actor_code,
  t.device_id,
  rt.external_id               AS reverses_external_id,
  jsonb_agg(
    jsonb_build_object(
      'account_code',  p.code,
      'kind',          a.kind,
      'currency',      e.currency,
      'amount_minor',  e.amount_minor,
      'category',      e.category
    ) ORDER BY e.id
  )                            AS entries
FROM ledger.transactions t
JOIN ledger.entries  e  ON e.transaction_id = t.id
JOIN ledger.accounts a  ON a.id = e.account_id
JOIN ledger.parties  p  ON p.id = a.party_id
LEFT JOIN identity.staff s ON s.id = t.actor_staff_id
LEFT JOIN ledger.transactions rt ON rt.id = t.reverses_tx_id
GROUP BY t.id, t.external_id, t.kind, t.branch, t.business_date,
         t.recorded_at, t.memo, t.auth_method, s.code, t.device_id, rt.external_id;

COMMIT;
