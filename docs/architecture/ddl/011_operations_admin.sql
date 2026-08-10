-- =============================================================================
-- 011. 운영 연산 — 승인 · 실사 · 기간 마감 · 교대 · 계좌 개설
-- =============================================================================
-- 006 에 있던 freeze_period() 가 여기로 온다. 잠금 프로토콜과 4-eyes 가 붙어
-- 연산 함수 계층의 규약을 따라야 하기 때문이다.
--
-- 주의: op_settle_period() 는 013 의 ledger.integrity_ok() 를 호출한다.
--       plpgsql 본문은 실행 시점에 해석되므로 생성 순서는 무관하지만,
--       013 을 적용하기 전에는 이 함수를 호출할 수 없다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- =============================================================================
-- 1. 4-eyes 승인 — 요청과 투표
-- =============================================================================
-- 승인 payload 는 **실행될 연산이 만드는 args JSONB 와 정확히 같아야 한다.**
-- consume_approval() 이 jsonb 동등성으로 대조하므로, 다른 내용을 승인받아
-- 다른 요청을 실행하는 경로가 없다.
CREATE FUNCTION identity.op_request_approval(
  p_actor_staff_id BIGINT,
  p_branch         ledger.branch_code,
  p_subject_kind   identity.approval_subject,
  p_subject_ref    TEXT,
  p_payload        JSONB,
  p_required_count SMALLINT DEFAULT 2,
  p_ttl            INTERVAL DEFAULT INTERVAL '2 hours'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_id  BIGINT;
  v_ext UUID;
BEGIN
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'approval.request');

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'approval payload is required — 무엇을 승인하는지가 명시돼야 한다'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO identity.approvals
    (subject_kind, subject_ref, payload, required_count, branch, requested_by, expires_at)
  VALUES
    (p_subject_kind, p_subject_ref, p_payload, p_required_count, p_branch,
     p_actor_staff_id, clock_timestamp() + p_ttl)
  RETURNING id, external_id INTO v_id, v_ext;

  RETURN jsonb_build_object(
    'approval_id', v_id, 'external_id', v_ext,
    'required_count', p_required_count, 'status', 'pending');
END;
$$;

COMMENT ON FUNCTION identity.op_request_approval IS
  'payload 는 실행될 연산의 args JSONB 와 정확히 같아야 한다. consume_approval() 이 대조한다.';

-- 요청자 배제는 approval_votes_four_eyes 트리거가, 중복 투표는 PK 가 막는다.
CREATE FUNCTION identity.op_cast_vote(
  p_actor_staff_id BIGINT,
  p_approval_id    BIGINT,
  p_decision       identity.approval_decision,
  p_auth_method    identity.auth_method
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_a       identity.approvals;
  v_approve INT;
BEGIN
  SELECT * INTO v_a FROM identity.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval % not found', p_approval_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_a.branch, 'approval.vote');

  IF v_a.status <> 'pending' THEN
    RAISE EXCEPTION 'approval % is %', p_approval_id, v_a.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_a.expires_at <= clock_timestamp() THEN
    UPDATE identity.approvals SET status = 'expired', resolved_at = clock_timestamp()
     WHERE id = p_approval_id;
    RAISE EXCEPTION 'approval % expired', p_approval_id
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 재인증 없이 승인할 수 없다
  IF p_auth_method NOT IN ('pin', 'totp', 'withdraw_pw') THEN
    RAISE EXCEPTION 'approval vote requires re-authentication, got %', p_auth_method
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  INSERT INTO identity.approval_votes (approval_id, staff_id, decision, auth_method)
  VALUES (p_approval_id, p_actor_staff_id, p_decision, p_auth_method);

  IF p_decision = 'reject' THEN
    UPDATE identity.approvals SET status = 'rejected', resolved_at = clock_timestamp()
     WHERE id = p_approval_id;
    RETURN jsonb_build_object('approval_id', p_approval_id, 'status', 'rejected');
  END IF;

  SELECT count(*) INTO v_approve
    FROM identity.approval_votes
   WHERE approval_id = p_approval_id AND decision = 'approve';

  -- status 는 여기서 바꾸지 않는다. consume_approval() 이 실행 시점에 투표수를
  -- 다시 세고 approved 로 전이시킨다 — 승인은 1회용이어야 한다.
  RETURN jsonb_build_object(
    'approval_id',    p_approval_id,
    'approve_votes',  v_approve,
    'required_count', v_a.required_count,
    'ready',          v_approve >= v_a.required_count);
END;
$$;

-- =============================================================================
-- 2. 실사 — 04-posting-rules.md §11
-- =============================================================================
-- 차액이 있으면 조정 거래를 **같은 트랜잭션에서** 만든다.
-- 실사 기록과 차액 조정이 갈라지면 차액이 조용히 묻힐 창이 생긴다.
CREATE FUNCTION cage.op_record_balancing(
  p_idempotency_key     TEXT,
  p_actor_staff_id      BIGINT,
  p_auth_method         identity.auth_method,
  p_device_id           TEXT,
  p_branch              ledger.branch_code,
  p_count_kind          cage.count_kind,
  p_denomination_counts JSONB,
  p_counted_total_minor BIGINT,
  p_system_total_minor  BIGINT,
  p_verified_by         BIGINT DEFAULT NULL,
  p_approval_id         BIGINT DEFAULT NULL,
  p_currency            TEXT   DEFAULT 'PHP'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'count_kind', p_count_kind,
                    'counted_total_minor', p_counted_total_minor,
                    'system_total_minor', p_system_total_minor);
  v_idem     ledger.idem_result;
  v_bdate    DATE;
  v_variance BIGINT := p_counted_total_minor - p_system_total_minor;
  v_tx       ledger.posted_tx;
  v_tx_id    BIGINT := NULL;
  v_id       BIGINT;
  v_body     JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('record_balancing', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'balancing.count');
  v_bdate := ledger.business_date_of(p_branch, clock_timestamp());

  IF p_counted_total_minor < 0 THEN
    RAISE EXCEPTION 'counted_total_minor must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 차액이 있으면 조정 거래가 필수다. 006 의 assert_variance_adjusted 트리거는
  -- verified_by 가 채워진 채 조정 없이 저장되는 것을 막는 최후 방어선이고,
  -- 여기서 조정 거래를 같은 트랜잭션에 먼저 만든다.
  IF v_variance <> 0 THEN
    IF p_approval_id IS NULL THEN
      RAISE EXCEPTION 'variance % requires a 4-eyes approval', v_variance
        USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
    END IF;

    PERFORM identity.consume_approval(p_approval_id, 'adjustment', p_branch, v_args);

    v_tx := ledger.post_transaction(
      p_idempotency_key || ':adj', 'adjustment', p_branch,
      p_actor_staff_id, p_auth_method, p_device_id,
      jsonb_build_array(
        jsonb_build_object('account_id',
          ledger.house_account_id(p_branch, 'house_cash', p_currency),
          'amount_minor',  v_variance, 'category', 'adjustment'),
        jsonb_build_object('account_id',
          ledger.house_account_id(p_branch, 'suspense', p_currency),
          'amount_minor', -v_variance, 'category', 'adjustment')
      ),
      'balancing variance ' || p_count_kind::text, NULL, p_approval_id);

    v_tx_id := v_tx.transaction_id;
  END IF;

  INSERT INTO cage.balancing_counts (
    branch, business_date, count_kind, denomination_counts,
    counted_total_minor, system_total_minor, adjustment_tx_id,
    counted_by, verified_by
  ) VALUES (
    p_branch, v_bdate, p_count_kind, p_denomination_counts,
    p_counted_total_minor, p_system_total_minor, v_tx_id,
    p_actor_staff_id, p_verified_by
  )
  RETURNING id INTO v_id;

  v_body := jsonb_build_object(
              'balancing_count_id', v_id,
              'branch',             p_branch,
              'business_date',      v_bdate,
              'variance_minor',     v_variance,
              'adjustment',         CASE WHEN v_tx_id IS NULL THEN NULL
                                         ELSE ledger.tx_response(v_tx) END);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION cage.op_record_balancing IS
  '실사 기록 + 차액 조정 거래를 한 트랜잭션에서 처리한다. 차액은 4-eyes 없이 흡수될 수 없다.';

-- =============================================================================
-- 3. 기간 마감 — 006 에서 이동. 잠금 프로토콜이 핵심이다
-- =============================================================================
-- 현행 월정산(index.html:8274-8280)은 메인케이지 누계 · 교대 카운터 · 게임 롤링을
-- 실제로 리셋한다. 신규는 데이터를 건드리지 않고 기간 상태만 전이한다.
--
-- FOR UPDATE 가 없으면: post_transaction 이 기간을 'open' 으로 읽은 직후
-- 동결이 커밋되고, 그 뒤 거래가 커밋되어 **동결된 기간에 거래가 들어간다.**
-- post_transaction 은 기간 행을 FOR SHARE 로 잡으므로 여기 FOR UPDATE 와 충돌해
-- 진행 중인 기록이 전부 끝난 뒤에야 동결이 진행된다.
CREATE FUNCTION ledger.op_freeze_period(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_auth_method     identity.auth_method,
  p_device_id       TEXT,
  p_branch          ledger.branch_code,
  p_business_date   DATE,
  p_approval_id     BIGINT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, cage, identity, pg_temp
AS $$
DECLARE
  v_args JSONB := jsonb_build_object('branch', p_branch, 'business_date', p_business_date);
  v_idem       ledger.idem_result;
  v_status     ledger.period_status;
  v_open_games INT;
  v_suspense   BIGINT;
  v_unsealed   INT;
  v_body       JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('freeze_period', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'period.freeze');

  IF p_approval_id IS NOT NULL THEN
    PERFORM identity.consume_approval(p_approval_id, 'period_settle', p_branch, v_args);
  END IF;

  -- ---- 잠금: 이 시점부터 해당 기간에 새 거래가 들어올 수 없다 ----------------
  SELECT status INTO v_status
    FROM ledger.accounting_periods
   WHERE branch = p_branch AND business_date = p_business_date
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'period %/% does not exist', p_branch, p_business_date
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'open' THEN
    RAISE EXCEPTION 'period %/% is %', p_branch, p_business_date, v_status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 진행 중 게임이 있으면 마감할 수 없다
  SELECT count(*) INTO v_open_games
    FROM cage.games
   WHERE branch = p_branch AND business_date = p_business_date AND status = 'ongoing';
  IF v_open_games > 0 THEN
    RAISE EXCEPTION 'cannot freeze %/%: % ongoing game(s)',
      p_branch, p_business_date, v_open_games
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 봉인되지 않은 거래가 있으면 마감할 수 없다 (있어서는 안 되는 상태)
  SELECT count(*) INTO v_unsealed
    FROM ledger.transactions
   WHERE branch = p_branch AND business_date = p_business_date AND hash IS NULL;
  IF v_unsealed > 0 THEN
    RAISE EXCEPTION 'cannot freeze %/%: % unsealed transaction(s)',
      p_branch, p_business_date, v_unsealed
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- 미해소 실사 차액이 있으면 마감할 수 없다
  SELECT COALESCE(sum(b.balance_minor), 0) INTO v_suspense
    FROM ledger.accounts a
    JOIN ledger.parties p ON p.id = a.party_id
    JOIN ledger.account_balances b ON b.account_id = a.id
   WHERE a.kind = 'suspense' AND p.home_branch = p_branch;
  IF v_suspense <> 0 THEN
    RAISE EXCEPTION 'cannot freeze %/%: suspense balance is % (미해소 차액)',
      p_branch, p_business_date, v_suspense
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE ledger.accounting_periods
     SET status = 'frozen', frozen_at = clock_timestamp(), closed_by = p_actor_staff_id
   WHERE branch = p_branch AND business_date = p_business_date;

  -- 다음 영업일 기간을 연다
  PERFORM ledger.ensure_period_row(p_branch, p_business_date + 1);

  v_body := jsonb_build_object(
              'branch', p_branch, 'business_date', p_business_date, 'status', 'frozen');
  PERFORM ledger.complete_idempotent(p_idempotency_key, 200, v_body, NULL);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_freeze_period IS
  '컷오프. 기간 행을 FOR UPDATE 로 잡아 진행 중 기록이 전부 끝난 뒤에만 동결된다.';

-- 월정산 — 동결된 기간을 확정한다. 4-eyes 필수.
CREATE FUNCTION ledger.op_settle_period(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_auth_method     identity.auth_method,
  p_device_id       TEXT,
  p_branch          ledger.branch_code,
  p_business_date   DATE,
  p_approval_id     BIGINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, cage, identity, pg_temp
AS $$
DECLARE
  v_args JSONB := jsonb_build_object('branch', p_branch, 'business_date', p_business_date);
  v_idem   ledger.idem_result;
  v_status ledger.period_status;
  v_body   JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('settle_period', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'period.settle');

  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'period settlement always requires a 4-eyes approval'
      USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
  END IF;
  PERFORM identity.consume_approval(p_approval_id, 'period_settle', p_branch, v_args);

  SELECT status INTO v_status
    FROM ledger.accounting_periods
   WHERE branch = p_branch AND business_date = p_business_date
     FOR UPDATE;

  IF v_status IS DISTINCT FROM 'frozen' THEN
    RAISE EXCEPTION 'period %/% must be frozen before settling (is %)',
      p_branch, p_business_date, COALESCE(v_status::text, 'missing')
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  -- 무결성 대사가 깨진 상태로는 확정할 수 없다 (013 의 R1~R7)
  IF NOT ledger.integrity_ok() THEN
    RAISE EXCEPTION 'cannot settle: ledger integrity checks are failing'
      USING ERRCODE = 'integrity_constraint_violation', HINT = 'ledger-integrity-halt';
  END IF;

  UPDATE ledger.accounting_periods
     SET status = 'settled', settled_at = clock_timestamp(), closed_by = p_actor_staff_id
   WHERE branch = p_branch AND business_date = p_business_date;

  v_body := jsonb_build_object(
              'branch', p_branch, 'business_date', p_business_date, 'status', 'settled');
  PERFORM ledger.complete_idempotent(p_idempotency_key, 200, v_body, NULL);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- 4. 교대 — 자금 이동 없음
-- =============================================================================
CREATE FUNCTION identity.op_shift_event(
  p_actor_staff_id BIGINT,
  p_branch         ledger.branch_code,
  p_action         identity.shift_action
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_id BIGINT;
BEGIN
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'shift.write');

  INSERT INTO identity.shift_events (staff_id, branch, action, business_date)
  VALUES (p_actor_staff_id, p_branch, p_action,
          ledger.business_date_of(p_branch, clock_timestamp()))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('shift_event_id', v_id, 'action', p_action);
END;
$$;

-- =============================================================================
-- 5. 계좌 개설 — 자금 이동 없음
-- =============================================================================
-- 주체 · member_deposit 계정 · KYC 프로필을 한 트랜잭션에서 만든다.
-- 계정 코드 형식은 003 의 parties_code_format 이 강제한다.
CREATE FUNCTION ledger.op_open_account(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_branch          ledger.branch_code,
  p_account_code    TEXT,
  p_display_name    TEXT,
  p_profile         JSONB DEFAULT '{}'::JSONB,
  p_currency        TEXT  DEFAULT 'PHP'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'account_code', p_account_code,
                    'currency', p_currency);
  v_idem  ledger.idem_result;
  v_party BIGINT;
  v_acct  BIGINT;
  v_body  JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('open_account', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'account.open');

  INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
  VALUES (p_account_code, 'member', p_display_name, p_branch)
  RETURNING id INTO v_party;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  VALUES (v_party, 'member_deposit', p_currency, 'credit', FALSE)
  RETURNING id INTO v_acct;

  INSERT INTO ledger.member_profiles (
    party_id, member_no, phone, telegram, eng_name, nickname, vip,
    agent_code, proxy, rolling_rate, default_currency, opened_branch, opened_at, remark
  ) VALUES (
    v_party,
    p_profile->>'member_no', p_profile->>'phone',    p_profile->>'telegram',
    p_profile->>'eng_name',  p_profile->>'nickname', p_profile->>'vip',
    p_profile->>'agent_code', p_profile->>'proxy',
    NULLIF(p_profile->>'rolling_rate', '')::NUMERIC(7,4),
    p_currency, p_branch, clock_timestamp(), p_profile->>'remark'
  );

  v_body := jsonb_build_object(
              'account_code', p_account_code, 'party_id', v_party, 'account_id', v_acct);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, NULL);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_open_account IS
  'KYC 사진 · 여권번호는 이 경로로 받지 않는다. 암호화 · 객체스토리지 업로드를 거친 뒤 별도 갱신한다.';

COMMIT;
