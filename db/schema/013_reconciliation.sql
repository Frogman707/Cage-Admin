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
CREATE VIEW ledger.v_check_double_entry
  WITH (security_invoker = true) AS
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
CREATE VIEW ledger.v_check_balance_projection
  WITH (security_invoker = true) AS
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

CREATE VIEW ledger.v_check_hash_chain
  WITH (security_invoker = true) AS
-- 체인 대상 거래만 본다 (design-review.md DR-05). chain_policy.chained = false 인
-- 거래(bet · payout)는 hash 가 NULL 인 것이 정상이고, 여기 끼면 lag() 연결이
-- 끊어져 멀쩡한 체인이 전부 위반으로 잡힌다.
WITH ordered AS (
  SELECT
    t.id, t.branch, t.external_id, t.recorded_at, t.prev_hash, t.hash,
    lag(t.hash) OVER (PARTITION BY t.branch ORDER BY t.id) AS expected_prev
  FROM ledger.transactions t
  JOIN ledger.chain_policy cp ON cp.kind = t.kind AND cp.chained
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
  p_branch  TEXT,
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
CREATE VIEW cage.v_check_rolling_projection
  WITH (security_invoker = true) AS
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
CREATE VIEW ledger.v_check_suspense
  WITH (security_invoker = true) AS
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
CREATE VIEW ledger.v_check_entry_branch
  WITH (security_invoker = true) AS
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
CREATE VIEW ledger.v_check_posting_rules
  WITH (security_invoker = true) AS
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
-- R8 — 앵커 대조 (design-review-2.md DR-26)
-- =============================================================================
-- R3(a) 링크 검사와 R3(b) 내용 재계산은 **연쇄 재작성을 통과시킨다.**
-- R3(b)가 저장된 prev_hash 를 그대로 입력으로 쓰기 때문이다. 공격 절차:
--   1. 거래 N 의 내용을 고친다
--   2. N.hash 를 canonical_digest(N) 으로 재계산해 덮는다        → R3(b) 통과
--   3. N+1.prev_hash 를 N 의 새 hash 로 갱신한다                 → R3(a) 통과
--   4. N+1.hash 도 재계산한다                                    → R3(b) 통과
--   5. 마지막 거래까지 반복하면 체인 전체가 자기 정합적이 된다
-- 이 재작성을 잡는 것은 앵커 대조뿐이다. 08-adr.md ADR-006 이 예상한 바로 그 시나리오다.
--
-- 앵커 자체가 DB 안에 있으므로 이 뷰만으로는 부족하다. 외부 서명 대조까지 해야
-- 완결된다 — 06-security.md 의 외부 앵커 서명 절.
CREATE VIEW ledger.v_check_chain_anchor
  WITH (security_invoker = true) AS
SELECT
  a.branch,
  a.business_date,
  a.last_tx_id,
  a.chain_hash          AS anchored_hash,
  t.hash                AS current_hash,
  a.anchored_at,
  a.anchor_ref,
  t.hash = a.chain_hash AS ok
  FROM audit.chain_anchors a
  JOIN ledger.transactions t ON t.id = a.last_tx_id;

COMMENT ON VIEW ledger.v_check_chain_anchor IS
  'R8. ok=false 는 앵커 시점 이후 과거 거래가 재작성됐다는 뜻이다. R3(a)·R3(b) 는 연쇄 재작성을 통과시키므로 위조를 잡는 것은 이 검사뿐이다.';

-- R9 — 머클 앵커 대조 (design-review.md DR-05)
-- =============================================================================
-- 체인 밖 거래(chain_policy.chained = false)는 hash 가 없으므로 R3 · R8 이 보지
-- 않는다. 그 공백을 메우는 것이 일 단위 머클 앵커다 (ADR-006).
--
-- 루트 계산을 함수 하나로 고정한다. 기록하는 쪽과 검증하는 쪽이 각자 계산하면
-- 산식이 갈리고, 그러면 나온 차이가 위조인지 산식 드리프트인지 구분할 수 없다.
-- 008 의 canonical_digest() 가 같은 이유로 함수 하나에 모여 있다.
--
-- SECURITY DEFINER 인 이유: canonical_digest() 는 012 에서 조회 역할에 EXECUTE 가
-- 회수돼 있다. verify_hash_chain() 과 같은 사정이다.
CREATE FUNCTION audit.merkle_root_for(
  p_branch        TEXT,
  p_business_date DATE,
  p_kind          ledger.tx_kind
) RETURNS BYTEA
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = audit, ledger, pg_temp
AS $$
DECLARE
  v_level BYTEA[];
  v_next  BYTEA[];
  i       INT;
BEGIN
  -- 리프: 거래 id 오름차순. 정렬 기준이 곧 규약이다.
  SELECT array_agg(sha256(convert_to(ledger.canonical_digest(t.id), 'UTF8')) ORDER BY t.id)
    INTO v_level
    FROM ledger.transactions t
   WHERE t.branch = p_branch
     AND t.business_date = p_business_date
     AND t.kind = p_kind;

  IF v_level IS NULL THEN
    RETURN NULL;                        -- 그날 그 종류의 거래가 없다
  END IF;

  WHILE array_length(v_level, 1) > 1 LOOP
    v_next := ARRAY[]::BYTEA[];
    i := 1;
    WHILE i <= array_length(v_level, 1) LOOP
      IF i + 1 <= array_length(v_level, 1) THEN
        v_next := v_next || sha256(v_level[i] || v_level[i + 1]);
      ELSE
        -- 홀수 개면 마지막 노드를 자기 자신과 짝짓는다 (Bitcoin 과 같은 관례).
        v_next := v_next || sha256(v_level[i] || v_level[i]);
      END IF;
      i := i + 2;
    END LOOP;
    v_level := v_next;
  END LOOP;

  RETURN v_level[1];
END;
$$;

COMMENT ON FUNCTION audit.merkle_root_for IS
  '체인 밖 거래의 일 단위 머클 루트. 기록과 검증이 같은 산식을 쓰게 하는 유일한 정의다. design-review.md DR-05.';

CREATE VIEW ledger.v_check_merkle_anchor
  WITH (security_invoker = true) AS
SELECT
  m.branch,
  m.business_date,
  m.tx_kind,
  m.tx_count,
  m.merkle_root                                                    AS anchored_root,
  audit.merkle_root_for(m.branch, m.business_date, m.tx_kind)      AS current_root,
  m.anchored_at,
  m.merkle_root = audit.merkle_root_for(m.branch, m.business_date, m.tx_kind) AS ok
  FROM audit.merkle_anchors m;

COMMENT ON VIEW ledger.v_check_merkle_anchor IS
  'R9. ok=false 는 앵커 시점 이후 체인 밖 거래(bet · payout)가 변조됐다는 뜻이다. R3 · R8 은 그 거래를 보지 않는다.';

CREATE VIEW ledger.v_integrity_status
  WITH (security_invoker = true) AS
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
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_posting_rules
UNION ALL
SELECT 'R8_chain_anchor',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_chain_anchor
UNION ALL
SELECT 'R9_merkle_anchor',
       count(*) FILTER (WHERE NOT ok) FROM ledger.v_check_merkle_anchor;

COMMENT ON VIEW ledger.v_integrity_status IS
  'violations 가 0이 아닌 행이 하나라도 있으면 신규 거래를 차단한다.';

-- 거래 차단 판정. 011 의 op_settle_period() 가 마감 전에 호출한다.
-- API 요청마다 호출하기에는 비싸므로 배치가 결과를 캐시한다.
--
-- SECURITY DEFINER 인 이유 (design-review-2.md DR-24): 이 파일의 뷰가 전부
-- security_invoker 가 되면서 v_integrity_status 는 호출자 권한으로 하위 v_check_*
-- 일곱 개를 읽는다. 그 일곱 개는 ledger_read 에만 부여돼 있으므로 ledger_app 이
-- 그대로 부르면 permission denied 로 깨진다.
-- 하위 뷰 일곱 개를 앱에 여는 것보다 판정 결과 하나만 돌려주는 쪽이 노출면이 작다.
-- 위 verify_hash_chain() 이 같은 이유로 이미 정의자 함수다.
CREATE FUNCTION ledger.integrity_ok() RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
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
CREATE VIEW cage.v_shift_counters
  WITH (security_invoker = true) AS
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
CREATE VIEW cage.v_branch_rolling_total
  WITH (security_invoker = true) AS
SELECT
  g.branch,
  sum(r.amount_minor) FILTER (WHERE r.counts_toward_branch_total) AS observed_rolling_minor,
  sum(r.amount_minor)                                             AS all_rolling_minor
FROM cage.rolling_events r
JOIN cage.games g ON g.id = r.game_id
GROUP BY g.branch;

-- 메인케이지 누계 (현행 deriveMainCageForBranch, index.html:4718)
CREATE VIEW cage.v_main_cage_total
  WITH (security_invoker = true) AS
SELECT branch, sum(amount_minor) AS grand_total_minor
  FROM cage.main_cage_events
 GROUP BY branch;

-- 게임 윈로스 — 04-posting-rules.md §8-3 공식 그대로.
--   회수 총액(chips_redeem) + 발행 총액(chips_issue, 바이인 거래분만)
-- chips_issue 는 대변(음수)이므로 더하면 차감된다.
-- 취소로 역분개된 게임은 같은 category 의 반대 부호 분개가 들어와 0으로 수렴한다.
CREATE VIEW cage.v_game_win_loss
  WITH (security_invoker = true) AS
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
-- 설치 완결성 검사 — 반쪽 지점 (design-review DR-60 · AC-60-2)
-- =============================================================================
-- 지점 추가가 branches INSERT 한 줄로 끝난 것처럼 보이지만, branch_config ·
-- chain_heads · 하우스 주체 · 하우스 계정이 함께 있어야 한다. chain_heads 를
-- 빠뜨리면 **그 지점의 첫 거래에서** 터진다 — 스키마 적용 시점이 아니라 운영 중이다.
--
-- 위 R1~R9 와 달리 v_integrity_status 에 넣지 않는다. 이것은 원장 정합성이 아니라
-- 설치 완결성이고, 거래를 차단할 일이 아니라 배포를 막을 일이다
-- (v_check_view_security · v_check_public_execute 와 같은 등급).
-- R 번호도 쓰지 않는다 — R10·R11 이 스펙 01 §6 에 예약돼 있다
-- (10-acceptance-criteria.md §11 대장).
--
-- has_staff 는 **정보 열이다.** ok 판정에 넣지 않는다 — 직원 배정은
-- provision_branch() 의 일이 아니고, 갓 만든 지점에 직원이 없는 것은 결함이 아니다.
--
-- 하우스 계정은 **개수가 아니라 집합으로** 본다. count(*) > 0 으로 두면 11 종 중
-- 10 종이 사라진 지점도 ok=true 다 — 그런 지점은 스키마 적용 시점이 아니라
-- 상대 계정을 못 찾는 첫 분개에서 터진다. 그래서 003 의 house_account_policy
-- 와 대조하고, 종류뿐 아니라 성격(normal_balance · allow_negative)과 통화까지 본다.
CREATE VIEW ledger.v_check_branch_provisioning
  WITH (security_invoker = true) AS
SELECT
  t.*,
  (t.has_config
   AND t.has_chain_head
   AND t.has_house_party
   AND t.missing_house_accounts = 0) AS ok
  FROM (
    SELECT
      b.code   AS branch,
      b.status AS status,
      EXISTS (SELECT 1 FROM ledger.branch_config c WHERE c.branch = b.code) AS has_config,
      EXISTS (SELECT 1 FROM ledger.chain_heads   h WHERE h.branch = b.code) AS has_chain_head,
      EXISTS (SELECT 1 FROM ledger.parties       p WHERE p.home_branch = b.code
                AND p.party_type = 'house')                                 AS has_house_party,
      -- 정보 열. 진단용이며 ok 판정에는 아래 missing_house_accounts 를 쓴다.
      (SELECT count(*) FROM ledger.accounts a
         JOIN ledger.parties p2 ON p2.id = a.party_id
        WHERE p2.home_branch = b.code AND p2.party_type = 'house')::int     AS house_account_count,
      -- 정책에 있는데 실물이 없거나 성격이 다른 종류의 수. 0 이어야 한다.
      -- ⚠️ 통화가 'PHP' 로 고정돼 있다 — a03 이 하우스 계정을 통화 곱집합으로
      -- 넓힐 때 (R-01-11) 이 조건도 함께 넓힌다. 003 의 house_account_policy 와
      -- 여기, 두 곳이 짝이다.
      (SELECT count(*) FROM ledger.house_account_policy k
        WHERE NOT EXISTS (
          SELECT 1 FROM ledger.accounts a
            JOIN ledger.parties hp ON hp.id = a.party_id
           WHERE hp.home_branch = b.code
             AND hp.party_type    = 'house'
             AND a.kind           = k.kind
             AND a.currency       = 'PHP'
             AND a.normal_balance = k.normal_balance
             AND a.allow_negative = k.allow_negative))::int                 AS missing_house_accounts,
      EXISTS (SELECT 1 FROM identity.staff_branches s WHERE s.branch = b.code) AS has_staff
      FROM ledger.branches b
  ) t;

COMMENT ON VIEW ledger.v_check_branch_provisioning IS
  'AC-60-2. ok=false 는 provision_branch() 를 건너뛴 반쪽 지점이거나 하우스 계정이 house_account_policy 와 어긋난 지점이다. missing_house_accounts 가 어느 쪽인지 가른다. has_staff 는 정보 열이며 ok 판정에 들어가지 않는다.';

-- =============================================================================
-- 설정 드리프트 검사 — security_invoker 누락 (design-review-2.md DR-24)
-- =============================================================================
-- 08-adr.md ADR-014 와 06-security.md §257 이 "모든 뷰에 security_invoker = true"
-- 를 규칙으로 정해 뒀는데도 이 파일의 뷰 12개가 전부 빠져 있었다. ADR 을 쓴 사람과
-- 013 을 쓴 사람이 같은데도 그랬다 — 사람이 지키는 규칙은 다시 빠진다.
--
-- 위 R1~R7 과 달리 v_integrity_status 에 넣지 않는다. 이것은 원장 정합성이 아니라
-- 배포 설정의 결함이고, 거래를 차단할 일이 아니라 배포를 막을 일이다.
-- 07-migration.md 의 컷오버 체크리스트와 CI 가 이 뷰를 본다.
CREATE VIEW ledger.v_check_view_security
  WITH (security_invoker = true) AS
SELECT c.relnamespace::regnamespace::text AS schema_name,
       c.relname                          AS view_name
  FROM pg_class c
 WHERE c.relkind = 'v'
   AND c.relnamespace::regnamespace::text IN ('ledger', 'cage', 'archive', 'identity')
   AND NOT COALESCE((SELECT option_value::boolean
                       FROM pg_options_to_table(c.reloptions)
                      WHERE option_name = 'security_invoker'), FALSE);

COMMENT ON VIEW ledger.v_check_view_security IS
  '행이 하나라도 나오면 정의자 뷰가 있다는 뜻이고, 그 뷰는 RLS 를 우회한다. 배포 전 0행이어야 한다.';

-- =============================================================================
-- 권한 — 012 가 이미 실행됐으므로 여기서 부여한다
-- =============================================================================
GRANT SELECT ON
  ledger.v_check_double_entry, ledger.v_check_balance_projection,
  ledger.v_check_hash_chain, ledger.v_check_suspense,
  ledger.v_check_entry_branch, ledger.v_check_posting_rules,
  ledger.v_check_chain_anchor, ledger.v_check_merkle_anchor,
  ledger.v_integrity_status,
  ledger.v_check_view_security,
  ledger.v_check_branch_provisioning,
  cage.v_check_rolling_projection
TO ledger_read;

-- R8 은 audit.chain_anchors 를 읽는다. security_invoker 뷰이므로 뷰에 SELECT 가
-- 있어도 그것만으로는 부족하고 호출자가 **기반 테이블에도** SELECT 를 가져야 한다.
--
-- audit_reader 를 ledger_read 에 상속시키지 않는다. 012 가 두 접근을 분리한 이유가
-- 그대로 적용된다 — 상시 접속하는 리포팅 자격증명에 감사 로그를 얹으면 감사 로그
-- 조회 자체가 감사되지 않는다. R8 을 직접 조회할 사람에게는 두 역할을 **각각** 부여한다.
-- 배치는 정의자 함수 integrity_ok() 를 쓰면 되고, 그 경로는 이 제약을 받지 않는다.
GRANT USAGE ON SCHEMA ledger TO audit_reader;

-- design-review-2.md DR-24. v_integrity_status 는 ledger_app 에 주지 않는다.
-- security_invoker 가 붙은 뒤로는 이 뷰가 호출자 권한으로 하위 v_check_* 를 읽는데,
-- 그 일곱 개는 ledger_read 전용이다. 앱은 대신 integrity_ok() 를 부른다 (정의자 함수).
-- 아래 네 개는 그대로 둔다 — 이제 security_invoker 라서 RLS 지점 스코프가 적용된다.
GRANT SELECT ON
  cage.v_shift_counters, cage.v_branch_rolling_total,
  cage.v_main_cage_total, cage.v_game_win_loss
TO ledger_app;

GRANT SELECT ON
  cage.v_shift_counters, cage.v_branch_rolling_total,
  cage.v_main_cage_total, cage.v_game_win_loss
TO ledger_read;

GRANT EXECUTE ON FUNCTION
  ledger.integrity_ok(),
  ledger.verify_hash_chain(TEXT, BIGINT, BIGINT)
TO ledger_app, ledger_read;

-- =============================================================================
-- 최종 차단 — 모든 함수가 만들어진 뒤 한 번
-- =============================================================================
-- 012 의 `REVOKE ALL ON ALL FUNCTIONS` 은 그 시점의 함수만 대상으로 한다. 그 뒤
-- 012 자신이 RLS 헬퍼 넷을, 013 이 verify_hash_chain · integrity_ok ·
-- merkle_root_for 를 만들고, 이들은 모두 내장 기본값인 PUBLIC EXECUTE 를 받는다.
-- 일곱 개 전부 SECURITY DEFINER 라서 소유자 권한으로 돈다 — archive_reader 든
-- audit_writer 든 클러스터의 아무 역할이나 부를 수 있는 상태였다.
--
-- ALTER DEFAULT PRIVILEGES 로는 막을 수 없다 (012 의 해당 주석 참조). 순서상
-- 마지막인 이 자리에서 한 번 쓸어내는 것이 유일하게 동작하는 방법이다.
-- FROM PUBLIC 이므로 위에서 역할에 준 EXECUTE 는 그대로 남는다.
--
-- 함수를 추가하는 파일이 013 뒤에 생기면 이 블록을 그 파일 끝으로 옮긴다.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger, cage, identity, audit, archive
  FROM PUBLIC;

-- 위 REVOKE 가 빠지거나 뒤에 새 파일이 붙었을 때를 잡는다. 012 · 013 어느 쪽도
-- 손대지 않은 새 함수가 하나라도 있으면 여기 나온다.
CREATE VIEW ledger.v_check_public_execute
  WITH (security_invoker = true) AS
SELECT n.nspname AS schema_name,
       p.proname AS function_name,
       p.prosecdef AS is_security_definer
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname IN ('ledger','cage','identity','audit','archive')
   AND has_function_privilege('public', p.oid, 'EXECUTE');

COMMENT ON VIEW ledger.v_check_public_execute IS
  '행이 나오면 그 함수를 클러스터의 아무 역할이나 부를 수 있다는 뜻이다. '
  'is_security_definer 가 true 면 소유자 권한으로 돈다. 배포 전 0행이어야 한다.';

GRANT SELECT ON ledger.v_check_public_execute TO ledger_read;

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
