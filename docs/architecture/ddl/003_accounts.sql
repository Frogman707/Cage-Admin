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
-- 지점 하우스 계정 부트스트랩
-- -----------------------------------------------------------------------------
-- U4 전환(2026-08-15): 지점 목록을 하드코딩하지 않고 ledger.branches 에서 읽는다.
-- ⚠️ 이 블록은 **부트스트랩 전용**이며 지점 추가 경로가 아니다. 지점 추가는
-- ledger.provision_branch() 가 한 트랜잭션에서 처리한다 — 여기서 INSERT 만 하면
-- branch_config · chain_heads 가 빠진 반쪽 지점이 남는다 (AC-60-3).
--
-- ⚠️ U2 와 곱해진다. 아래 통화가 'PHP' 로 고정돼 있는데, U2 결정에 따라
-- 하우스 계정은 branches × currencies × house account_kind 곱집합이어야 한다
-- (docs/spec/01-ledger-foundation.md R-01-11 · AC-06-4). **그 확장은 M0 작업이며
-- 이 블록은 아직 PHP 만 만든다** — 다른 통화 거래는 상대 하우스 계정이 없어
-- 실패한다. 현재 상태를 숨기지 않기 위해 여기 적는다.
DO $$
DECLARE
  v_branch  TEXT;
  v_party   BIGINT;
  v_kind    ledger.account_kind;
  v_normal  ledger.normal_balance;
  v_negok   BOOLEAN;
BEGIN
  FOR v_branch IN SELECT code FROM ledger.branches ORDER BY code LOOP
    INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
    VALUES ('MAIN-' || v_branch, 'house', v_branch || ' MAIN ACCOUNT', v_branch)
    RETURNING id INTO v_party;

    FOREACH v_kind IN ARRAY ARRAY[
      'house_cash','marker_receivable','tips_dealer','tips_house',
      'promo_expense','commission_expense','suspense','house_gaming',
      -- 실사 차액 종착지 (design-review.md DR-01). 지점별로 있어야 한다.
      'shortage_expense','overage_income',
      -- 케이지 포인트 발행의 하우스 측 상대 계정 (B2 분리 결정 · spec/05 R-05-02).
      -- 지점별로 있어야 손님 포인트 발행이 상대 계정을 찾는다.
      'point_liability'
    ]::ledger.account_kind[] LOOP
      v_normal := CASE WHEN v_kind IN ('house_cash','marker_receivable','promo_expense',
                                       'commission_expense','suspense','shortage_expense',
                                       'point_liability')
                       THEN 'debit' ELSE 'credit' END::ledger.normal_balance;
      v_negok  := v_kind IN ('suspense','house_gaming','promo_expense');

      INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
      VALUES (v_party, v_kind, 'PHP', v_normal, v_negok);
    END LOOP;
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
