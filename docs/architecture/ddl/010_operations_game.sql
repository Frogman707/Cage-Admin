-- =============================================================================
-- 010. 게임 연산 — 개설 · 바이인 · 롤링 · 정산 · 취소 · 메인케이지
-- =============================================================================
-- 009 와 같은 규약을 따른다: 멱등 선점 → 인가 → 분개 구성 → 기록 → 응답 저장.
-- 분개는 04-posting-rules.md §5 · §7 · §8 · §9 를 그대로 옮긴 것이다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 게임 조회 헬퍼 — 잠금 포함
-- -----------------------------------------------------------------------------
-- 게임 행을 FOR UPDATE 로 잡고 진행 중인지 확인한다.
-- 정산과 종료가 동시에 들어와도 한쪽이 대기한다.
CREATE FUNCTION cage.lock_ongoing_game(p_game_no TEXT) RETURNS cage.games
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  v_g cage.games;
BEGIN
  SELECT * INTO v_g FROM cage.games WHERE game_no = p_game_no FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'game % not found', p_game_no USING ERRCODE = 'no_data_found';
  END IF;
  IF v_g.status <> 'ongoing' THEN
    RAISE EXCEPTION 'game % is %', p_game_no, v_g.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN v_g;
END;
$$;

-- =============================================================================
-- §5 게임 개설 — 04-posting-rules.md §5
-- =============================================================================
-- 게임 주체(party) · chips_outstanding 계정 · 게임 행 · 바이인 분개 · 롤링 시드를
-- 한 트랜잭션에서 만든다. 현행 _doStartGame(index.html:6783)의 다중 write 를 대체한다.
CREATE FUNCTION cage.op_open_game(
  p_idempotency_key    TEXT,
  p_actor_staff_id     BIGINT,
  p_step_up_id         BIGINT,
  p_device_id          TEXT,
  p_branch             ledger.branch_code,
  p_game_no            TEXT,
  p_member_code        TEXT,
  p_table_code         TEXT,
  p_bet_type           TEXT,
  p_start_type         cage.game_start_type,
  p_start_kind         cage.game_start_kind,
  p_buyin_minor        BIGINT,
  p_working_chip_minor BIGINT DEFAULT 0,
  p_currency           TEXT   DEFAULT 'PHP',
  p_memo               TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'game_no', p_game_no,
                    'member_code', p_member_code, 'start_type', p_start_type,
                    'buyin_minor', p_buyin_minor,
                    'working_chip_minor', p_working_chip_minor,
                    'currency', p_currency);
  v_idem    ledger.idem_result;
  v_tx      ledger.posted_tx;
  v_body    JSONB;
  v_member  BIGINT;
  v_gparty  BIGINT;
  v_chips   BIGINT;
  v_game_id BIGINT;
  v_entries JSONB;
  v_src     BIGINT;
  v_src_cat ledger.entry_category;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('open_game', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'game.open');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.open');
  PERFORM ledger.assert_positive(p_buyin_minor, 'buyin_minor');

  IF p_working_chip_minor < 0 THEN
    RAISE EXCEPTION 'working_chip_minor must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 계좌 바이인은 손님 잔액을 건드리므로 재인증을 요구한다 (현행 requestWithdrawAuth)
  IF p_start_type = 'account' AND v_auth NOT IN ('withdraw_pw','totp','approval') THEN
    RAISE EXCEPTION 'account buy-in requires step-up auth, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  SELECT id INTO v_member FROM ledger.parties
   WHERE code = p_member_code AND party_type = 'member';
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'member % not found', p_member_code USING ERRCODE = 'no_data_found';
  END IF;

  -- 게임 주체 + 칩 계정
  INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
  VALUES ('GAME-' || p_game_no, 'game', 'Game ' || p_game_no, p_branch)
  RETURNING id INTO v_gparty;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  VALUES (v_gparty, 'chips_outstanding', p_currency, 'credit', FALSE)
  RETURNING id INTO v_chips;

  INSERT INTO cage.games (
    game_no, branch, member_party_id, game_party_id, chips_account_id,
    table_code, currency, bet_type, start_type, start_kind,
    buyin_minor, working_chip_minor, opened_by, business_date
  ) VALUES (
    p_game_no, p_branch, v_member, v_gparty, v_chips,
    p_table_code, p_currency, p_bet_type, p_start_type, p_start_kind,
    p_buyin_minor, p_working_chip_minor, p_actor_staff_id,
    ledger.business_date_of(p_branch, clock_timestamp())
  )
  RETURNING id INTO v_game_id;

  -- 자금원 결정 — 04-posting-rules.md §5-1 · §5-2 · §5-3
  v_src := CASE p_start_type
             WHEN 'account' THEN ledger.account_id_of(p_member_code, 'member_deposit', p_currency)
             WHEN 'cash'    THEN ledger.house_account_id(p_branch, 'house_cash', p_currency)
             WHEN 'marker'  THEN ledger.house_account_id(p_branch, 'marker_receivable', p_currency)
           END;
  v_src_cat := CASE p_start_type
                 WHEN 'account' THEN 'buyin_account'
                 WHEN 'cash'    THEN 'buyin_cash'
                 WHEN 'marker'  THEN 'buyin_marker'
               END::ledger.entry_category;

  v_entries := jsonb_build_array(
    jsonb_build_object('account_id', v_src,
      'amount_minor',  p_buyin_minor, 'category', v_src_cat),
    jsonb_build_object('account_id', v_chips,
      'amount_minor', -p_buyin_minor, 'category', 'chips_issue')
  );

  -- §5-4 워킹칩 발행 — 같은 거래에 추가 분개
  IF p_working_chip_minor > 0 THEN
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.house_account_id(p_branch, 'promo_expense', p_currency),
        'amount_minor',  p_working_chip_minor, 'category', 'working_chip_issue'),
      jsonb_build_object('account_id', v_chips,
        'amount_minor', -p_working_chip_minor, 'category', 'chips_issue')
    );
  END IF;

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'game_buyin', p_branch,
    p_actor_staff_id, v_auth, p_device_id, v_entries, p_memo);

  -- §5-5 롤링 시드 (자금 아님). 지점 누계에는 산입하지 않는다.
  INSERT INTO cage.rolling_events
    (game_id, amount_minor, source, counts_toward_branch_total,
     transaction_id, staff_id, business_date)
  VALUES
    (v_game_id, p_buyin_minor, 'buyin', FALSE,
     v_tx.transaction_id, p_actor_staff_id, v_tx.business_date);

  IF p_working_chip_minor > 0 THEN
    INSERT INTO cage.rolling_events
      (game_id, amount_minor, source, counts_toward_branch_total,
       transaction_id, staff_id, business_date)
    VALUES
      (v_game_id, p_working_chip_minor, 'working_chip', FALSE,
       v_tx.transaction_id, p_actor_staff_id, v_tx.business_date);
  END IF;

  v_body := ledger.tx_response(v_tx) || jsonb_build_object('game_no', p_game_no);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- 추가 바이인 — 현행 _doAddBuyin (index.html:6747)
-- =============================================================================
CREATE FUNCTION cage.op_add_buyin(
  p_idempotency_key    TEXT,
  p_actor_staff_id     BIGINT,
  p_step_up_id         BIGINT,
  p_device_id          TEXT,
  p_game_no            TEXT,
  p_start_type         cage.game_start_type,
  p_buyin_minor        BIGINT,
  p_working_chip_minor BIGINT DEFAULT 0,
  p_memo               TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'game_no', p_game_no, 'start_type', p_start_type,
                    'buyin_minor', p_buyin_minor,
                    'working_chip_minor', p_working_chip_minor);
  v_idem    ledger.idem_result;
  v_g       cage.games;
  v_member  TEXT;
  v_tx      ledger.posted_tx;
  v_body    JSONB;
  v_entries JSONB;
  v_src     BIGINT;
  v_src_cat ledger.entry_category;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('add_buyin', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  v_g := cage.lock_ongoing_game(p_game_no);
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_g.branch, 'game.buyin');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.buyin');
  PERFORM ledger.assert_positive(p_buyin_minor, 'buyin_minor');

  SELECT code INTO v_member FROM ledger.parties WHERE id = v_g.member_party_id;

  IF p_start_type = 'account' AND v_auth NOT IN ('withdraw_pw','totp','approval') THEN
    RAISE EXCEPTION 'account buy-in requires step-up auth, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  v_src := CASE p_start_type
             WHEN 'account' THEN ledger.account_id_of(v_member, 'member_deposit', v_g.currency)
             WHEN 'cash'    THEN ledger.house_account_id(v_g.branch, 'house_cash', v_g.currency)
             WHEN 'marker'  THEN ledger.house_account_id(v_g.branch, 'marker_receivable', v_g.currency)
           END;
  v_src_cat := CASE p_start_type
                 WHEN 'account' THEN 'buyin_account'
                 WHEN 'cash'    THEN 'buyin_cash'
                 WHEN 'marker'  THEN 'buyin_marker'
               END::ledger.entry_category;

  v_entries := jsonb_build_array(
    jsonb_build_object('account_id', v_src,
      'amount_minor',  p_buyin_minor, 'category', v_src_cat),
    jsonb_build_object('account_id', v_g.chips_account_id,
      'amount_minor', -p_buyin_minor, 'category', 'chips_issue')
  );

  IF p_working_chip_minor > 0 THEN
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object('account_id',
        ledger.house_account_id(v_g.branch, 'promo_expense', v_g.currency),
        'amount_minor',  p_working_chip_minor, 'category', 'working_chip_issue'),
      jsonb_build_object('account_id', v_g.chips_account_id,
        'amount_minor', -p_working_chip_minor, 'category', 'chips_issue')
    );
  END IF;

  v_tx := ledger.post_transaction(
    p_idempotency_key, 'game_buyin', v_g.branch,
    p_actor_staff_id, v_auth, p_device_id, v_entries, p_memo);

  UPDATE cage.games
     SET buyin_minor        = buyin_minor + p_buyin_minor,
         working_chip_minor = working_chip_minor + p_working_chip_minor
   WHERE id = v_g.id;

  INSERT INTO cage.rolling_events
    (game_id, amount_minor, source, counts_toward_branch_total,
     transaction_id, staff_id, business_date)
  VALUES
    (v_g.id, p_buyin_minor, 'buyin', FALSE,
     v_tx.transaction_id, p_actor_staff_id, v_tx.business_date);

  IF p_working_chip_minor > 0 THEN
    INSERT INTO cage.rolling_events
      (game_id, amount_minor, source, counts_toward_branch_total,
       transaction_id, staff_id, business_date)
    VALUES
      (v_g.id, p_working_chip_minor, 'working_chip', FALSE,
       v_tx.transaction_id, p_actor_staff_id, v_tx.business_date);
  END IF;

  v_body := ledger.tx_response(v_tx) || jsonb_build_object('game_no', p_game_no);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §6 롤링 입력 — 자금 이동 없음
-- =============================================================================
-- 거래를 만들지 않는다. 현행 confirmRollingInput(index.html:6914)의 3중 누계 갱신은
-- 전부 rolling_events 집계로 파생되므로 사라진다.
CREATE FUNCTION cage.op_record_rolling(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_game_no         TEXT,
  p_amount_minor    BIGINT               -- 정정은 음수
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object('game_no', p_game_no, 'amount_minor', p_amount_minor);
  v_idem ledger.idem_result;
  v_g    cage.games;
  v_id   BIGINT;
  v_body JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('record_rolling', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  v_g := cage.lock_ongoing_game(p_game_no);
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_g.branch, 'game.rolling');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.rolling');

  IF p_amount_minor IS NULL OR p_amount_minor = 0 THEN
    RAISE EXCEPTION 'amount_minor must be non-zero' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- source='manual' 이 지점 누계에 산입되는 유일한 값이다 (001 의 rolling_source 주석)
  INSERT INTO cage.rolling_events
    (game_id, amount_minor, source, counts_toward_branch_total, staff_id, business_date)
  VALUES
    (v_g.id, p_amount_minor, 'manual', TRUE, p_actor_staff_id,
     ledger.business_date_of(v_g.branch, clock_timestamp()))
  RETURNING id INTO v_id;

  SELECT jsonb_build_object(
           'game_no', p_game_no,
           'rolling_event_id', v_id,
           'rolling_total_minor', g.rolling_total_minor)
    INTO v_body
    FROM cage.games g WHERE g.id = v_g.id;

  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, NULL);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- §7 중간정산 · §8 게임종료 — 분개가 동일하므로 한 함수다
-- =============================================================================
-- 04-posting-rules.md §7-1 의 12행 중 chips_outstanding 차변 6행은 계정과
-- category 가 모두 같으므로 합계 1행으로 합친다 (의미 동일, 행 수만 감소).
CREATE FUNCTION cage.op_settle_game(
  p_idempotency_key      TEXT,
  p_actor_staff_id       BIGINT,
  p_step_up_id           BIGINT,
  p_device_id            TEXT,
  p_game_no              TEXT,
  p_kind                 cage.settlement_kind,
  p_cc_deposit_minor     BIGINT DEFAULT 0,
  p_cc_cashout_minor     BIGINT DEFAULT 0,
  p_cc_marker_minor      BIGINT DEFAULT 0,
  p_cc_dealer_tips_minor BIGINT DEFAULT 0,
  p_cc_house_tips_minor  BIGINT DEFAULT 0,
  p_nn_deposit_minor     BIGINT DEFAULT 0,
  p_nn_cashout_minor     BIGINT DEFAULT 0,
  p_nn_marker_minor      BIGINT DEFAULT 0,
  p_nn_working_minor     BIGINT DEFAULT 0,
  p_memo                 TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
    'game_no', p_game_no, 'kind', p_kind,
    'cc', jsonb_build_object('deposit', p_cc_deposit_minor, 'cashout', p_cc_cashout_minor,
                             'marker', p_cc_marker_minor,
                             'dealer_tips', p_cc_dealer_tips_minor,
                             'house_tips', p_cc_house_tips_minor),
    'nn', jsonb_build_object('deposit', p_nn_deposit_minor, 'cashout', p_nn_cashout_minor,
                             'marker', p_nn_marker_minor, 'working', p_nn_working_minor));
  v_idem     ledger.idem_result;
  v_g        cage.games;
  v_member   TEXT;
  v_tx       ledger.posted_tx;
  v_body     JSONB;
  v_entries  JSONB;
  v_deposit  BIGINT := p_cc_deposit_minor + p_nn_deposit_minor;
  v_cashout  BIGINT := p_cc_cashout_minor + p_nn_cashout_minor;
  v_marker   BIGINT := p_cc_marker_minor  + p_nn_marker_minor;
  v_redeem   BIGINT;
  v_seq      INT;
  v_nn_total BIGINT := p_nn_deposit_minor + p_nn_cashout_minor
                     + p_nn_marker_minor  + p_nn_working_minor;
  v_cc_total BIGINT := p_cc_deposit_minor + p_cc_cashout_minor + p_cc_marker_minor
                     + p_cc_dealer_tips_minor + p_cc_house_tips_minor;
  v_txkind   ledger.tx_kind;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('settle_game', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  v_g := cage.lock_ongoing_game(p_game_no);
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_g.branch, 'game.settle');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.settle');

  IF v_auth NOT IN ('pin','totp','withdraw_pw','approval') THEN
    RAISE EXCEPTION 'settlement requires re-authentication, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  IF LEAST(p_cc_deposit_minor, p_cc_cashout_minor, p_cc_marker_minor,
           p_cc_dealer_tips_minor, p_cc_house_tips_minor,
           p_nn_deposit_minor, p_nn_cashout_minor, p_nn_marker_minor,
           p_nn_working_minor) < 0 THEN
    RAISE EXCEPTION 'settlement amounts must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_redeem := v_cc_total + v_nn_total;
  IF v_redeem = 0 THEN
    RAISE EXCEPTION 'settlement is empty' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT code INTO v_member FROM ledger.parties WHERE id = v_g.member_party_id;
  v_txkind := CASE p_kind WHEN 'mid' THEN 'mid_settle' ELSE 'game_end' END::ledger.tx_kind;

  -- 칩 회수 (차변 합계 1행)
  v_entries := jsonb_build_array(jsonb_build_object(
    'account_id', v_g.chips_account_id,
    'amount_minor', v_redeem, 'category', 'chips_redeem'));

  -- 대변 각 항목 — 금액이 0이면 분개를 만들지 않는다 (entries_amount_nonzero)
  IF v_deposit > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.account_id_of(v_member, 'member_deposit', v_g.currency),
      'amount_minor', -v_deposit, 'category', 'settle_deposit'));
  END IF;
  IF v_cashout > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.house_account_id(v_g.branch, 'house_cash', v_g.currency),
      'amount_minor', -v_cashout, 'category', 'settle_cashout'));
  END IF;
  IF v_marker > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.house_account_id(v_g.branch, 'marker_receivable', v_g.currency),
      'amount_minor', -v_marker, 'category', 'settle_marker_redeem'));
  END IF;
  IF p_cc_dealer_tips_minor > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.house_account_id(v_g.branch, 'tips_dealer', v_g.currency),
      'amount_minor', -p_cc_dealer_tips_minor, 'category', 'settle_dealer_tip'));
  END IF;
  IF p_cc_house_tips_minor > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.house_account_id(v_g.branch, 'tips_house', v_g.currency),
      'amount_minor', -p_cc_house_tips_minor, 'category', 'settle_house_tip'));
  END IF;
  IF p_nn_working_minor > 0 THEN
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'account_id', ledger.house_account_id(v_g.branch, 'promo_expense', v_g.currency),
      'amount_minor', -p_nn_working_minor, 'category', 'working_chip_return'));
  END IF;

  v_tx := ledger.post_transaction(
    p_idempotency_key, v_txkind, v_g.branch,
    p_actor_staff_id, v_auth, p_device_id, v_entries, p_memo);

  -- 정산 이력 (현행 g.checkpoints 배열의 정규화)
  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq
    FROM cage.game_settlements WHERE game_id = v_g.id;

  INSERT INTO cage.game_settlements (
    game_id, seq, kind, transaction_id,
    cc_deposit_minor, cc_cashout_minor, cc_marker_minor,
    cc_dealer_tips_minor, cc_house_tips_minor,
    nn_deposit_minor, nn_cashout_minor, nn_marker_minor, nn_working_minor,
    staff_id, business_date
  ) VALUES (
    v_g.id, v_seq, p_kind, v_tx.transaction_id,
    p_cc_deposit_minor, p_cc_cashout_minor, p_cc_marker_minor,
    p_cc_dealer_tips_minor, p_cc_house_tips_minor,
    p_nn_deposit_minor, p_nn_cashout_minor, p_nn_marker_minor, p_nn_working_minor,
    p_actor_staff_id, v_tx.business_date
  );

  -- §7-2 재고 원장 (자금 아님) — 금고로 돌아온 칩.
  -- 사유별로 나눠 기록한다. 합쳐서 넣으면 013 의 교대 카운터가
  -- nn_cashout_shift · nn_marker_shift · cc_marker_shift 를 분리해 낼 수 없다.
  INSERT INTO cage.chip_inventory_events
    (branch, chip_type, delta_minor, reason, transaction_id, staff_id, business_date)
  SELECT v_g.branch, x.chip_type, x.amt, x.reason,
         v_tx.transaction_id, p_actor_staff_id, v_tx.business_date
    FROM (VALUES
      ('nn'::cage.chip_type, p_nn_deposit_minor,     'settle_deposit'::ledger.entry_category),
      ('nn'::cage.chip_type, p_nn_cashout_minor,     'settle_cashout'::ledger.entry_category),
      ('nn'::cage.chip_type, p_nn_marker_minor,      'settle_marker_redeem'::ledger.entry_category),
      ('nn'::cage.chip_type, p_nn_working_minor,     'working_chip_return'::ledger.entry_category),
      ('cc'::cage.chip_type, p_cc_deposit_minor,     'settle_deposit'::ledger.entry_category),
      ('cc'::cage.chip_type, p_cc_cashout_minor,     'settle_cashout'::ledger.entry_category),
      ('cc'::cage.chip_type, p_cc_marker_minor,      'settle_marker_redeem'::ledger.entry_category),
      ('cc'::cage.chip_type, p_cc_dealer_tips_minor, 'settle_dealer_tip'::ledger.entry_category),
      ('cc'::cage.chip_type, p_cc_house_tips_minor,  'settle_house_tip'::ledger.entry_category)
    ) AS x(chip_type, amt, reason)
   WHERE x.amt > 0;

  -- §7-3 롤링 감소 — 현행 index.html:7237 공식 그대로
  IF v_nn_total > 0 THEN
    INSERT INTO cage.rolling_events
      (game_id, amount_minor, source, counts_toward_branch_total,
       transaction_id, staff_id, business_date)
    VALUES
      (v_g.id, -v_nn_total,
       CASE p_kind WHEN 'mid' THEN 'mid_settle' ELSE 'game_end' END::cage.rolling_source,
       FALSE, v_tx.transaction_id, p_actor_staff_id, v_tx.business_date);
  END IF;

  -- 종료 — 칩 잔액 0 검증은 005 의 games_chips_settled 지연 트리거가 커밋 시점에 한다
  IF p_kind = 'final' THEN
    UPDATE cage.games
       SET status = 'ended', ended_at = clock_timestamp(), closed_by = p_actor_staff_id,
           win_loss_minor = (
             SELECT COALESCE(sum(e.amount_minor), 0)
               FROM ledger.entries e
               JOIN ledger.transactions t ON t.id = e.transaction_id
              WHERE e.account_id = v_g.chips_account_id
                AND (e.category = 'chips_redeem'
                     OR (e.category = 'chips_issue' AND t.kind = 'game_buyin')))
     WHERE id = v_g.id;
  END IF;

  v_body := ledger.tx_response(v_tx)
            || jsonb_build_object('game_no', p_game_no, 'settlement_seq', v_seq);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx.transaction_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION cage.op_settle_game IS
  '중간정산과 게임종료. 분개가 동일하고 transactions.kind 만 다르다 (04 §8-1).';

-- =============================================================================
-- §9 게임 취소 — 삭제하지 않는다. 역분개한다
-- =============================================================================
-- 현행 cancelGame(index.html:6824)은 게임 문서와 롤링 이벤트를 삭제한다.
CREATE FUNCTION cage.op_cancel_game(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_game_no         TEXT,
  p_memo            TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args     JSONB := jsonb_build_object('game_no', p_game_no);
  v_idem     ledger.idem_result;
  v_g        cage.games;
  v_tx_id    BIGINT;
  v_n        INT := 0;
  v_reversed JSONB := '[]'::JSONB;
  v_rev      ledger.posted_tx;
  v_bdate    DATE;
  v_row      RECORD;
  v_body     JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('cancel_game', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  v_g := cage.lock_ongoing_game(p_game_no);
  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_g.branch, 'game.cancel');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.cancel');

  v_bdate := ledger.business_date_of(v_g.branch, clock_timestamp());

  -- 이 게임의 칩 계정을 건드린 모든 거래를 최근 것부터 역분개한다.
  -- 이미 역분개된 거래와, 그 자체가 역분개인 거래는 건너뛴다.
  FOR v_tx_id IN
    SELECT DISTINCT e.transaction_id
      FROM ledger.entries e
     WHERE e.account_id = v_g.chips_account_id
       AND NOT EXISTS (SELECT 1 FROM ledger.transactions r
                        WHERE r.reverses_tx_id = e.transaction_id)
       AND NOT EXISTS (SELECT 1 FROM ledger.transactions o
                        WHERE o.id = e.transaction_id AND o.reverses_tx_id IS NOT NULL)
     ORDER BY e.transaction_id DESC
  LOOP
    v_rev := ledger.reverse_transaction(
               p_idempotency_key || ':' || v_tx_id::text,
               v_tx_id, p_actor_staff_id, v_auth, p_device_id,
               COALESCE(p_memo, 'cancel game ' || p_game_no),
               'game_cancel');
    v_n := v_n + 1;
    v_reversed := v_reversed || jsonb_build_array(v_rev.external_id);
  END LOOP;

  -- 롤링 상쇄. 지점 누계 산입분과 비산입분을 나눠 각각 상쇄해야
  -- 지점 롤링 누계가 정확히 원상 복구된다.
  FOR v_row IN
    SELECT r.counts_toward_branch_total AS counts, sum(r.amount_minor) AS amt
      FROM cage.rolling_events r
     WHERE r.game_id = v_g.id
     GROUP BY 1
    HAVING sum(r.amount_minor) <> 0
  LOOP
    INSERT INTO cage.rolling_events
      (game_id, amount_minor, source, counts_toward_branch_total, staff_id, business_date)
    VALUES (v_g.id, -v_row.amt, 'correction', v_row.counts, p_actor_staff_id, v_bdate);
  END LOOP;

  -- 상태 전이는 마지막. 005 의 assert_game_ongoing 이 위 삽입들을 통과시켜야 한다.
  -- 전이 시 games_chips_settled 지연 트리거가 칩 잔액 0을 커밋 시점에 확인한다.
  UPDATE cage.games
     SET status = 'cancelled', ended_at = clock_timestamp(), closed_by = p_actor_staff_id
   WHERE id = v_g.id;

  v_body := jsonb_build_object(
              'game_no', p_game_no,
              'reversed_transactions', v_reversed,
              'reversed_count', v_n);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 200, v_body, NULL);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION cage.op_cancel_game IS
  '게임 취소. 원 거래를 전부 역분개하고 롤링을 상쇄한다. 삭제하지 않는다 (04 §9).';

-- =============================================================================
-- §10 메인 케이지 — 자금 원장 아님
-- =============================================================================
CREATE FUNCTION cage.op_main_cage_entry(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_step_up_id      BIGINT,
  p_device_id       TEXT,
  p_branch          ledger.branch_code,
  p_kind            cage.main_cage_kind,
  p_amount_minor    BIGINT               -- 절대값. 부호는 종류가 결정한다
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
                    'branch', p_branch, 'kind', p_kind, 'amount_minor', p_amount_minor);
  v_idem   ledger.idem_result;
  v_signed BIGINT;
  v_id     BIGINT;
  v_body   JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('main_cage_entry', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, p_branch, 'maincage.write');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'maincage.write');

  IF p_amount_minor IS NULL OR p_amount_minor < 0 THEN
    RAISE EXCEPTION 'amount_minor must be an absolute (non-negative) value'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 현행 mainCageSignedEffect(index.html:4695)의 부호 규약을 저장 시점에 확정한다.
  -- 읽는 쪽이 규칙을 다시 적용할 필요가 없다.
  v_signed := CASE WHEN p_kind = 'redeem' THEN -p_amount_minor ELSE p_amount_minor END;

  INSERT INTO cage.main_cage_events
    (branch, kind, amount_minor, staff_id, business_date)
  VALUES
    (p_branch, p_kind, v_signed, p_actor_staff_id,
     ledger.business_date_of(p_branch, clock_timestamp()))
  RETURNING id INTO v_id;

  v_body := jsonb_build_object(
              'main_cage_event_id', v_id,
              'branch', p_branch, 'kind', p_kind, 'amount_minor', v_signed);
  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, NULL);
  RETURN v_body;
END;
$$;

-- =============================================================================
-- 롤링 커미션 정산 — 손님에게 커미션을 지급한다 (design-review-6.md DR-66)
-- =============================================================================
-- op_settle_game 과 다른 조작이다. 저쪽은 칩을 회수하고 이쪽은 돈을 내보낸다.
-- 현행 _doSettleGame(index.html:7218-7267) 의 목표 대응.
--
-- 현행과 달라지는 것 넷:
--  (1) 요율이 UI select 옵션 라벨을 경유하지 않는다. games.commission_rate_bp
--      스냅샷이 유일한 권위다 (design-review-9.md DR-84). 현행은 "Share 40%"
--      프리셋에서 정규식이 40%를 잡아 롤링 커미션 40%를 프리필했다.
--  (2) 같은 롤링에 두 번 지급할 수 없다 (005 의 base_available 트리거).
--      현행은 종료 게임에만 재정산 방지가 있었다 (design-review-9.md DR-85).
--  (3) F&B 차감이 커미션을 넘으면 거부한다. 현행은 result<=0 이 되어 조용히
--      아무것도 하지 않았고 차감분의 행방이 기록되지 않았다.
--  (4) 지급액이 0이어도 정산 이력은 남는다. "정산했고 0이었다" 와 "정산한 적 없다" 는
--      다른 사실이다.
CREATE FUNCTION cage.op_settle_commission(
  p_idempotency_key    TEXT,
  p_actor_staff_id     BIGINT,
  p_step_up_id         BIGINT,
  p_device_id          TEXT,
  p_game_no            TEXT,
  p_rolling_base_minor BIGINT,
  p_commission_minor   BIGINT,
  p_fb_deduction_minor BIGINT DEFAULT 0,
  p_memo               TEXT   DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = cage, ledger, identity, pg_temp
AS $$
DECLARE
  v_auth identity.auth_method;
  v_args JSONB := jsonb_build_object(
    'game_no', p_game_no,
    'rolling_base_minor', p_rolling_base_minor,
    'commission_minor',   p_commission_minor,
    'fb_deduction_minor', p_fb_deduction_minor);
  v_idem     ledger.idem_result;
  v_g        cage.games;
  v_member   TEXT;
  v_expected BIGINT;
  v_override BOOLEAN;
  v_payout   BIGINT;
  v_tx       ledger.posted_tx;
  v_tx_id    BIGINT;
  v_bdate    DATE;
  v_seq      INT;
  v_body     JSONB;
BEGIN
  v_idem := ledger.begin_idempotent(
              p_idempotency_key, ledger.request_fingerprint('settle_commission', v_args));
  IF NOT v_idem.fresh THEN RETURN v_idem.response_body; END IF;

  -- 진행 중 · 종료 게임 모두 정산 대상이다. 취소된 게임은 아니다.
  -- lock_ongoing_game 을 쓰지 않는 이유가 이것이다. FOR UPDATE 잠금은
  -- 005 의 base_available 트리거가 check-then-act 가 되지 않게 만든다.
  SELECT * INTO v_g FROM cage.games WHERE game_no = p_game_no FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game % not found', p_game_no USING ERRCODE = 'no_data_found';
  END IF;
  IF v_g.status = 'cancelled' THEN
    RAISE EXCEPTION 'game % is cancelled — 커미션을 지급할 수 없다', p_game_no
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_g.branch, 'game.commission');
  v_auth := identity.consume_step_up(
            p_step_up_id, p_actor_staff_id, p_device_id, 'game.commission');

  IF v_auth NOT IN ('pin','totp','withdraw_pw','approval') THEN
    RAISE EXCEPTION 'commission settlement requires re-authentication, got %', v_auth
      USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
  END IF;

  IF LEAST(p_rolling_base_minor, p_commission_minor, p_fb_deduction_minor) < 0 THEN
    RAISE EXCEPTION 'commission settlement amounts must not be negative'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_g.commission_rate_bp IS NULL THEN
    RAISE EXCEPTION 'game % has no commission rate snapshot', p_game_no
      USING ERRCODE = 'object_not_in_prerequisite_state',
            HINT = '게임 개설 시 commission_rate_bp 를 기록하라. 요율은 화면 라벨에서 파싱하지 않는다';
  END IF;

  -- 산출값. 반올림 방향은 손님에게 유리한 쪽(반올림)으로 고정한다.
  -- 절사 · 절상은 지점마다 달라질 수 있는 사업 규칙이므로 바꾸려면
  -- branch_config 에 항목을 두고 여기서 읽어야 한다 (미확정).
  v_expected := ROUND(p_rolling_base_minor::NUMERIC * v_g.commission_rate_bp / 10000)::BIGINT;
  v_override := (p_commission_minor <> v_expected);

  v_payout := p_commission_minor - p_fb_deduction_minor;
  IF v_payout < 0 THEN
    RAISE EXCEPTION
      'F&B deduction % exceeds commission % — 차감이 커미션을 넘을 수 없다',
      p_fb_deduction_minor, p_commission_minor
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT code INTO v_member FROM ledger.parties WHERE id = v_g.member_party_id;

  -- 지급액이 0이면 원장 거래를 만들지 않는다. 004 의 entries_amount_nonzero 가
  -- 0원 분개를 막고, 0원 거래는 원장에 남길 사실이 없다.
  IF v_payout > 0 THEN
    v_tx := ledger.post_transaction(
      p_idempotency_key, 'commission_payout', v_g.branch,
      p_actor_staff_id, v_auth, p_device_id,
      jsonb_build_array(
        jsonb_build_object('account_id',
          ledger.house_account_id(v_g.branch, 'commission_expense', v_g.currency),
          'amount_minor',  v_payout, 'category', 'commission_payout'),
        jsonb_build_object('account_id',
          ledger.account_id_of(v_member, 'member_deposit', v_g.currency),
          'amount_minor', -v_payout, 'category', 'commission_payout')
      ),
      COALESCE(p_memo, 'rolling commission ' || v_g.game_no));
    v_tx_id := v_tx.transaction_id;
    v_bdate := v_tx.business_date;
  ELSE
    v_tx_id := NULL;
    v_bdate := ledger.business_date_of(v_g.branch, clock_timestamp());
  END IF;

  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq
    FROM cage.commission_settlements WHERE game_id = v_g.id;

  INSERT INTO cage.commission_settlements (
    game_id, seq, transaction_id, rolling_base_minor, commission_rate_bp,
    commission_minor, rate_overridden, fb_deduction_minor, payout_minor,
    staff_id, business_date
  ) VALUES (
    v_g.id, v_seq, v_tx_id, p_rolling_base_minor, v_g.commission_rate_bp,
    p_commission_minor, v_override, p_fb_deduction_minor, v_payout,
    p_actor_staff_id, v_bdate
  );

  v_body := jsonb_build_object(
    'game_no',            v_g.game_no,
    'seq',                v_seq,
    'rolling_base_minor', p_rolling_base_minor,
    'commission_rate_bp', v_g.commission_rate_bp,
    'commission_minor',   p_commission_minor,
    'expected_minor',     v_expected,
    'rate_overridden',    v_override,
    'fb_deduction_minor', p_fb_deduction_minor,
    'payout_minor',       v_payout,
    'transaction',        CASE WHEN v_tx_id IS NULL THEN NULL ELSE ledger.tx_response(v_tx) END);

  PERFORM ledger.complete_idempotent(p_idempotency_key, 201, v_body, v_tx_id);
  RETURN v_body;
END;
$$;

COMMENT ON FUNCTION cage.op_settle_commission IS
  '롤링 커미션 지급. 요율의 권위는 games.commission_rate_bp 스냅샷이다. design-review-6.md DR-66 · design-review-9.md DR-84·DR-85.';

COMMIT;
