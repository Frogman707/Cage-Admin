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
  -- design-review.md DR-03. 토큰은 단말에 묶인다 — consume_step_up 이 device_id 를
  -- 대조하므로 이 함수도 단말을 받아야 한다.
  p_step_up_id     BIGINT,
  p_device_id      TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_a       identity.approvals;
  v_approve INT;
BEGIN
  SELECT * INTO v_a FROM identity.approvals WHERE id = p_approval_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval % not found', p_approval_id USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_a.branch, 'approval.vote');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'approval.vote');

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
  IF v_auth NOT IN ('pin', 'totp', 'withdraw_pw') THEN
    RAISE EXCEPTION 'approval vote requires re-authentication, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  INSERT INTO identity.approval_votes (approval_id, staff_id, decision, auth_method)
  VALUES (p_approval_id, p_actor_staff_id, p_decision, v_auth);

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
  p_step_up_id          BIGINT,
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
  v_auth identity.auth_method;
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
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'balancing.count');
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
      p_actor_staff_id, v_auth, p_device_id,
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
  p_step_up_id      BIGINT,
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
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object('branch', p_branch, 'business_date', p_business_date);
  v_idem       ledger.idem_result;
  v_status     ledger.period_status;
  v_suspense   BIGINT;
  v_unsealed   INT;
  v_body       JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('freeze_period', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'period.freeze');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'period.freeze');

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

  -- 진행 중 게임 검사는 **제거했다** (design-review.md DR-02).
  --
  -- cage.games.business_date 는 개설 시점에 확정된다. 카지노에서 게임이 영업일
  -- 경계를 넘는 것은 예외가 아니라 정상 운영이고, 게임 종료는 chips_outstanding = 0
  -- 을 요구하므로(005) 손님이 칩을 들고 있으면 끝낼 수도 없다. 그 결과 새벽에 시작한
  -- VIP 세션 하나가 그 영업일을 영구히 동결 불가로 만들었고, op_settle_period 가
  -- frozen 을 전제하므로 월정산까지 연쇄로 막혔다.
  --
  -- 동결이 보장해야 하는 것은 "이 영업일에 새 거래가 들어오지 않는다" 이지
  -- "이 영업일에 시작한 모든 활동이 끝났다" 가 아니다. 게임 정산 거래는 이미
  -- **정산 시점의** 영업일로 귀속된다 (008 이 business_date_of(clock_timestamp())
  -- 를 쓴다). 진행 중 게임의 미래 거래는 미래 기간으로 간다.
  --
  -- 받아들이는 것: 한 게임의 정산 이력이 여러 기간에 걸칠 수 있다.
  -- 005 의 game_settlements 가 이미 그렇게 설계돼 있어 모순이 없다.
  -- games.business_date 는 통계 · 조회용으로 남고 마감 판정에서 빠진다.

  -- 봉인되지 않은 거래가 있으면 마감할 수 없다 (있어서는 안 되는 상태)
  -- **체인 대상만 본다** (design-review.md DR-05). bet · payout 은 hash 가 NULL 인
  -- 것이 정상이므로, 필터가 없으면 온라인 지점이 영구히 마감 불가가 된다.
  SELECT count(*) INTO v_unsealed
    FROM ledger.transactions t
    JOIN ledger.chain_policy cp ON cp.kind = t.kind AND cp.chained
   WHERE t.branch = p_branch AND t.business_date = p_business_date AND t.hash IS NULL;
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
  p_step_up_id      BIGINT,
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
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object('branch', p_branch, 'business_date', p_business_date);
  v_idem   ledger.idem_result;
  v_status ledger.period_status;
  v_body   JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('settle_period', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'period.settle');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'period.settle');

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

-- =============================================================================
-- 6. 역분개 — 정정의 유일한 경로 (design-review-4.md DR-50)
-- =============================================================================
-- ledger.reverse_transaction() 은 008:511 에 온전히 구현돼 있었지만 008 은 내부
-- 전용이고 012 의 GRANT 목록에 없었다. 그래서 잘못 입력한 입금 · 출금 · 계좌이체 ·
-- 지점이체 · 지갑이체를 되돌릴 수단이 애플리케이션에 하나도 없었다.
-- DELETE 는 004:433 이, UPDATE 는 004:437 이 막고, 004:439 의 오류 메시지는
-- "정정은 역분개로만 가능하다" 고 지시하는데 그 역분개에 권한이 없었다.
--
-- 유일한 예외적 호출자였던 cage.op_cancel_game 은 해당 게임의 칩 계정을 건드린
-- 거래만 되돌린다. 그 밖의 거래에는 경로가 없었다.
--
-- 이 래퍼는 원 거래를 external_id (UUID) 로 지목한다. 내부 BIGINT id 를 API 표면에
-- 노출하지 않기 위해서다 — 05 의 다른 엔드포인트와 같은 규약이다.
CREATE FUNCTION ledger.op_reverse_transaction(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_original_ext_id UUID,
  p_approval_id     BIGINT,
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args   JSONB := jsonb_build_object('original_external_id', p_original_ext_id);
  v_idem   ledger.idem_result;
  v_tx_id  BIGINT;
  v_branch ledger.branch_code;
  v_rev    ledger.posted_tx;
  v_body   JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('reverse', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  SELECT t.id, t.branch INTO v_tx_id, v_branch
    FROM ledger.transactions t WHERE t.external_id = p_original_ext_id;

  IF v_tx_id IS NULL THEN
    RAISE EXCEPTION 'transaction % not found', p_original_ext_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 인가는 원 거래의 지점 기준이다. 호출자가 지점을 지정하지 않는다 —
  -- 지정하게 하면 다른 지점 거래를 자기 지점 권한으로 되돌릴 여지가 생긴다.
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_branch, 'ledger.reverse');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'ledger.reverse');

  -- 역분개는 금액과 무관하게 항상 4-eyes 다. branch_config 임계 검사에 맡기지
  -- 않는다 — 임계 미만 거래를 잘못 찍고 조용히 되돌리는 경로를 남기지 않기 위해서다.
  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'reversal always requires a 4-eyes approval'
      USING ERRCODE = 'insufficient_privilege', HINT = 'approval-required';
  END IF;

  PERFORM identity.consume_approval(p_approval_id, 'reversal', v_branch, v_args);

  -- 중복 역분개 방어는 reverse_transaction 안에 있다 (원 거래 행 FOR UPDATE 잠금 +
  -- 004 의 transactions_reverses_uq 부분 UNIQUE). 여기서 다시 검사하지 않는다.
  v_rev := ledger.reverse_transaction(
             p_idempotency_key, v_tx_id, p_actor_staff_id,
             v_auth, p_device_id, p_memo, 'reversal', p_approval_id);

  v_body := ledger.tx_response(v_rev);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_rev.transaction_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_reverse_transaction IS
  '008 의 reverse_transaction 에 대한 유일한 애플리케이션 진입점. 승인 필수. design-review-4.md DR-50.';

-- =============================================================================
-- 7. 마이그레이션 개시 잔액 (design-review-3.md DR-38)
-- =============================================================================
-- 003:303-308 이 OPENING-EQUITY 주체와 계정을 부트스트랩에서 만들어 두고
-- 07-migration.md 전체가 이 계정에 개시 잔액을 싣는 것을 전제로 서 있었는데,
-- **그 분개를 발행할 함수가 없었다.** ADR-013 이 post_transaction 을 앱에 열지
-- 않기로 했으므로 op 함수가 없는 자금은 기록할 방법 자체가 없다.
-- 마이그레이션 계획 문서가 실행 불가능한 상태였다.
--
-- ledger_app 에는 부여하지 않는다 (012). 이 함수는 임의 금액을 무에서 만들 수 있으므로
-- 상시 접속하는 앱이 가지면 그 자체가 화폐 발행 API 다.
-- ledger_migrator 전용이고, 07-migration.md 가 실행 주체 · 시점 · 감사 방법을 정한다.
CREATE FUNCTION ledger.op_load_opening_balance(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_device_id       TEXT,
  p_branch          ledger.branch_code,
  p_balances        JSONB,          -- [{"account_id": 12, "amount_minor": -55000000}, ...]
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_args    JSONB := jsonb_build_object('branch', p_branch, 'balances', p_balances);
  v_idem    ledger.idem_result;
  v_sum     BIGINT;
  v_equity  BIGINT;
  v_entries JSONB;
  v_tx      ledger.posted_tx;
  v_body    JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('opening_balance', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'ledger.opening_balance');

  IF jsonb_typeof(p_balances) <> 'array' OR jsonb_array_length(p_balances) = 0 THEN
    RAISE EXCEPTION 'opening balance requires a non-empty array'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 대상 계정 분개를 그대로 쓰고, 균형은 opening_equity 한 행이 맞춘다.
  -- 04-posting-rules.md §14 — "전 계정의 개시 잔액을 하나의 거래로 세운다."
  SELECT jsonb_agg(jsonb_build_object(
           'account_id',   (b->>'account_id')::BIGINT,
           'amount_minor', (b->>'amount_minor')::BIGINT,
           'category',     'opening_balance')),
         sum((b->>'amount_minor')::BIGINT)
    INTO v_entries, v_sum
    FROM jsonb_array_elements(p_balances) AS b;

  v_equity := -v_sum;

  IF v_equity <> 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id',
        ledger.account_id_of('OPENING-EQUITY', 'opening_equity', 'PHP'),
      'amount_minor', v_equity, 'category', 'opening_balance'));
  END IF;

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'opening_balance', p_branch,
    p_actor_staff_id, 'system', p_device_id, v_entries,
    COALESCE(p_memo, 'opening balance load for ' || p_branch));

  v_body := ledger.tx_response(v_tx);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION ledger.op_load_opening_balance IS
  '마이그레이션 전용. ledger_migrator 에만 부여한다. 앱에 열면 화폐 발행 API 가 된다. design-review-3.md DR-38.';

COMMIT;
