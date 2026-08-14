# 06. 보안 아키텍처

목표: 큰 금액의 자금을 처리하는 실서비스. 보안은 부가 기능이 아니라 성립 조건이다.

---

## 1. 현행 상태 — 인증 경계는 생겼다. 자금 경계는 없다

> **2026-08-14 갱신.** Track A 하드닝으로 **인증 경로**에 서버 검증 지점이 생겼다([01-current-system.md](01-current-system.md) 12절). 아래 표에 항목별 현재 상태를 반영했다. **자금 경로는 초판과 동일하다.**

```
┌──────────── 브라우저 (자금 경로 전권 보유) ──────────┐
│  인증      staffLogin 이 서버에서 PIN+TOTP 검증       │ ← [Track A] 이동 완료
│            단, PIN·마스터 해시는 여전히 평문/무솔트    │
│            partner-admin 은 여전히 클라이언트 비교     │
│  잔액      원장 전량 다운로드 후 JS 합산              │
│  결과      Math.random()                             │
│  페이아웃  클라이언트가 배수 계산 후 원장에 기록       │
└───────────────────────┬──────────────────────────────┘
                        │   ⚠ 자금 경로에 검증 계층 없음
                        ▼
┌──── Firestore (규칙 존재. staff 만 잠김) ────────────┐
│  staff        request.auth != null      ← [Track A]  │
│  그 외 전부   무제한 (accounts · ledger · members …)  │
└──────────────────────────────────────────────────────┘
```

**자금 컬렉션의 서버 측 검증 지점 = 여전히 0개.** 브라우저를 신뢰하지 않으면 성립하는 자금 기능이 하나도 없다.

즉시 폐기해야 하는 것:

| 항목 | 위치 | 2026-08-14 상태 |
|---|---|---|
| 평문 비밀번호 + 클라이언트 비교 | `index.html` `seedDB()` · `partner-admin/app.js:186` | **부분.** 케이지 직원은 서버 검증으로 이동. **저장은 여전히 평문**이고 **파트너 콘솔은 클라이언트 비교 그대로** |
| 번들 하드코딩 시크릿 (`APP_API_SECRET`) | `index.html` | **미해결.** 회전 여부 미확인 — Git 히스토리에도 존재 |
| 자동 생성 마스터 계정 | `partner-admin/app.js:172` · `:185` | **미해결.** `admin` / `0000` 그대로 |
| **빈 입력 로그인이 마스터가 된다** | `partner-admin/app.js:178-179` | **[신규]** `.value.trim() \|\| 'admin'` · `\|\| '0000'`. ID와 비밀번호를 **비운 채 로그인하면** 기본값이 채워진다 ([P-02](../partner-admin/explanation-known-gaps.md#p-02--빈-입력으로-로그인하면-admin이-된다)) |
| **`partnerStaff` 평문 비밀번호 공개 노출** | `partner-admin/app.js:172` · `firestore.rules` | **[신규]** `pw`를 평문 저장하는데 **규칙은 `staff`만 잠근다.** `partnerStaff`는 프로젝트 ID만 알면 인증 없이 읽힌다 ([P-12](../partner-admin/explanation-known-gaps.md#p-12--partnerstaff가-평문-비밀번호를-공개-노출한다)) |
| 솔트 없는 SHA-256 마스터 비밀번호 | `index.html:6487` · **`functions/index.js:172`** | **악화.** 비밀번호는 회전됐고 평문 주석은 삭제됐으나 **방식 동일 + 상수가 두 곳으로 늘었다**(배포 파이프라인이 분리돼 공유 설정이 없음) |
| 클라이언트 통과 TOTP 시크릿 | `index.html:4352-4353` · `:9296` | **미해결.** 시크릿 생성이 여전히 브라우저에서 일어난다 |
| **`ERIC` 계정 TOTP 우회** | `index.html:9138` · `functions/index.js:154` | **[신규]** 고정 코드 `'123456'`. 클라이언트·서버 양쪽. 계정 하나가 사실상 2FA 없이 열려 있다 |
| `Math.random()` RNG | `shared/game-engine.js` | **미해결** |
| 저장형 XSS | `partner-admin/app.js` 렌더링 경로 | **부분.** `escapeHtml` 3개 영역 적용. `onclick` 문자열 삽입 구조 잔존 (8절) |
| **인증 로컬 폴백** | `index.html:9128-9138` | **[신규]** `staffLogin` 도달 불가 시 클라이언트 검증으로 회귀. 가용성과 맞바꾼 의도적 선택 |

> **시크릿 회전이 먼저다.** 코드에서 지우는 것만으로는 무효화되지 않는다. Git 히스토리에 남아 있다. 마스터 비밀번호는 이 원칙에 따라 회전됐다(TA-S8).

---

## 2. 신뢰 경계 — 목표

```
┌─────────── 브라우저 (권한 0) ───────────┐
│  세션 토큰만 보유 (수명 짧음)            │
│  모든 판단은 서버 응답을 표시할 뿐        │
└──────────────────┬───────────────────────┘
                   │ TLS 1.3
                   ▼
┌────────────── API Gateway ──────────────┐
│  세션 검증 · RBAC · 지점 스코프          │
│  rate limit · 멱등키 · 감사 로그          │
└──────────────────┬───────────────────────┘
                   ▼
┌───────── 애플리케이션 (ledger_app) ──────┐
│  테이블 DML 권한 없음                    │
│  SECURITY DEFINER 함수 EXECUTE 만         │
└──────────────────┬───────────────────────┘
                   ▼
┌────────── PostgreSQL (불변식 강제) ──────┐
│  지연 제약 트리거 · 권한 분리 · RLS       │
└──────────────────────────────────────────┘
```

**각 계층이 아래 계층을 신뢰하지 않는다.** 앱이 뚫려도 DB 불변식이 남고, DB 계정이 뚫려도 트리거가 남는다.

---

## 3. 인증

### 3-1. 비밀번호 — Argon2id

OWASP Password Storage Cheat Sheet의 권장 파라미터를 따른다. 다음 설정들은 **동등한 방어 수준**이며 CPU와 RAM 사용량의 트레이드오프만 다르다.

```
m=47104 (46 MiB), t=1, p=1
m=19456 (19 MiB), t=2, p=1      ← 채택 (균형점)
m=12288 (12 MiB), t=3, p=1
m=9216  (9 MiB),  t=4, p=1
m=7168  (7 MiB),  t=5, p=1
```

적용 대상: 직원 PIN, 파트너 운영자 비밀번호, 회원 비밀번호, **출금 비밀번호**.

**페퍼(pepper)** 는 비밀 저장소(vault) 또는 HSM에 보관하고 DB와 분리한다. 단, 페퍼는 사용자 비밀번호를 모르면 교체할 수 없으므로, 유출 시 전원 비밀번호 재설정이 필요하다는 점을 운영 절차에 명시한다.

> PIN이 4자리라면 해시 강도와 무관하게 온라인 무차별 대입이 위협이다. **시도 횟수 제한과 계정 잠금이 필수**이며, 고액 조작에는 PIN 단독을 허용하지 않는다(3-2 참조).

### 3-2. TOTP — RFC 6238

현행 구현을 **서버로 이전**해 재사용한다. 알고리즘은 검증된 것을 그대로 쓰되 시크릿이 브라우저를 지나가지 않게 한다.

> **[Track A] 이전은 이미 끝났다.** `functions/index.js:66-105`에 `base32Decode`/`hotp`/`verifyTotp`가 포팅돼 있고(SHA-1, 6자리, 30초 스텝, ±1 창), `functions/test/totp.test.js`가 클라이언트 구현과 동일 동작임을 고정한다. 신규 Identity 서비스는 **이 코드를 새로 쓰지 말고 그대로 가져가라.**
>
> **다만 아래 3가지는 아직 하나도 적용되지 않았다** — 서버로 옮긴 것은 *검증*뿐이고, *시크릿 관리*는 그대로다:
> - 시크릿을 여전히 **클라이언트가 생성**한다 (`genTotpSecret()` `index.html:5652`, `:4352` · `:9296`에서 되쓴다)
> - 시크릿이 **평문으로 Firestore에 저장**된다 (봉투 암호화 없음)
> - **재사용 금지가 강제되지 않는다** — 같은 코드로 두 번 로그인할 수 있다 (아래 `totp_used` 테이블이 해결할 문제)

| 항목 | 값 | 근거 |
|---|---|---|
| 시간 간격 | 30초 | "We RECOMMEND a default time-step size of 30 seconds." |
| 허용 창 | ±1 스텝 | "at most one time step is allowed as the network delay" |
| **재사용 금지** | 필수 | "The verifier MUST NOT accept the second attempt of the OTP after the successful validation has been issued for the first OTP" |

재사용 금지를 DB로 강제한다:

```sql
CREATE TABLE identity.totp_used (
  staff_id  BIGINT NOT NULL REFERENCES identity.staff,
  time_step BIGINT NOT NULL,
  used_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (staff_id, time_step)
);
```

같은 코드를 두 번 쓰면 기본키 충돌로 실패한다.

**시크릿 저장:** `totp_secret_enc BYTEA` — KMS 봉투 암호화. 평문으로 DB에 두지 않고, 클라이언트에 전송하지 않는다. 최초 등록 시 QR을 **서버가 생성**해 1회만 표시한다.

### 3-3. 세션

| 항목 | 정책 |
|---|---|
| 액세스 토큰 | 수명 15분 이하 |
| 리프레시 토큰 | 회전(rotation) 적용. 재사용 감지 시 세션 계열 전체 무효화 |
| 즉시 무효화 | 서버 측 세션 테이블 조회. 직원 해고·단말 분실 시 즉시 차단 |
| 단말 바인딩 | `device_id` 등록. 미등록 단말은 재인증 요구 |

> **자체 세션을 쓰는 이유:** 외부 ID 공급자의 클레임 전파 지연과 무효화 한계 때문이다. 자금 시스템은 "지금 즉시 차단"이 가능해야 한다.

### 3-4. 조작별 재인증 (step-up)

현행 UX를 유지한다 — 이것은 좋은 설계다.

| 조작 | 현행 함수 | 요구 인증 |
|---|---|---|
| 롤링 입력 · 중간정산 · 게임종료 · 지점이체 | `requestPinAuth()` | PIN 또는 TOTP |
| 출금 · 계좌 간 이체 · 계좌 바이인 | `requestWithdrawAuth()` | 출금 비밀번호 |
| 임계 금액 초과 · 차액 조정 · 기간 동결 | — | **2인 승인 (4-eyes)** |

검증 결과는 `ledger.transactions.auth_method`에 기록된다. **어떤 인증으로 승인된 거래인지 사후에 확인할 수 있다.**

---

## 4. 데이터베이스 권한

### 4-1. 역할 분리

애플리케이션 역할은 **자금 테이블에 DML 권한이 없고, 범용 기록 함수에도 EXECUTE 권한이 없다.**

```sql
-- 앱은 테이블에 직접 접근할 수 없다
REVOKE ALL ON ALL TABLES IN SCHEMA ledger FROM PUBLIC;

-- 범용 기록 함수는 앱에 주지 않는다 (내부 전용)
--   ledger.post_transaction · reverse_transaction · begin_idempotent … → 미부여

-- 앱이 호출할 수 있는 것은 연산 함수뿐이다
GRANT EXECUTE ON FUNCTION ledger.op_deposit(...)  TO ledger_app;
GRANT EXECUTE ON FUNCTION ledger.op_withdraw(...) TO ledger_app;
-- ... 009~011 의 op_* 만
```

| 역할 | 권한 |
|---|---|
| `ledger_owner` | 스키마 소유. 마이그레이션 전용. 애플리케이션이 접속하지 않음 |
| `ledger_app` | **`op_*` 연산 함수 EXECUTE + 조회 SELECT.** 자금 테이블 DML 없음, `post_transaction` EXECUTE 없음 |
| `ledger_read` | 조회 전용 (리포팅·대사). 인증 비밀값·KYC 컬럼 제외 |
| `ledger_kyc` | 여권번호·사진 참조 컬럼 열람 전용. 컬럼 단위 GRANT |
| `audit_writer` | `audit` 스키마 INSERT만. SELECT·UPDATE·DELETE 없음 |
| `archive_reader` | 레거시 아카이브 조회 전용. `ledger_read`에는 주지 않는다 |
| `ledger_migrator` | 마이그레이션 전용. 평시 사용 금지 |

**왜 두 계층인가.** `post_transaction()`을 앱에 노출하면 그것이 곧 "임의 분개 기록 API"가 된다. 균형만 맞으면 통과하므로 `member_deposit`을 대변 기록하고 `suspense`를 차변 기록해 돈을 창조할 수 있다 — 회계 항등식은 지켜진 채로. 연산 함수가 계정과 부호를 직접 구성하고 앱은 금액과 대상만 넘기는 구조라야 그 경로가 사라진다.

### 4-2. `SECURITY DEFINER` 안전 패턴

PostgreSQL 문서가 명시하는 두 가지를 반드시 지킨다.

**(1) `search_path` 명시**

> "For security, search_path should be set to exclude any schemas writable by untrusted users. This prevents malicious users from creating objects (e.g., tables, functions, and operators) that mask objects intended to be used by the function."
> "Particularly important in this regard is the temporary-table schema, which is searched first by default, and is normally writable by anyone. A secure arrangement can be obtained by forcing the temporary schema to be searched last. To do this, write pg_temp as the last entry in search_path."

```sql
CREATE FUNCTION ledger.post_transaction(...) RETURNS ...
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, cage, identity, pg_temp   -- pg_temp 를 마지막에
AS $$ ... $$;
```

**(2) 생성과 권한 부여를 한 트랜잭션으로**

함수 생성 직후 `PUBLIC`에게 열려 있는 창을 없앤다.

```sql
BEGIN;
CREATE FUNCTION ledger.post_transaction(...) ... SECURITY DEFINER ...;
REVOKE ALL ON FUNCTION ledger.post_transaction(...) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ledger.post_transaction(...) TO ledger_app;
COMMIT;
```

### 4-3. Row Level Security

지점 스코프를 DB 계층에서도 강제한다. 애플리케이션 인가가 뚫려도 다른 지점 데이터가 나가지 않는다.

문서가 명시하는 기본 동작:
> "If no policy exists for the table, a default-deny policy is used, meaning that no rows are visible or can be modified."
> "Superusers and roles with the `BYPASSRLS` attribute always bypass the row security system when accessing a table. Table owners normally bypass row security as well, though a table owner can choose to be subject to row security with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`."

따라서:
- RLS를 켜되 **정책을 명시적으로 작성**한다 (켜기만 하면 전면 차단)
- 앱은 커넥션마다 `SET LOCAL app.staff_id = '<staff.id>'`를 설정한다

**지점 목록을 앱이 직접 넘기지 않는다.**

```sql
CREATE FUNCTION ledger.current_branches() RETURNS ledger.branch_code[]
SECURITY DEFINER AS $$
  SELECT COALESCE(array_agg(sb.branch), ARRAY[]::ledger.branch_code[])
    FROM identity.staff_branches sb
    JOIN identity.staff s ON s.id = sb.staff_id AND s.status = 'active'
   WHERE sb.staff_id = NULLIF(current_setting('app.staff_id', TRUE), '')::BIGINT;
$$;
```

자유 텍스트 `app.branches`를 신뢰하면 앱이 `'HANN,NUSTAR,ONLINE'`을 써 넣는 것으로 끝난다. 직원 ID를 받아 실제 소속을 조회하면 **실재하는 직원의 실제 소속 지점**만 얻을 수 있고, 그 ID가 감사 로그에 남는다.

미설정이면 빈 배열 → 기본 거부. 조용히 새는 게 아니라 즉시 빈 결과가 되므로 누락을 바로 안다.

**RLS를 켜는 테이블 (13개).** 이전 판은 `transactions`와 `games` 둘뿐이었는데, `entries`에 정책이 없어 조인 한 번으로 우회됐다.

```
ledger:  transactions · entries · accounts · parties · account_balances ·
         accounting_periods · member_profiles
cage:    games · rolling_events · game_settlements · main_cage_events ·
         chip_inventory_events · balancing_counts
identity: approvals
```

계정 체계는 지점으로 가르지 않는다 — **손님은 지점을 옮겨 다니므로 회원 계정은 지점 중립**이다. 하우스·게임 계정만 지점 스코프를 적용한다.

**파트너 계정도 지점 중립**이지만 가시성 규칙은 다르다. 파트너는 지점이 아니라 **계층**으로 가린다 — 파트너 콘솔 운영자는 자기 파트너와 그 하위만 본다(`ledger.partner_subtree()`), 케이지 직원은 자기 지점 소속 파트너만 본다. 판정은 `ledger.party_visible()` 한 함수에 모여 있다(`ddl/012`). 현행 파트너 콘솔은 이 경계가 아예 없어 **모든 파트너의 데이터를 무제한으로 본다.**

**뷰에는 `security_invoker = true`가 필수다.**

```sql
CREATE VIEW ledger.v_account_balances WITH (security_invoker = true) AS ...
```

기본값(정의자 뷰)이면 뷰가 **소유자 권한**으로 실행되고, 아래 이유로 소유자는 RLS 대상이 아니므로 **뷰를 통한 조회가 지점 정책을 통째로 우회한다.** 정책이 걸린 테이블을 직접 조회할 때만 정책이 산다. PostgreSQL 15 이상 필요.

**`FORCE ROW LEVEL SECURITY`는 쓰지 않는다.** 이유가 중요하다:

```
FORCE 는 테이블 소유자까지 RLS 대상으로 만든다.
그런데 op_* 와 post_transaction() 은 SECURITY DEFINER 라 소유자 권한으로 실행된다.
소유자용 정책이 없으면 default-deny 에 걸려 모든 INSERT 가 실패한다.
```

쓰기는 정의자 함수라는 신뢰 경로만 통과하므로 소유자는 우회하게 두고, RLS는 **`ledger_app`의 직접 조회를 제약하는 2차 방어선**으로만 쓴다. 소유자 계정(`ledger_owner`)은 마이그레이션 전용이며 애플리케이션이 접속하지 않는다.

> **한계를 분명히 한다.** RLS는 애플리케이션 **버그**에 대한 방어선이지, 침해된 `ledger_app` 자격증명에 대한 완전한 방어선이 아니다. `app.staff_id`를 설정하는 주체가 애플리케이션 자신이기 때문이다. 공격자는 특정 직원을 사칭할 수는 있으나 존재하지 않는 권한을 만들어 낼 수는 없고, 사칭한 ID가 `transactions.actor_staff_id`와 `audit.access_log`에 남는다.

**KYC 컬럼은 RLS가 아니라 컬럼 단위 GRANT로 가른다.** 회원이 지점 중립이라 행 단위로 가릴 기준이 없다. `ledger_app`은 연락처·등급까지, `ledger_kyc`만 여권번호와 사진 참조를 본다.

### 4-4. 원장 불변성

[03-ledger-model.md](03-ledger-model.md) 7-4절 참조. 권한 회수 + `BEFORE UPDATE OR DELETE` 트리거 이중 방어.

> **한계:** `session_replication_role = 'replica'`는 트리거를 비활성화한다. 슈퍼유저 전용 설정이며 운영 접근 통제와 감사로 관리한다.

---

## 5. 4-eyes 승인

임계 금액을 넘는 조작은 2인 승인을 거친다.

```sql
CREATE TABLE identity.approvals (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  subject_kind   identity.approval_subject NOT NULL,  -- withdrawal | adjustment | period_settle
  subject_ref    TEXT NOT NULL,
  payload        JSONB NOT NULL,          -- 승인 시 실행될 요청 원본
  required_count SMALLINT NOT NULL DEFAULT 2,
  status         identity.approval_status NOT NULL DEFAULT 'pending',
  requested_by   BIGINT NOT NULL REFERENCES identity.staff,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  branch         ledger.branch_code NOT NULL
);

CREATE TABLE identity.approval_votes (
  approval_id BIGINT NOT NULL REFERENCES identity.approvals,
  staff_id    BIGINT NOT NULL REFERENCES identity.staff,
  decision    identity.approval_decision NOT NULL,   -- approve | reject
  auth_method identity.auth_method NOT NULL,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (approval_id, staff_id)
);
```

**승인자 ≠ 요청자를 DB가 강제한다.** 트리거로 `approval_votes.staff_id <> approvals.requested_by`를 검사한다. `PRIMARY KEY (approval_id, staff_id)`가 한 사람의 중복 투표를 막는다.

### 5-1. 승인을 실제로 소비하는 함수

**테이블만으로는 4-eyes가 성립하지 않는다.** 거래에 `approval_id`를 적어 넣기만 하면 그 값이 유효한지 아무도 확인하지 않는다. `identity.consume_approval()`이 실행 시점에 여섯 가지를 검사한다.

```sql
PERFORM identity.consume_approval(p_approval_id, 'adjustment', p_branch, v_args);
```

| # | 검사 | 막는 것 |
|---|---|---|
| 1 | 행 `FOR UPDATE` 잠금 | 동시 소비 |
| 2 | `status = 'pending'` · 미만료 | 재사용 · 만료 승인 |
| 3 | `subject_kind` 일치 | 출금 승인으로 차액 조정 집행 |
| 4 | `branch` 일치 | 다른 지점 승인 전용 |
| 5 | `payload` **jsonb 동등** | 작은 금액 승인 → 큰 금액 집행 |
| 6 | `approve` 표 ≥ `required_count` | 정족수 미달 집행 |

통과하면 `status`를 `approved`로 전이시킨다. **승인은 1회용**이다 — 두 번째 호출은 2번에서 실패한다.

`payload`는 실행될 연산이 만드는 args JSONB와 **정확히 같아야 한다.** 승인 화면에 표시된 내용과 실제 집행 내용이 다를 수 없다.

승인 대상:

| 대상 | 조건 |
|---|---|
| 출금 · 지점이체 | `branch_config.approval_threshold_minor` 이상 |
| 밸런싱 차액 조정 | **금액 무관 항상** |
| 기간 정산 (`settle`) | **항상** |
| 기간 동결 (`freeze`) | 선택 (`p_approval_id` 전달 시 검증) |
| 계좌 상태 변경 | 정책에 따름 |

API는 승인 대기 시 `202 Accepted` + `approval-required`를 반환하고 **거래를 생성하지 않는다.**

---

## 6. 저장 데이터 보호

### 6-1. KYC 이미지 — DB에서 제거

현행은 여권·서명·현장 사진을 Firestore 문서 필드에 직접 저장한다 (`passportPhoto`, `signaturePhoto`, `sitePhoto`).

**신규:**

```
객체 스토리지 (비공개 버킷)
  └── KMS 봉투 암호화 (객체별 DEK)
        └── DB에는 참조 키 + SHA-256 해시만 저장
              └── 조회는 단기 서명 URL (수명 5분 이하)
                    └── 모든 접근을 audit 로그에 기록
```

DB 침해만으로 KYC 원본이 유출되지 않는다.

### 6-2. 필드 레벨 암호화

`passport_no` 등 식별 정보는 **애플리케이션 계층**에서 KMS DEK로 암호화한다. DB 관리자가 평문을 볼 수 없다.

> `pgcrypto`로 DB 안에서 암호화하면 키가 DB 세션을 지나가므로 DB 관리자 위협 모델에 대응하지 못한다.

### 6-3. 시크릿 관리

| 대상 | 저장소 |
|---|---|
| DB 접속 정보 · KMS 키 ID · 외부 API 토큰 | KMS / Vault |
| TOTP 시크릿 | DB (봉투 암호화) |
| 페퍼 | Vault 또는 HSM |
| **클라이언트 번들** | **아무것도 없음** |

### 6-4. 레거시 아카이브 — 이관이 끝나면 파기한다

`archive.firestore_snapshot`은 현행 Firestore 문서를 **원본 그대로** 담는다. 즉 위 6-1~6-3의 전환을 통째로 무효화하는 것들이 그 안에 남는다.

| 필드 | 현행 상태 | 신규 대응 |
|---|---|---|
| `staff.pin` | 평문 (`seedDB()` — 데모 전원 `'1234'`) | Argon2id 해시 |
| `staff.totpSecret` | 평문, 브라우저를 통과 (`index.html:4352-4353`) | KMS 봉투 암호화 |
| `accounts.passport` | 평문 | 애플리케이션 계층 암호화 |
| `accounts.*Photo` | Firestore 필드에 직접 | 객체 스토리지 참조 |

두 가지를 지킨다.

1. **조회 권한을 분리한다.** `archive`는 `ledger_read`에 주지 않는다. 전용 `archive_reader` 역할만 본다. (이전 판은 `GRANT SELECT ON ALL TABLES IN SCHEMA archive TO ledger_read`였다 — 인증 비밀값을 리포팅 역할에 열어 준 셈이다.)
2. **이관 검증이 끝나면 파기한다.**

```sql
SELECT archive.scrub_secrets();   -- 되돌릴 수 없다
SELECT * FROM archive.v_unscrubbed;   -- 0행이어야 운영 준비 완료
```

인증 비밀값은 삭제하고, KYC 식별정보는 `had_passport: true` 같은 **존재 여부만** 남긴다. 이관 감사에 필요한 것은 "그 필드가 있었다"는 사실이지 값이 아니다.

---

## 7. 게임 무결성

### 7-1. RNG

현행은 `Math.random()`으로 클라이언트가 결과를 만든다. 페이아웃 기록 권한도 클라이언트에 있다.

**신규: 서버가 결과를 생성하고, commit-reveal로 사후 검증 가능하게 한다.**

```
라운드 시작 전:  서버가 server_seed 생성 → SHA-256(server_seed) 공개
베팅 마감:       클라이언트 seed 수집
결과 생성:       HMAC(server_seed, client_seed || nonce) → 결과
라운드 종료 후:  server_seed 공개 → 누구나 해시 일치와 결과 재현을 검증
```

난수원은 OS CSPRNG를 쓴다. **규제 관할에 따라 공인 RNG 인증이 별도로 필요할 수 있다** — 기술 구현과 별개 사안이며 오픈 전 확인 대상이다.

### 7-2. 라운드 권위

현행은 단말마다 `setInterval`로 각자 라운드를 돌린다. **"같은 테이블"이라는 개념 자체가 성립하지 않는다.**

신규: 테이블당 상주 single-writer 워커가 라운드를 생성하고, 모든 단말이 같은 라운드를 구독한다.

---

## 8. 애플리케이션 계층 방어

| 위협 | 대응 |
|---|---|
| 저장형 XSS | 출력 이스케이프 전수 적용. `onclick` 문자열 삽입 폐기, `data-*` + 이벤트 위임으로 교체. CSP 헤더 |
| SQL 인젝션 | 파라미터 바인딩. 문자열 결합 금지 |
| 입력 검증 | 스키마 기반 검증. 계좌 코드 `^[A-Z0-9]{4,16}$` 등 형식 제약을 API와 DB 양쪽에서 |
| 무차별 대입 | 계정·IP·단말 단위 rate limit + 지수 백오프 잠금 |
| CSRF | 토큰 기반 인증 + `SameSite` 쿠키 |
| 전송 | TLS 1.3 강제. HSTS |

### Telegram 연동 — 계좌 탈취 경로 차단

현행 `telegramWebhook`은 `/start SE7419`를 보낸 **누구든** 그 계좌에 자기 chat을 연결한다 (`functions/index.js:212-232`). 계좌 ID가 짧고 규칙적이라 열거가 쉽다. 출금 인증 메시지가 이 채널로 가므로 계좌 탈취로 이어진다.

**신규 4항목 중 4번만 적용됐다:**

| # | 대응 | 상태 |
|---|---|---|
| 1 | 계좌 ID를 직접 받지 않는다. **로그인 세션에서 발급한 1회용 단기 토큰**만 페이로드로 허용 | **미해결** |
| 2 | 토큰은 사용 즉시 소멸, 수명 5분 | **미해결** |
| 3 | chat 단위 rate limit | **미해결** |
| 4 | 문서 ID 조립 전 형식 검증 | **[Track A] 완료** — `/^[A-Za-z0-9]{4,16}$/` (`functions/index.js:219`) |

> **⚠ 4번은 위 위협을 막지 않는다.** 형식 검증이 닫은 것은 **경로 조작**이다 — 검증 전에는 `/` 를 포함한 값이 Firestore 클라이언트에 의해 경로 구분자로 파싱돼 `telegramLinks` 밖의 문서를 노릴 수 있었다. 그건 실재하는 결함이었고 닫혔다.
>
> 그러나 **계좌 탈취 경로는 그대로다.** `SE7419`는 형식 검증을 정상 통과하는 값이고, 공격자에게 필요한 것은 유효한 계좌 ID 하나를 추측하는 것뿐이다. 1~3번이 없으면 소유권 증명이 여전히 존재하지 않는다.

---

## 9. 감사

### 9-1. 이중 기록

| 대상 | 내용 |
|---|---|
| `ledger.transactions` | 자금 사건 — 행위자·인증 방식·단말·시각·해시 체인 |
| `audit.access_log` | 조회·인증 시도·권한 변경·KYC 접근 |

`audit` 스키마는 **별도 역할**이 쓰며, 애플리케이션 역할은 삭제 권한이 없다. 필요하면 별도 인스턴스로 분리한다.

### 9-2. 변조 탐지

지점별 해시 체인 + 일 단위 외부 앵커링. [03-ledger-model.md](03-ledger-model.md) 7-5절.

### 9-3. 보존

규제 관할이 요구하는 기간을 따른다. **기술 기본값이 아니라 법적 요건이 정한다** — 확정 필요 사항이다. [08-adr.md](08-adr.md) 미확정 사항 참조.

---

## 10. 인시던트 대응

| 사건 | 자동 대응 |
|---|---|
| 대사 위반 (R1/R2/R3) | **신규 거래 차단** (`503 ledger-integrity-halt`) + 즉시 호출 |
| `suspense` 잔액 ≠ 0 | 알람. 기간 마감 차단 |
| `unbalanced-transaction` 발생 | 즉시 호출. 서버 버그 신호 |
| 리프레시 토큰 재사용 감지 | 세션 계열 전체 무효화 |
| 인증 실패 급증 | rate limit 강화 + 알람 |

**돈이 새는 상태에서 계속 받는 것보다 멈추는 편이 낫다.**

---

## 11. 이전 전 체크리스트

구현 착수와 무관하게 **지금 당장** 해야 하는 것. 2026-08-14 기준 상태를 함께 표기한다.

**완료 (Track A):**

- [x] Firestore 보안 규칙을 저장소에 두고 배포 — [`firestore.rules`](../../firestore.rules). CI 경로 필터 누락으로 한동안 배포되지 않던 문제까지 수정하고 라이브에서 검증했다
- [x] `staff` 컬렉션 직접 접근 차단 + 서버 검증 로그인 경로 구축
- [x] 마스터 비밀번호 회전 및 소스 주석의 평문 제거
- [x] Telegram 계좌 ID 형식 검증 (경로 조작만 차단 — 8절 경고 참조)

**미해결 — 우선순위 순:**

- [ ] **`ERIC` 계정 TOTP 우회 제거** (`index.html:9138` · `functions/index.js:154`). 인증 인프라를 구축해 놓고 계정 하나를 열어 둔 상태다
- [ ] **`staff` 외 전 컬렉션 잠금.** 규칙 파일은 생겼으나 `accounts` · `ledger` · `members`는 여전히 무제한이다. 이것이 지금 가장 큰 노출면이며, 서버 API 없이는 완전히 닫을 수 없다
- [ ] **`partnerStaff`를 `firestore.rules`로 잠금.** 평문 비밀번호가 인증 없이 읽힌다 (P-12). `staff`와 같은 조치를 적용하면 되므로 **미해결 항목 중 가장 싸다**
- [ ] `admin` / `0000` 자동 생성 마스터 계정 제거 (`partner-admin/app.js:172` · `:185`)
- [ ] 빈 입력 폴백 제거 (`partner-admin/app.js:178-179`). `|| 'admin'` · `|| '0000'`을 지우면 끝난다 (P-02)
- [ ] `TG_APP_API_SECRET` 회전 (Git 히스토리에 존재) — 회전 여부 미확인
- [ ] Telegram 연동 1회용 토큰 도입 (8절 1~3번)
- [ ] `partner-admin/app.js` `onclick` 문자열 삽입을 `data-*` + 이벤트 위임으로 교체. 이스케이프는 적용됐으나 구조가 남아 있다
- [ ] 마스터 비밀번호 해시 이중 하드코딩 해소 (`index.html:6487` · `functions/index.js:172`). 회전 시 한쪽만 고치면 로그인이 조용히 깨진다
- [ ] 파트너 콘솔 클라이언트 측 비밀번호 비교 제거 (`partner-admin/app.js:186`)
- [ ] `balanceTotals` 쓰기 권한 제한 — 지금은 다른 컬렉션과 동일하게 열려 있다

---

**이전:** [05. API 계약](05-api-contract.md) · **다음:** [07. 마이그레이션 계획](07-migration.md)
