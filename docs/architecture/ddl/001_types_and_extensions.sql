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
-- 지점 — 참조 테이블 (U4 결정: 2026-08-15 · ungkey)
-- -----------------------------------------------------------------------------
-- 초안은 CREATE TYPE ledger.branch_code AS ENUM ('HANN','NUSTAR','ONLINE') 였다.
-- U4 가 "지점 추가 계획이 있다" 로 결정되어 참조 테이블 + FK 로 바꾼다
-- (docs/spec/00-decisions.md §5). ENUM 은 값 추가는 되지만 제거가 어렵고,
-- 지점 목록을 읽어야 하는 검증 쿼리마다 enum_range() 를 써야 했다.
--
-- ⚠️ 이 전환은 M0 의 첫 스키마 작업이다. 다음이 전부 함께 움직인다:
--   - 전 테이블의 branch 컬럼          ledger.branch_code -> TEXT REFERENCES ledger.branches(code)
--   - ledger.current_branches()        반환형 ENUM[] -> TEXT[]
--   - 검증 SQL                         unnest(enum_range(NULL::ledger.branch_code))
--                                        -> SELECT code FROM ledger.branches
--   - ledger.provision_branch()        그대로 필요하다. INSERT 한 줄이 되어도 부수 4종
--                                      (config · chain_head · 하우스 주체 · 하우스 계정
--                                       곱집합) 은 여전히 한 트랜잭션에서 따라와야 한다.
--                                      아니면 반쪽 지점이 남는다 (AC-60-3)
CREATE TABLE ledger.branches (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_online   BOOLEAN NOT NULL DEFAULT false,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT branches_code_format CHECK (code ~ '^[A-Z][A-Z0-9_]{1,15}$')
);

COMMENT ON TABLE ledger.branches IS
  '지점 참조 테이블. 지점 추가는 provision_branch() 경유이며 직접 INSERT 는 반쪽 지점을 만든다.';

-- 현행 index.html:4563 / :6430 의 하드코딩 3개 지점을 그대로 옮긴 것.
INSERT INTO ledger.branches (code, name, is_online) VALUES
  ('HANN',   'Hann',   false),
  ('NUSTAR', 'NUSTAR', false),
  ('ONLINE', 'Online', true);

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
  -- 케이지 포인트. B2 결정(2026-08-15): 파트너 측 player_points 와 **분리**한다.
  -- 흡수(a)를 고르지 않은 이유는 "케이지 손님 = 온라인 회원" 매핑 규칙(DR-75)이
  -- 선행해야 하는데 그것이 A1/A2 보류에 묶여 있기 때문이다. 분리하면 지금 만든다.
  -- docs/spec/05-cage-points.md · 00-decisions.md §8
  'cage_point',         -- credit  케이지 손님 포인트 잔액 (손님에게 진 의무)
  -- ⚠️ 이름과 normal_balance 가 어긋나 보인다. 손님 쪽 의무는 cage_point(credit) 가
  -- 이미 지고 있고, 이것은 그 발행분을 받는 하우스 쪽 **차변** 상대 계정이다
  -- (promo_expense 계열). 이름은 spec/05 의 R-05-02 표기를 따랐다.
  'point_liability',    -- debit   포인트 발행의 하우스 측 상대 계정
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
--                            (아바타/스피드 개선이 진행 중이라 스키마가 흔들린다).
--                            **이 두 값이 이 블록에서 사라지는 것이 A2 완료 조건이다**
--                            (docs/spec/10-partner-console.md R-10-37)
--   point_earn · point_convert  파트너/플레이어 측 포인트. A1·A8 보류.
--                            DR-68 은 B2 결정으로 해소됐다 — 케이지 포인트는 흡수하지
--                            않고 분리했고 별도 값(point_grant · point_use)을 쓴다.
--                            남은 보류 사유는 DR-75(회원 주체 매핑)뿐이다
--   share_accrue             파트너 쉐어 적립. **요율 규칙이 여전히 미확정**이다
--                            (DR-62 · U3 범위 밖). 실행 경로 없음
--
-- 해소된 것: opening_balance (ledger.op_load_opening_balance, 011),
--            commission_payout (cage.op_settle_commission, 010),
--            share_settle (op_share_settle 은 입력이 금액이지 요율이 아니라 U3 와
--                          무관하게 만든다 — AC-07-6).
--
-- 만들지 않는 것 — fx_exchange
--   환전 업무 없음. 2026-08-15 U2 결정(docs/spec/00-decisions.md §3).
--   통화별 계정은 정식 지원하되 통화 간 이동 연산은 정의하지 않는다.
--   ledger.fx_rates · fx_position 도 만들지 않는다. 요구가 생기면 그때 추가한다.
--
-- 만들지 않는 것 — 포인트 <-> 자금 전환
--   케이지 포인트를 현금·칩으로 바꾸는 연산은 현행에 없다. 요구가 생기면
--   그때 분개를 추가한다 (docs/spec/05-cage-points.md §9).
--
-- 013 의 v_check_view_security 처럼 이 공백을 자동 검출하는 대사는 아직 없다 —
-- DR-38 의 검증 쿼리(pg_proc.prosrc LIKE) 를 CI 에 넣는 것이 남은 일이다
-- (docs/spec/12-ci-golden-tests.md R-12-13).
CREATE TYPE ledger.tx_kind AS ENUM (
  'deposit',           -- §1   _doProcessIo IN
  'withdraw',          -- §2   _doProcessIo OUT
  'transfer',          -- §3   _doTransfer
  'branch_transfer',   -- §4   _doProcessBranchTransfer
  'game_buyin',        -- §5   _doStartGame / _doAddBuyin
  'marker_issue',      -- §5-3 마커 발행 (op_issue_marker). 4-eyes 대상.
                       --      바이인과 분리한다 — 발행 없이 마커 바이인이 성립하던
                       --      공백을 막는다 (docs/spec/04-cage-game-rolling.md R-04-21)
  'mid_settle',        -- §7   _doConfirmMidSettle
  'game_end',          -- §8   _doConfirmGameEnd
  'game_cancel',       -- §9   cancelGame (역분개)
  'adjustment',        -- §11  밸런싱 차액
  'suspense_resolve',  -- §11-2 차액 확정 해소 (design-review.md DR-01)
  'wallet_transfer',   -- §12  케이지 계좌 <-> 회원 보유금
  'bet',               -- §13
  'payout',            -- §13
  'point_earn',        -- §13-2  포인트 적립      (파트너/플레이어 측)
  'point_convert',     -- §13-2  포인트 -> 보유금 전환 (파트너/플레이어 측)
  'point_grant',       -- §13-4  케이지 포인트 발행 (B2 분리 결정)
  'point_use',         -- §13-4  케이지 포인트 사용 (B2 분리 결정)
  'share_accrue',      -- §13-3  파트너 쉐어 적립
  'share_settle',      -- §13-3  파트너 쉐어 지급
  'commission_payout', -- §6-1  롤링 커미션 정산 지급 (design-review-6.md DR-66)
  'event_commission',  -- §6-2  이벤트 보너스 커미션 (B1 계속운영 결정).
                       --       commission_payout 의 아웃박스 후속이며 별개 거래다
  'opening_balance',   -- §14  마이그레이션 전용
  'reversal'           -- 일반 역분개
);

-- 'reversal' 은 제거했다 (DR-23 · AC-23-1). ADR-016 이후 역분개는 원 거래의
-- category 를 그대로 뒤집어 쓰므로 이 값을 쓰는 경로가 없다. 미사용 값을 주석으로
-- 남기면 다음 사람이 "쓸 수 있다" 고 읽는다. M1 착수 전이라 타입 재생성이 싸다 (AC-23-2).
CREATE TYPE ledger.entry_category AS ENUM (
  'deposit_cash',          'withdraw_cash',
  'transfer_out',          'transfer_in',
  'branch_transfer_out',   'branch_transfer_in',
  'buyin_account',         'buyin_cash',            'buyin_marker',
  'marker_issue',
  'chips_issue',           'chips_redeem',
  'working_chip_issue',    'working_chip_return',
  'settle_deposit',        'settle_cashout',        'settle_marker_redeem',
  'settle_dealer_tip',     'settle_house_tip',
  'wallet_transfer_out',   'wallet_transfer_in',
  'bet',                   'payout',
  'point_earn',            'point_convert_out',     'point_convert_in',
  'point_grant',           'point_use',
  'share_accrue',          'share_settle',
  'commission_payout',     'event_commission',
  'adjustment',            'suspense_resolve_out',  'suspense_resolve_in',
  'opening_balance'
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
-- 'account_status' 는 DR-83 당시 발동하는 조작이 없었다. 해소 경로가 정해졌다 —
-- ledger.op_set_account_status() 가 만들어지면서 발동한다
-- (docs/spec/08-account-lifecycle.md R-08-01). 단 4-eyes 는 closed 만이고
-- suspended 는 스텝업 재인증까지다 (DR-70 결정 · AC-70-2). 해지가 비가역이기 때문이다.
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

-- 5종이다. U2 결정(2026-08-15 · docs/spec/00-decisions.md §3).
-- 초안 시드는 3종(PHP·USD·KRW)이었고 HKD·CNY 가 빠져 있었다. 현행 UI 가 권위다 —
-- <select id="gCurrency"> 가 5종을 제시하고(index.html:697) 영수증 라벨도 5종이다
-- (index.html:7144). 계좌만 currency:'PHP' 로 하드코딩돼 있었고(index.html:8566)
-- 바이인은 환산 없이 차감했다(index.html:6939). 즉 현행 다통화는 표기용이며
-- 이 시드는 현행 유지가 아니라 **그 결함의 교정**이다.
--
-- KRW 는 scale=0 이다. 최소 단위 산술이 통화마다 다르다는 사실이 여기서 시작한다 —
-- PHP 만 통과하고 나머지가 비뚤어지는 사각(DR-41)을 CI 가 잡아야 한다
-- (docs/spec/12-ci-golden-tests.md R-12-21 · R-12-22).
INSERT INTO ledger.currencies (code, scale, symbol) VALUES
  ('PHP', 2, '₱'),
  ('USD', 2, '$'),
  ('HKD', 2, 'HK$'),
  ('CNY', 2, '¥'),
  ('KRW', 0, '₩');

-- -----------------------------------------------------------------------------
-- 영업일 규칙
-- -----------------------------------------------------------------------------
-- 현행 phNow()(index.html:4153)는 UTC 에 8시간을 더한 고정 오프셋 산술이다.
-- 신규는 타임존 규칙을 쓰고, 컷오프 시각 기준으로 영업일을 결정한다.
CREATE TABLE ledger.branch_config (
  -- U4 전환: ledger.branch_code ENUM -> TEXT FK. branches 에 없는 지점의 설정 행은
  -- 만들 수 없다. ON DELETE 를 두지 않는다 — 지점 삭제는 설계에 없는 연산이다.
  branch       TEXT PRIMARY KEY REFERENCES ledger.branches(code),
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

-- 아래 세 값은 **잠정값이다.** U5(규제 관할)가 2026-08-15 에 **유예**로 결정됐고
-- (docs/spec/00-decisions.md §6) 임계값·윈도·보존기간은 관할 확정 시점까지 잠정으로
-- 남는다. AC-15-5(임계값의 근거 기록)도 그 시점으로 이월됐다.
-- 확정 시 이 시드와 07-migration.md 의 컷오버 체크리스트를 함께 고친다.
-- ⚠️ 값을 넣지 않은 채 오픈하면 이 방어는 "잠정값으로 켜져 있는" 상태다.
INSERT INTO ledger.branch_config (branch, approval_threshold_minor) VALUES
  ('HANN',   50000000),   -- ₱500,000.00  (잠정)
  ('NUSTAR', 50000000),   -- ₱500,000.00  (잠정)
  ('ONLINE', 20000000);   -- ₱200,000.00  (잠정)

-- 컷오프 이전 시각은 전일 영업일로 귀속한다.
-- U4 전환: p_branch 가 ledger.branch_code -> TEXT. 존재하지 않는 지점 코드는
-- branch_config 조회에서 NULL 이 되어 아래 EXCEPTION 이 잡는다.
CREATE FUNCTION ledger.business_date_of(p_branch TEXT, p_ts TIMESTAMPTZ)
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
