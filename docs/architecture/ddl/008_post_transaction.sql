-- =============================================================================
-- 008. 원장 코어 — 해시 정규화 · 멱등성 · 기록 · 역분개
-- =============================================================================
-- 이 파일의 함수는 전부 **내부 전용**이다. 012 는 이 중 어느 것에도
-- ledger_app EXECUTE 를 주지 않는다. 애플리케이션은 009~011 의 연산 함수만 호출한다.
--
-- 왜 두 계층인가:
--   post_transaction() 은 "균형 잡힌 분개를 원자적으로 기록한다"만 책임진다.
--   "어떤 분개가 정당한가"(분개 정의표) · "누가 할 수 있는가"(인가) ·
--   "승인이 필요한가"(4-eyes) 는 연산 함수의 책임이다.
--   이 둘을 한 함수에 두고 앱에 노출하면 범용 기록 함수가 그대로 자금 이동 API 가
--   되어 분개 정의표가 장식이 된다.
--
-- post_transaction() 이 강제하는 것:
--   1. 잠금 순서 고정 (기간 → 계정 account_id 오름차순 → 체인헤드) — 데드락 회피
--      PostgreSQL 문서: "The best defense against deadlocks is generally to avoid
--      them by being certain that all applications using a database acquire locks
--      on multiple objects in a consistent order."
--   2. 영업일 서버 계산
--   3. 지점 정합성 — house/game 계정은 거래 지점의 것이어야 한다
--   4. 행위자 · 승인 근거 재확인
--   5. 해시 체인 봉인 (거래 + 분개 전량을 덮는다)
--   6. 잔액 프로젝션 갱신
--   7. Outbox 이벤트 기록 (같은 트랜잭션)
--
-- 격리 수준: 기본값(Read Committed) + 명시적 행 잠금.
-- SERIALIZABLE 을 쓰지 않는 이유는 08-adr.md ADR-004.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 반환 타입
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.posted_tx AS (
  transaction_id BIGINT,
  external_id    UUID,
  business_date  DATE,
  recorded_at    TIMESTAMPTZ,
  hash           BYTEA
);

CREATE TYPE ledger.idem_result AS (
  fresh           BOOLEAN,    -- true 면 새 요청. false 면 저장된 응답을 재생하라
  response_status INT,
  response_body   JSONB,
  transaction_id  BIGINT
);

-- =============================================================================
-- 1. 해시 정규화
-- =============================================================================
-- 기록 경로와 검증 경로가 반드시 같은 함수를 써야 한다.
-- 두 벌로 나뉘면 재계산 검증(013 · R3)이 원본과 어긋나 오탐을 낸다.

-- timestamptz 를 세션 설정과 무관하게 직렬화한다.
-- 주의: 이전 판은 v_now::text 를 썼는데 그 출력은 DateStyle · TimeZone GUC 에
--       좌우된다. 세션 설정만 달라도 재계산 결과가 달라진다.
CREATE FUNCTION ledger.canonical_ts(p_ts TIMESTAMPTZ) RETURNS TEXT
LANGUAGE sql IMMUTABLE STRICT
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT to_char(p_ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- 구분자 이스케이프. memo 에 '|' 를 넣어 필드 경계를 흉내내는 것을 막는다.
CREATE FUNCTION ledger.esc(p_text TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN p_text IS NULL THEN '\N'
              ELSE replace(replace(p_text, '\', '\\'), '|', '\|') END;
$$;

-- 분개 정규 문자열. 입력 JSONB 가 아니라 **저장된 행**에서만 만든다.
-- 삽입 순서에 좌우되지 않게 정렬한다.
CREATE FUNCTION ledger.entries_canon(p_tx_id BIGINT) RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = ledger, pg_temp
AS $$
  SELECT COALESCE(string_agg(
           e.account_id::text   || ':' || e.currency || ':' ||
           e.amount_minor::text || ':' || e.category::text || ':' || e.branch::text,
           '|' ORDER BY e.account_id, e.category, e.amount_minor, e.id), '')
    FROM ledger.entries e
   WHERE e.transaction_id = p_tx_id;
$$;

-- 거래 전체의 정규 문자열. 이전 판이 덮지 않던 필드를 전부 포함한다:
--   actor_staff_id · auth_method · device_id · memo · approval_id ·
--   reverses_tx_id · idempotency_key
-- 행위자가 체인 밖에 있으면 감사 추적의 목적(귀속)이 성립하지 않는다.
CREATE FUNCTION ledger.canonical_digest(p_tx_id BIGINT) RETURNS TEXT
LANGUAGE sql STABLE
SET search_path = ledger, pg_temp
AS $$
  SELECT concat_ws('|',
           'v1',
           t.external_id::text,
           ledger.esc(t.idempotency_key),
           t.kind::text,
           t.branch::text,
           to_char(t.business_date, 'YYYY-MM-DD'),
           ledger.canonical_ts(t.recorded_at),
           COALESCE(t.actor_staff_id::text, '\N'),
           t.auth_method::text,
           ledger.esc(t.device_id),
           ledger.esc(t.memo),
           COALESCE(t.reverses_tx_id::text, '\N'),
           COALESCE(t.approval_id::text, '\N'),
           ledger.entries_canon(t.id)
         )
    FROM ledger.transactions t
   WHERE t.id = p_tx_id;
$$;

COMMENT ON FUNCTION ledger.canonical_digest IS
  '해시 대상 문자열. 기록(008)과 검증(013 R3)이 이 함수 하나를 공유한다.';

-- =============================================================================
-- 2. 멱등성 — 05-api-contract.md §2-2 를 실제로 구현한다
-- =============================================================================
-- 이전 판은 idempotency_keys 테이블을 만들어 두고 아무도 쓰지 않았다.
-- 재시도는 transactions.idempotency_key UNIQUE 의 23505 로 터졌다 — 규약 위반이다.
--
-- ON CONFLICT DO UPDATE 를 쓰는 이유:
--   DO NOTHING 이면 동시 요청의 미커밋 행이 보이지 않아 뒤이은 SELECT 가 빈손이 된다.
--   DO UPDATE 는 그 행을 잠그고 상대 트랜잭션이 끝날 때까지 대기한다.
--   xmax = 0 은 "이번 문장이 삽입한 행"을 뜻하는 관용구다.
CREATE FUNCTION ledger.begin_idempotent(
  p_key         TEXT,
  p_fingerprint BYTEA
) RETURNS ledger.idem_result
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_inserted BOOLEAN;
  v_row      ledger.idempotency_keys;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 THEN
    -- API: 400 idempotency-key-required
    RAISE EXCEPTION 'idempotency key is required'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'idempotency-key-required';
  END IF;

  -- PL/pgSQL 의 다중 타깃 INTO 는 스칼라만 받는다. 행 변수는 단독 타깃이어야
  -- 하므로 삽입 여부만 먼저 받고, 기존 행이면 그때 다시 읽는다. DO UPDATE 가
  -- 이미 행을 잠갔으므로 같은 트랜잭션 안의 재조회는 일관적이다.
  INSERT INTO ledger.idempotency_keys AS ik (key, request_fingerprint)
  VALUES (p_key, p_fingerprint)
  ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
  RETURNING (xmax::text::bigint = 0)
       INTO v_inserted;

  IF v_inserted THEN
    RETURN ROW(TRUE, NULL::INT, NULL::JSONB, NULL::BIGINT)::ledger.idem_result;
  END IF;

  SELECT * INTO v_row FROM ledger.idempotency_keys WHERE key = p_key;

  -- 만료된 키는 새 요청으로 취급한다 (보존 24시간)
  IF v_row.expires_at <= clock_timestamp() THEN
    UPDATE ledger.idempotency_keys
       SET request_fingerprint = p_fingerprint,
           state = 'in_progress',
           response_status = NULL, response_body = NULL, transaction_id = NULL,
           created_at = clock_timestamp(),
           expires_at = clock_timestamp() + INTERVAL '24 hours'
     WHERE key = p_key;
    RETURN ROW(TRUE, NULL::INT, NULL::JSONB, NULL::BIGINT)::ledger.idem_result;
  END IF;

  IF v_row.request_fingerprint IS DISTINCT FROM p_fingerprint THEN
    -- API: 422 idempotency-key-reused
    RAISE EXCEPTION 'idempotency key % was already used with a different payload', p_key
      USING ERRCODE = 'invalid_parameter_value', HINT = 'idempotency-key-reused';
  END IF;

  IF v_row.state = 'in_progress' THEN
    -- API: 409 request-in-progress
    RAISE EXCEPTION 'request with idempotency key % is still in progress', p_key
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'request-in-progress';
  END IF;

  -- completed → 저장된 응답 재생
  RETURN ROW(FALSE, v_row.response_status, v_row.response_body, v_row.transaction_id)
         ::ledger.idem_result;
END;
$$;

COMMENT ON FUNCTION ledger.begin_idempotent IS
  '멱등키 선점. fresh=false 면 호출자는 response_body 를 그대로 반환해야 한다.';

CREATE FUNCTION ledger.complete_idempotent(
  p_key    TEXT,
  p_status INT,
  p_body   JSONB,
  p_tx_id  BIGINT DEFAULT NULL
) RETURNS VOID
LANGUAGE sql
SET search_path = ledger, pg_temp
AS $$
  UPDATE ledger.idempotency_keys
     SET state = 'completed', response_status = p_status,
         response_body = p_body, transaction_id = p_tx_id
   WHERE key = p_key;
$$;

-- 요청 지문. 같은 키로 다른 내용이 오면 422 를 내기 위한 것이다.
-- jsonb 는 키 정렬·중복 제거가 끝난 정규형이므로 ::text 가 결정적이다.
CREATE FUNCTION ledger.request_fingerprint(p_operation TEXT, p_args JSONB)
RETURNS BYTEA
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT sha256(convert_to(p_operation || '|' || p_args::text, 'UTF8'));
$$;

-- 유지보수 배치가 호출한다. 만료 행은 begin_idempotent 가 자동 재사용하지만
-- 테이블이 무한히 커지는 것은 막아야 한다.
CREATE FUNCTION ledger.purge_expired_idempotency() RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_n BIGINT;
BEGIN
  DELETE FROM ledger.idempotency_keys WHERE expires_at <= clock_timestamp();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- =============================================================================
-- 3. 기록 — 내부 전용
-- =============================================================================
-- p_entries 형식:
--   [ {"account_id": 12, "amount_minor":  50000000, "category": "deposit_cash"},
--     {"account_id":  3, "amount_minor": -50000000, "category": "deposit_cash"} ]
CREATE FUNCTION ledger.post_transaction(
  p_idempotency_key TEXT,
  p_kind            ledger.tx_kind,
  p_branch          ledger.branch_code,
  p_actor_staff_id  BIGINT,
  p_auth_method     identity.auth_method,
  p_device_id       TEXT,
  p_entries         JSONB,
  p_memo            TEXT   DEFAULT NULL,
  p_reverses_tx_id  BIGINT DEFAULT NULL,
  p_approval_id     BIGINT DEFAULT NULL
)
RETURNS ledger.posted_tx
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, cage, identity, pg_temp
AS $$
DECLARE
  v_now        TIMESTAMPTZ := clock_timestamp();
  v_bdate      DATE;
  v_ext_id     UUID := uuidv7();
  v_tx_id      BIGINT;
  v_account_id BIGINT;
  v_leg_count  INT;
  v_prev_hash  BYTEA;
  v_hash       BYTEA;
  v_currency   TEXT;
  v_bad        TEXT;
BEGIN
  -- ---- 입력 검증 -----------------------------------------------------------
  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_leg_count FROM jsonb_array_elements(p_entries);
  IF v_leg_count < 2 THEN
    RAISE EXCEPTION 'double-entry requires at least 2 legs, got %', v_leg_count
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_idempotency_key IS NULL OR length(p_idempotency_key) = 0 THEN
    RAISE EXCEPTION 'idempotency key is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_device_id IS NULL OR length(p_device_id) = 0 THEN
    RAISE EXCEPTION 'device_id is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ---- 행위자 검증 (연산 함수의 권한 검사를 보완하는 최후 방어선) ------------
  IF p_auth_method <> 'system' THEN
    IF p_actor_staff_id IS NULL THEN
      RAISE EXCEPTION 'actor_staff_id is required for auth_method %', p_auth_method
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identity.staff s
        JOIN identity.staff_branches sb ON sb.staff_id = s.id
       WHERE s.id = p_actor_staff_id AND s.status = 'active' AND sb.branch = p_branch
    ) THEN
      RAISE EXCEPTION 'staff % may not post in branch %', p_actor_staff_id, p_branch
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---- 승인 근거 검증 -------------------------------------------------------
  -- 소비(상태 전이·투표수·payload 대조)는 연산 함수의 identity.consume_approval()
  -- 이 이미 했다. 여기서는 "그 승인이 실제로 승인됐고 이 지점 것인가"만 재확인해
  -- 존재하지 않는 승인 ID 를 거래에 적어 넣는 경로를 막는다.
  IF p_approval_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM identity.approvals a
       WHERE a.id = p_approval_id AND a.status = 'approved' AND a.branch = p_branch
    ) THEN
      RAISE EXCEPTION 'approval % is not an approved approval for branch %',
        p_approval_id, p_branch
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---- 지점 정합성 ---------------------------------------------------------
  -- 하우스 금고 · 게임 칩 계정은 거래 지점의 것이어야 한다.
  -- 손님(member)과 내부(internal) 계정은 지점 중립이다 — 손님은 지점을 옮겨 다닌다.
  --
  -- 예외: branch_transfer 는 정의상 두 지점의 house_cash 를 함께 움직인다
  -- (04-posting-rules.md §4). 이 경우 호출자인 op_branch_transfer() 가
  -- 양쪽 지점 모두에 대한 행위자 권한을 이미 확인했다.
  -- member 와 partner 는 지점 중립이다. 손님은 지점을 옮겨 다니고, 파트너는
  -- 여러 지점의 회원을 거느린다. house · game 계정만 지점 일치를 요구한다.
  IF p_kind <> 'branch_transfer' THEN
    SELECT p.code INTO v_bad
      FROM jsonb_array_elements(p_entries) AS e
      JOIN ledger.accounts a ON a.id = (e->>'account_id')::BIGINT
      JOIN ledger.parties  p ON p.id = a.party_id
     WHERE p.party_type IN ('house', 'game')
       AND p.home_branch IS DISTINCT FROM p_branch
     LIMIT 1;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'account % does not belong to branch %', v_bad, p_branch
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- branch_transfer 라도 house_cash 외의 계정 종류는 허용하지 않는다
    SELECT p.code INTO v_bad
      FROM jsonb_array_elements(p_entries) AS e
      JOIN ledger.accounts a ON a.id = (e->>'account_id')::BIGINT
      JOIN ledger.parties  p ON p.id = a.party_id
     WHERE a.kind <> 'house_cash'
     LIMIT 1;

    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'branch_transfer may only touch house_cash accounts (got %)', v_bad
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- ---- 영업일 (서버 권위) --------------------------------------------------
  v_bdate := ledger.business_date_of(p_branch, v_now);
  PERFORM ledger.ensure_period_row(p_branch, v_bdate);

  -- ---- 잠금 1: 회계 기간 ---------------------------------------------------
  -- FOR SHARE 로 잡아 두면 이 트랜잭션이 커밋할 때까지 op_freeze_period() 의
  -- FOR UPDATE 가 대기한다. 상태 판정은 004 의 assert_period_open 트리거가 한다.
  PERFORM 1 FROM ledger.accounting_periods
    WHERE branch = p_branch AND business_date = v_bdate
      FOR SHARE;

  -- ---- 잠금 2: 계정 (account_id 오름차순 고정) -----------------------------
  FOR v_account_id IN
    SELECT DISTINCT (e->>'account_id')::BIGINT AS aid
      FROM jsonb_array_elements(p_entries) AS e
     ORDER BY aid
  LOOP
    PERFORM 1 FROM ledger.account_balances
      WHERE account_id = v_account_id
        FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'account % has no balance row', v_account_id
        USING ERRCODE = 'foreign_key_violation';
    END IF;
  END LOOP;

  -- ---- 잠금 3: 해시 체인 헤드 ----------------------------------------------
  SELECT last_hash INTO v_prev_hash
    FROM ledger.chain_heads WHERE branch = p_branch FOR UPDATE;

  IF v_prev_hash IS NULL THEN
    RAISE EXCEPTION 'chain head missing for branch %', p_branch
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- ---- 거래 (해시는 아직 NULL) ---------------------------------------------
  INSERT INTO ledger.transactions (
    external_id, idempotency_key, kind, branch, business_date,
    actor_staff_id, auth_method, device_id, memo,
    reverses_tx_id, approval_id, recorded_at
  ) VALUES (
    v_ext_id, p_idempotency_key, p_kind, p_branch, v_bdate,
    p_actor_staff_id, p_auth_method, p_device_id, p_memo,
    p_reverses_tx_id, p_approval_id, v_now
  )
  RETURNING id INTO v_tx_id;

  -- ---- 분개 ---------------------------------------------------------------
  -- entries_posting_rule 트리거가 (kind, category, account_kind, sign) 조합을
  -- ledger.posting_rules 와 대조한다. 표에 없는 분개는 여기서 막힌다.
  -- entries.branch 는 계정이 지점 귀속이면 그 계정의 지점을, 아니면 거래 지점을 쓴다.
  -- 지점 간 이체에서 받는 쪽 분개가 받는 지점 소속이 되어야 그 지점 직원이
  -- RLS 로 자기 분개를 볼 수 있다.
  INSERT INTO ledger.entries
    (transaction_id, account_id, currency, amount_minor, category, branch)
  SELECT
    v_tx_id,
    (e->>'account_id')::BIGINT,
    a.currency,
    (e->>'amount_minor')::BIGINT,
    (e->>'category')::ledger.entry_category,
    CASE WHEN p.party_type IN ('house', 'game') AND p.home_branch IS NOT NULL
         THEN p.home_branch ELSE p_branch END
  FROM jsonb_array_elements(p_entries) AS e
  JOIN ledger.accounts a ON a.id = (e->>'account_id')::BIGINT
  JOIN ledger.parties  p ON p.id = a.party_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no entries were inserted — account_id 가 존재하지 않는다'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 닫힌 계정에는 기록할 수 없다
  IF EXISTS (
    SELECT 1 FROM ledger.entries e
      JOIN ledger.accounts a ON a.id = e.account_id
     WHERE e.transaction_id = v_tx_id AND a.status <> 'active'
  ) THEN
    RAISE EXCEPTION 'transaction touches a non-active account'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- ---- 봉인 ---------------------------------------------------------------
  -- 분개가 다 들어온 뒤에 해시를 계산한다. 저장된 행에서 만들므로
  -- 013 의 R3 재계산과 정확히 같은 입력을 쓴다.
  v_hash := sha256(v_prev_hash || convert_to(ledger.canonical_digest(v_tx_id), 'UTF8'));

  UPDATE ledger.transactions
     SET prev_hash = v_prev_hash, hash = v_hash
   WHERE id = v_tx_id;

  UPDATE ledger.chain_heads
     SET last_tx_id = v_tx_id, last_hash = v_hash, updated_at = v_now
   WHERE branch = p_branch;

  -- ---- 잔액 프로젝션 -------------------------------------------------------
  -- 하한 검사는 지연 제약 트리거가 커밋 시점에 수행한다 (004 · I2).
  -- 여기서는 중간 상태가 음수여도 무방하다.
  UPDATE ledger.account_balances b
     SET balance_minor = b.balance_minor + agg.delta,
         version       = b.version + 1,
         updated_at    = v_now
    FROM (
      SELECT (e->>'account_id')::BIGINT AS aid,
             sum((e->>'amount_minor')::BIGINT) AS delta
        FROM jsonb_array_elements(p_entries) AS e
       GROUP BY 1
    ) agg
   WHERE b.account_id = agg.aid;

  -- ---- Outbox (같은 트랜잭션) ---------------------------------------------
  SELECT a.currency INTO v_currency
    FROM ledger.entries e JOIN ledger.accounts a ON a.id = e.account_id
   WHERE e.transaction_id = v_tx_id LIMIT 1;

  INSERT INTO ledger.outbox (event_type, channel, aggregate_type, aggregate_id, payload)
  SELECT
    'transaction.posted',
    'ledger:branch:' || p_branch::text,
    'transaction',
    v_ext_id::text,
    jsonb_build_object(
      'external_id',   v_ext_id,
      'kind',          p_kind,
      'branch',        p_branch,
      'business_date', v_bdate,
      'recorded_at',   v_now,
      'currency',      v_currency,
      'entries',       jsonb_agg(jsonb_build_object(
                         'account_code', pa.code,
                         'account_kind', a.kind,
                         'currency',     e.currency,
                         'amount_minor', e.amount_minor,
                         'category',     e.category
                       ) ORDER BY e.id)
    )
  FROM ledger.entries e
  JOIN ledger.accounts a  ON a.id  = e.account_id
  JOIN ledger.parties  pa ON pa.id = a.party_id
  WHERE e.transaction_id = v_tx_id;

  RETURN ROW(v_tx_id, v_ext_id, v_bdate, v_now, v_hash)::ledger.posted_tx;
END;
$$;

COMMENT ON FUNCTION ledger.post_transaction IS
  '내부 전용. 원장에 쓰는 유일한 경로. 012 는 ledger_app 에 EXECUTE 를 주지 않는다.';

-- =============================================================================
-- 4. 역분개 — 정정은 삭제가 아니다 (08-adr.md ADR-009)
-- =============================================================================
CREATE FUNCTION ledger.reverse_transaction(
  p_idempotency_key TEXT,
  p_original_tx_id  BIGINT,
  p_actor_staff_id  BIGINT,
  p_auth_method     identity.auth_method,
  p_device_id       TEXT,
  p_memo            TEXT DEFAULT NULL,
  p_kind            ledger.tx_kind DEFAULT 'reversal',
  p_approval_id     BIGINT DEFAULT NULL
)
RETURNS ledger.posted_tx
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, cage, identity, pg_temp
AS $$
DECLARE
  v_branch  ledger.branch_code;
  v_entries JSONB;
BEGIN
  -- 원 거래 행을 잠근다. 잠그지 않으면 아래 중복 검사가 check-then-act 가 되어
  -- 동시 요청 두 건이 같은 거래를 각각 역분개한다 (잔액 과복구).
  -- 004 의 transactions_reverses_uq 부분 UNIQUE 인덱스가 최종 방어선이고,
  -- 이 잠금은 두 번째 요청이 인덱스 충돌 대신 명확한 메시지를 받게 한다.
  SELECT t.branch INTO v_branch
    FROM ledger.transactions t WHERE t.id = p_original_tx_id FOR UPDATE;

  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'transaction % not found', p_original_tx_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF EXISTS (SELECT 1 FROM ledger.transactions WHERE reverses_tx_id = p_original_tx_id) THEN
    RAISE EXCEPTION 'transaction % is already reversed', p_original_tx_id
      USING ERRCODE = 'unique_violation';
  END IF;

  -- category 를 'reversal' 로 덮지 않고 원 category 를 유지한다.
  -- 덮으면 category 기준 파생 뷰(013 의 교대 카운터 · 윈로스)가 정정을
  -- 반영하지 못한다 — 바이인을 역분개해도 cash_buyin_shift 가 그대로 남는다.
  -- 역분개 여부는 transactions.kind 와 reverses_tx_id 로 구분한다.
  SELECT jsonb_agg(jsonb_build_object(
           'account_id',   e.account_id,
           'amount_minor', -e.amount_minor,      -- 부호만 반전
           'category',     e.category
         ))
    INTO v_entries
    FROM ledger.entries e
   WHERE e.transaction_id = p_original_tx_id;

  RETURN ledger.post_transaction(
    p_idempotency_key,
    p_kind,
    v_branch,
    p_actor_staff_id,
    p_auth_method,
    p_device_id,
    v_entries,
    COALESCE(p_memo, 'reversal of tx ' || p_original_tx_id),
    p_original_tx_id,
    p_approval_id
  );
END;
$$;

-- =============================================================================
-- 5. 계정 조회 헬퍼
-- =============================================================================
CREATE FUNCTION ledger.account_id_of(
  p_party_code TEXT,
  p_kind       ledger.account_kind,
  p_currency   TEXT DEFAULT 'PHP'
) RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  SELECT a.id INTO v_id
    FROM ledger.accounts a
    JOIN ledger.parties  p ON p.id = a.party_id
   WHERE p.code = p_party_code AND a.kind = p_kind AND a.currency = p_currency;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'account not found: % / % / %', p_party_code, p_kind, p_currency
      USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_id;
END;
$$;

-- 지점 하우스 계정 (MAIN-{branch})
CREATE FUNCTION ledger.house_account_id(
  p_branch   ledger.branch_code,
  p_kind     ledger.account_kind,
  p_currency TEXT DEFAULT 'PHP'
) RETURNS BIGINT
LANGUAGE sql
STABLE
SET search_path = ledger, pg_temp
AS $$
  SELECT ledger.account_id_of('MAIN-' || p_branch::text, p_kind, p_currency);
$$;

COMMIT;
