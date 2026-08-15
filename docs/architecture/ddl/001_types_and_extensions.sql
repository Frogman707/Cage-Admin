-- =============================================================================
-- 001. 스키마 · 타입 · 공통 함수
-- =============================================================================
-- 적용 대상: PostgreSQL 18 이상
--   - uuidv7()  : 18 내장. 시간 정렬 UUID
--   - sha256()  : 11 이상 내장. 해시 체인용 (pgcrypto 불필요)
--
-- 적용: psql -v ON_ERROR_STOP=1 -f 001_types_and_extensions.sql
-- 순서: 001 → 002 → ... → 010 (번호 순서 고정)
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 스키마
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS ledger;    -- 계정 · 거래 · 분개 · 잔액 · 기간 · outbox
CREATE SCHEMA IF NOT EXISTS cage;      -- 게임 · 롤링 · 정산 · 메인케이지 · 실사 · 칩재고
CREATE SCHEMA IF NOT EXISTS identity;  -- 직원 · 역할 · 세션 · TOTP · 승인
CREATE SCHEMA IF NOT EXISTS audit;     -- 감사 로그 (별도 역할이 소유)
CREATE SCHEMA IF NOT EXISTS archive;   -- 레거시 스냅샷 (조회 전용)

COMMENT ON SCHEMA ledger   IS '자금 원장. 이 스키마의 유일한 writer 는 Ledger 서비스다.';
COMMENT ON SCHEMA cage     IS '케이지 운영 도메인. 자금 이동은 반드시 ledger.post_transaction() 경유.';
COMMENT ON SCHEMA archive  IS '레거시 Firestore 스냅샷. 조회 전용이며 신규 원장과 연결되지 않는다.';

-- -----------------------------------------------------------------------------
-- 지점
-- -----------------------------------------------------------------------------
-- 현행 index.html:4563 / :6430 의 하드코딩 3개 지점을 그대로 옮긴 것.
-- 지점 추가 계획이 있으면 참조 테이블로 전환할 것 (08-adr.md · U4).
CREATE TYPE ledger.branch_code AS ENUM ('HANN', 'NUSTAR', 'ONLINE');

-- -----------------------------------------------------------------------------
-- 계정 체계
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.party_type AS ENUM (
  'member',    -- 손님 (현행 accounts 중 isMain=false)
  'house',     -- 지점 (현행 MAIN-{branch})
  'game',      -- 게임별 칩 발행 주체
  'partner',   -- 에이전트 · 쉐어 파트너 (현행 partners/{partnerCode})
  'internal'   -- 개시 자본 · 미결산 등 내부 계정
);

-- normal_balance 는 표시 부호를 결정한다 (03-ledger-model.md §3-2)
--   debit  → 표시잔액 =  balance_minor,  하한 balance_minor >= 0
--   credit → 표시잔액 = -balance_minor,  하한 balance_minor <= 0
CREATE TYPE ledger.normal_balance AS ENUM ('debit', 'credit');

CREATE TYPE ledger.account_kind AS ENUM (
  'member_deposit',     -- credit  손님 예치금 (케이지가 갚을 돈)
  'player_wallet',      -- credit  온라인 회원 보유금 (현행 memberLedger)
  'player_points',      -- credit  회원 포인트 (현행 memberLedger category point_earn/point_convert)
  'partner_share_payable', -- credit  파트너 쉐어 미지급금 (현행 shareLedger)
  'chips_outstanding',  -- credit  해당 게임에 발행된 미상환 칩
  'tips_dealer',        -- credit  딜러 팁 미지급금
  'tips_house',         -- credit  하우스 팁
  'house_gaming',       -- credit  온라인 게임 손익
  'house_cash',         -- debit   지점 현금 금고
  'marker_receivable',  -- debit   마커 미수금
  'promo_expense',      -- debit   워킹칩 · 포인트 적립 등 프로모션 비용
  'commission_expense', -- debit   파트너 쉐어 · 롤링 커미션 비용
  'suspense',           -- debit   밸런싱 차액 임시계정 (allow_negative)
  -- 실사 차액의 **종착지**. 이 둘이 없어서 suspense 를 0으로 되돌릴 방법이 없었고,
  -- 차액이 한 번 나면 그 지점은 영원히 마감되지 않았다 (design-review.md DR-01).
  -- op_adjustment 를 다시 불러도 house_cash <-> suspense 를 왕복할 뿐이었다.
  'shortage_expense',   -- debit   실사 부족분 확정 손실 (하우스 부담)
  'overage_income',     -- credit  실사 과잉분 확정 이익
  'opening_equity'      -- credit  마이그레이션 개시 균형 계정
);

CREATE TYPE ledger.account_status AS ENUM ('active', 'suspended', 'closed');

-- -----------------------------------------------------------------------------
-- 거래 · 분개
-- -----------------------------------------------------------------------------
-- 각 값이 04-posting-rules.md 의 절 하나에 대응한다.
-- ⚠️ 선언 ≠ 실행 경로 (design-review-3.md DR-38).
-- ADR-013 때문에 op_* 함수가 없는 tx_kind 는 애플리케이션이 기록할 방법이 없다.
-- 아래 값 중 **아직 op 함수가 없는 것**을 여기 명시한다. 다음 사람이 "선언돼 있으니
-- 구현됐다" 고 읽는 것이 이 결함의 발생 원인 그 자체였다.
--
--   bet · payout             플레이어 도메인. 00-system-map.md §8 A1·A2 보류 중
--                            (아바타/스피드 개선이 진행 중이라 스키마가 흔들린다)
--   point_earn · point_convert  같은 이유로 보류 + design-review-6.md DR-68
--                            (케이지 포인트를 흡수/분리/폐기 중 무엇으로 할지 미결정)
--   share_accrue · share_settle 파트너 쉐어. 현행 구현이 없어 (a) op 추가와
--                            (c) 타입 삭제 사이 결정이 남아 있다
--
-- 해소된 것: opening_balance (ledger.op_load_opening_balance, 011),
--            commission_payout (cage.op_settle_commission, 010).
-- 013 의 v_check_view_security 처럼 이 공백을 자동 검출하는 대사는 아직 없다 —
-- DR-38 의 검증 쿼리(pg_proc.prosrc LIKE) 를 CI 에 넣는 것이 남은 일이다.
CREATE TYPE ledger.tx_kind AS ENUM (
  'deposit',           -- §1   _doProcessIo IN
  'withdraw',          -- §2   _doProcessIo OUT
  'transfer',          -- §3   _doTransfer
  'branch_transfer',   -- §4   _doProcessBranchTransfer
  'game_buyin',        -- §5   _doStartGame / _doAddBuyin
  'mid_settle',        -- §7   _doConfirmMidSettle
  'game_end',          -- §8   _doConfirmGameEnd
  'game_cancel',       -- §9   cancelGame (역분개)
  'adjustment',        -- §11  밸런싱 차액
  'suspense_resolve',  -- §11-2 차액 확정 해소 (design-review.md DR-01)
  'wallet_transfer',   -- §12  케이지 계좌 <-> 회원 보유금
  'bet',               -- §13
  'payout',            -- §13
  'point_earn',        -- §13-2  포인트 적립
  'point_convert',     -- §13-2  포인트 -> 보유금 전환
  'share_accrue',      -- §13-3  파트너 쉐어 적립
  'share_settle',      -- §13-3  파트너 쉐어 지급
  'commission_payout', -- §6-1  롤링 커미션 정산 지급 (design-review-6.md DR-66)
  'opening_balance',   -- §14  마이그레이션 전용
  'reversal'           -- 일반 역분개
);

CREATE TYPE ledger.entry_category AS ENUM (
  'deposit_cash',          'withdraw_cash',
  'transfer_out',          'transfer_in',
  'branch_transfer_out',   'branch_transfer_in',
  'buyin_account',         'buyin_cash',            'buyin_marker',
  'chips_issue',           'chips_redeem',
  'working_chip_issue',    'working_chip_return',
  'settle_deposit',        'settle_cashout',        'settle_marker_redeem',
  'settle_dealer_tip',     'settle_house_tip',
  'wallet_transfer_out',   'wallet_transfer_in',
  'bet',                   'payout',
  'point_earn',            'point_convert_out',     'point_convert_in',
  'share_accrue',          'share_settle',
  'commission_payout',
  'adjustment',            'suspense_resolve_out',  'suspense_resolve_in',
  'reversal',              'opening_balance'
);

-- -----------------------------------------------------------------------------
-- 회계 기간 · 멱등성
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.period_status AS ENUM ('open', 'frozen', 'settled');

CREATE TYPE ledger.idempotency_state AS ENUM ('in_progress', 'completed');

-- -----------------------------------------------------------------------------
-- 인증 · 승인
-- -----------------------------------------------------------------------------
-- 현행 requestPinAuth() / requestWithdrawAuth() 흐름을 그대로 표현한다.
CREATE TYPE identity.auth_method AS ENUM (
  'pin',          -- 현행 requestPinAuth
  'totp',         -- 현행 verifyTotp (index.html:5566)
  'withdraw_pw',  -- 현행 requestWithdrawAuth
  'approval',     -- 4-eyes 승인 완료
  'system'        -- 배치 · 마이그레이션
);

-- 인증 주체의 종류. 케이지 직원과 파트너 콘솔 운영자는 같은 인증·세션·RBAC 기반을
-- 쓰지만 데이터 가시성 규칙이 다르다 (직원=지점 스코프, 파트너=계층 스코프).
-- 현행 대응: staff/{id}(index.html) · partnerStaff/{id}(partner-admin/app.js:170)
CREATE TYPE identity.principal_type AS ENUM (
  'cage_staff',        -- 지점 케이지 직원. staff_branches 로 지점 스코프
  'partner_operator'   -- 파트너 콘솔 운영자. partner_party_id 계층으로 스코프
);

-- 'reversal' 은 design-review-4.md DR-50 에서 추가됐다. 역분개는 금액과 무관하게
-- 항상 4-eyes 이므로 branch_config 임계 검사를 거치지 않고 op_reverse_transaction 이
-- 직접 consume_approval 을 부른다 (011).
--
-- 'account_status' 는 여전히 발동하는 조작이 없다 — design-review-9.md DR-83.
-- 계좌 상태를 바꾸는 op 함수가 만들어질 때 함께 해소된다.
CREATE TYPE identity.approval_subject AS ENUM (
  'withdrawal', 'adjustment', 'period_settle', 'account_status', 'reversal',
  'suspense_resolve'   -- 실사 차액 확정 (design-review.md DR-01). 금액 무관 4-eyes
);
CREATE TYPE identity.approval_status   AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE identity.approval_decision AS ENUM ('approve', 'reject');
CREATE TYPE identity.shift_action      AS ENUM ('in', 'out');

-- -----------------------------------------------------------------------------
-- 게임 · 롤링 · 케이지
-- -----------------------------------------------------------------------------
CREATE TYPE cage.game_status     AS ENUM ('ongoing', 'ended', 'cancelled');
CREATE TYPE cage.game_start_type AS ENUM ('cash', 'account', 'marker');   -- 현행 startType
CREATE TYPE cage.game_start_kind AS ENUM ('live', 'avatar', 'speed');     -- 현행 startKind

-- 현행 rollingEvents.memo 문자열 관례(index.html:4553)를 명시 타입으로 승격.
-- 빈 memo 와 'rolling' 을 동일 취급하던 모호성을 제거한다.
CREATE TYPE cage.rolling_source AS ENUM (
  'buyin',         -- memo 'buy-in'
  'working_chip',  -- memo 'working-chip'
  'manual',        -- memo 'rolling'  (지점 누계에 산입되는 유일한 값)
  'mid_settle',    -- memo 'mid-settle'
  'game_end',      -- memo 'game-end'
  'month_reset',   -- memo 'month-settle-reset'
  'correction'     -- 신규: 취소 시 상쇄
);

CREATE TYPE cage.settlement_kind AS ENUM ('mid', 'final');

-- 현행 mainCageSignedEffect(index.html:4695): redeem 만 음수
CREATE TYPE cage.main_cage_kind AS ENUM ('buyin', 'rolling_cc', 'marker', 'redeem', 'reset');

CREATE TYPE cage.chip_type AS ENUM ('nn', 'cc');   -- 현행 NN칩 / CC칩
CREATE TYPE cage.count_kind AS ENUM ('cash', 'nn', 'cc');  -- 현행 BREAKDOWN_PREFIXES(:4888)

-- -----------------------------------------------------------------------------
-- 통화
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.currencies (
  code   TEXT PRIMARY KEY,
  scale  SMALLINT NOT NULL CHECK (scale BETWEEN 0 AND 6),
  symbol TEXT NOT NULL,
  CONSTRAINT currencies_code_format CHECK (code ~ '^[A-Z]{3}$')
);

COMMENT ON COLUMN ledger.currencies.scale IS
  '최소 단위 소수 자릿수. 모든 금액은 BIGINT 최소 단위로 저장한다 (PHP scale=2 → 센타보).';

INSERT INTO ledger.currencies (code, scale, symbol) VALUES
  ('PHP', 2, '₱'),
  ('USD', 2, '$'),
  ('KRW', 0, '₩');

-- -----------------------------------------------------------------------------
-- 영업일 규칙
-- -----------------------------------------------------------------------------
-- 현행 phNow()(index.html:4153)는 UTC 에 8시간을 더한 고정 오프셋 산술이다.
-- 신규는 타임존 규칙을 쓰고, 컷오프 시각 기준으로 영업일을 결정한다.
CREATE TABLE ledger.branch_config (
  branch       ledger.branch_code PRIMARY KEY,
  timezone     TEXT NOT NULL DEFAULT 'Asia/Manila',
  cutoff_time  TIME NOT NULL DEFAULT '06:00',

  -- 이 금액 이상의 출금 · 지점이체는 4-eyes 승인이 없으면 거부된다.
  -- 009 의 require_approval_if_over_threshold() 가 읽는다.
  -- 05-api-contract.md §6-2 의 "임계 금액 초과 → approval" 이 여기서 실체를 갖는다.
  --
  -- NOT NULL 이고 기본값도 없다 (design-review-3.md DR-39). 지점을 만들 때
  -- 임계를 반드시 정하게 한다. 예전에는 NULL 허용 + 시드 미지정이어서 신규 설치가
  -- "임계 없음" 상태로 출발했고, 그 상태에서는 금액이 얼마든 승인 없이 통과했다.
  -- 오류도 로그도 없이 4-eyes 통제 전체가 비활성이었다.
  --
  -- 임계를 실제로 끄려는 지점은 9223372036854775807 (BIGINT 최댓값) 을 넣는다.
  -- "끄기로 했다" 가 데이터로 남는다. 침묵으로는 못 끈다.
  approval_threshold_minor BIGINT NOT NULL CHECK (approval_threshold_minor > 0),

  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 아래 세 값은 **잠정값이다.** 운영이 확정하기 전까지의 자리 표시자이며,
-- 확정 시 이 시드와 07-migration.md 의 컷오버 체크리스트를 함께 고친다.
INSERT INTO ledger.branch_config (branch, approval_threshold_minor) VALUES
  ('HANN',   50000000),   -- ₱500,000.00  (잠정)
  ('NUSTAR', 50000000),   -- ₱500,000.00  (잠정)
  ('ONLINE', 20000000);   -- ₱200,000.00  (잠정)

-- 컷오프 이전 시각은 전일 영업일로 귀속한다.
CREATE FUNCTION ledger.business_date_of(p_branch ledger.branch_code, p_ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_tz     TEXT;
  v_cutoff TIME;
  v_local  TIMESTAMP;
BEGIN
  SELECT timezone, cutoff_time INTO v_tz, v_cutoff
    FROM ledger.branch_config WHERE branch = p_branch;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'branch_config missing for branch %', p_branch
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  v_local := p_ts AT TIME ZONE v_tz;

  IF v_local::time < v_cutoff THEN
    RETURN (v_local::date - 1);
  END IF;
  RETURN v_local::date;
END;
$$;

COMMENT ON FUNCTION ledger.business_date_of IS
  '거래의 정산 귀속 영업일. 클라이언트가 아니라 서버가 결정한다.';

-- -----------------------------------------------------------------------------
-- 공통 트리거 함수 — 원장 불변성 (03-ledger-model.md §7-4)
-- -----------------------------------------------------------------------------
CREATE FUNCTION ledger.deny_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'append-only violation: % on %.% is forbidden. 정정은 역분개(reverses_tx_id)로만 가능하다.',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

COMMENT ON FUNCTION ledger.deny_mutation IS
  '한계: session_replication_role=''replica'' 세션은 트리거를 우회한다(슈퍼유저 전용). 운영 접근통제로 관리할 것.';

COMMIT;
