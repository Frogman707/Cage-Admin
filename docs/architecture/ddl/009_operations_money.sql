-- =============================================================================
-- 009. 자금 연산 — 애플리케이션이 호출하는 유일한 자금 경로
-- =============================================================================
-- 이 파일부터 011 까지가 애플리케이션 API 다. 012 는 이 함수들의 EXECUTE 만
-- ledger_app 에 부여하고, 테이블 DML 과 008 의 코어 함수는 전부 막는다.
--
-- 각 함수가 순서대로 하는 일:
--   1. ledger.begin_idempotent()           멱등키 선점 · 재생 · 409 · 422
--   2. identity.assert_actor_authorized()  직원상태 · 지점소속 · 역할권한
--   3. identity.consume_approval()         (필요한 연산만) 4-eyes 승인 1회 소비
--   4. 계정 해석 + 04-posting-rules.md 의 분개 구성
--   5. ledger.post_transaction()           원자적 기록
--   6. ledger.complete_idempotent()        응답 저장 (재시도 시 재생됨)
--
-- 분개는 함수가 만든다. 호출자가 계정과 부호를 지정할 방법이 없다.
-- 임의 분개 주입을 구조적으로 막는 유일한 방법이다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 공통 응답 조립 — 05-api-contract.md §3-1 의 응답 본문
-- -----------------------------------------------------------------------------
-- 거래 식별자 + 갱신 잔액 + 분개를 함께 돌려준다. 클라이언트가 재조회할 필요가 없다.
CREATE FUNCTION ledger.tx_response(p_tx ledger.posted_tx) RETURNS JSONB
LANGUAGE sql STABLE
SET search_path = ledger, pg_temp
AS $$
  SELECT jsonb_build_object(
    'transaction', jsonb_build_object(
      'external_id',   p_tx.external_id,
      'kind',          t.kind,
      'branch',        t.branch,
      'business_date', p_tx.business_date,
      'recorded_at',   p_tx.recorded_at
    ),
    'entries', (
      SELECT jsonb_agg(jsonb_build_object(
               'account_code', pa.code,
               'kind',         a.kind,
               'currency',     e.currency,
               'amount_minor', e.amount_minor,
               'category',     e.category
             ) ORDER BY e.id)
        FROM ledger.entries  e
        JOIN ledger.accounts a  ON a.id  = e.account_id
        JOIN ledger.parties  pa ON pa.id = a.party_id
       WHERE e.transaction_id = p_tx.transaction_id
    ),
    'balances', (
      SELECT jsonb_agg(DISTINCT jsonb_build_object(
               'account_code',          v.party_code,
               'kind',                  v.kind,
               'currency',              v.currency,
               'display_balance_minor', v.display_balance_minor
             ))
        FROM ledger.v_account_balances v
       WHERE v.account_id IN (
               SELECT e.account_id FROM ledger.entries e
                WHERE e.transaction_id = p_tx.transaction_id)
    )
  )
  FROM ledger.transactions t
 WHERE t.id = p_tx.transaction_id;
$$;

-- 금액 검증. 모든 연산이 앞부분에서 부른다.
CREATE FUNCTION ledger.assert_positive(p_amount_minor BIGINT, p_label TEXT)
RETURNS VOID
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION '% must be a positive minor-unit integer, got %',
      p_label, COALESCE(p_amount_minor::text, 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END;
$$;

-- 임계 금액 초과 시 4-eyes 를 요구한다.
-- 승인이 필요한데 없으면 여기서 막힌다 (API: 202 approval-required).
CREATE FUNCTION ledger.require_approval_if_over_threshold(
  p_branch       TEXT,
  p_amount_minor BIGINT,
  p_approval_id  BIGINT,
  p_subject_kind identity.approval_subject,
  p_payload      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_threshold BIGINT;
BEGIN
  SELECT approval_threshold_minor INTO v_threshold
    FROM ledger.branch_config WHERE branch = p_branch;

  -- design-review-3.md DR-39. 001 에서 이 컬럼이 NOT NULL 이 됐으므로 NULL 은
  -- 더 이상 "임계 없음" 을 뜻하지 않는다 — branch_config 행 자체가 없다는 뜻이다.
  -- 설정 누락은 통과가 아니라 거부다. 통제가 조용히 꺼지는 경로를 남기지 않는다.
  IF v_threshold IS NULL THEN
    RAISE EXCEPTION
      'branch % has no approval threshold configured', p_branch
      USING ERRCODE = 'configuration_limit_exceeded',
            HINT = 'ledger.branch_config.approval_threshold_minor 를 설정하라';
  END IF;

  IF p_amount_minor < v_threshold THEN
    RETURN;                       -- 임계 미만 — 승인 불필요
  END IF;

  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION
      'amount % exceeds branch % approval threshold % — 4-eyes 승인이 필요하다',
      p_amount_minor, p_branch, v_threshold
      USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
  END IF;

  PERFORM identity.consume_approval(p_approval_id, p_subject_kind, p_branch, p_payload);
END;
$$;

-- =============================================================================
-- §1 입금 — 04-posting-rules.md §1
-- =============================================================================
CREATE FUNCTION ledger.op_deposit(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_account_code    TEXT,
  p_amount_minor    BIGINT,
  p_currency        TEXT DEFAULT 'PHP',
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'account_code', p_account_code,
                    'amount_minor', p_amount_minor, 'currency', p_currency);
  v_idem ledger.idem_result;
  v_tx   ledger.posted_tx;
  v_body JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('deposit', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.deposit');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.deposit');
  PERFORM ledger.assert_positive(p_amount_minor, 'amount_minor');

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'deposit', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, 'house_cash', p_currency),
        'amount_minor',  p_amount_minor, 'category', 'deposit_cash'),
      jsonb_build_object('account_id',
        ledger.account_id_of(p_account_code, 'member_deposit', p_currency),
        'amount_minor', -p_amount_minor, 'category', 'deposit_cash')
    ),
    p_memo);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §2 출금 — 04-posting-rules.md §2
-- =============================================================================
-- 잔액 부족은 004 의 I2 지연 제약 트리거가 커밋 시점에 막는다.
-- 금고 현금 부족도 같은 방식으로 막힌다 — 현행에는 이 검사가 아예 없다.
CREATE FUNCTION ledger.op_withdraw(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_account_code    TEXT,
  p_amount_minor    BIGINT,
  p_currency        TEXT   DEFAULT 'PHP',
  p_memo            TEXT   DEFAULT NULL,
  p_approval_id     BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'account_code', p_account_code,
                    'amount_minor', p_amount_minor, 'currency', p_currency);
  v_idem ledger.idem_result;
  v_tx   ledger.posted_tx;
  v_body JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('withdraw', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.withdraw');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.withdraw');
  PERFORM ledger.assert_positive(p_amount_minor, 'amount_minor');

  -- 출금은 재인증이 필수다. 현행 requestWithdrawAuth() 흐름을 서버가 강제한다.
  IF v_auth NOT IN ('withdraw_pw', 'totp', 'approval') THEN
    RAISE EXCEPTION 'withdraw requires step-up auth (withdraw_pw · totp · approval), got %',
      v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  PERFORM ledger.require_approval_if_over_threshold(
            p_branch, p_amount_minor, p_approval_id, 'withdrawal', v_args);

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'withdraw', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.account_id_of(p_account_code, 'member_deposit', p_currency),
        'amount_minor',  p_amount_minor, 'category', 'withdraw_cash'),
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, 'house_cash', p_currency),
        'amount_minor', -p_amount_minor, 'category', 'withdraw_cash')
    ),
    p_memo, NULL, p_approval_id);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §3 계좌 간 이체 — 04-posting-rules.md §3
-- =============================================================================
-- 현행의 반쪽 거래(index.html:6562-6566 toastTransferHalfFailed)가
-- 단일 트랜잭션이 되어 구조적으로 사라진다.
CREATE FUNCTION ledger.op_transfer(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_from_code       TEXT,
  p_to_code         TEXT,
  p_amount_minor    BIGINT,
  p_currency        TEXT DEFAULT 'PHP',
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'from', p_from_code, 'to', p_to_code,
                    'amount_minor', p_amount_minor, 'currency', p_currency);
  v_idem ledger.idem_result;
  v_tx   ledger.posted_tx;
  v_body JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('transfer', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.transfer');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.transfer');
  PERFORM ledger.assert_positive(p_amount_minor, 'amount_minor');

  IF p_from_code = p_to_code THEN
    RAISE EXCEPTION 'transfer source and destination are the same account (%)', p_from_code
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_auth NOT IN ('withdraw_pw', 'totp', 'approval') THEN
    RAISE EXCEPTION 'transfer requires step-up auth, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'transfer', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.account_id_of(p_from_code, 'member_deposit', p_currency),
        'amount_minor',  p_amount_minor, 'category', 'transfer_out'),
      jsonb_build_object('account_id',
        ledger.account_id_of(p_to_code, 'member_deposit', p_currency),
        'amount_minor', -p_amount_minor, 'category', 'transfer_in')
    ),
    p_memo);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §4 지점 간 이체 — 04-posting-rules.md §4
-- =============================================================================
-- 두 지점의 house_cash 를 하나의 거래로 움직인다. 08 의 지점 정합성 검사는
-- kind='branch_transfer' 일 때만 이를 허용하고, 대신 house_cash 이외의 계정
-- 종류를 전면 금지한다. 양쪽 지점 권한 확인은 이 함수의 책임이다.
--
-- suspense 경유를 쓰지 않는 이유: suspense 는 R5 대사가 "항상 0"을 요구하는
-- 계정이라, 이체 중간 상태가 지점별로 0이 아니게 되어 무결성 알람이 울린다.
CREATE FUNCTION ledger.op_branch_transfer(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_from_branch     TEXT,
  p_to_branch       TEXT,
  p_amount_minor    BIGINT,
  p_currency        TEXT   DEFAULT 'PHP',
  p_memo            TEXT   DEFAULT NULL,
  p_approval_id     BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args   JSONB := jsonb_build_object(
                      'from_branch', p_from_branch, 'to_branch', p_to_branch,
                      'amount_minor', p_amount_minor, 'currency', p_currency);
  v_idem   ledger.idem_result;
  v_tx     ledger.posted_tx;
  v_body   JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('branch_transfer', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  -- 양쪽 지점 모두에 대한 권한을 요구한다
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_from_branch,
                                           'ledger.branch_transfer');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.branch_transfer');
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_to_branch,
                                           'ledger.branch_transfer');
  PERFORM ledger.assert_positive(p_amount_minor, 'amount_minor');

  IF p_from_branch = p_to_branch THEN
    RAISE EXCEPTION 'branch transfer source and destination are the same (%)', p_from_branch
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM ledger.require_approval_if_over_threshold(
            p_from_branch, p_amount_minor, p_approval_id, 'withdrawal', v_args);

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'branch_transfer', p_from_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.house_account_id(p_to_branch, 'house_cash', p_currency),
        'amount_minor',  p_amount_minor, 'category', 'branch_transfer_in'),
      jsonb_build_object('account_id',
        ledger.house_account_id(p_from_branch, 'house_cash', p_currency),
        'amount_minor', -p_amount_minor, 'category', 'branch_transfer_out')
    ),
    COALESCE(p_memo, p_from_branch::text || ' -> ' || p_to_branch::text),
    NULL, p_approval_id);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_branch_transfer IS
  '지점 간 이체. 두 지점 house_cash 를 단일 거래로 움직인다. 현행의 별도 감사 로그 테이블은 불필요하다.';

-- =============================================================================
-- §12 케이지 계좌 <-> 회원 보유금 — 04-posting-rules.md §12
-- =============================================================================
CREATE FUNCTION ledger.op_wallet_transfer(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_account_code    TEXT,
  p_member_code     TEXT,
  p_amount_minor    BIGINT,
  p_to_wallet       BOOLEAN,              -- true: 케이지 계좌 → 보유금
  p_currency        TEXT DEFAULT 'PHP',
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'account_code', p_account_code,
                    'member_code', p_member_code, 'amount_minor', p_amount_minor,
                    'to_wallet', p_to_wallet, 'currency', p_currency);
  v_idem ledger.idem_result;
  v_tx   ledger.posted_tx;
  v_body JSONB;
  v_cage BIGINT;
  v_wall BIGINT;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('wallet_transfer', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch,
                                           'ledger.wallet_transfer');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.wallet_transfer');
  PERFORM ledger.assert_positive(p_amount_minor, 'amount_minor');

  v_cage := ledger.account_id_of(p_account_code, 'member_deposit', p_currency);
  v_wall := ledger.account_id_of(p_member_code,  'player_wallet',  p_currency);

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'wallet_transfer', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    CASE WHEN p_to_wallet THEN
      jsonb_build_array(
        jsonb_build_object('account_id', v_cage,
          'amount_minor',  p_amount_minor, 'category', 'wallet_transfer_out'),
        jsonb_build_object('account_id', v_wall,
          'amount_minor', -p_amount_minor, 'category', 'wallet_transfer_in'))
    ELSE
      jsonb_build_array(
        jsonb_build_object('account_id', v_wall,
          'amount_minor',  p_amount_minor, 'category', 'wallet_transfer_out'),
        jsonb_build_object('account_id', v_cage,
          'amount_minor', -p_amount_minor, 'category', 'wallet_transfer_in'))
    END,
    p_memo);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §11 밸런싱 차액 조정 — 04-posting-rules.md §11
-- =============================================================================
-- 4-eyes 가 무조건 필수다. 금액 임계와 무관하다 — 차액 조정은 그 자체가
-- "장부를 실물에 맞추는" 행위라 단독 수행을 허용할 수 없다.
CREATE FUNCTION ledger.op_adjustment(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_variance_minor  BIGINT,               -- 실사 − 시스템. 양수면 과잉, 음수면 부족
  p_approval_id     BIGINT,
  p_currency        TEXT DEFAULT 'PHP',
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'variance_minor', p_variance_minor,
                    'currency', p_currency);
  v_idem ledger.idem_result;
  v_tx   ledger.posted_tx;
  v_body JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('adjustment', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.adjustment');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.adjustment');

  IF p_variance_minor IS NULL OR p_variance_minor = 0 THEN
    RAISE EXCEPTION 'variance_minor must be non-zero'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'adjustment always requires a 4-eyes approval'
      USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
  END IF;

  PERFORM identity.consume_approval(p_approval_id, 'adjustment', p_branch, v_args);

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'adjustment', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, 'house_cash', p_currency),
        'amount_minor',  p_variance_minor, 'category', 'adjustment'),
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, 'suspense', p_currency),
        'amount_minor', -p_variance_minor, 'category', 'adjustment')
    ),
    COALESCE(p_memo, 'balancing variance'), NULL, p_approval_id);

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- 실사 차액 확정 해소 — suspense 를 0으로 되돌린다 (design-review.md DR-01)
-- =============================================================================
-- 이 함수가 없던 동안 실사 차액이 한 번 발생하면 그 지점은 **다시 마감되지 않았다.**
--   1. 실사 차액 → op_record_balancing 이 adjustment 거래 생성 (house_cash <-> suspense)
--   2. suspense 잔액 <> 0
--   3. op_freeze_period 거부 (011:304-313)
--   4. suspense 를 0으로 되돌릴 경로가 없다 → 3으로
-- op_adjustment 를 다시 불러도 house_cash <-> suspense 를 왕복할 뿐이었다.
-- 차액을 최종 귀착시킬 계정 자체가 account_kind 에 없었다.
--
-- 탈출구 없는 제약은 우회를 만든다. 멈춘 상태에서 사람이 하는 일은 정해져 있다 —
-- DBA 에게 직접 UPDATE 를 요청하고, 그 순간 불변식 전체가 무의미해진다.
--
-- 금액을 호출자가 지정하지 않는다. 함수가 현재 잔액을 직접 읽어 정한다.
-- 부분 해소도 없다. 호출 후 suspense 잔액은 정확히 0 이다.
CREATE FUNCTION ledger.op_resolve_suspense(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          TEXT,
  p_resolution      TEXT,             -- 조사 결과. NULL · 빈 문자열 불가
  p_approval_id     BIGINT,           -- NULL 불가. 금액과 무관하게 항상 4-eyes
  p_currency        TEXT DEFAULT 'PHP'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args      JSONB := jsonb_build_object('branch', p_branch, 'currency', p_currency);
  v_idem      ledger.idem_result;
  v_suspense  BIGINT;
  v_susp_acct BIGINT;
  v_dest_kind ledger.account_kind;
  v_tx        ledger.posted_tx;
  v_body      JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('resolve_suspense', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.suspense_resolve');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.suspense_resolve');

  IF p_resolution IS NULL OR btrim(p_resolution) = '' THEN
    RAISE EXCEPTION 'suspense resolution requires a written finding'
      USING ERRCODE = 'invalid_parameter_value',
            HINT = '차액을 확정 손실 · 이익으로 넘기는 조작이다. 조사 결과 없이 통과시키지 않는다';
  END IF;

  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'suspense resolution always requires a 4-eyes approval'
      USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
  END IF;

  v_susp_acct := ledger.house_account_id(p_branch, 'suspense', p_currency);

  -- 잔액 행을 잠근다. 잠그지 않으면 동시 요청 두 건이 같은 잔액을 각각 해소해
  -- suspense 를 반대 방향으로 넘긴다.
  SELECT b.balance_minor INTO v_suspense
    FROM ledger.account_balances b
   WHERE b.account_id = v_susp_acct
   FOR UPDATE;

  IF COALESCE(v_suspense, 0) = 0 THEN
    RAISE EXCEPTION 'branch % has no suspense balance to resolve', p_branch
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM identity.consume_approval(p_approval_id, 'suspense_resolve', p_branch, v_args);

  -- 차변 잔액(양수) = 부족분 → 확정 손실. 대변 잔액(음수) = 과잉분 → 확정 이익.
  v_dest_kind := CASE WHEN v_suspense > 0 THEN 'shortage_expense' ELSE 'overage_income' END;

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'suspense_resolve', p_branch,
    p_actor_staff_id, v_auth, p_device_id,
    jsonb_build_array(
      jsonb_build_object('account_id', v_susp_acct,
        'amount_minor', -v_suspense, 'category', 'suspense_resolve_out'),
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, v_dest_kind, p_currency),
        'amount_minor',  v_suspense, 'category', 'suspense_resolve_in')
    ),
    p_resolution, NULL, p_approval_id);

  v_body := ledger.tx_response(v_tx) || jsonb_build_object(
              'resolved_minor', v_suspense,
              'destination',    v_dest_kind);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_resolve_suspense IS
  '실사 차액을 확정 손실 · 이익으로 귀착시켜 suspense 를 0으로 만든다. 승인 · 조사 결과 필수. design-review.md DR-01.';

COMMIT;
