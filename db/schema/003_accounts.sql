-- =============================================================================
-- 003. 계정 체계 — parties · accounts · member_profiles
-- =============================================================================
-- 현행 대응: accounts/{accountId}  (index.html:5593-5605)
--   손님 계좌  : balance 단일 통합 (migrateDB :5712-5718 에서 3분할 → 통합)
--   MAIN-{br}  : balances{HANN,NUSTAR,ONLINE} 지점별 격리
--
-- 신규: 주체(parties)와 원장 계정(accounts)을 분리한다.
--   손님 1명   = party 1개 + member_deposit 계정 (통화당 1개)
--   지점 1개   = party 1개 + house_cash · marker_receivable · tips_* · promo_expense · suspense
--   게임 1건   = party 1개 + chips_outstanding 계정
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 주체
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.parties (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id  UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  code         TEXT NOT NULL UNIQUE,      -- 'SE7419' · 'MAIN-HANN' · 'GAME-260810001'
  party_type   ledger.party_type NOT NULL,
  display_name TEXT,
  home_branch  TEXT REFERENCES ledger.branches(code),        -- house/game 필수, member 는 개설 지점
  status       ledger.account_status NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- 현행 회원 ID 형식(SE7419 · MK2201 · PL0001)을 형식 제약으로 고정한다.
  -- 파트너 콘솔 저장형 XSS(partner-admin/app.js:585-595)의 근본 대응 중 하나.
  CONSTRAINT parties_code_format CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{1,31}$'),
  CONSTRAINT parties_house_needs_branch
    CHECK (party_type <> 'house' OR home_branch IS NOT NULL)
);

COMMENT ON CONSTRAINT parties_code_format ON ledger.parties IS
  '계좌 코드에 따옴표·꺾쇠 등이 들어갈 수 없게 한다. 현행은 형식 검증이 없다.';

-- -----------------------------------------------------------------------------
-- 원장 계정
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.accounts (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id    UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  party_id       BIGINT NOT NULL REFERENCES ledger.parties,
  kind           ledger.account_kind NOT NULL,
  currency       TEXT NOT NULL REFERENCES ledger.currencies(code),
  normal_balance ledger.normal_balance NOT NULL,
  allow_negative BOOLEAN NOT NULL DEFAULT FALSE,
  status         ledger.account_status NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- 하나의 계정은 하나의 통화만 갖는다. 통화 혼합을 구조적으로 차단한다.
  UNIQUE (party_id, kind, currency)
);

CREATE INDEX accounts_kind_idx ON ledger.accounts (kind, currency);

-- kind 와 normal_balance 의 조합을 고정한다. 계정 하나가 잘못 만들어지면
-- 그 계정의 모든 분개 부호가 뒤집히므로 데이터로 강제한다.
CREATE FUNCTION ledger.assert_account_kind_consistent() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_expected ledger.normal_balance;
BEGIN
  v_expected := CASE NEW.kind
    WHEN 'member_deposit'        THEN 'credit'
    WHEN 'player_wallet'         THEN 'credit'
    WHEN 'player_points'         THEN 'credit'
    WHEN 'partner_share_payable' THEN 'credit'
    WHEN 'chips_outstanding'     THEN 'credit'
    WHEN 'tips_dealer'           THEN 'credit'
    WHEN 'tips_house'            THEN 'credit'
    WHEN 'house_gaming'          THEN 'credit'
    WHEN 'opening_equity'        THEN 'credit'
    WHEN 'house_cash'            THEN 'debit'
    WHEN 'marker_receivable'     THEN 'debit'
    WHEN 'promo_expense'         THEN 'debit'
    WHEN 'commission_expense'    THEN 'debit'
    WHEN 'suspense'              THEN 'debit'
    WHEN 'shortage_expense'      THEN 'debit'
    WHEN 'overage_income'        THEN 'credit'
    -- 케이지 포인트 (B2 분리 결정 2026-08-15 · docs/spec/05-cage-points.md)
    WHEN 'cage_point'            THEN 'credit'
    WHEN 'point_liability'       THEN 'debit'
  END::ledger.normal_balance;

  -- 001 의 ENUM 에 값을 추가하고 이 CASE 를 빠뜨리면 v_expected 가 NULL 이 되고,
  -- 아래 비교가 NULL 이 되어 검사가 조용히 통과한다. 명시적으로 막는다.
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'account kind % has no normal_balance mapping', NEW.kind
      USING ERRCODE = 'integrity_constraint_violation',
            HINT = '001 의 ledger.account_kind 에 값을 추가했다면 이 CASE 도 함께 갱신하라';
  END IF;

  IF NEW.normal_balance <> v_expected THEN
    RAISE EXCEPTION 'account kind % requires normal_balance %, got %',
      NEW.kind, v_expected, NEW.normal_balance
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- 양방향 잔액이 정상인 계정만 allow_negative 를 허용한다.
  --   suspense       실사 차액이 +/- 양쪽으로 발생
  --   house_gaming   하우스가 순손실일 수 있다
  --   promo_expense  정정 역분개가 발행분을 넘길 수 있다
  --   opening_equity 마이그레이션 균형 계정 (순자산 방향에 따라 부호가 갈린다)
  IF NEW.allow_negative
     AND NEW.kind NOT IN ('suspense', 'house_gaming', 'promo_expense', 'opening_equity') THEN
    RAISE EXCEPTION
      'allow_negative 는 suspense · house_gaming · promo_expense · opening_equity 만 허용한다 (kind=%)',
      NEW.kind
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_kind_consistent
  BEFORE INSERT OR UPDATE ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_account_kind_consistent();

-- -----------------------------------------------------------------------------
-- 잔액 프로젝션
-- -----------------------------------------------------------------------------
-- "잔액을 저장하지 않는다"는 현행 원칙의 의도적 예외다.
-- 이유: 행 잠금 대상이 있어야 오버드래프트를 원자적으로 막을 수 있다.
-- 대신 013_reconciliation.sql 의 R2 가 분개 합과 상시 대조한다.
CREATE TABLE ledger.account_balances (
  account_id    BIGINT PRIMARY KEY REFERENCES ledger.accounts,
  balance_minor BIGINT NOT NULL DEFAULT 0,
  version       BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

-- 계정 생성 시 잔액 행을 함께 만든다 (post_transaction 이 항상 행을 찾을 수 있게)
CREATE FUNCTION ledger.create_balance_row() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  INSERT INTO ledger.account_balances (account_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_create_balance
  AFTER INSERT ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.create_balance_row();

-- 표시 잔액 뷰 — normal_balance 에 맞춰 부호를 뒤집는다
--
-- security_invoker = true 가 필수다. 기본값(security_definer 뷰)이면 뷰는 소유자
-- 권한으로 실행되고, 소유자는 RLS 대상이 아니므로(012 에서 FORCE 를 쓰지 않는다)
-- 뷰를 통한 조회가 지점 정책을 통째로 우회한다.
-- PostgreSQL 15 이상 필요.
CREATE VIEW ledger.v_account_balances WITH (security_invoker = true) AS
SELECT
  a.id                AS account_id,
  p.code              AS party_code,
  p.party_type,
  p.home_branch       AS branch,
  a.kind,
  a.currency,
  a.normal_balance,
  b.balance_minor,
  CASE a.normal_balance
    WHEN 'debit'  THEN  b.balance_minor
    WHEN 'credit' THEN -b.balance_minor
  END                 AS display_balance_minor,
  b.updated_at
FROM ledger.accounts a
JOIN ledger.parties p ON p.id = a.party_id
JOIN ledger.account_balances b ON b.account_id = a.id;

COMMENT ON VIEW ledger.v_account_balances IS
  '화면·API 가 읽는 잔액. display_balance_minor 는 항상 양수가 정상이다.';

-- -----------------------------------------------------------------------------
-- 회원 프로필 (KYC)
-- -----------------------------------------------------------------------------
-- 현행 accounts 문서의 비금전 필드에 대응한다.
-- 여권/서명/현장 사진은 DB 에 저장하지 않는다 — 객체 스토리지 참조만 둔다.
CREATE TABLE ledger.member_profiles (
  party_id            BIGINT PRIMARY KEY REFERENCES ledger.parties ON DELETE CASCADE,
  member_no           TEXT,                        -- 현행 member
  phone               TEXT,
  telegram            TEXT,
  eng_name            TEXT,
  nickname            TEXT,
  vip                 TEXT,
  agent_code          TEXT,
  proxy               TEXT,
  rolling_rate        NUMERIC(7,4),                -- 현행 rate "1.45%" → 1.4500
  default_currency    TEXT REFERENCES ledger.currencies(code),
  opened_branch       TEXT REFERENCES ledger.branches(code),
  opened_at           TIMESTAMPTZ,
  remark              TEXT,

  -- 애플리케이션 계층 KMS 암호화. DB 관리자가 평문을 볼 수 없다.
  passport_no_enc     BYTEA,
  passport_exp        DATE,

  -- 객체 스토리지 키 + 무결성 해시. 조회는 단기 서명 URL 로만.
  passport_photo_ref  TEXT,
  passport_photo_sha  BYTEA,
  site_photo_ref      TEXT,
  site_photo_sha      BYTEA,
  signature_photo_ref TEXT,
  signature_photo_sha BYTEA,

  updated_at          TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON COLUMN ledger.member_profiles.rolling_rate IS
  '현행 accounts.rate("1.45%"). 커미션 계산 규칙은 미확정 — 08-adr.md U3.';

-- -----------------------------------------------------------------------------
-- 파트너 (에이전트 · 쉐어) 프로필
-- -----------------------------------------------------------------------------
-- 현행 partners/{partnerCode}
--   { id, name, parentCode, shareRate, level, status, casino, createdAt }
--   partner-admin/app.js:864 생성 · :873 요율 수정
--
-- 파트너는 partner_share_payable 계정을 소유하는 자금 주체이므로
-- ledger.parties 에 party_type='partner' 로 들어간다. 인증 주체(파트너 콘솔
-- 운영자)는 별개이며 identity.staff 쪽에 있다 (002).
CREATE TABLE ledger.partner_profiles (
  party_id     BIGINT PRIMARY KEY REFERENCES ledger.parties ON DELETE RESTRICT,

  -- 계층. 현행 parentCode + level. 자기 참조로 트리를 만든다.
  parent_id    BIGINT REFERENCES ledger.parties,
  depth        SMALLINT NOT NULL DEFAULT 1 CHECK (depth BETWEEN 1 AND 8),

  -- 현행 shareRate 는 Number. 백분율을 basis point 로 고정해 부동소수점을 없앤다.
  share_rate_bp INTEGER NOT NULL DEFAULT 0
    CHECK (share_rate_bp BETWEEN 0 AND 10000),

  updated_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  -- 자기 자신을 상위로 둘 수 없다. 더 깊은 순환은 애플리케이션이 막는다.
  CONSTRAINT partner_no_self_parent CHECK (parent_id IS NULL OR parent_id <> party_id)
);

CREATE INDEX partner_profiles_parent_idx ON ledger.partner_profiles (parent_id);

COMMENT ON COLUMN ledger.partner_profiles.share_rate_bp IS
  '현행 partners.shareRate(Number). basis point(1bp=0.01%). 커미션 계산 규칙은 미확정 — 08-adr.md U3.';

-- party_type='partner' 인 주체만 프로필을 가질 수 있다.
CREATE FUNCTION ledger.assert_partner_party() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  IF (SELECT party_type FROM ledger.parties WHERE id = NEW.party_id) <> 'partner' THEN
    RAISE EXCEPTION 'partner_profiles.party_id % is not a partner party', NEW.party_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.parent_id IS NOT NULL
     AND (SELECT party_type FROM ledger.parties WHERE id = NEW.parent_id) <> 'partner' THEN
    RAISE EXCEPTION 'partner_profiles.parent_id % is not a partner party', NEW.parent_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER partner_profiles_party_kind
  BEFORE INSERT OR UPDATE ON ledger.partner_profiles
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_partner_party();

-- -----------------------------------------------------------------------------
-- 지점 하우스 계정 — 생성 정책을 한 곳에 모은다
-- -----------------------------------------------------------------------------
-- U4 전환(2026-08-15): 지점 목록을 하드코딩하지 않고 ledger.branches 에서 읽는다.
--
-- ⚠️ 이 함수는 **지점 추가 경로가 아니다.** 지점 추가는 004 의
-- ledger.provision_branch() 가 branch_config · chain_heads 까지 한 트랜잭션에서
-- 처리한다 (AC-60-3). 이 함수는 그 안에서 하우스 측 한 조각만 담당한다.
--
-- 함수로 뽑은 이유(a02 결정 3): 아래 부트스트랩 DO 블록과 provision_branch() 가
-- 같은 계정 집합을 만들어야 하는데, 두 벌로 쓰면 갈라진다. 갈라진 사실은
-- 신규 지점을 실제로 만들어 보기 전까지 드러나지 않는다.
--
-- ⚠️ U2 와 곱해진다. 아래 통화가 'PHP' 로 고정돼 있는데, U2 결정에 따라
-- 하우스 계정은 branches × currencies × house account_kind 곱집합이어야 한다
-- (docs/spec/01-ledger-foundation.md R-01-11 · AC-06-4). **그 확장은 스펙 01 §3
-- 이고 계획 a03 소관이다.**
--
-- 넓힐 자리는 **짝을 이루는 두 곳**이다. 한 쪽만 고치면 안 된다.
--   (가) 만드는 쪽 — 아래 bootstrap_house_accounts() 의 INSERT ... SELECT 에
--        ledger.currencies 를 크로스조인한다. 시드 지점과 신규 지점이 함께 따라온다.
--   (나) 보는 쪽 — 013 의 v_check_branch_provisioning 안 missing_house_accounts
--        하위쿼리에 있는 `a.currency = 'PHP'` 조건.
-- (가)만 고치면 **조용히 어긋난다**: accounts 의 UNIQUE (party_id, kind, currency)
-- 때문에 크로스조인은 순증이라 PHP 행이 그대로 남고, (나)의 조건도 계속 만족돼
-- 모든 지점이 초록으로 나온다 — 새 통화 계정이 정책과 어긋나 있어도 모른다.
-- (나)만 고치면 **모든 지점이 즉시 빨개진다** — 없는 통화 계정을 찾기 때문이다.
-- 현재 상태에서 PHP 외 통화 거래는 상대 하우스 계정이 없어 실패한다.

-- 하우스 계정 정책. ENUM 을 참조 테이블로 옮긴 U4 와 같은 방향이다.
-- 함수가 아니라 테이블인 이유(a02 결정 3):
--   (1) 013 의 v_check_branch_provisioning 이 security_invoker 라 호출자 권한으로
--       읽는다. 테이블이면 012 의 GRANT SELECT ON ALL TABLES IN SCHEMA ledger
--       가 이미 덮는다 (003 이 012 보다 먼저 적용된다). 함수였다면 013 말미의
--       일괄 REVOKE ... FROM PUBLIC 뒤에 GRANT EXECUTE 를 따로 챙겨야 한다.
--   (2) normal_balance · allow_negative 를 CASE WHEN kind IN (...) 로 두 벌
--       쓰던 것이 사라진다. 종류를 하나 늘릴 때 고칠 곳이 한 행이다.
CREATE TABLE ledger.house_account_policy (
  kind           ledger.account_kind   PRIMARY KEY,
  normal_balance ledger.normal_balance NOT NULL,
  allow_negative BOOLEAN               NOT NULL,
  note           TEXT
);

COMMENT ON TABLE ledger.house_account_policy IS
  '지점 하우스 계정의 정본. bootstrap_house_accounts() 가 이것을 읽어 만들고 013 의 v_check_branch_provisioning 이 이것과 대조한다. 행을 더하면 신규 지점은 자동으로 따라오지만 **기존 지점은 따라오지 않는다** — 같은 커밋에서 기존 지점 보정 INSERT 를 함께 넣는다.';

INSERT INTO ledger.house_account_policy (kind, normal_balance, allow_negative, note) VALUES
  ('house_cash',         'debit',  false, '지점 현금'),
  ('marker_receivable',  'debit',  false, '마커 채권'),
  ('tips_dealer',        'credit', false, '딜러 팁'),
  ('tips_house',         'credit', false, '하우스 팁'),
  ('promo_expense',      'debit',  true,  '프로모션 비용'),
  ('commission_expense', 'debit',  false, '롤링 커미션 비용'),
  ('suspense',           'debit',  true,  '미결 — 실사 차액이 여기 머문다'),
  ('house_gaming',       'credit', true,  '게임 손익'),
  -- 실사 차액 종착지 (design-review.md DR-01). 지점별로 있어야 한다.
  ('shortage_expense',   'debit',  false, '실사 부족 확정'),
  ('overage_income',     'credit', false, '실사 초과 확정'),
  -- 케이지 포인트 발행의 하우스 측 상대 계정 (B2 분리 결정 · spec/05 R-05-02).
  -- 지점별로 있어야 손님 포인트 발행이 상대 계정을 찾는다.
  ('point_liability',    'debit',  false, '포인트 발행 상대 계정');

CREATE FUNCTION ledger.bootstrap_house_accounts(p_branch TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_party BIGINT;
BEGIN
  INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
  VALUES ('MAIN-' || p_branch, 'house', p_branch || ' MAIN ACCOUNT', p_branch)
  RETURNING id INTO v_party;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  SELECT v_party, k.kind, 'PHP', k.normal_balance, k.allow_negative
    FROM ledger.house_account_policy k;

  RETURN v_party;
END;
$$;

COMMENT ON FUNCTION ledger.bootstrap_house_accounts IS
  '지점의 하우스 주체(MAIN-<branch>)와 ledger.house_account_policy 전 종류의 계정을 만든다. 지점 추가는 이것만으로 끝나지 않는다 — ledger.provision_branch() 를 쓴다. **EXECUTE 를 어떤 역할에도 주지 않는다** — 이것만 부를 수 있으면 branch_config · chain_heads 없는 반쪽 지점을 만들 수 있다.';

-- 시드 지점 부트스트랩. 004 의 provision_branch() 는 아직 존재하지 않으므로
-- (chain_heads 가 004 에서 생긴다) 여기서는 하우스 조각만 만들고,
-- 004 말미가 시드 3행의 프로비저닝 완결성을 다시 단언한다.
DO $$
DECLARE
  v_branch TEXT;
  v_party  BIGINT;
BEGIN
  FOR v_branch IN SELECT code FROM ledger.branches ORDER BY code LOOP
    PERFORM ledger.bootstrap_house_accounts(v_branch);
  END LOOP;

  -- 마이그레이션 개시 균형 계정
  INSERT INTO ledger.parties (code, party_type, display_name)
  VALUES ('OPENING-EQUITY', 'internal', 'Migration opening equity')
  RETURNING id INTO v_party;

  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  VALUES (v_party, 'opening_equity', 'PHP', 'credit', TRUE);
END;
$$;

-- -----------------------------------------------------------------------------
-- 002 에서 미룬 FK — identity.staff.partner_party_id
-- -----------------------------------------------------------------------------
-- 002 시점에는 ledger.parties 가 아직 없어 컬럼만 만들어 두었다. 여기서 잠근다.
ALTER TABLE identity.staff
  ADD CONSTRAINT staff_partner_party_fk
  FOREIGN KEY (partner_party_id) REFERENCES ledger.parties (id);

COMMIT;
