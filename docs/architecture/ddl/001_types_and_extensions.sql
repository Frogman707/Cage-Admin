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
  'internal'   -- 개시 자본 · 미결산 등 내부 계정
);

-- normal_balance 는 표시 부호를 결정한다 (03-ledger-model.md §3-2)
--   debit  → 표시잔액 =  balance_minor,  하한 balance_minor >= 0
--   credit → 표시잔액 = -balance_minor,  하한 balance_minor <= 0
CREATE TYPE ledger.normal_balance AS ENUM ('debit', 'credit');

CREATE TYPE ledger.account_kind AS ENUM (
  'member_deposit',     -- credit  손님 예치금 (케이지가 갚을 돈)
  'player_wallet',      -- credit  온라인 회원 보유금 (현행 memberLedger)
  'chips_outstanding',  -- credit  해당 게임에 발행된 미상환 칩
  'tips_dealer',        -- credit  딜러 팁 미지급금
  'tips_house',         -- credit  하우스 팁
  'house_gaming',       -- credit  온라인 게임 손익
  'house_cash',         -- debit   지점 현금 금고
  'marker_receivable',  -- debit   마커 미수금
  'promo_expense',      -- debit   워킹칩 등 프로모션 비용
  'suspense',           -- debit   밸런싱 차액 임시계정 (allow_negative)
  'opening_equity'      -- credit  마이그레이션 개시 균형 계정
);

CREATE TYPE ledger.account_status AS ENUM ('active', 'suspended', 'closed');

-- -----------------------------------------------------------------------------
-- 거래 · 분개
-- -----------------------------------------------------------------------------
-- 각 값이 04-posting-rules.md 의 절 하나에 대응한다.
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
  'wallet_transfer',   -- §12  케이지 계좌 <-> 회원 보유금
  'bet',               -- §13
  'payout',            -- §13
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
  'adjustment',            'reversal',              'opening_balance'
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

CREATE TYPE identity.approval_subject AS ENUM (
  'withdrawal', 'adjustment', 'period_settle', 'account_status'
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
  -- NULL 이면 임계 없음. 009 의 require_approval_if_over_threshold() 가 읽는다.
  -- 05-api-contract.md §6-2 의 "임계 금액 초과 → approval" 이 여기서 실체를 갖는다.
  approval_threshold_minor BIGINT CHECK (approval_threshold_minor > 0),

  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

INSERT INTO ledger.branch_config (branch) VALUES ('HANN'), ('NUSTAR'), ('ONLINE');

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
