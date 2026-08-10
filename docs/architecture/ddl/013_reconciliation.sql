-- =============================================================================
-- 013. 상시 대사 · 파생 뷰
-- =============================================================================
-- R1~R7 은 상시 감시 대상이다. 하나라도 위반하면 신규 거래를 차단한다
-- (API 는 503 ledger-integrity-halt 로 응답).
-- 돈이 새는 상태에서 계속 받는 것보다 멈추는 편이 낫다.
--
-- 파생 뷰는 현행 9개 교대 카운터를 원장 · 재고 원장에서 재구성한다.
-- 화면과 API 응답 형태는 유지되므로 프런트엔드 변경이 거의 없다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- =============================================================================
-- R1 · 전역 복식부기 항등식 — 통화별 분개 합이 0이어야 한다
-- =============================================================================
CREATE VIEW ledger.v_check_double_entry AS
SELECT
  currency,
  sum(amount_minor)     AS imbalance_minor,
  count(*)              AS entry_count,
  sum(amount_minor) = 0 AS ok
FROM ledger.entries
GROUP BY currency;

COMMENT ON VIEW ledger.v_check_double_entry IS
  'R1. imbalance_minor 가 0이 아닌 행이 하나라도 있으면 즉시 호출 등급 알람.';

-- =============================================================================
-- R2 · 잔액 프로젝션 대사 — account_balances = SUM(entries)
-- =============================================================================
-- 잔액을 별도 저장하는 것은 "잔액을 저장하지 않는다"는 원칙의 의도적 예외다.
-- (행 잠금 대상이 있어야 오버드래프트를 원자적으로 막을 수 있다.)
-- 그 예외를 이 대사가 상시 보완한다.
CREATE VIEW ledger.v_check_balance_projection AS
SELECT
  a.id                                        AS account_id,
  p.code                                      AS party_code,
  a.kind,
  a.currency,
  b.balance_minor                             AS projected_minor,
  COALESCE(e.ledger_sum, 0)                   AS ledger_sum_minor,
  b.balance_minor - COALESCE(e.ledger_sum, 0) AS variance_minor,
  b.balance_minor = COALESCE(e.ledger_sum, 0) AS ok
FROM ledger.accounts a
JOIN ledger.parties p          ON p.id = a.party_id
JOIN ledger.account_balances b ON b.account_id = a.id
LEFT JOIN (
  SELECT account_id, sum(amount_minor) AS ledger_sum
    FROM ledger.entries GROUP BY account_id
) e ON e.account_id = a.id;

COMMENT ON VIEW ledger.v_check_balance_projection IS
  'R2. variance_minor 가 0이 아닌 계정이 하나라도 있으면 프로젝션이 깨진 것이다.';

-- =============================================================================
-- R3 · 해시 체인 — 두 단계로 나눈다
-- =============================================================================
-- (a) 링크 검사   저비용. 상시(1분) 수행. 누락 · 삽입 · 재배열을 잡는다.
-- (b) 내용 재계산 고비용. 야간 배치. **위조를 잡는 것은 이쪽뿐이다.**
--
-- 링크만 검사하면 원문과 해시를 함께 고쳤을 때 탐지하지 못한다.
-- 재계산은 008 의 canonical_digest() 를 그대로 쓴다 — 기록 경로와 같은 함수다.

CREATE VIEW ledger.v_check_hash_chain AS
WITH ordered AS (
  SELECT
    t.id, t.branch, t.external_id, t.recorded_at, t.prev_hash, t.hash,
    lag(t.hash) OVER (PARTITION BY t.branch ORDER BY t.id) AS expected_prev
  FROM ledger.transactions t
)
SELECT
  o.id               AS transaction_id,
  o.branch,
  o.external_id,
  o.recorded_at,
  o.hash IS NOT NULL AS sealed,
  CASE
    WHEN o.expected_prev IS NOT NULL THEN o.prev_hash = o.expected_prev
    -- 지점의 첫 거래는 004 가 심은 제네시스 해시를 가리켜야 한다
    ELSE o.prev_hash = sha256(('cage-admin-genesis:' || o.branch::text)::bytea)
  END                AS ok
FROM ordered o;

COMMENT ON VIEW ledger.v_check_hash_chain IS
  'R3(a) 링크 검사. ok=false 는 그 지점에서 체인이 끊어졌다는 뜻(누락 · 삽입 · 재배열).';

-- R3(b) 심층 재계산. 범위를 받아 야간 배치가 그날치만 검증한다.
-- 전량 검증은 감사 시점에만 수행한다 (거래 수에 비례해 비싸다).
CREATE FUNCTION ledger.verify_hash_chain(
  p_branch  ledger.branch_code,
  p_from_id BIGINT DEFAULT 0,
  p_to_id   BIGINT DEFAULT 9223372036854775807
)
RETURNS TABLE (
  transaction_id BIGINT,
  external_id    UUID,
  recorded_at    TIMESTAMPTZ,
  stored_hash    BYTEA,
  computed_hash  BYTEA,
  content_ok     BOOLEAN
)
LANGUAGE sql
STABLE
-- SECURITY DEFINER 인 이유: canonical_digest() 는 012 에서 PUBLIC · 조회 역할
-- 모두에게 EXECUTE 가 회수돼 있다. 검증자에게 다이제스트 함수를 직접 열어 주지
-- 않으면서 검증 결과만 돌려주기 위해 정의자 권한으로 실행한다.
SECURITY DEFINER
SET search_path = ledger, pg_temp
AS $$
  SELECT
    t.id, t.external_id, t.recorded_at, t.hash,
    sha256(t.prev_hash || convert_to(ledger.canonical_digest(t.id), 'UTF8')),
    t.hash = sha256(t.prev_hash || convert_to(ledger.canonical_digest(t.id), 'UTF8'))
  FROM ledger.transactions t
  WHERE t.branch = p_branch
    AND t.id BETWEEN p_from_id AND p_to_id
    AND t.hash IS NOT NULL
  ORDER BY t.id;
$$;

COMMENT ON FUNCTION ledger.verify_hash_chain IS
  'R3(b) 내용 재계산. content_ok=false 는 원문 위조를 뜻한다. 링크 검사로는 잡히지 않는다.';

-- =============================================================================
-- R4 · 게임 롤링 프로젝션 대사
-- =============================================================================
CREATE VIEW cage.v_check_rolling_projection AS
SELECT
  g.id                                             AS game_id,
  g.game_no,
  g.branch,
  g.rolling_total_minor                            AS projected_minor,
  COALESCE(r.event_sum, 0)                         AS event_sum_minor,
  g.rolling_total_minor - COALESCE(r.event_sum, 0) AS variance_minor,
  g.rolling_total_minor = COALESCE(r.event_sum, 0) AS ok
FROM cage.games g
LEFT JOIN (
  SELECT game_id, sum(amount_minor) AS event_sum
    FROM cage.rolling_events GROUP BY game_id
) r ON r.game_id = g.id;

-- =============================================================================
-- R5 · 미해소 차액 — suspense 잔액은 0이어야 한다
-- =============================================================================
CREATE VIEW ledger.v_check_suspense AS
SELECT
  p.home_branch       AS branch,
  a.currency,
  b.balance_minor,
  b.balance_minor = 0 AS ok,
  b.updated_at
FROM ledger.accounts a
JOIN ledger.parties p          ON p.id = a.party_id
JOIN ledger.account_balances b ON b.account_id = a.id
WHERE a.kind = 'suspense';

COMMENT ON VIEW ledger.v_check_suspense IS
  'R5. 0이 아니면 조사 중인 실사 차액이 있다는 뜻. 기간 마감이 차단된다.';

-- =============================================================================
-- R6 · 분개 지점 정합 — entries.branch 는 비정규화 값이다
-- =============================================================================
-- entries.branch 는 RLS 와 파생 뷰를 위해 중복 저장한다.
-- 계정 귀속 지점(하우스 · 게임) 또는 거래 지점과 일치해야 한다.
CREATE VIEW ledger.v_check_entry_branch AS
SELECT
  e.id          AS entry_id,
  e.transaction_id,
  e.branch      AS entry_branch,
  t.branch      AS tx_branch,
  p.home_branch AS account_branch,
  p.party_type,
  (e.branch = CASE WHEN p.party_type IN ('house','game') AND p.home_branch IS NOT NULL
                   THEN p.home_branch ELSE t.branch END) AS ok
FROM ledger.entries e
JOIN ledger.transactions t ON t.id = e.transaction_id
JOIN ledger.accounts a     ON a.id = e.account_id
JOIN ledger.parties p      ON p.id = a.party_id;

COMMENT ON VIEW ledger.v_check_entry_branch IS
  'R6. 비정규화된 entries.branch 가 부모 거래 · 계정 귀속과 어긋나지 않는지 상시 확인.';

-- =============================================================================
-- R7 · 분개 정의표 준수
-- =============================================================================
-- entries_posting_rule 트리거가 삽입 시점에 막지만, 트리거를 우회하는 경로
-- (session_replication_role='replica' 슈퍼유저 세션 등)가 남긴 흔적을 잡는다.
CREATE VIEW ledger.v_check_posting_rules AS
SELECT
  e.id AS entry_id,
  e.transaction_id,
  t.kind,
  e.category,
  a.kind               AS account_kind,
  sign(e.amount_minor) AS entry_sign,
  EXISTS (
    SELECT 1 FROM ledger.posting_rules r
     WHERE r.kind = t.kind
       AND r.category = e.category
       AND r.account_kind = a.kind
       AND r.sign = sign(e.amount_minor)
  ) AS ok
FROM ledger.entries e
JOIN ledger.transactions t ON t.id = e.transaction_id
JOIN ledger.accounts a     ON a.id = e.account_id;

COMMENT ON VIEW ledger.v_check_posting_rules IS
  'R7. 04-posting-rules.md 에 없는 분개가 원장에 존재하는지 확인한다.';

-- =============================================================================
-- 종합 상태 — 배치 · 헬스체크가 이 하나만 본다
-- =============================================================================
CREATE VIEW ledger.v_integrity_status AS
SELECT 'R1_double_entry' AS check_name,
       count(*) FILTER (WHERE NOT ok) AS violations
  FROM ledger.v_check_double_entry
UNION ALL
SELECT 'R2_balance_projection',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_balance_projection
UNION ALL
SELECT 'R3_hash_chain_link',
       count(*) FILTER (WHERE NOT ok OR NOT sealed) FROM ledger.v_check_hash_chain
UNION ALL
SELECT 'R4_rolling_projection',
       count(*) FILTER (WHERE NOT ok) FROM cage.v_check_rolling_projection
UNION ALL
SELECT 'R5_suspense',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_suspense
UNION ALL
SELECT 'R6_entry_branch',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_entry_branch
UNION ALL
SELECT 'R7_posting_rules',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_posting_rules;

COMMENT ON VIEW ledger.v_integrity_status IS
  'violations 가 0이 아닌 행이 하나라도 있으면 신규 거래를 차단한다.';

-- 거래 차단 판정. 011 의 op_settle_period() 가 마감 전에 호출한다.
-- API 요청마다 호출하기에는 비싸므로 배치가 결과를 캐시한다.
CREATE FUNCTION ledger.integrity_ok() RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = ledger, cage, pg_temp
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM ledger.v_integrity_status WHERE violations > 0);
$$;

-- =============================================================================
-- 파생 뷰 — 현행 9개 교대 카운터 재구성
-- =============================================================================
-- 현행 SHIFT_FIELDS (index.html:4828) 는 서로 독립적으로 누적되며 상호 정합성을
-- 검증할 수단이 없었다. 여기서는 전부 원장 · 재고 원장에서 파생되므로
-- R1 · R2 가 통과하는 한 이 값들도 정합한다.
--
-- 역분개가 자동 반영된다: reverse_transaction() 이 원 category 를 유지하므로
-- 부호가 뒤집힌 같은 category 분개가 합계에서 상쇄된다.
-- (category 를 'reversal' 로 덮으면 여기서 정정이 사라진다.)
CREATE VIEW cage.v_shift_counters AS
WITH scope AS (
  SELECT branch, business_date FROM ledger.accounting_periods
),
money AS (
  SELECT e.branch, t.business_date, e.category, sum(e.amount_minor) AS amt
    FROM ledger.entries e
    JOIN ledger.transactions t ON t.id = e.transaction_id
   GROUP BY 1, 2, 3
),
chips AS (
  SELECT branch, business_date, chip_type, reason, sum(delta_minor) AS amt
    FROM cage.chip_inventory_events
   GROUP BY 1, 2, 3, 4
),
rolling AS (
  SELECT g.branch, r.business_date, sum(r.amount_minor) AS amt
    FROM cage.rolling_events r
    JOIN cage.games g ON g.id = r.game_id
   WHERE r.counts_toward_branch_total
   GROUP BY 1, 2
)
SELECT
  s.branch,
  s.business_date,
  -- 현행 cashBuyinShift
  COALESCE((SELECT sum(m.amt) FROM money m
             WHERE m.branch = s.branch AND m.business_date = s.business_date
               AND m.category = 'buyin_cash'), 0)                    AS cash_buyin_shift,
  -- 현행 buyinRollingShift (칩 발행은 대변이므로 부호를 뒤집어 표시한다)
  COALESCE((SELECT -sum(m.amt) FROM money m
             WHERE m.branch = s.branch AND m.business_date = s.business_date
               AND m.category = 'chips_issue'), 0)                   AS buyin_rolling_shift,
  -- 현행 workingChipRollingShift (발행 − 반환)
  COALESCE((SELECT sum(m.amt) FROM money m
             WHERE m.branch = s.branch AND m.business_date = s.business_date
               AND m.category IN ('working_chip_issue','working_chip_return')), 0)
                                                                     AS working_chip_rolling_shift,
  -- 현행 nnChipInShift · ccChipInShift (금고로 돌아온 칩)
  COALESCE((SELECT sum(c.amt) FROM chips c
             WHERE c.branch = s.branch AND c.business_date = s.business_date
               AND c.chip_type = 'nn'), 0)                           AS nn_chip_in_shift,
  COALESCE((SELECT sum(c.amt) FROM chips c
             WHERE c.branch = s.branch AND c.business_date = s.business_date
               AND c.chip_type = 'cc'), 0)                           AS cc_chip_in_shift,
  -- 현행 nnCashoutShift
  COALESCE((SELECT sum(c.amt) FROM chips c
             WHERE c.branch = s.branch AND c.business_date = s.business_date
               AND c.chip_type = 'nn' AND c.reason = 'settle_cashout'), 0)
                                                                     AS nn_cashout_shift,
  -- 현행 nnMarkerShift · ccMarkerShift
  COALESCE((SELECT sum(c.amt) FROM chips c
             WHERE c.branch = s.branch AND c.business_date = s.business_date
               AND c.chip_type = 'nn' AND c.reason = 'settle_marker_redeem'), 0)
                                                                     AS nn_marker_shift,
  COALESCE((SELECT sum(c.amt) FROM chips c
             WHERE c.branch = s.branch AND c.business_date = s.business_date
               AND c.chip_type = 'cc' AND c.reason = 'settle_marker_redeem'), 0)
                                                                     AS cc_marker_shift,
  -- 현행 rollingCashShift (관측 롤링 — 자금 아님)
  COALESCE((SELECT r.amt FROM rolling r
             WHERE r.branch = s.branch AND r.business_date = s.business_date), 0)
                                                                     AS rolling_cash_shift
FROM scope s;

COMMENT ON VIEW cage.v_shift_counters IS
  '현행 9개 shift 카운터를 원장 · 재고에서 재구성. API 응답 형태를 유지해 화면 변경을 최소화한다.';

-- 지점 롤링 누계 (현행 getGuestRollingGrandTotal, index.html:4547)
CREATE VIEW cage.v_branch_rolling_total AS
SELECT
  g.branch,
  sum(r.amount_minor) FILTER (WHERE r.counts_toward_branch_total) AS observed_rolling_minor,
  sum(r.amount_minor)                                             AS all_rolling_minor
FROM cage.rolling_events r
JOIN cage.games g ON g.id = r.game_id
GROUP BY g.branch;

-- 메인케이지 누계 (현행 deriveMainCageForBranch, index.html:4718)
CREATE VIEW cage.v_main_cage_total AS
SELECT branch, sum(amount_minor) AS grand_total_minor
  FROM cage.main_cage_events
 GROUP BY branch;

-- 게임 윈로스 — 04-posting-rules.md §8-3 공식 그대로.
--   회수 총액(chips_redeem) + 발행 총액(chips_issue, 바이인 거래분만)
-- chips_issue 는 대변(음수)이므로 더하면 차감된다.
-- 취소로 역분개된 게임은 같은 category 의 반대 부호 분개가 들어와 0으로 수렴한다.
CREATE VIEW cage.v_game_win_loss AS
SELECT
  g.id      AS game_id,
  g.game_no,
  g.branch,
  g.status,
  g.buyin_minor,
  COALESCE(sum(e.amount_minor) FILTER (WHERE e.category = 'chips_redeem'), 0)
                                                                 AS redeemed_minor,
  COALESCE(sum(e.amount_minor) FILTER (WHERE e.category = 'chips_issue'
                                         AND t.kind = 'game_buyin'), 0)
                                                                 AS issued_minor,
  COALESCE(sum(e.amount_minor) FILTER (
    WHERE e.category = 'chips_redeem'
       OR (e.category = 'chips_issue' AND t.kind = 'game_buyin')), 0)
                                                                 AS win_loss_minor
FROM cage.games g
LEFT JOIN ledger.entries e      ON e.account_id = g.chips_account_id
LEFT JOIN ledger.transactions t ON t.id = e.transaction_id
GROUP BY g.id, g.game_no, g.branch, g.status, g.buyin_minor;

-- =============================================================================
-- 권한 — 012 가 이미 실행됐으므로 여기서 부여한다
-- =============================================================================
GRANT SELECT ON
  ledger.v_check_double_entry, ledger.v_check_balance_projection,
  ledger.v_check_hash_chain, ledger.v_check_suspense,
  ledger.v_check_entry_branch, ledger.v_check_posting_rules,
  ledger.v_integrity_status,
  cage.v_check_rolling_projection
TO ledger_read;

GRANT SELECT ON
  ledger.v_integrity_status,
  cage.v_shift_counters, cage.v_branch_rolling_total,
  cage.v_main_cage_total, cage.v_game_win_loss
TO ledger_app;

GRANT SELECT ON
  cage.v_shift_counters, cage.v_branch_rolling_total,
  cage.v_main_cage_total, cage.v_game_win_loss
TO ledger_read;

GRANT EXECUTE ON FUNCTION
  ledger.integrity_ok(),
  ledger.verify_hash_chain(ledger.branch_code, BIGINT, BIGINT)
TO ledger_app, ledger_read;

COMMIT;

-- =============================================================================
-- 운영 사용법
-- =============================================================================
-- 상시 헬스체크 (1분 주기):
--   SELECT * FROM ledger.v_integrity_status WHERE violations > 0;
--
-- 야간 심층 검증 — 위조를 잡는 것은 이쪽뿐이다:
--   SELECT * FROM ledger.verify_hash_chain('HANN', :first_id, :last_id)
--    WHERE NOT content_ok;
--
-- 위반 발생 시:
--   1. 신규 거래 차단 (API 503 ledger-integrity-halt)
--   2. 즉시 호출 등급 알람
--   3. 어느 검사가 깨졌는지에 따라 해당 상세 뷰 조회
--        R1 → ledger.v_check_double_entry
--        R2 → ledger.v_check_balance_projection   WHERE NOT ok
--        R3 → ledger.v_check_hash_chain           WHERE NOT ok
--             ledger.verify_hash_chain(...)       WHERE NOT content_ok
--        R6 → ledger.v_check_entry_branch         WHERE NOT ok
--        R7 → ledger.v_check_posting_rules        WHERE NOT ok
--
-- 일 마감 앵커링 — 심층 검증을 통과한 뒤에만 수행한다:
--   INSERT INTO audit.chain_anchors (branch, business_date, last_tx_id, chain_hash, anchor_ref)
--   SELECT branch, :business_date, last_tx_id, last_hash, :external_ref
--     FROM ledger.chain_heads;
--
-- 멱등키 정리 (일 1회):
--   SELECT ledger.purge_expired_idempotency();
