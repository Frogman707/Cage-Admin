# 설계 검토 2차 — 권한 · 대사 · 감사 계층 결함 등록부

> **분류**: 작업 문서 (Issue Register)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **대상**: `ddl/002` · `006` · `007` · `012` · `013` 전량 (1,589줄) + `011` 일부 + `08-adr.md`
> **상태**: 미해결 14건. **차단 4 · 높음 3 · 중간 5 · 낮음 2**
> **선행 문서**: [design-review.md](design-review.md) — DR-01~DR-23 (차단 5 · 높음 7 · 중간 9 · 낮음 2)
> **후속**: [design-review-3.md](design-review-3.md) — 3차 검토 `DR-38`~`DR-49` (차단 2 · 높음 3 · 중간 5 · 낮음 2) · [design-review-4.md](design-review-4.md) — 4차 `DR-50`~`DR-60` (차단 1) · [design-review-5.md](design-review-5.md) — 5차 `DR-61`~`DR-65` (높음 2 · 중간 2 · 낮음 1) · [design-review-6.md](design-review-6.md) — 6차 `DR-66`~`DR-72` (차단 1) · [design-review-7.md](design-review-7.md) — 7차 `DR-73`~`DR-77` (차단 0) · [design-review-8.md](design-review-8.md) — 8차 `DR-78`~`DR-82` (차단 0) · [design-review-9.md](design-review-9.md) — 9차 `DR-83`~`DR-86` (차단 0 · 높음 2 · 중간 2). 아홉 문서 합계 **86건 · 차단 13**

1차 검토([design-review.md](design-review.md))는 **원장 코어와 연산 함수**(`003`~`005`, `008`~`011`)를
중심으로 훑었다. 이 문서는 그때 얕게 지나간 **인증 · 권한 · RLS · 대사 · 감사 계층**을 전량 정독한
결과다. 두 문서를 합치면 **미해결 37건 · 차단 9건**이다.

ID는 1차와 이어진다 — `DR-24` ~ `DR-37`.

## 검토 방법

1차와 같다. 문서가 약속한 것이 DDL에 있는지, DDL이 하는 일이 문서와 같은지를 대조했다.
이번 회차에서 가장 많이 나온 유형은 **ADR이 선언한 규칙을 DDL이 지키지 않는 경우**다
(DR-24가 대표).

**확인하지 않은 것**: 실제 PostgreSQL 18 인스턴스에서의 런타임 동작. DR-27은 PostgreSQL의
생성 열 평가 시점에 대한 문서화된 동작에 근거하지만, 그것을 확인하는 테스트가 저장소에
없다 — [DR-12](design-review.md#dr-12).

---

## 1. 요약

| ID | 항목 | 등급 | 영향 | 근거 |
|---|---|---|---|---|
| [DR-24](#dr-24) | 파생 뷰 12개가 정의자 뷰 — RLS 지점 격리 우회 | **차단** | M1 | `013` 전체 · `08-adr:480` |
| [DR-25](#dr-25) | `audit` 스키마를 읽을 수 있는 역할이 존재하지 않는다 | **차단** | M1 | `012:185` · `012:188` |
| [DR-26](#dr-26) | 앵커 대조 검사 부재 + 앱이 앵커를 쓴다 → 연쇄 위조 탐지 불가 | **차단** | M1 | `013:115` · `012:190` |
| [DR-27](#dr-27) | 실사 차액 강제가 생성 열 평가 시점 때문에 죽은 코드 | **차단** | M1 | `006:27` · `006:66` |
| [DR-28](#dr-28) | R2가 INNER JOIN — 잔액 행 없는 계정을 놓친다 | 높음 | M1 | `013:49` |
| [DR-29](#dr-29) | 스크럽이 `pw` 미제거 — 평문 파트너 비밀번호 잔존 | 높음 | M5 | `007:147` · `002:6` |
| [DR-30](#dr-30) | 승인 · 교대 연산 3종에 멱등키 없음 | 높음 | M1 | `012:94-97` |
| [DR-31](#dr-31) | `approval_votes`에 RLS 없음 | 중간 | M1 | `012:150` · `012:398` |
| [DR-32](#dr-32) | `identity.sessions`에 컬럼 무제한 UPDATE 권한 | 중간 | M1 | `012:155` |
| [DR-33](#dr-33) | `op_open_account`에 재인증 인자 자체가 없다 | 중간 | M2 | `012:104` |
| [DR-34](#dr-34) | `partner_admin`에 `approval.vote` 없음 — 파트너 4-eyes 불가 | 중간 | M4 | `002:143-148` |
| [DR-35](#dr-35) | `totp_used` 정리 경로 없음 | 낮음 | M1 | `012:156` |
| [DR-36](#dr-36) | `REVOKE` · `DEFAULT PRIVILEGES` 목록에 `audit` 누락 | 낮음 | M1 | `012:52` · `012:206` |
| [DR-37](#dr-37) | R1에 지점 · 기간 분해가 없다 — 위반 위치 특정 불가 | 중간 | M1 | `013:26` |

**차단 4건은 모두 M1(Ledger + Identity) 착수 전에 해소해야 한다.** DR-24와 DR-25는 `012`를,
DR-26은 `013`과 `007`을, DR-27은 `006`을 고친다 — 전부 원장 코어보다 아래 계층이라 나중에
고치면 그 위에 쌓은 것을 되짚어야 한다.

---

## 2. 차단 항목

### DR-24

**파생 뷰 12개가 `security_invoker` 없이 정의자 뷰다 — RLS 지점 격리가 통째로 우회된다**

#### 증상

`ledger_app` 역할로 접속한 HANN 지점 직원이 `cage.v_shift_counters`를 조회하면
**NUSTAR · ONLINE의 교대 카운터까지 함께 반환된다.** `012`의 지점 스코프 RLS 정책이
파생 뷰 한 겹으로 전부 새어 나간다.

#### 근거

[`08-adr.md:480`](08-adr.md#L480)이 규칙을 명시한다.

> 모든 뷰에 `security_invoker = true`를 붙인다 — 정의자 뷰는 소유자 권한으로 실행되어
> RLS를 통째로 우회한다

[`06-security.md:257`](06-security.md#L257)도 같은 말을 한다 — **"뷰에는 `security_invoker = true`가 필수다."**

실제로 붙어 있는 뷰는 **둘뿐이다**.

| 뷰 | 파일:줄 | `security_invoker` |
|---|---|---|
| `ledger.v_account_balances` | [`003:156`](ddl/003_accounts.sql#L156) | ✅ |
| `ledger.v_transaction_detail` | [`004:526`](ddl/004_ledger.sql#L526) | ✅ |
| `013`의 뷰 12개 전부 | [`013`](ddl/013_reconciliation.sql) | ❌ |
| `archive.v_unscrubbed` | [`007:129`](ddl/007_outbox_audit.sql#L129) | ❌ |

그중 **넷이 `ledger_app`에 GRANT되어 있고**([`013:382-386`](ddl/013_reconciliation.sql#L382)),
전부 RLS가 켜진 테이블을 읽는다.

| 뷰 | 읽는 RLS 테이블 |
|---|---|
| `cage.v_shift_counters` | `ledger.entries` · `cage.chip_inventory_events` · `cage.rolling_events` · `ledger.accounting_periods` |
| `cage.v_branch_rolling_total` | `cage.rolling_events` · `cage.games` |
| `cage.v_main_cage_total` | `cage.main_cage_events` |
| `cage.v_game_win_loss` | `ledger.entries` · `cage.games` |

#### 왜 심각한가

[`012:221-226`](ddl/012_roles_and_grants.sql#L221)이 `FORCE ROW LEVEL SECURITY`를 의도적으로
쓰지 않는다고 명시한다. 따라서 **뷰 소유자는 RLS를 통과한다.** 정의자 뷰는 소유자 권한으로
실행되므로, `ledger_app`이 뷰를 거치는 순간 지점 필터가 사라진다.

이건 설정 실수가 아니라 **ADR이 예측하고 경고한 바로 그 실패다.** ADR을 쓴 뒤 `013`을
작성하면서 적용을 빠뜨렸다. 같은 실수가 `013` 이후 추가되는 모든 뷰에서 반복될 수 있다.

#### 개선 방안

1. `013`의 뷰 12개와 [`007:129`](ddl/007_outbox_audit.sql#L129) `archive.v_unscrubbed`에
   `WITH (security_invoker = true)` 추가

2. **⚠️ 함께 고쳐야 한다 — 단독 수정은 런타임 실패를 만든다.**

   `ledger.v_integrity_status`도 현재 정의자 뷰라서, `ledger_app`이 하위 `v_check_*` 뷰의
   SELECT 권한 **없이도** 통과하고 있다([`013:374-380`](ddl/013_reconciliation.sql#L374)은
   하위 뷰를 `ledger_read`에만 부여한다). `security_invoker`를 붙이는 순간
   `ledger.integrity_ok()`([`013:244`](ddl/013_reconciliation.sql#L244))가
   `permission denied`로 깨진다.

   ```sql
   -- 013 의 GRANT 절에 추가
   GRANT SELECT ON
     ledger.v_check_double_entry, ledger.v_check_balance_projection,
     ledger.v_check_hash_chain, ledger.v_check_suspense,
     ledger.v_check_entry_branch, ledger.v_check_posting_rules,
     cage.v_check_rolling_projection
   TO ledger_app;
   ```

   또는 `integrity_ok()`를 `SECURITY DEFINER`로 바꾸고 하위 뷰는 `ledger_read`에만 남긴다
   — [`013:107-110`](ddl/013_reconciliation.sql#L107)의 `verify_hash_chain()`이 이미
   같은 이유로 정의자 함수다. **이쪽이 권장이다.** 하위 뷰 12개를 앱에 여는 것보다
   판정 결과 하나만 돌려주는 쪽이 노출면이 작다.

3. `ledger` · `cage` 스키마에 새 뷰를 만들 때 `security_invoker`가 붙었는지 검사하는
   대사 쿼리를 추가한다 — 사람이 지키는 규칙은 다시 빠진다 (ADR-014와 같은 논리).

   ```sql
   SELECT c.relnamespace::regnamespace AS schema, c.relname
     FROM pg_class c
    WHERE c.relkind = 'v'
      AND c.relnamespace::regnamespace::text IN ('ledger','cage','archive')
      AND NOT COALESCE((SELECT option_value::boolean
                          FROM pg_options_to_table(c.reloptions)
                         WHERE option_name = 'security_invoker'), FALSE);
   ```

#### 검증

`ledger_app`으로 `SET LOCAL app.staff_id`를 HANN 전용 직원으로 설정한 뒤
`SELECT DISTINCT branch FROM cage.v_shift_counters` — `HANN` 한 행만 나와야 한다.
현재는 세 지점이 전부 나온다.

---

### DR-25

**`audit` 스키마를 읽을 수 있는 역할이 존재하지 않는다**

#### 증상

`audit.access_log`(인증 시도 · 권한 변경 · KYC 열람)와 `audit.chain_anchors`(체인 앵커)를
**슈퍼유저 외에는 아무도 조회할 수 없다.** 감사 추적을 만들어 놓고 감사관에게 주지 않는다.

#### 근거

[`012:50`](ddl/012_roles_and_grants.sql#L50)이 전 스키마를 PUBLIC에서 회수한다.

```sql
REVOKE ALL ON SCHEMA ledger, cage, identity, audit, archive FROM PUBLIC;
```

이후 `audit` 스키마에 대한 권한 부여는 **한 곳뿐이다** ([`012:185-188`](ddl/012_roles_and_grants.sql#L185)).

```sql
GRANT USAGE  ON SCHEMA audit TO audit_writer;
GRANT INSERT ON audit.access_log, audit.chain_anchors TO audit_writer;
GRANT USAGE  ON ALL SEQUENCES IN SCHEMA audit TO audit_writer;
-- SELECT · UPDATE · DELETE 를 주지 않는다. 앱은 감사 로그를 읽거나 지울 수 없다.
```

`ledger_read`는 [`012:165`](ddl/012_roles_and_grants.sql#L165)에서 `ledger` · `cage`만,
[`012:174`](ddl/012_roles_and_grants.sql#L174)에서 `identity`만 받는다.
`archive_reader`는 [`012:195`](ddl/012_roles_and_grants.sql#L195)에서 `archive`만 받는다.
**`audit`에 USAGE를 가진 역할은 `audit_writer` 하나이고 그 역할은 INSERT만 갖는다.**

추가로 [`002:107`](ddl/002_identity.sql#L107)이 RBAC 역할 `auditor`("조회 전용")를 정의하지만,
[`002:149`](ddl/002_identity.sql#L149)가 **"auditor 는 권한을 갖지 않는다. 조회는 ledger_read
역할과 RLS 가 담당한다"** 고 못 박는다 — 그런데 `ledger_read`가 `audit`을 못 본다.

#### 왜 심각한가

- **감사 로그의 목적이 무산된다.** 사건 조사 시 슈퍼유저 자격증명을 꺼내야 하는데,
  그건 정확히 감사가 감시해야 할 대상이다
- **DR-26의 앵커 대조 검사를 구현할 수 없다.** `audit.chain_anchors`를 읽을 역할이 없으므로
  대사 뷰를 만들어도 조회 주체가 없다
- [`06-security.md`](06-security.md)가 설계한 감사 체계 전체가 접근 불가 상태로 배포된다

#### 개선 방안

`audit_reader` 역할을 신설한다. `archive_reader`와 같은 패턴이다.

```sql
-- 012 의 역할 배열에 'audit_reader' 추가
GRANT USAGE  ON SCHEMA audit TO audit_reader;
GRANT SELECT ON audit.access_log, audit.chain_anchors TO audit_reader;
-- INSERT · UPDATE · DELETE 는 주지 않는다. 읽기와 쓰기를 분리한다.

ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT ON TABLES TO audit_reader;

COMMENT ON ROLE audit_reader IS
  '감사 로그 · 체인 앵커 조회 전용. 감사 담당자와 대사 배치에만 부여. INSERT 권한 없음.';
```

`ledger_read`에 합치지 **않는** 이유: 리포팅 서비스는 상시 접속하고, 감사 로그에는 인증 시도와
KYC 열람 기록이 들어간다. 두 접근을 같은 자격증명으로 묶으면 감사 로그 조회 자체가
감사되지 않는다.

부수 결정: [`002:107`](ddl/002_identity.sql#L107)의 RBAC `auditor`와 DB 역할 `audit_reader`의
관계를 [`06-security.md`](06-security.md)에 명시한다. 지금은 이름만 비슷하고 연결이 없다.

#### 검증

`audit_reader`로 접속해 `SELECT count(*) FROM audit.access_log` — 성공해야 한다.
`ledger_app`으로 같은 쿼리 — `permission denied for schema audit`이어야 한다.

---

### DR-26

**앵커 대조 검사가 없고, 앱이 앵커를 직접 쓴다 — 연쇄 재작성 위조를 탐지할 수 없다**

#### 증상

DB 쓰기 권한을 쥔 공격자가 과거 거래를 고쳐도 **R1~R7이 전부 통과한다.**

#### 근거

해시 체인 검사는 두 겹이다.

**R3(a) 링크 검사** — [`013:67-85`](ddl/013_reconciliation.sql#L67)

```sql
lag(t.hash) OVER (PARTITION BY t.branch ORDER BY t.id) AS expected_prev
...
WHEN o.expected_prev IS NOT NULL THEN o.prev_hash = o.expected_prev
```

**R3(b) 내용 재계산** — [`013:113-121`](ddl/013_reconciliation.sql#L113)

```sql
sha256(t.prev_hash || convert_to(ledger.canonical_digest(t.id), 'UTF8'))
```

R3(b)는 **저장된 `prev_hash`를 그대로 입력으로 쓴다.** 따라서 공격 절차는:

1. 거래 N의 내용을 고친다
2. N의 `hash`를 `canonical_digest(N)`으로 재계산해 덮는다 → **R3(b) 통과**
3. N+1의 `prev_hash`를 N의 새 `hash`로 갱신한다 → **R3(a) 통과**
4. N+1의 `hash`도 재계산한다 → **R3(b) 통과**
5. 마지막 거래까지 3~4를 반복한다

체인 전체가 자기 정합적이 되어 **R3(a)·R3(b) 어느 쪽도 잡지 못한다.**

[`08-adr.md` ADR-006](08-adr.md#L192)이 이 시나리오를 예상하고 답을 준비했다.

> 일 단위로 각 지점 체인 헤드를 외부 저장소에 서명·보관한다.
> **DB 전체가 침해되어도 과거 변조를 탐지할 수 있다.**

그런데 실제로는:

| 필요한 것 | 현재 상태 |
|---|---|
| 앵커 저장 테이블 | ✅ [`007:90`](ddl/007_outbox_audit.sql#L90) `audit.chain_anchors` |
| 앵커 기록 절차 | ⚠️ [`013:421-424`](ddl/013_reconciliation.sql#L421) 주석의 수동 SQL만 |
| **앵커 대조 검사** | ❌ **R1~R7에 없다** |
| 앵커를 읽을 역할 | ❌ [DR-25](#dr-25) |
| 앵커 쓰기 주체 분리 | ❌ [`012:190`](ddl/012_roles_and_grants.sql#L190) |

마지막 항목이 특히 나쁘다.

```sql
-- 012:190
GRANT audit_writer TO ledger_app;
```

역할 상속 기본값이 `INHERIT`이므로 **`ledger_app`이 `audit.chain_anchors`에 INSERT할 수 있다.**
침해된 앱 자격증명 하나로 위조와 앵커를 함께 만들 수 있다면 **외부 앵커의 독립성이 성립하지 않는다.**

#### 왜 심각한가

해시 체인은 이 설계에서 감사 추적의 최종 근거다. 위 조건에서는 **체인이 "누가 언제 무엇을
했는가"를 증명하지 못한다.** 분쟁 시 원장을 신뢰할 수 없다는 뜻이고,
[README.md](README.md)가 선언한 "실서비스 · 큰 금액" 전제와 정면으로 충돌한다.

#### 개선 방안

**(1) R8 — 앵커 대조 검사를 추가한다.**

```sql
-- 013 에 추가
CREATE VIEW ledger.v_check_chain_anchor WITH (security_invoker = true) AS
SELECT
  a.branch,
  a.business_date,
  a.last_tx_id,
  a.chain_hash                AS anchored_hash,
  t.hash                      AS current_hash,
  a.anchored_at,
  t.hash = a.chain_hash       AS ok
FROM audit.chain_anchors a
JOIN ledger.transactions t ON t.id = a.last_tx_id;

COMMENT ON VIEW ledger.v_check_chain_anchor IS
  'R8. ok=false 는 앵커 시점 이후 과거 거래가 재작성됐다는 뜻이다. '
  'R3(a)·R3(b) 는 연쇄 재작성을 통과시키므로 위조를 잡는 것은 이 검사뿐이다.';
```

`v_integrity_status`에 `R8_chain_anchor` 행을 추가한다.

**(2) 앵커 쓰기 주체를 앱에서 분리한다.**

```sql
-- 012:186 에서 chain_anchors 를 뺀다
GRANT INSERT ON audit.access_log TO audit_writer;

-- 앵커 전용 역할. 배치 잡에만 부여하고 애플리케이션 서비스 계정에는 주지 않는다.
GRANT USAGE  ON SCHEMA audit TO audit_anchorer;
GRANT INSERT ON audit.chain_anchors TO audit_anchorer;
```

`GRANT audit_writer TO ledger_app`([`012:190`](ddl/012_roles_and_grants.sql#L190))은 유지한다
— 앱은 `access_log`를 계속 써야 한다. 앵커만 떼면 된다.

**(3) 외부 서명을 실제로 정의한다.**

[`007:97`](ddl/007_outbox_audit.sql#L97) `anchor_ref TEXT`가 "외부 저장소 위치 · 서명 참조"라고만
되어 있다. **무엇에 어떻게 서명하는지가 어디에도 없다.** DB 안에만 있는 앵커는 DB를 침해한
공격자가 함께 고칠 수 있으므로 (1)만으로는 부족하다. 최소한 다음을 정한다.

- 서명 대상: `(branch, business_date, last_tx_id, chain_hash)` 정규 직렬화
- 키 보관: DB와 분리된 KMS (앱 자격증명으로 접근 불가)
- 보관 위치: append-only 외부 저장소
- 대조 주기: 야간 배치가 R3(b) 통과 후 서명 검증까지 수행

이건 [`06-security.md`](06-security.md)에 새 절이 필요하다.

**(4) [DR-25](#dr-25)를 먼저 해소한다.** 앵커를 읽을 역할이 없으면 R8이 조회 주체를 갖지 못한다.

#### 검증

`ledger_app` 자격증명으로 `INSERT INTO audit.chain_anchors ...` — `permission denied`여야 한다.
앵커 기록 후 임의 거래의 `hash`·`prev_hash`를 연쇄 재작성한 뒤
`SELECT * FROM ledger.v_check_chain_anchor WHERE NOT ok` — 행이 나와야 한다.
(현재는 R3(a)·R3(b) 모두 통과하고 잡히지 않는다.)

---

### DR-27

**실사 차액 강제가 생성 열 평가 시점 때문에 죽은 코드다**

#### 증상

밸런싱(실사)에서 차액이 발생해도 **조정 거래 없이 검증 완료할 수 있다.**
[`006:46`](ddl/006_periods_balancing.sql#L46)의 주석 — "차액이 조용히 묻히지 않는다" — 과 정반대다.

#### 근거

컬럼은 생성 열이다 ([`006:27-28`](ddl/006_periods_balancing.sql#L27)).

```sql
variance_minor BIGINT GENERATED ALWAYS AS
                 (counted_total_minor - system_total_minor) STORED,
```

강제는 `BEFORE` 트리거다 ([`006:66-68`](ddl/006_periods_balancing.sql#L66)).

```sql
CREATE TRIGGER balancing_variance_adjusted
  BEFORE INSERT OR UPDATE ON cage.balancing_counts
  FOR EACH ROW EXECUTE FUNCTION cage.assert_variance_adjusted();
```

트리거 본문 ([`006:54-56`](ddl/006_periods_balancing.sql#L54)):

```sql
IF NEW.verified_by IS NOT NULL
   AND NEW.variance_minor <> 0
   AND NEW.adjustment_tx_id IS NULL THEN
```

**PostgreSQL은 STORED 생성 열을 BEFORE 행 트리거가 끝난 뒤에 계산한다.** 따라서 트리거
안에서 `NEW.variance_minor`는 `NULL`이고, `NULL <> 0`은 `NULL`이며,
`IF` 조건은 **어떤 입력에서도 참이 되지 않는다.**

#### 왜 심각한가

- 실사 차액 흡수는 이 설계가 현행 `memberCompanyDiffVal`(차액을 스칼라에 숫자만 저장)을
  대체하겠다고 내세운 개선 그 자체다 ([`006:9`](ddl/006_periods_balancing.sql#L9))
- 실패가 **조용하다.** 예외도 경고도 없고, 스키마를 읽으면 보호되는 것처럼 보인다
- R5(`v_check_suspense`)는 `suspense` 잔액만 본다. 차액이 `suspense`를 거치지 않고
  묻히면 어떤 대사에도 걸리지 않는다
- [DR-01](design-review.md#dr-01)(suspense 해소 경로 부재)과 겹친다 — 정상 경로가 막혀 있는데
  우회 경로의 방어도 죽어 있다

#### 개선 방안

두 가지 중 하나. **(A)를 권장한다** — 트리거를 BEFORE에 두면 이 함정이 계속 남는다.

**(A) 트리거 안에서 직접 계산한다.**

```sql
CREATE OR REPLACE FUNCTION cage.assert_variance_adjusted() RETURNS trigger
LANGUAGE plpgsql
SET search_path = cage, pg_temp
AS $$
DECLARE
  -- 생성 열은 BEFORE 트리거 이후에 계산된다. NEW.variance_minor 를 읽으면
  -- 항상 NULL 이므로 여기서 같은 식을 직접 평가한다.
  v_variance BIGINT := NEW.counted_total_minor - NEW.system_total_minor;
BEGIN
  IF NEW.verified_by IS NOT NULL
     AND v_variance <> 0
     AND NEW.adjustment_tx_id IS NULL THEN
    RAISE EXCEPTION
      'balancing variance % 가 있는데 조정 거래가 없다. adjustment 거래를 먼저 기록하라.',
      v_variance
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
  RETURN NEW;
END;
$$;
```

**(B) `AFTER` 제약 트리거로 옮긴다.** 생성 열이 계산된 뒤에 실행되므로 `NEW.variance_minor`를
그대로 읽을 수 있다. 다만 `op_record_balancing`이 실사 기록과 조정 거래를 같은 트랜잭션에서
만들므로([`011:126-128`](ddl/011_operations_admin.sql#L126)) `DEFERRABLE INITIALLY DEFERRED`가
필요하고, 그러면 ADR-005의 지연 제약 트리거 목록에 항목이 하나 늘어난다.

**공통으로 필요한 것**: 같은 유형의 실수를 저장소 전체에서 찾는다. `GENERATED ALWAYS AS ...
STORED` 컬럼을 BEFORE 트리거에서 참조하는 곳이 여기 말고 또 있는지 확인해야 한다.

#### 검증

```sql
-- 차액 있음 + 검증자 있음 + 조정 거래 없음 → 예외가 나야 한다
INSERT INTO cage.balancing_counts
  (branch, business_date, count_kind, denomination_counts,
   counted_total_minor, system_total_minor, counted_by, verified_by)
VALUES ('HANN', current_date, 'cash', '{"1000": 1}'::jsonb,
        100000, 90000, 1, 2);
```

현재는 이 INSERT가 **성공한다.** 수정 후에는
`object_not_in_prerequisite_state`로 거부돼야 한다.

---

## 3. 높음 이하

### DR-28

**R2가 INNER JOIN이라 잔액 행이 없는 계정을 대사에서 놓친다** — 높음

[`013:47-49`](ddl/013_reconciliation.sql#L47):

```sql
FROM ledger.accounts a
JOIN ledger.parties p          ON p.id = a.party_id
JOIN ledger.account_balances b ON b.account_id = a.id   -- INNER
```

`account_balances` 행이 없는 계정은 결과에서 **통째로 빠진다.** 그런데 "분개는 있는데 잔액 행이
없다"는 정확히 프로젝션이 깨진 대표 사례다. R2가 자기가 잡아야 할 것을 못 잡는다.

**개선**: `LEFT JOIN` + `COALESCE(b.balance_minor, 0)`. 잔액 행 부재가 `variance_minor <> 0`으로
드러나야 한다. 계정 생성 시 잔액 행이 항상 함께 생긴다는 보장이 `003`에 있더라도, 그 보장이
깨진 상태를 탐지하는 것이 R2의 존재 이유다.

---

### DR-29

**`scrub_secrets()`가 `pw`를 지우지 않는다 — 평문 파트너 비밀번호가 아카이브에 영구 잔존** — 높음

[`002:6`](ddl/002_identity.sql#L6)이 현행 스키마를 명시한다.

```
partnerStaff/{id} { id, pw, name, role }    partner-admin/app.js:170-172
```

[`007:147-149`](ddl/007_outbox_audit.sql#L147)의 제거 대상:

```sql
- 'pin' - 'totpSecret' - 'withdrawPw'
- 'passport' - 'passportNo' - 'passportPhoto'
- 'sitePhoto' - 'signaturePhoto'
```

**`pw`가 없다.** [`007:150-158`](ddl/007_outbox_audit.sql#L150)의 `had_*` 플래그에도 없어서
**남아 있다는 사실조차 기록되지 않는다.**

[`007:108-115`](ddl/007_outbox_audit.sql#L108)의 경고가 정확히 이 상황을 예상했다 —
"아카이브에 평문 원본이 남으면 그 전환이 무의미해진다."

**개선**: 제거 목록에 `'pw'` 추가, `had_partner_pw` 플래그 추가. 더 나아가 **필드 목록을
화이트리스트가 아니라 블랙리스트로 두는 방식 자체를 재검토한다** — 현행 컬렉션 33종의
필드를 전수 조사해 비밀값 후보를 빠짐없이 열거해야 하고, 하나라도 빠지면 조용히 남는다.
`archive.migration_audit`에 "스크럽 대상 필드 목록을 어떻게 도출했는가"를 남기는 편이 안전하다.

관련: [M11](00-system-map.md) 단말 인벤토리, [DR-15](design-review.md#dr-15) 파트너 운영자 가시성.

---

### DR-30

**승인 · 교대 연산 3종에 멱등키가 없다** — 높음

자금 연산은 전부 첫 인자가 `p_idempotency_key TEXT`인데
([`012:61-89`](ddl/012_roles_and_grants.sql#L61)) 다음 셋만 빠졌다
([`012:94-97`](ddl/012_roles_and_grants.sql#L94)).

| 함수 | 시그니처 첫 인자 | 재시도 시 결과 |
|---|---|---|
| `identity.op_request_approval` | `BIGINT` (staff_id) | **승인 요청 중복 생성** — 같은 건에 승인 두 벌 |
| `identity.op_cast_vote` | `BIGINT` (staff_id) | `approval_votes` PK 충돌 → raw `23505` |
| `identity.op_shift_event` | `BIGINT` (staff_id) | **교대 기록 중복** — `shift_events` PK가 `id`뿐이라 막을 게 없다 |

`op_cast_vote`의 `23505`는 [`05-api-contract.md` §7](05-api-contract.md)의 오류 표에 없으므로
클라이언트가 해석할 수 없는 500으로 나간다.

승인 요청 중복이 특히 나쁘다 — 같은 출금 건에 승인 두 개가 생기면 각각 2표를 모아
**같은 요청을 두 번 실행할 수 있는 승인권**이 된다. `consume_approval()`은 승인 하나를
1회용으로 소비하지만, **승인이 둘이면 소비도 두 번 가능하다.**

**개선**: 셋 다 `p_idempotency_key TEXT`를 첫 인자로 추가하고
`ledger.begin_idempotent()`를 태운다. 자연 멱등키 후보:

- `op_request_approval` → 호출자 제공 키 (요청 페이로드가 자유롭다)
- `op_cast_vote` → `vote:{approval_id}:{staff_id}` (자연키가 명확하다)
- `op_shift_event` → 호출자 제공 키

관련: [DR-04](design-review.md#dr-04) 멱등키 만료 모순, [DR-19](design-review.md#dr-19) 파생 멱등키.

---

### DR-31

**`identity.approval_votes`에 RLS가 없다** — 중간

[`012:398-400`](ddl/012_roles_and_grants.sql#L398)이 `identity.approvals`에만 지점 스코프
정책을 붙인다. `approval_votes`는 [`012:150`](ddl/012_roles_and_grants.sql#L150)에서
`ledger_app`에 SELECT가 부여되지만 RLS가 켜져 있지 않다 —
**전 지점의 승인 투표 내역이 조회된다.**

승인 본문은 가려지고 투표만 보이므로 유출 규모는 크지 않지만,
"누가 무엇을 승인했는가"는 감사 대상 정보다. `approvals`를 가리는 이유가 그대로 적용된다.

**개선**:

```sql
ALTER TABLE identity.approval_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_branch_scope ON identity.approval_votes FOR SELECT TO ledger_app
  USING (EXISTS (SELECT 1 FROM identity.approvals a
                  WHERE a.id = approval_id
                    AND a.branch = ANY (ledger.current_branches())));
```

`cage.rolling_events`가 게임 경유로 지점을 따르는 방식([`012:316`](ddl/012_roles_and_grants.sql#L316))과
같은 패턴이다.

---

### DR-32

**`ledger_app`이 `identity.sessions`에 컬럼 무제한 UPDATE 권한을 갖는다** — 중간

[`012:155`](ddl/012_roles_and_grants.sql#L155):

```sql
GRANT SELECT, INSERT, UPDATE ON identity.sessions TO ledger_app;
```

앱이 인증 흐름을 담당하므로 세션 발급·갱신·무효화는 필요하다. 그러나 컬럼 제한이 없어
**`staff_id`와 `refresh_hash`를 임의로 바꿀 수 있다.** 앱 버그 하나로 세션이 다른 직원에게
귀속될 수 있고, 그 직원 ID가 그대로 `app.staff_id`와 감사 로그에 실린다.

**개선**: 컬럼 단위로 좁힌다.

```sql
GRANT SELECT, INSERT ON identity.sessions TO ledger_app;
GRANT UPDATE (revoked_at, revoked_reason) ON identity.sessions TO ledger_app;
```

리프레시 토큰 회전은 "기존 행 revoke + 새 행 INSERT"로 표현한다 — 어차피
[`002:164`](ddl/002_identity.sql#L164)의 `refresh_family` 설계가 그 형태를 전제한다.
`sessions` 행이 append-only가 되면 재사용 감지 이력도 함께 남는다.

관련: [DR-03](design-review.md#dr-03) `identity_app` 역할 분리 — 그 작업과 함께 정리하면 좋다.

---

### DR-33

**`ledger.op_open_account`에 재인증 인자 자체가 없다** — 중간

[`012:104`](ddl/012_roles_and_grants.sql#L104):

```sql
ledger.op_open_account(TEXT, BIGINT, ledger.branch_code, TEXT, TEXT, JSONB, TEXT)
```

다른 모든 `op_*`는 3번째 인자가 `identity.auth_method`인데 **이것만 없다.**
계정 개설은 이후 모든 자금 이동의 출발점이고, 유령 계정 생성은 자금 유출의 표준 수법이다.

관련: [DR-14](design-review.md#dr-14)(`op_deposit`에 step-up 없음)와 같은 계열이지만
이쪽이 더 나쁘다 — `op_deposit`은 인자는 받고 검사만 안 하는데, 이건 **인자가 없어서
`transactions.auth_method`에 무엇을 기록할지조차 정의되지 않는다.**

**개선**: [DR-03](design-review.md#dr-03)의 `p_step_up_id BIGINT` 도입 시 함께 추가한다.
계정 개설을 4-eyes 대상으로 올릴지는 사업 결정이다 —
[`002:139`](ddl/002_identity.sql#L139)이 `account.open`을 `cage_manager`와 `partner_admin`
양쪽에 주고 있으므로, 최소한 재인증은 요구해야 한다.

---

### DR-34

**`partner_admin`에 `approval.vote` 권한이 없다 — 파트너 조직 내 4-eyes가 성립하지 않는다** — 중간

[`002:143-148`](ddl/002_identity.sql#L143):

```sql
('partner_admin', 'account.open'),
('partner_admin', 'approval.request'),
('partner_admin', 'member.point_earn'),
('partner_admin', 'member.point_convert'),
('partner_admin', 'partner.share_accrue'),
('partner_admin', 'partner.share_settle');
```

`approval.request`는 있고 **`approval.vote`가 없다.** `approval.vote`를 가진 역할은
`cage_manager` 하나뿐이다([`002:141`](ddl/002_identity.sql#L141)).

결과: 파트너 운영자가 올린 승인 요청은 **케이지 매니저만 승인할 수 있다.**
`partner.share_settle`(파트너 쉐어 정산 — 실제 자금 이동)까지 케이지 측 승인에 매달린다.

이게 의도된 통제라면 [`06-security.md`](06-security.md)에 명시해야 한다. 의도가 아니라면
파트너 조직 내 4-eyes를 성립시킬 역할 분화가 필요하다 — 예: `partner_admin`(요청) /
`partner_approver`(승인).

`op_cast_vote`가 `assert_actor_authorized(actor, v_a.branch, 'approval.vote')`를 호출하는데
([`011:83`](ddl/011_operations_admin.sql#L83)) 파트너 운영자에게는 `staff_branches` 행이
없을 가능성이 높다는 점도 함께 확인해야 한다 — 그렇다면 권한을 줘도 지점 검사에서 막힌다.

관련: [DR-07](design-review.md#dr-07)(포인트 · 쉐어 연산 함수 전무), [DR-15](design-review.md#dr-15).

---

### DR-35

**`identity.totp_used`에 정리 경로가 없다** — 낮음

[`012:156`](ddl/012_roles_and_grants.sql#L156):

```sql
GRANT SELECT, INSERT ON identity.totp_used TO ledger_app;
```

DELETE 권한을 가진 역할이 **아무도 없다.** 직원 × 30초 스텝으로 행이 무한 증가한다.
RFC 6238 재사용 차단은 허용 창(±1 스텝) 밖의 기록을 보관할 이유가 없다.

**개선**: 보존 창을 지나면 지우는 유지보수 함수를 추가하고
([`013:427`](ddl/013_reconciliation.sql#L427)의 `purge_expired_idempotency()`와 같은 자리),
전용 유지보수 역할에만 EXECUTE를 준다.

---

### DR-36

**`REVOKE` · `ALTER DEFAULT PRIVILEGES` 목록에서 `audit` 스키마만 빠졌다** — 낮음

[`012:52`](ddl/012_roles_and_grants.sql#L52):

```sql
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger, cage, identity, archive FROM PUBLIC;
--                                    ^ audit 없음
```

[`012:206`](ddl/012_roles_and_grants.sql#L206):

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA ledger, cage, identity, archive
  REVOKE ALL ON FUNCTIONS FROM PUBLIC;
--                                 ^ audit 없음
```

[`012:50`](ddl/012_roles_and_grants.sql#L50)의 `REVOKE ALL ON SCHEMA`에는 `audit`이 포함돼 있어
지금은 무해하다. 그러나 `audit` 스키마에 함수가 추가되는 순간 PUBLIC 노출 경로가 생긴다.
[DR-25](#dr-25)의 `audit_reader` 작업과 함께 정리한다.

---

### DR-37

**R1에 지점 · 기간 분해가 없다 — 위반이 떠도 위치를 특정할 수 없다** — 중간

[`013:19-26`](ddl/013_reconciliation.sql#L19):

```sql
SELECT currency, sum(amount_minor) AS imbalance_minor, ...
FROM ledger.entries
GROUP BY currency;
```

두 문제가 있다.

1. **위반 시 조사 시작점이 없다.** [`013:414`](ddl/013_reconciliation.sql#L414)의 운영 절차는
   "R1 → `v_check_double_entry` 조회"라고 하지만, 그 뷰가 주는 것은 통화별 총합 하나뿐이다.
   수백만 행 중 어디가 깨졌는지 알 수 없다
2. **상쇄되는 두 오류를 못 잡는다.** 지점 A에서 +100, 지점 B에서 −100이면 전역 합은 0이다

**개선**: 거래 단위 검사를 추가한다. 이쪽이 R1의 실질이다.

```sql
CREATE VIEW ledger.v_check_double_entry_tx WITH (security_invoker = true) AS
SELECT
  e.transaction_id,
  t.branch,
  t.business_date,
  e.currency,
  sum(e.amount_minor)     AS imbalance_minor,
  sum(e.amount_minor) = 0 AS ok
FROM ledger.entries e
JOIN ledger.transactions t ON t.id = e.transaction_id
GROUP BY e.transaction_id, t.branch, t.business_date, e.currency
HAVING sum(e.amount_minor) <> 0;
```

전역 합 뷰는 헬스체크용으로 남기고, 거래 단위 뷰는 위반 시 조사용으로 쓴다.
`HAVING`으로 걸러 두면 정상 상태에서는 0행이라 비용이 인덱스 스캔 수준으로 유지된다.

---

## 4. 1차 등록부와의 연결

이번 회차에서 기존 항목의 **근거가 강화되거나 범위가 넓어진** 것들.

| 기존 ID | 갱신 내용 |
|---|---|
| [DR-03](design-review.md#dr-03) | 앱 자기신고 재인증 검사 지점이 **7곳**이 됐다 — [`011:97`](ddl/011_operations_admin.sql#L97) `op_cast_vote` 추가. **4-eyes의 두 눈이 모두 앱의 주장만 믿는다** |
| [DR-05](design-review.md#dr-05) | 베팅을 체인에서 제외하면 [`013:71`](ddl/013_reconciliation.sql#L71)의 `lag(hash)`가 미체인 행에서 NULL을 반환해 제네시스 비교로 떨어진다 → 대량 오탐. [DR-24](#dr-24)·[DR-26](#dr-26)과 함께 설계해야 한다 |
| [DR-10](design-review.md#dr-10) | `outbox` RLS 부재에 더해, `ledger_read`가 [`012:166`](ddl/012_roles_and_grants.sql#L166) `ALL TABLES` GRANT로 `outbox` · `chain_heads` · 멱등키 테이블까지 전량 조회한다 |
| [DR-12](design-review.md#dr-12) | [DR-27](#dr-27)은 **골든 테스트 한 줄이면 즉시 잡혔을 결함이다.** 이번 14건 중 최소 4건(DR-24 · DR-27 · DR-28 · DR-30)이 같은 성격이다 |
| [DR-15](design-review.md#dr-15) | `identity.staff` RLS 부재에 [DR-31](#dr-31) `approval_votes`, [DR-32](#dr-32) `sessions`가 더해진다. `identity` 스키마 전체의 RLS 설계가 한 번에 필요하다 |

---

## 5. 착수 순서 갱신

[design-review.md §5](design-review.md#5-착수-순서)의 계획에 이번 4건을 끼워 넣는다.

**1주차 (CI + DB 파이프라인)와 병행 가능** — `012`·`013`만 고치므로 원장 코어와 독립이다.

| 순서 | 항목 | 이유 |
|---|---|---|
| 1 | [DR-25](#dr-25) `audit_reader` 신설 | [DR-26](#dr-26)의 선행 조건 |
| 2 | [DR-24](#dr-24) `security_invoker` 일괄 + `integrity_ok()` 정의자 전환 | RLS 격리가 지금 새고 있다. 뷰가 늘기 전에 |
| 3 | [DR-27](#dr-27) 실사 차액 트리거 | 단일 함수 교체. 가장 싸다 |
| 4 | [DR-28](#dr-28) · [DR-37](#dr-37) 대사 뷰 보강 | 2번과 같은 파일을 만진다 |
| 5 | [DR-26](#dr-26) R8 + 앵커 쓰기 분리 + 외부 서명 정의 | 서명 체계 결정이 필요해 리드타임이 있다 |

**2~3주차 (1차 차단 항목 해소)와 묶을 것**

- [DR-30](#dr-30) 멱등키 3종 → [DR-04](design-review.md#dr-04) 멱등성 정책 정리와 같은 작업
- [DR-32](#dr-32) `sessions` 컬럼 GRANT · [DR-33](#dr-33) `op_open_account` 재인증
  → [DR-03](design-review.md#dr-03) `step_up_tokens` · `identity_app` 역할 분리와 같은 작업
- [DR-31](#dr-31) `approval_votes` RLS → [DR-15](design-review.md#dr-15) `identity` RLS 설계와 같은 작업

**M4 이후**

- [DR-34](#dr-34) 파트너 4-eyes — 파트너 도메인 설계와 함께
- [DR-29](#dr-29) 스크럽 필드 — M5 이관 실행 전까지

---

## 6. 이 문서에 대해

**범위.** `ddl/002` · `006` · `007` · `012` · `013` 전량과 `011` 일부, `08-adr.md` 전량을
정독했다. 1차 검토에서 얕게 지나간 계층이다.

**아직 정독하지 않은 것.** [`01-current-system.md`](01-current-system.md) 581줄,
[`ddl/001`](ddl/001_types_and_extensions.sql) · [`003`](ddl/003_accounts.sql) ·
[`005`](ddl/005_games_rolling.sql) 전량, [`references.md`](references.md).

**철회한 지적.** 검토 중 제기됐다가 근거 확인 후 기각한 것 — 재론을 막기 위해 남긴다.

- **"`approval_decision`의 `reject`가 무의미하다 (`consume_approval`이 approve만 센다)"**
  — 성립하지 않는다. [`011:105-108`](ddl/011_operations_admin.sql#L105)이 거부 1표에
  즉시 `status = 'rejected'`로 전이시키고, `consume_approval`의 `status <> 'pending'`
  검사가 그 이후를 막는다. 정상 동작이다.

**검증 수준.** 모든 항목이 실제 파일의 줄 번호에 근거한다. 런타임 확인은 하지 않았다 —
특히 [DR-27](#dr-27)은 PostgreSQL의 생성 열 평가 시점에 대한 문서화된 동작에 근거하며,
실제 인스턴스에서 재현 확인이 필요하다.
