-- =============================================================================
-- 007. Outbox · 감사 로그 · 레거시 아카이브
-- =============================================================================
-- Outbox 패턴: 도메인 이벤트를 자금 트랜잭션과 같은 DB 트랜잭션에서 기록하고,
-- relay 가 발행한다. 이중 쓰기 문제(DB 커밋과 메시지 발행이 갈라지는 문제)를 없앤다.
--
-- 전달 보장은 at-least-once 다. relay 가 발행 후 확인 전에 죽으면 중복 발행된다.
-- 따라서 구독자는 반드시 멱등해야 한다 (02-target-architecture.md §4-1).
-- =============================================================================

\set ON_ERROR_STOP on

BEGIN;

CREATE TABLE ledger.outbox (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_type     TEXT NOT NULL,          -- 'transaction.posted' · 'game.ended' ...
  channel        TEXT NOT NULL,          -- 'ledger:branch:HANN' · 'games:HANN' ...
  aggregate_type TEXT NOT NULL,
  aggregate_id   TEXT NOT NULL,
  payload        JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  published_at   TIMESTAMPTZ
);

-- relay 는 이 인덱스로 미발행 건만 훑는다.
-- 폴링 쿼리: SELECT ... WHERE published_at IS NULL ORDER BY id
--            FOR UPDATE SKIP LOCKED LIMIT n
CREATE INDEX outbox_unpublished_idx ON ledger.outbox (id) WHERE published_at IS NULL;
CREATE INDEX outbox_channel_idx     ON ledger.outbox (channel, id);

COMMENT ON COLUMN ledger.outbox.id IS
  '구독자에게 전달되는 단조 증가 seq. 클라이언트가 중복 무시와 재연결 이어받기에 사용한다.';

-- 발행 완료 표시만 허용한다 (내용 변경 금지)
CREATE FUNCTION ledger.outbox_mark_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- 보존 기간 경과분 정리는 별도 유지보수 역할이 수행한다
    RETURN OLD;
  END IF;
  IF NEW.event_type    IS DISTINCT FROM OLD.event_type
     OR NEW.channel    IS DISTINCT FROM OLD.channel
     OR NEW.payload    IS DISTINCT FROM OLD.payload
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'outbox rows are immutable except published_at'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_immutable_content
  BEFORE UPDATE ON ledger.outbox
  FOR EACH ROW EXECUTE FUNCTION ledger.outbox_mark_only();

-- -----------------------------------------------------------------------------
-- 감사 로그
-- -----------------------------------------------------------------------------
-- 자금 사건은 ledger.transactions 가 이미 기록한다(행위자·인증방식·단말·시각·해시).
-- 여기에는 조회 · 인증 시도 · 권한 변경 · KYC 접근을 기록한다.
-- audit 스키마는 별도 역할이 쓰며 애플리케이션 역할은 삭제 권한이 없다 (009).
CREATE TABLE audit.access_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  actor_kind    TEXT NOT NULL,            -- 'staff' · 'member' · 'system'
  actor_ref     TEXT,
  action        TEXT NOT NULL,            -- 'auth.login' · 'kyc.view' · 'role.grant' ...
  target_kind   TEXT,
  target_ref    TEXT,
  branch        TEXT REFERENCES ledger.branches(code),
  outcome       TEXT NOT NULL,            -- 'success' · 'denied' · 'error'
  source_ip     INET,
  device_id     TEXT,
  detail        JSONB
);

CREATE INDEX access_log_time_idx   ON audit.access_log (occurred_at DESC);
CREATE INDEX access_log_actor_idx  ON audit.access_log (actor_kind, actor_ref, occurred_at DESC);
CREATE INDEX access_log_action_idx ON audit.access_log (action, occurred_at DESC);

CREATE TRIGGER access_log_immutable
  BEFORE UPDATE OR DELETE ON audit.access_log
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- 해시 체인 외부 앵커링 기록 (03-ledger-model.md §7-5)
CREATE TABLE audit.chain_anchors (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  branch        TEXT NOT NULL REFERENCES ledger.branches(code),
  business_date DATE NOT NULL,
  last_tx_id    BIGINT NOT NULL,
  chain_hash    BYTEA NOT NULL,
  anchored_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  anchor_ref    TEXT,                     -- 외부 저장소 위치 · 서명 참조
  UNIQUE (branch, business_date)
);

CREATE TRIGGER chain_anchors_immutable
  BEFORE UPDATE OR DELETE ON audit.chain_anchors
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

-- 체인 밖 거래의 무결성 대체 수단 — 일 단위 머클 앵커 (design-review.md DR-05)
-- ADR-006 이 "베팅은 체인 제외 + 일 단위 머클 앵커링" 이라고 정해 놓고 이 테이블이
-- 없었다. 위 chain_anchors 는 체인 **헤드**용이라 대체가 되지 않는다.
-- chain_policy.chained = false 인 거래 종류가 여기 걸린다.
CREATE TABLE audit.merkle_anchors (
  branch        TEXT NOT NULL REFERENCES ledger.branches(code),
  business_date DATE NOT NULL,
  tx_kind       ledger.tx_kind NOT NULL,
  tx_count      BIGINT NOT NULL CHECK (tx_count > 0),
  merkle_root   BYTEA NOT NULL,
  anchored_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  anchor_ref    TEXT,                     -- 외부 저장소 위치 · 서명 참조
  PRIMARY KEY (branch, business_date, tx_kind)
);

CREATE TRIGGER merkle_anchors_immutable
  BEFORE UPDATE OR DELETE ON audit.merkle_anchors
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();

COMMENT ON TABLE audit.merkle_anchors IS
  '해시 체인에 넣지 않는 거래 종류의 일 단위 무결성 앵커. 루트 계산은 013 의 merkle_root_for() 하나로 고정한다. ADR-006 · design-review.md DR-05.';

-- -----------------------------------------------------------------------------
-- 레거시 아카이브 (07-migration.md §6)
-- -----------------------------------------------------------------------------
-- 경고: 이 테이블은 현행 Firestore 문서를 '원본 그대로' 담는다. 즉 다음이 들어온다.
--   staff.pin          평문 PIN            (index.html:5663 — 데모 전원 '1234')
--   staff.totpSecret   평문 TOTP 시크릿    (index.html:4300-4305)
--   accounts.passport / passportPhoto / sitePhoto / signaturePhoto  여권·KYC 원본
-- 신규 스키마는 이것들을 Argon2id 해시 · KMS 봉투암호화 · 객체스토리지 참조로
-- 바꾸는데(002 · 003), 아카이브에 평문 원본이 남으면 그 전환이 무의미해진다.
-- 따라서 이관 검증이 끝나는 즉시 scrub_secrets() 를 돌리고,
-- 조회 권한은 ledger_read 가 아니라 전용 archive_reader 역할에만 준다 (012).
CREATE TABLE archive.firestore_snapshot (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection  TEXT NOT NULL,
  document_id TEXT NOT NULL,
  data        JSONB NOT NULL,            -- 원본 그대로. 변환하지 않는다
  snapshot_at TIMESTAMPTZ NOT NULL,
  scrubbed_at TIMESTAMPTZ,               -- 비밀값 제거 시각. NULL 이면 아직 원본이다
  UNIQUE (collection, document_id)
);

CREATE INDEX firestore_snapshot_collection_idx ON archive.firestore_snapshot (collection);

-- 남아 있는 원본 스냅샷 개수. 0이 아니면 운영 준비가 끝나지 않은 것이다.
-- security_invoker: 08-adr.md ADR-014 의 규칙이다 (design-review-2.md DR-24).
CREATE VIEW archive.v_unscrubbed
  WITH (security_invoker = true) AS
SELECT collection, count(*) AS documents, min(snapshot_at) AS oldest
  FROM archive.firestore_snapshot
 WHERE scrubbed_at IS NULL
 GROUP BY collection;

-- 이관 검증 완료 후 실행한다. 되돌릴 수 없다.
-- 인증 비밀값은 삭제하고, KYC 식별정보는 '있었다'는 사실만 남긴다.
CREATE FUNCTION archive.scrub_secrets()
RETURNS TABLE (collection TEXT, scrubbed BIGINT)
LANGUAGE plpgsql
SET search_path = archive, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH updated AS (
    UPDATE archive.firestore_snapshot s
       SET data = (s.data
                     - 'pin' - 'totpSecret' - 'withdrawPw'
                     - 'passport' - 'passportNo' - 'passportPhoto'
                     - 'sitePhoto' - 'signaturePhoto')
                  || jsonb_strip_nulls(jsonb_build_object(
                       'scrubbed',       TRUE,
                       'had_pin',        (s.data ? 'pin')            OR NULL,
                       'had_totp',       (s.data ? 'totpSecret')     OR NULL,
                       'had_passport',   (s.data ? 'passport')       OR NULL,
                       'had_kyc_photos', (s.data ? 'passportPhoto'
                                       OR s.data ? 'sitePhoto'
                                       OR s.data ? 'signaturePhoto') OR NULL
                     )),
           scrubbed_at = clock_timestamp()
     WHERE s.scrubbed_at IS NULL
     RETURNING s.collection AS c
  )
  SELECT u.c, count(*) FROM updated u GROUP BY u.c;
END;
$$;

COMMENT ON FUNCTION archive.scrub_secrets IS
  '레거시 스냅샷에서 평문 PIN · TOTP 시크릿 · KYC 원본을 제거한다. 되돌릴 수 없다.';

CREATE TABLE archive.migration_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_code   TEXT NOT NULL,
  legacy_balance NUMERIC NOT NULL,       -- 감사 시점 계산값 (부동소수 원본)
  opening_minor  BIGINT NOT NULL,        -- 확정 개시 잔액 (정수)
  rounding_delta BIGINT NOT NULL,        -- 반올림 잔차 — 조용히 흡수하지 않는다
  anomalies      JSONB,                  -- 중복 후보 · 반쪽 거래 등
  approved_by    TEXT NOT NULL,
  approved_at    TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE archive.migration_audit IS
  '이관 감사 결과. 운영 책임자 서명 없이는 개시 분개를 세우지 않는다.';

COMMIT;
