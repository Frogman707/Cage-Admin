-- =============================================================================
-- 012. 역할 · 권한 · RLS
-- =============================================================================
-- 핵심 규칙 — 이 파일이 지키지 못하면 008~011 의 계층 분리가 전부 무의미해진다.
--
--   ledger_app 은 어떤 자금 테이블에도 INSERT · UPDATE · DELETE 권한이 없다.
--   ledger_app 은 008 의 코어 함수(post_transaction · reverse_transaction ·
--   begin_idempotent …)에도 EXECUTE 권한이 없다.
--   ledger_app 이 가진 것은 009~011 의 op_* 함수 EXECUTE 와 조회 SELECT 뿐이다.
--
-- PostgreSQL 문서가 권고하는 두 가지를 지킨다.
--   (1) SECURITY DEFINER 함수에 search_path 명시, pg_temp 를 마지막에
--       "A secure arrangement can be obtained by forcing the temporary schema to be
--        searched last. To do this, write pg_temp as the last entry in search_path."
--   (2) 함수 생성과 권한 부여를 한 트랜잭션으로 묶어 PUBLIC 노출 창을 없앤다
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- -----------------------------------------------------------------------------
-- 역할 생성
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY[
    'ledger_app', 'identity_app', 'ledger_read', 'ledger_kyc',
    'audit_writer', 'audit_reader', 'audit_anchorer',
    'archive_reader', 'ledger_migrator'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END;
$$;

COMMENT ON ROLE ledger_app      IS '애플리케이션. op_* 함수 EXECUTE + 조회 SELECT 만. 테이블 DML 없음. step-up 토큰을 발급할 수 없다.';
COMMENT ON ROLE identity_app    IS 'Identity 서비스 전용. step-up 토큰 발급 · 세션 관리. 자금 op_* 는 하나도 못 부른다.';
COMMENT ON ROLE ledger_read     IS '리포팅 · 대사 전용. 원장 · 케이지 조회만.';
COMMENT ON ROLE ledger_kyc      IS 'KYC 열람 전용. 여권 · 사진 참조 컬럼 접근권. 감사 대상.';
COMMENT ON ROLE audit_writer    IS 'audit 스키마 INSERT 전용. 조회 · 삭제 권한 없음.';
COMMENT ON ROLE audit_reader    IS '감사 로그 · 체인 앵커 조회 전용. 감사 담당자와 대사 배치에만 부여. INSERT 권한 없음.';
COMMENT ON ROLE audit_anchorer  IS '해시 체인 앵커 기록 전용. 야간 배치에만 부여. ledger_app 이 상속하지 않는다.';
COMMENT ON ROLE archive_reader  IS '레거시 아카이브 조회 전용. 이관 담당자에게만 부여.';
COMMENT ON ROLE ledger_migrator IS '마이그레이션 전용. 평시 사용 금지.';

-- -----------------------------------------------------------------------------
-- 기본 차단
-- -----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA        ledger, cage, identity, audit, archive FROM PUBLIC;
REVOKE ALL ON ALL TABLES    IN SCHEMA ledger, cage, identity, audit, archive FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger, cage, identity, audit, archive FROM PUBLIC;
-- 이 REVOKE 는 **지금 존재하는** 함수만 대상으로 한다. 이 파일 뒤쪽과 013 이 만드는
-- 함수는 다시 PUBLIC EXECUTE 를 받는다. 최종 차단은 013 끝의 일괄 REVOKE 다.

-- =============================================================================
-- ledger_app — 연산 함수 EXECUTE + 조회 SELECT. 그 외 아무것도 없다
-- =============================================================================
GRANT USAGE ON SCHEMA ledger, cage, identity TO ledger_app;

-- ---- 자금 연산 (009) --------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  ledger.op_deposit(TEXT, BIGINT, BIGINT, TEXT,
                    TEXT, TEXT, BIGINT, TEXT, TEXT),
  ledger.op_withdraw(TEXT, BIGINT, BIGINT, TEXT,
                     TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT),
  ledger.op_transfer(TEXT, BIGINT, BIGINT, TEXT,
                     TEXT, TEXT, TEXT, BIGINT, TEXT, TEXT),
  ledger.op_branch_transfer(TEXT, BIGINT, BIGINT, TEXT,
                            TEXT, TEXT, BIGINT,
                            TEXT, TEXT, BIGINT),
  ledger.op_wallet_transfer(TEXT, BIGINT, BIGINT, TEXT,
                            TEXT, TEXT, TEXT, BIGINT, BOOLEAN, TEXT, TEXT),
  ledger.op_adjustment(TEXT, BIGINT, BIGINT, TEXT,
                       TEXT, BIGINT, BIGINT, TEXT, TEXT),
  -- design-review.md DR-01. 이것이 없으면 실사 차액이 난 지점은 영원히 마감되지 않는다.
  ledger.op_resolve_suspense(TEXT, BIGINT, BIGINT, TEXT,
                             TEXT, TEXT, BIGINT, TEXT)
TO ledger_app;

-- ---- 게임 연산 (010) --------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  cage.op_open_game(TEXT, BIGINT, BIGINT, TEXT, TEXT,
                    TEXT, TEXT, TEXT, TEXT, cage.game_start_type, cage.game_start_kind,
                    BIGINT, BIGINT, TEXT, TEXT),
  cage.op_add_buyin(TEXT, BIGINT, BIGINT, TEXT, TEXT,
                    cage.game_start_type, BIGINT, BIGINT, TEXT),
  cage.op_record_rolling(TEXT, BIGINT, BIGINT, TEXT, TEXT, BIGINT),
  cage.op_settle_game(TEXT, BIGINT, BIGINT, TEXT, TEXT,
                      cage.settlement_kind, BIGINT, BIGINT, BIGINT, BIGINT, BIGINT,
                      BIGINT, BIGINT, BIGINT, BIGINT, TEXT),
  cage.op_cancel_game(TEXT, BIGINT, BIGINT, TEXT, TEXT, TEXT),
  -- design-review-6.md DR-66. 롤링 커미션 지급 — 칩 정산과 별개의 자금 이동이다.
  cage.op_settle_commission(TEXT, BIGINT, BIGINT, TEXT, TEXT,
                            BIGINT, BIGINT, BIGINT, TEXT),
  cage.op_main_cage_entry(TEXT, BIGINT, BIGINT, TEXT,
                          TEXT, cage.main_cage_kind, BIGINT)
TO ledger_app;

-- ---- 운영 연산 (011) --------------------------------------------------------
GRANT EXECUTE ON FUNCTION
  identity.op_request_approval(BIGINT, TEXT, identity.approval_subject,
                               TEXT, JSONB, SMALLINT, INTERVAL),
  identity.op_cast_vote(BIGINT, BIGINT, identity.approval_decision, BIGINT, TEXT),
  identity.op_shift_event(BIGINT, TEXT, identity.shift_action),
  cage.op_record_balancing(TEXT, BIGINT, BIGINT, TEXT, TEXT,
                           cage.count_kind, JSONB, BIGINT, BIGINT, BIGINT, BIGINT, TEXT),
  ledger.op_freeze_period(TEXT, BIGINT, BIGINT, TEXT,
                          TEXT, DATE, BIGINT),
  ledger.op_settle_period(TEXT, BIGINT, BIGINT, TEXT,
                          TEXT, DATE, BIGINT),
  ledger.op_open_account(TEXT, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT),
  -- design-review-4.md DR-50. 008 의 reverse_transaction 자체는 계속 비부여다.
  -- 부여 대상은 011 의 래퍼뿐이고, 그 래퍼가 인가 · 승인 · 멱등을 강제한다.
  ledger.op_reverse_transaction(TEXT, BIGINT, BIGINT, TEXT,
                                UUID, BIGINT, TEXT)
TO ledger_app;

-- ---- 조회 헬퍼 --------------------------------------------------------------
-- 순수 조회 함수만. 008 의 기록 계열은 하나도 포함하지 않는다.
-- 세션 스코프 헬퍼(current_branches · current_partner_id · partner_subtree ·
-- party_visible)는 이 파일 뒤쪽에서 정의되므로 GRANT 도 그 뒤에 있다.
GRANT EXECUTE ON FUNCTION
  ledger.business_date_of(TEXT, TIMESTAMPTZ),
  ledger.account_id_of(TEXT, ledger.account_kind, TEXT),
  ledger.house_account_id(TEXT, ledger.account_kind, TEXT)
TO ledger_app;

-- ---- 조회 SELECT ------------------------------------------------------------
-- security_invoker 뷰(v_account_balances · v_transaction_detail)가 호출자 권한으로
-- 실행되므로 기반 테이블 SELECT 가 필요하다. 범위 제한은 아래 RLS 가 한다.
GRANT SELECT ON
  ledger.transactions, ledger.entries, ledger.accounts, ledger.parties,
  ledger.account_balances, ledger.accounting_periods, ledger.currencies,
  -- chain_policy 는 004 의 assert_transaction_sealed 지연 트리거가 커밋 시점에
  -- 읽는다. 지연 트리거는 세션 컨텍스트로 실행되므로 ledger_app 이 SELECT 를
  -- 가져야 한다 (design-review.md DR-05).
  ledger.posting_rules, ledger.chain_policy, ledger.partner_profiles,
  ledger.v_account_balances, ledger.v_transaction_detail,
  cage.games, cage.rolling_events, cage.game_settlements,
  cage.commission_settlements,
  cage.main_cage_events, cage.chip_inventory_events, cage.balancing_counts
TO ledger_app;

-- KYC 민감 컬럼은 제외한다. 여권번호 · 사진 참조는 ledger_kyc 만 본다.
GRANT SELECT (party_id, member_no, phone, telegram, eng_name, nickname, vip,
              agent_code, proxy, rolling_rate, default_currency,
              opened_branch, opened_at, remark, updated_at)
  ON ledger.member_profiles TO ledger_app;

GRANT SELECT (party_id, passport_no_enc, passport_exp,
              passport_photo_ref, passport_photo_sha,
              site_photo_ref, site_photo_sha,
              signature_photo_ref, signature_photo_sha)
  ON ledger.member_profiles TO ledger_kyc;

-- Identity 조회. pin_hash · withdraw_pw_hash · totp_secret_enc 는 주지 않는다.
-- 현행 파트너 콘솔은 partnerStaff.pw 를 평문으로 노출한다 (P-12) — 그 재발을
-- 막는 것이 이 컬럼 단위 GRANT 다.
GRANT SELECT (id, external_id, code, name, principal_type, partner_party_id,
              status, totp_enrolled_at,
              failed_attempts, locked_until, created_at, updated_at)
  ON identity.staff TO ledger_app;
GRANT SELECT ON
  identity.staff_branches, identity.staff_roles, identity.roles,
  identity.role_permissions, identity.approvals, identity.approval_votes,
  identity.shift_events
TO ledger_app;

-- 세션 · TOTP 재사용 기록은 인증 흐름이 직접 쓴다 (자금 원장이 아니다).
GRANT SELECT, INSERT, UPDATE ON identity.sessions  TO ledger_app;
GRANT SELECT, INSERT         ON identity.totp_used TO ledger_app;

-- Outbox relay — 발행 표시만. 내용 변경은 007 의 트리거가 막는다.
GRANT SELECT               ON ledger.outbox TO ledger_app;
GRANT UPDATE (published_at) ON ledger.outbox TO ledger_app;

-- =============================================================================
-- ledger_read — 조회 전용
-- =============================================================================
GRANT USAGE  ON SCHEMA ledger, cage TO ledger_read;
GRANT SELECT ON ALL TABLES IN SCHEMA ledger, cage TO ledger_read;

-- archive 는 주지 않는다. 레거시 스냅샷에 평문 PIN · TOTP 시크릿 · KYC 원본이
-- 들어 있기 때문이다 (007 의 경고 참조). archive_reader 만 본다.
REVOKE ALL ON SCHEMA archive FROM ledger_read;

-- 인증 비밀값과 KYC 는 리포팅에도 노출하지 않는다.
-- identity 는 위 GRANT ... ALL TABLES 대상이 아니었으므로 USAGE 부터 준다.
GRANT USAGE ON SCHEMA identity TO ledger_read;
REVOKE SELECT ON identity.staff, ledger.member_profiles FROM ledger_read;
GRANT  SELECT (id, external_id, code, name, status, created_at)
  ON identity.staff TO ledger_read;
GRANT  SELECT (party_id, member_no, vip, agent_code, rolling_rate,
               default_currency, opened_branch, opened_at)
  ON ledger.member_profiles TO ledger_read;

-- 013 의 v_check_branch_provisioning 이 security_invoker 라 이 테이블을
-- 호출자 권한으로 읽는다. 뷰가 쓰는 것은 branch 한 컬럼뿐이므로 컬럼 단위로만
-- 연다 — "어느 지점에 직원이 있는가" 는 나가고 "누가 어느 지점인가" 는 안 나간다.
-- 테이블 통째로 열면 리포팅 자격증명 하나로 직원 배치도를 뜰 수 있게 된다.
GRANT SELECT (branch) ON identity.staff_branches TO ledger_read;

-- =============================================================================
-- identity_app — step-up 토큰 발급 전용 (design-review.md DR-03)
-- =============================================================================
-- **이 역할 분리가 DR-03 대책의 핵심이다.** 한 역할이 발급과 소비를 모두 할 수
-- 있으면 원래 문제로 돌아간다 — 앱이 재인증 사실을 스스로 만들어 낼 수 있게 된다.
--
--   identity_app  PIN · TOTP · 출금비밀번호를 실제로 검증한 뒤 토큰 행을 만든다.
--                 자금 op_* 는 하나도 부를 수 없다.
--   ledger_app    토큰을 **소비만** 한다 (op_* 안에서 consume_step_up 경유).
--                 step_up_tokens 에 INSERT 권한이 없다.
--
-- 배포상 두 서비스가 서로 다른 DB 자격증명으로 접속해야 한다는 뜻이다.
-- 같은 자격증명을 쓰면 이 분리가 무의미해진다.
GRANT USAGE  ON SCHEMA identity TO identity_app;
GRANT INSERT ON identity.step_up_tokens TO identity_app;
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA identity TO identity_app;
GRANT SELECT (id, external_id, code, name, status, locked_until,
              pin_hash, withdraw_pw_hash, totp_secret_enc)
  ON identity.staff TO identity_app;
-- 소비 · 수정 권한은 주지 않는다. 발급한 토큰을 발급자가 되돌릴 수 없다.

-- ledger_app 은 토큰을 소비만 한다. consume_step_up 은 SECURITY DEFINER 가 아니라
-- op_* (SECURITY DEFINER) 안에서만 불리므로 소유자 권한으로 UPDATE 가 통과한다.
-- ledger_app 에게 step_up_tokens 의 INSERT · UPDATE · SELECT 는 주지 않는다.

-- =============================================================================
-- audit_writer — 삽입 전용
-- =============================================================================
GRANT USAGE  ON SCHEMA audit TO audit_writer;
GRANT INSERT ON audit.access_log TO audit_writer;
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA audit TO audit_writer;
-- SELECT · UPDATE · DELETE 를 주지 않는다. 앱은 감사 로그를 읽거나 지울 수 없다.
--
-- chain_anchors 는 이 역할에서 뺐다 (design-review-2.md DR-26).
-- 역할 상속 기본값이 INHERIT 이므로 audit_writer 에 앵커 INSERT 가 있으면
-- ledger_app 이 그것을 물려받는다. 침해된 앱 자격증명 하나로 거래 위조와
-- 앵커 기록을 함께 만들 수 있다면 외부 앵커의 독립성이 성립하지 않는다.
-- 앵커는 아래 audit_anchorer 전용이다.

GRANT audit_writer TO ledger_app;

-- =============================================================================
-- audit_anchorer — 해시 체인 앵커 기록 전용 (design-review-2.md DR-26)
-- =============================================================================
-- 야간 배치에만 부여한다. 애플리케이션 서비스 계정에는 주지 않는다.
-- 이 역할은 ledger_app 이 상속하지 않는다 — 그것이 이 역할이 존재하는 이유다.
GRANT USAGE  ON SCHEMA audit TO audit_anchorer;
GRANT INSERT ON audit.chain_anchors, audit.merkle_anchors TO audit_anchorer;
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA audit TO audit_anchorer;
-- 앵커를 읽으려면 audit_reader 가 따로 필요하다. 쓰기와 읽기를 분리한다.

-- =============================================================================
-- audit_reader — 조회 전용 (design-review-2.md DR-25)
-- =============================================================================
-- 이 역할이 없던 동안 audit 스키마에 USAGE 를 가진 역할은 audit_writer 하나였고
-- 그 역할은 INSERT 만 가졌다. 즉 access_log 와 chain_anchors 를 **슈퍼유저 외에는
-- 아무도 읽을 수 없었다** — 감사 추적을 만들어 놓고 감사관에게 주지 않은 상태였다.
-- 사건 조사에 슈퍼유저 자격증명을 꺼내야 했고, 그건 정확히 감사가 감시해야 할 대상이다.
--
-- ledger_read 에 합치지 않는다. 리포팅 서비스는 상시 접속하고, 감사 로그에는
-- 인증 시도와 KYC 열람 기록이 들어간다. 두 접근을 같은 자격증명으로 묶으면
-- 감사 로그 조회 자체가 감사되지 않는다.
--
-- 002 의 RBAC 역할 'auditor' (애플리케이션 권한)와는 다른 층이다.
-- 관계는 06-security.md 에 명시한다.
GRANT USAGE  ON SCHEMA audit TO audit_reader;
GRANT SELECT ON audit.access_log, audit.chain_anchors, audit.merkle_anchors TO audit_reader;
-- INSERT · UPDATE · DELETE 는 주지 않는다. 읽기와 쓰기를 분리한다.
-- ledger_app 에는 이 역할을 주지 않는다 (audit_writer 와 달리 GRANT ... TO ledger_app 없음).

-- =============================================================================
-- archive_reader · ledger_migrator
-- =============================================================================
GRANT USAGE  ON SCHEMA archive TO archive_reader, ledger_migrator;
GRANT SELECT ON ALL TABLES IN SCHEMA archive TO archive_reader;

GRANT INSERT, SELECT  ON ALL TABLES    IN SCHEMA archive TO ledger_migrator;
GRANT USAGE           ON ALL SEQUENCES IN SCHEMA archive TO ledger_migrator;
GRANT EXECUTE ON FUNCTION archive.scrub_secrets() TO ledger_migrator;

-- 개시 잔액 적재 (design-review-3.md DR-38).
-- **ledger_app 에는 주지 않는다.** 이 함수는 임의 금액을 무에서 만들 수 있다.
-- 상시 접속하는 앱이 가지면 그 자체가 화폐 발행 API 이므로, 컷오버 기간에만
-- 쓰는 ledger_migrator 전용으로 둔다. 07-migration.md 가 실행 절차를 정한다.
GRANT USAGE ON SCHEMA ledger, identity TO ledger_migrator;
GRANT EXECUTE ON FUNCTION
  ledger.op_load_opening_balance(TEXT, BIGINT, TEXT, TEXT, JSONB, TEXT),
  ledger.account_id_of(TEXT, ledger.account_kind, TEXT)
TO ledger_migrator;
GRANT SELECT ON ledger.accounts, ledger.parties TO ledger_migrator;

-- =============================================================================
-- 향후 생성 객체 기본 권한
-- =============================================================================
-- 새 테이블은 리포팅에만 열어 둔다.
--
-- 함수는 여기서 막지 않는다. `ALTER DEFAULT PRIVILEGES ... REVOKE ... ON FUNCTIONS
-- FROM PUBLIC` 은 PostgreSQL 18 에서 **아무 일도 하지 않는다** — pg_default_acl 에
-- 행이 남지 않고 (`\ddp` 에도 안 보인다), 그 뒤 만든 함수는 그대로 `=X/postgres` 를
-- 받는다. REVOKE 는 ALTER DEFAULT PRIVILEGES GRANT 로 넣어 둔 항목을 빼는 명령이고,
-- 내장 기본값인 PUBLIC EXECUTE 는 그 대상이 아니다. 2026-08-15 PostgreSQL 18.6
-- 컨테이너에서 단일/다중 스키마, ALL/EXECUTE, FOR ROLE 명시까지 네 형태 모두 실패를
-- 확인했다. 여기에 그 문장을 두면 막혔다고 오독하게 되므로 두지 않는다.
--
-- 실제 차단은 013 끝의 사후 일괄 REVOKE 하나뿐이고, 드리프트 검사는
-- ledger.v_check_public_execute 가 한다.
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger, cage
  GRANT SELECT ON TABLES TO ledger_read;
-- audit 스키마에 테이블이 하나 늘 때마다 두 역할을 다시 챙기지 않아도 되게 한다
-- (design-review-2.md DR-25 가 정확히 그 누락이었다).
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT ON TABLES TO audit_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT INSERT ON TABLES TO audit_writer;

-- =============================================================================
-- Row Level Security — 지점 스코프
-- =============================================================================
-- PostgreSQL 문서:
--   "If no policy exists for the table, a default-deny policy is used, meaning that
--    no rows are visible or can be modified."
--   "Superusers and roles with the BYPASSRLS attribute always bypass the row security
--    system... though a table owner can choose to be subject to row security with
--    ALTER TABLE ... FORCE ROW LEVEL SECURITY."
--
-- FORCE 를 쓰지 않는 이유:
--   FORCE 는 테이블 소유자까지 RLS 대상으로 만든다. 008~011 의 연산 함수는
--   SECURITY DEFINER 라 소유자 권한으로 실행되고, 소유자용 정책이 없으면
--   기본 거부에 걸려 모든 INSERT 가 실패한다.
--   쓰기는 정의자 함수만 통과하므로 소유자는 우회하게 두고, RLS 는
--   ledger_app 의 **직접 조회**를 제약하는 용도로만 켠다.
--
-- 한계를 분명히 한다: RLS 는 애플리케이션 버그에 대한 방어선이지,
-- 침해된 ledger_app 자격증명에 대한 완전한 방어선이 아니다. app.staff_id 를
-- 설정하는 주체가 애플리케이션 자신이기 때문이다. 다만 자유 텍스트 지점 목록과
-- 달리 **실재하는 직원의 실제 소속 지점**만 얻을 수 있고, 그 직원 ID 가
-- 감사 로그에 남으므로 임의 확장은 불가능하다.

-- 이전 판은 current_setting('app.branches') 문자열을 그대로 신뢰했다.
-- 즉 앱이 'HANN,NUSTAR,ONLINE' 을 써 넣으면 그만이었다.
-- 신규는 세션의 직원 ID 로 staff_branches 를 조회한다.
CREATE OR REPLACE FUNCTION ledger.current_branches() RETURNS TEXT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
  SELECT COALESCE(array_agg(sb.branch), ARRAY[]::TEXT[])
    FROM identity.staff_branches sb
    JOIN identity.staff s ON s.id = sb.staff_id AND s.status = 'active'
   WHERE sb.staff_id = NULLIF(current_setting('app.staff_id', TRUE), '')::BIGINT;
$$;

COMMENT ON FUNCTION ledger.current_branches IS
  '세션의 app.staff_id 가 실제로 소속된 지점 목록. 미설정이면 빈 배열 → 기본 거부.';

-- 파트너 콘솔 운영자의 소속 파트너. 케이지 직원이면 NULL 이다.
-- 파트너는 지점이 아니라 계층으로 스코프가 갈리므로 별도 헬퍼가 필요하다.
CREATE OR REPLACE FUNCTION ledger.current_partner_id() RETURNS BIGINT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
  SELECT s.partner_party_id
    FROM identity.staff s
   WHERE s.id = NULLIF(current_setting('app.staff_id', TRUE), '')::BIGINT
     AND s.status = 'active'
     AND s.principal_type = 'partner_operator';
$$;
COMMENT ON FUNCTION ledger.current_partner_id IS
  '세션 주체가 파트너 운영자면 소속 파트너 party_id, 아니면 NULL. '
  '현행 파트너 콘솔은 모든 파트너의 데이터를 무제한으로 본다 — 이 함수가 그 경계를 만든다.';

-- 자기 자신과 하위 파트너 전체. partner_profiles.parent_id 를 따라 내려간다.
CREATE OR REPLACE FUNCTION ledger.partner_subtree(p_root BIGINT) RETURNS BIGINT[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ledger, pg_temp
AS $$
  WITH RECURSIVE sub AS (
    SELECT p_root AS party_id
    UNION
    SELECT pp.party_id
      FROM ledger.partner_profiles pp
      JOIN sub ON pp.parent_id = sub.party_id
  )
  SELECT COALESCE(array_agg(party_id), ARRAY[]::BIGINT[]) FROM sub;
$$;
COMMENT ON FUNCTION ledger.partner_subtree IS
  '루트 파트너와 그 하위 전체. depth 제약(1~8)이 있어 순환이 없으면 종료가 보장된다.';

-- -----------------------------------------------------------------------------
-- 정책 부착
-- -----------------------------------------------------------------------------
-- 지점 귀속 테이블: branch 컬럼 직접 비교
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ledger.transactions', 'ledger.entries', 'ledger.accounting_periods',
    'cage.games', 'cage.main_cage_events', 'cage.chip_inventory_events',
    'cage.balancing_counts'
  ] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY app_branch_scope ON %s FOR SELECT TO ledger_app
         USING (branch = ANY (ledger.current_branches()))', t);
    EXECUTE format(
      'CREATE POLICY read_all ON %s FOR SELECT TO ledger_read USING (TRUE)', t);
  END LOOP;
END;
$$;

-- 게임 경유 테이블: 게임의 지점을 따른다
ALTER TABLE cage.rolling_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cage.game_settlements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE cage.commission_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_branch_scope ON cage.commission_settlements FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM cage.games g
                  WHERE g.id = game_id AND g.branch = ANY (ledger.current_branches())));
CREATE POLICY read_all ON cage.commission_settlements FOR SELECT TO ledger_read USING (TRUE);

CREATE POLICY app_branch_scope ON cage.rolling_events FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM cage.games g
                  WHERE g.id = game_id AND g.branch = ANY (ledger.current_branches())));
CREATE POLICY read_all ON cage.rolling_events FOR SELECT TO ledger_read USING (TRUE);

CREATE POLICY app_branch_scope ON cage.game_settlements FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM cage.games g
                  WHERE g.id = game_id AND g.branch = ANY (ledger.current_branches())));
CREATE POLICY read_all ON cage.game_settlements FOR SELECT TO ledger_read USING (TRUE);

-- 계정 체계: 손님(member)과 내부(internal) 계정은 지점 중립이다.
-- 손님은 지점을 옮겨 다니므로 지점으로 가릴 수 없다 (01-current-system.md 참조).
-- 하우스 · 게임 계정만 지점 스코프를 적용한다.
ALTER TABLE ledger.parties          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.accounts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.account_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.member_profiles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger.partner_profiles ENABLE ROW LEVEL SECURITY;

-- 주체 가시성 판정을 한 함수에 모은다. parties · accounts · account_balances 가
-- 같은 규칙을 세 번 다시 쓰면 party_type 이 늘어날 때 한 곳을 빠뜨리게 된다.
--   member · internal   전원 (손님은 지점을 옮겨 다닌다)
--   house · game        소속 지점이 세션 지점 목록에 있을 때
--   partner             파트너 운영자는 자기 서브트리, 케이지 직원은 지점 소속 파트너
CREATE OR REPLACE FUNCTION ledger.party_visible(p_party_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ledger, pg_temp
AS $$
  SELECT CASE p.party_type
           WHEN 'member'   THEN TRUE
           WHEN 'internal' THEN TRUE
           WHEN 'partner'  THEN
             CASE WHEN ledger.current_partner_id() IS NOT NULL
                  THEN p.id = ANY (ledger.partner_subtree(ledger.current_partner_id()))
                  ELSE p.home_branch = ANY (ledger.current_branches())
             END
           ELSE p.home_branch = ANY (ledger.current_branches())
         END
    FROM ledger.parties p
   WHERE p.id = p_party_id;
$$;
COMMENT ON FUNCTION ledger.party_visible IS
  'RLS 주체 가시성 단일 판정. ledger.party_type 에 값을 추가하면 이 CASE 를 함께 갱신하라 '
  '— ELSE 분기가 home_branch 비교로 떨어지므로 home_branch 가 NULL 인 신규 종류는 전면 비가시가 된다.';

-- RLS 의 USING 식은 조회하는 역할의 권한으로 평가된다. 아래 EXECUTE 가 없으면
-- 정책이 통째로 실패해 조회가 permission denied 로 떨어진다.
GRANT EXECUTE ON FUNCTION
  ledger.current_branches(),
  ledger.current_partner_id(),
  ledger.partner_subtree(BIGINT),
  ledger.party_visible(BIGINT)
TO ledger_app, ledger_read;

-- 지점 프로비저닝은 앱 역할의 일이 아니다. 하우스 계정을 만들 수 있는 자가
-- 자금 경로에 있으면 상대 계정을 스스로 지어내 분개를 통과시킬 수 있다.
--
-- ledger_migrator 에게도 주지 않는다. 이것만 부를 수 있으면 branch_config ·
-- chain_heads 가 빠진 **반쪽 지점을 만드는 경로가 하나 생긴다** — 013 의
-- v_check_branch_provisioning 이 잡으려는 바로 그 상태다 (R-01-06).
-- 이관 역할이 부를 것은 004 의 provision_branch() 하나뿐이고, 그것이
-- SECURITY DEFINER 라 이 함수를 소유자 권한으로 부른다.
REVOKE EXECUTE ON FUNCTION ledger.bootstrap_house_accounts(TEXT) FROM PUBLIC;

-- 지점 추가는 이관 역할의 일이다. 자금 레인(ledger_app)이 지점을 만들 수 있으면
-- 자기 거래의 상대 계정을 스스로 지어낼 수 있게 된다.
REVOKE EXECUTE ON FUNCTION
  ledger.provision_branch(TEXT, TEXT, DATE, BIGINT, BOOLEAN, TEXT, TIME) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION
  ledger.provision_branch(TEXT, TEXT, DATE, BIGINT, BOOLEAN, TEXT, TIME) TO ledger_migrator;

CREATE POLICY app_scope ON ledger.parties FOR SELECT TO ledger_app
  USING (ledger.party_visible(id));
CREATE POLICY read_all ON ledger.parties FOR SELECT TO ledger_read USING (TRUE);

CREATE POLICY app_scope ON ledger.accounts FOR SELECT TO ledger_app
  USING (ledger.party_visible(party_id));
CREATE POLICY read_all ON ledger.accounts FOR SELECT TO ledger_read USING (TRUE);

CREATE POLICY app_scope ON ledger.account_balances FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM ledger.accounts a
                  WHERE a.id = account_id
                    AND ledger.party_visible(a.party_id)));
CREATE POLICY read_all ON ledger.account_balances FOR SELECT TO ledger_read USING (TRUE);

CREATE POLICY app_scope ON ledger.partner_profiles FOR SELECT TO ledger_app
  USING (ledger.party_visible(party_id));
CREATE POLICY read_all ON ledger.partner_profiles FOR SELECT TO ledger_read USING (TRUE);

-- KYC 프로필은 지점이 아니라 '세션에 유효한 직원이 있는가'로 가른다.
-- 실제 접근 통제는 컬럼 단위 GRANT(ledger_kyc)와 audit.access_log 가 담당한다.
CREATE POLICY app_scope ON ledger.member_profiles FOR SELECT TO ledger_app
  USING (cardinality(ledger.current_branches()) > 0);
CREATE POLICY read_all ON ledger.member_profiles FOR SELECT TO ledger_read USING (TRUE);
CREATE POLICY kyc_read  ON ledger.member_profiles FOR SELECT TO ledger_kyc  USING (TRUE);

-- 승인은 지점 스코프
ALTER TABLE identity.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_branch_scope ON identity.approvals FOR SELECT TO ledger_app
  USING (branch = ANY (ledger.current_branches()));

COMMIT;

-- =============================================================================
-- 운영 계정 (배포 환경에서 개별 수행 — 비밀번호를 스크립트에 두지 않는다)
-- =============================================================================
-- CREATE ROLE cage_ledger_svc LOGIN PASSWORD :'pw';
-- GRANT ledger_app TO cage_ledger_svc;
--
-- CREATE ROLE cage_report_svc LOGIN PASSWORD :'pw';
-- GRANT ledger_read TO cage_report_svc;
--
-- 애플리케이션은 커넥션마다 다음을 설정한다. 설정하지 않으면 RLS 기본 거부로
-- 아무 행도 보이지 않는다 — 잊으면 조용히 새는 게 아니라 즉시 빈 결과가 된다.
--   SET LOCAL app.staff_id = '1234';
