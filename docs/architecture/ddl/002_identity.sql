-- =============================================================================
-- 002. Identity — 직원 · 인증 · 역할 · 승인 · 교대
-- =============================================================================
-- 현행 대응:
--   staff/{id} { id, name, pin, dt, totpSecret }        index.html:5663
--   partnerStaff/{id} { id, pw, name, role }            partner-admin/app.js:170-172
--   requestPinAuth() / requestWithdrawAuth()            조작별 재인증 UX (유지)
--   TOTP 구현 b32encode..verifyTotp                     index.html:5511-5576 (서버 이전)
--   shiftLog [{dt, staff, action}]                      교대 기록
--
-- 케이지 직원과 파트너 콘솔 운영자를 한 테이블에 둔다. 세션 · TOTP · RBAC ·
-- 4-eyes 승인 · 감사 로그가 전부 staff_id 를 참조하므로 테이블을 나누면 그
-- FK 를 전부 이중화해야 한다. 구분은 principal_type 컬럼이 한다.
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 직원
-- -----------------------------------------------------------------------------
CREATE TABLE identity.staff (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id     UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  code            TEXT NOT NULL UNIQUE,          -- 현행 'STF-KYLE'
  name            TEXT NOT NULL,

  -- 케이지 직원 / 파트너 콘솔 운영자 구분. 데이터 가시성 규칙이 갈린다 (012).
  principal_type  identity.principal_type NOT NULL DEFAULT 'cage_staff',

  -- 파트너 운영자가 소속된 파트너 주체. FK 는 003 에서 붙인다
  -- (ledger.parties 가 003 에서 생성되므로 이 파일 시점에는 존재하지 않는다).
  partner_party_id BIGINT,

  -- OWASP Password Storage Cheat Sheet: Argon2id m=19456(19MiB), t=2, p=1
  -- 저장 형식은 PHC string (알고리즘 · 파라미터 · salt 포함)
  pin_hash        TEXT NOT NULL,
  withdraw_pw_hash TEXT,

  -- RFC 6238. KMS 봉투 암호화. 평문으로 두지 않고 클라이언트에 전송하지 않는다.
  -- 현행 index.html:4300-4305 는 시크릿이 브라우저를 통과한다 — 폐기 대상.
  totp_secret_enc BYTEA,
  totp_enrolled_at TIMESTAMPTZ,

  status          ledger.account_status NOT NULL DEFAULT 'active',
  failed_attempts SMALLINT NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT staff_code_format CHECK (code ~ '^[A-Z0-9_-]{2,32}$'),

  -- 파트너 운영자는 소속 파트너가 반드시 있고, 케이지 직원은 반드시 없다.
  CONSTRAINT staff_partner_link CHECK (
    (principal_type = 'partner_operator' AND partner_party_id IS NOT NULL) OR
    (principal_type = 'cage_staff'       AND partner_party_id IS NULL)
  )
);

COMMENT ON COLUMN identity.staff.pin_hash IS
  'Argon2id PHC string. 현행 평문 PIN(index.html:5663)의 대체.';

COMMENT ON COLUMN identity.staff.principal_type IS
  '현행은 staff(케이지)와 partnerStaff(파트너)가 별개 컬렉션이고 인증 방식도 다르다 '
  '— 케이지는 PIN+TOTP 서버 검증, 파트너는 평문 비밀번호 클라이언트 비교'
  '(partner-admin/app.js:186). 신규는 인증 경로를 하나로 합치고 가시성만 분리한다.';

COMMENT ON COLUMN identity.staff.partner_party_id IS
  '파트너 운영자의 소속 파트너. 현행 partnerStaff 에는 대응 필드가 없다 — '
  '파트너 콘솔이 모든 파트너의 데이터를 무제한으로 본다.';

-- 직원이 조작 가능한 지점. 현행은 클라이언트가 currentBranch()로 정하고
-- 전 데이터를 받아 필터링한다. 신규는 서버가 강제한다.
CREATE TABLE identity.staff_branches (
  staff_id BIGINT NOT NULL REFERENCES identity.staff ON DELETE CASCADE,
  branch   ledger.branch_code NOT NULL,
  PRIMARY KEY (staff_id, branch)
);

-- -----------------------------------------------------------------------------
-- 역할 (RBAC)
-- -----------------------------------------------------------------------------
CREATE TABLE identity.roles (
  code        TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

CREATE TABLE identity.role_permissions (
  role_code  TEXT NOT NULL REFERENCES identity.roles ON DELETE CASCADE,
  permission TEXT NOT NULL,           -- 'ledger.deposit' · 'game.end' · 'period.settle'
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE identity.staff_roles (
  staff_id  BIGINT NOT NULL REFERENCES identity.staff ON DELETE CASCADE,
  role_code TEXT NOT NULL REFERENCES identity.roles ON DELETE CASCADE,
  granted_by BIGINT REFERENCES identity.staff,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (staff_id, role_code)
);

INSERT INTO identity.roles (code, description) VALUES
  ('cage_operator',  '케이지 단말 조작 — 입출금 · 게임 · 롤링'),
  ('cage_manager',   '케이지 관리 — 정산 · 실사 · 승인'),
  ('partner_admin',  '파트너 콘솔'),
  ('auditor',        '조회 전용');

-- 권한 목록. 009~011 의 각 연산 함수가 이 문자열 하나를 요구한다.
-- 함수 안에서 identity.assert_actor_authorized() 로 검사하므로
-- 애플리케이션이 인가를 건너뛸 수 없다.
INSERT INTO identity.role_permissions (role_code, permission) VALUES
  ('cage_operator', 'ledger.deposit'),
  ('cage_operator', 'ledger.withdraw'),
  ('cage_operator', 'ledger.transfer'),
  ('cage_operator', 'game.open'),
  ('cage_operator', 'game.buyin'),
  ('cage_operator', 'game.rolling'),
  ('cage_operator', 'game.settle'),
  ('cage_operator', 'maincage.write'),
  ('cage_operator', 'shift.write'),

  ('cage_manager',  'ledger.deposit'),
  ('cage_manager',  'ledger.withdraw'),
  ('cage_manager',  'ledger.transfer'),
  ('cage_manager',  'ledger.branch_transfer'),
  ('cage_manager',  'ledger.wallet_transfer'),
  ('cage_manager',  'ledger.adjustment'),
  ('cage_manager',  'game.open'),
  ('cage_manager',  'game.buyin'),
  ('cage_manager',  'game.rolling'),
  ('cage_manager',  'game.settle'),
  ('cage_manager',  'game.cancel'),
  ('cage_manager',  'maincage.write'),
  ('cage_manager',  'shift.write'),
  ('cage_manager',  'balancing.count'),
  ('cage_manager',  'period.freeze'),
  ('cage_manager',  'period.settle'),
  ('cage_manager',  'account.open'),
  ('cage_manager',  'approval.request'),
  ('cage_manager',  'approval.vote'),

  ('partner_admin', 'account.open'),
  ('partner_admin', 'approval.request'),
  ('partner_admin', 'member.point_earn'),
  ('partner_admin', 'member.point_convert'),
  ('partner_admin', 'partner.share_accrue'),
  ('partner_admin', 'partner.share_settle');
-- auditor 는 권한을 갖지 않는다. 조회는 ledger_read 역할과 RLS 가 담당한다.
--
-- partner_admin 은 principal_type='partner_operator' 인 주체에게 부여하는 역할이다.
-- 현행 partnerStaff.role 은 'master' 한 종류뿐이고 아무것도 강제하지 않는다
-- (partner-admin/app.js:172). 플레이어 도메인 권한(베팅 취소 · 아바타 승인 등)은
-- game 스키마 설계와 함께 추가한다 — 00-system-map.md §8 A1.

-- -----------------------------------------------------------------------------
-- 세션
-- -----------------------------------------------------------------------------
-- 즉시 무효화가 가능해야 한다 (직원 해고 · 단말 분실). 08-adr.md ADR-010.
CREATE TABLE identity.sessions (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  staff_id        BIGINT NOT NULL REFERENCES identity.staff ON DELETE CASCADE,
  device_id       TEXT NOT NULL,
  refresh_family  UUID NOT NULL,        -- 회전 계열. 재사용 감지 시 계열 전체 무효화
  refresh_hash    BYTEA NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

CREATE INDEX sessions_staff_active_idx
  ON identity.sessions (staff_id) WHERE revoked_at IS NULL;

-- -----------------------------------------------------------------------------
-- TOTP 재사용 차단
-- -----------------------------------------------------------------------------
-- RFC 6238: "The verifier MUST NOT accept the second attempt of the OTP after
--            the successful validation has been issued for the first OTP"
-- 기본키 충돌로 강제한다.
CREATE TABLE identity.totp_used (
  staff_id  BIGINT NOT NULL REFERENCES identity.staff ON DELETE CASCADE,
  time_step BIGINT NOT NULL,         -- floor(unix_time / 30). RFC 6238 권장 30초
  used_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (staff_id, time_step)
);

COMMENT ON TABLE identity.totp_used IS
  'RFC 6238 재사용 금지 강제. 허용 창은 ±1 스텝("at most one time step is allowed as the network delay").';

-- -----------------------------------------------------------------------------
-- 4-eyes 승인
-- -----------------------------------------------------------------------------
CREATE TABLE identity.approvals (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id    UUID NOT NULL DEFAULT uuidv7() UNIQUE,
  subject_kind   identity.approval_subject NOT NULL,
  subject_ref    TEXT NOT NULL,
  payload        JSONB NOT NULL,        -- 승인 완료 시 실행할 요청 원본
  required_count SMALLINT NOT NULL DEFAULT 2 CHECK (required_count >= 2),
  status         identity.approval_status NOT NULL DEFAULT 'pending',
  branch         ledger.branch_code NOT NULL,
  requested_by   BIGINT NOT NULL REFERENCES identity.staff,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  resolved_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ NOT NULL
);

CREATE TABLE identity.approval_votes (
  approval_id BIGINT NOT NULL REFERENCES identity.approvals ON DELETE CASCADE,
  staff_id    BIGINT NOT NULL REFERENCES identity.staff,
  decision    identity.approval_decision NOT NULL,
  auth_method identity.auth_method NOT NULL,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (approval_id, staff_id)    -- 한 사람이 두 번 투표할 수 없다
);

-- 승인자 != 요청자. 교차 테이블 검사라 CHECK 로는 표현할 수 없어 트리거로 강제한다.
CREATE FUNCTION identity.assert_four_eyes() RETURNS trigger
LANGUAGE plpgsql
SET search_path = identity, pg_temp
AS $$
DECLARE
  v_requested_by BIGINT;
BEGIN
  SELECT requested_by INTO v_requested_by
    FROM identity.approvals WHERE id = NEW.approval_id;

  IF v_requested_by = NEW.staff_id THEN
    RAISE EXCEPTION 'four-eyes violation: 요청자(%)는 자기 요청을 승인할 수 없다', NEW.staff_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_votes_four_eyes
  BEFORE INSERT ON identity.approval_votes
  FOR EACH ROW EXECUTE FUNCTION identity.assert_four_eyes();

-- 투표는 되돌릴 수 없다
CREATE TRIGGER approval_votes_immutable
  BEFORE UPDATE OR DELETE ON identity.approval_votes
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- -----------------------------------------------------------------------------
-- 인가 — 모든 연산 함수의 첫 줄
-- -----------------------------------------------------------------------------
-- 이 함수가 없으면 인가는 애플리케이션 계층에만 존재한다.
-- 세 가지를 한 번에 본다: 직원 상태 · 지점 소속 · 역할 권한.
CREATE FUNCTION identity.assert_actor_authorized(
  p_staff_id   BIGINT,
  p_branch     ledger.branch_code,
  p_permission TEXT
) RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_status       ledger.account_status;
  v_locked_until TIMESTAMPTZ;
BEGIN
  SELECT s.status, s.locked_until INTO v_status, v_locked_until
    FROM identity.staff s WHERE s.id = p_staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'staff % not found', p_staff_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status <> 'active' THEN
    RAISE EXCEPTION 'staff % is % — 조작할 수 없다', p_staff_id, v_status
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_locked_until IS NOT NULL AND v_locked_until > clock_timestamp() THEN
    RAISE EXCEPTION 'staff % is locked until %', p_staff_id, v_locked_until
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 지점 스코프. 현행은 클라이언트의 currentBranch() 가 정한다(index.html:4626).
  IF NOT EXISTS (
    SELECT 1 FROM identity.staff_branches sb
     WHERE sb.staff_id = p_staff_id AND sb.branch = p_branch
  ) THEN
    RAISE EXCEPTION 'staff % is not assigned to branch %', p_staff_id, p_branch
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM identity.staff_roles sr
      JOIN identity.role_permissions rp ON rp.role_code = sr.role_code
     WHERE sr.staff_id = p_staff_id AND rp.permission = p_permission
  ) THEN
    RAISE EXCEPTION 'staff % lacks permission %', p_staff_id, p_permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION identity.assert_actor_authorized IS
  '직원 상태 · 지점 소속 · 역할 권한을 한 번에 검사한다. 모든 연산 함수의 첫 줄.';

-- -----------------------------------------------------------------------------
-- 4-eyes 승인 소비 — 단 한 번만 쓸 수 있다
-- -----------------------------------------------------------------------------
-- 승인 ID 를 거래에 적기만 하면 4-eyes 는 장식이다. 이 함수가 실제로 검증한다.
--   1. 행 잠금 (동시 소비 방지)
--   2. pending 상태 · 미만료
--   3. 대상 종류 · 지점 일치
--   4. payload 가 실행하려는 요청과 정확히 같은가 (jsonb 는 정규형이므로 = 로 충분)
--   5. 요청자와 다른 사람의 approve 표가 required_count 이상인가
--        (요청자 배제는 approval_votes_four_eyes 트리거가 이미 강제한다)
--   6. status 를 approved 로 전이 → 두 번째 호출은 3번에서 실패한다
CREATE FUNCTION identity.consume_approval(
  p_approval_id  BIGINT,
  p_subject_kind identity.approval_subject,
  p_branch       ledger.branch_code,
  p_payload      JSONB
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = identity, ledger, pg_temp
AS $$
DECLARE
  v_a         identity.approvals;
  v_approvals INT;
BEGIN
  SELECT * INTO v_a FROM identity.approvals WHERE id = p_approval_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval % not found', p_approval_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_a.status <> 'pending' THEN
    RAISE EXCEPTION 'approval % is already % — 재사용할 수 없다', p_approval_id, v_a.status
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_a.expires_at <= clock_timestamp() THEN
    UPDATE identity.approvals SET status = 'expired', resolved_at = clock_timestamp()
     WHERE id = p_approval_id;
    RAISE EXCEPTION 'approval % expired at %', p_approval_id, v_a.expires_at
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  IF v_a.subject_kind <> p_subject_kind THEN
    RAISE EXCEPTION 'approval % is for %, not %', p_approval_id, v_a.subject_kind, p_subject_kind
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_a.branch <> p_branch THEN
    RAISE EXCEPTION 'approval % is for branch %, not %', p_approval_id, v_a.branch, p_branch
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- IS DISTINCT FROM 을 쓴다. p_payload 가 NULL 이면 <> 는 NULL 이 되어
  -- IF 가 통과해 버린다 — 검증을 건너뛰는 경로가 생긴다.
  IF v_a.payload IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION
      'approval % payload does not match the request being executed — 승인한 내용과 다른 요청이다',
      p_approval_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_approvals
    FROM identity.approval_votes v
   WHERE v.approval_id = p_approval_id AND v.decision = 'approve';

  IF v_approvals < v_a.required_count THEN
    RAISE EXCEPTION 'approval % has %/% approve votes',
      p_approval_id, v_approvals, v_a.required_count
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;

  UPDATE identity.approvals
     SET status = 'approved', resolved_at = clock_timestamp()
   WHERE id = p_approval_id;
END;
$$;

COMMENT ON FUNCTION identity.consume_approval IS
  '승인을 1회용으로 소비한다. 상태·만료·대상·지점·payload·투표수를 모두 검증한다.';

-- -----------------------------------------------------------------------------
-- 교대
-- -----------------------------------------------------------------------------
-- 현행 shiftLog [{dt, staff, action:'in'|'out'}]
CREATE TABLE identity.shift_events (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id      BIGINT NOT NULL REFERENCES identity.staff,
  branch        ledger.branch_code NOT NULL,
  action        identity.shift_action NOT NULL,
  business_date DATE NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX shift_events_branch_date_idx
  ON identity.shift_events (branch, business_date, recorded_at);

CREATE TRIGGER shift_events_immutable
  BEFORE UPDATE OR DELETE ON identity.shift_events
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

COMMIT;
