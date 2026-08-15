# 설계 검토 3차 — 타입 · 계정 체계 · 게임 도메인 결함 등록부

> **분류**: 작업 문서 (Issue Register)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **대상**: `ddl/001` · `003` · `005` 전량 (886줄) + `009`~`011` op 함수 전수 조사
> **상태**: 미해결 12건. **차단 2 · 높음 3 · 중간 5 · 낮음 2**
> **선행 문서**: [design-review.md](design-review.md) DR-01~DR-23 · [design-review-2.md](design-review-2.md) DR-24~DR-37
> **후속**: [design-review-4.md](design-review-4.md) — 4차 `DR-50`~`DR-60` (차단 1 · 높음 1 · 중간 5 · 낮음 4) · [design-review-5.md](design-review-5.md) — 5차 `DR-61`~`DR-65` (높음 2 · 중간 2 · 낮음 1) · [design-review-6.md](design-review-6.md) — 6차 `DR-66`~`DR-72` (차단 1) · [design-review-7.md](design-review-7.md) — 7차 `DR-73`~`DR-77` (차단 0) · [design-review-8.md](design-review-8.md) — 8차 `DR-78`~`DR-82` (차단 0) · [design-review-9.md](design-review-9.md) — 9차 `DR-83`~`DR-86` (차단 0 · 높음 2 · 중간 2). 아홉 문서 합계 **86건 · 차단 13 — 2026-08-15 전부 해소** (`DR-38`만 부분 해소)

1차는 **원장 코어와 연산 함수**를, 2차는 **권한 · 대사 · 감사 계층**을 봤다. 이 문서는 남은
**타입 정의 · 계정 체계 · 게임 도메인**(`001` · `003` · `005`)을 정독하고, 그 타입들이
실제로 쓰이는지를 `009`~`011`의 op 함수 18개 전수로 대조한 결과다.
세 문서를 합치면 **미해결 49건 · 차단 11건**이다.

ID는 이어진다 — `DR-38` ~ `DR-49`.

## 검토 방법

1·2차와 다른 축을 하나 추가했다. **선언된 타입에 실행 경로가 있는지**를 셌다.

`001`이 선언한 `tx_kind` 18종 · `account_kind` 14종을, `009`~`011`이 정의한
`op_*` 함수 18개와 대조했다. 이 대조가 이번 회차의 차단 1건(DR-38)을 통째로 만들어냈다.

1·2차의 지배적 유형이 **"규칙을 선언하고 지키지 않았다"** 였다면,
이번 회차는 **"타입을 선언하고 함수를 만들지 않았다"** 다. 결함의 모양이 다르다 —
잘못 만든 것이 아니라 **없는 것**이므로, 정적 검토가 아니면 구현 단계에 가서야 발견된다.

**확인하지 않은 것**: 실제 PostgreSQL 18 인스턴스에서의 런타임 동작.
DR-45(잠금 승격)는 PostgreSQL의 행 잠금 충돌 규칙에 근거하며, 재현하는 동시성 테스트가
저장소에 없다 — [DR-12](design-review.md#dr-12).

**철회한 주장 1건**: "계정 상태(`accounts.status`)를 아무도 검사하지 않는다"고 의심했으나
[`008:436`](ddl/008_post_transaction.sql#L436)에 `AND a.status <> 'active'` 검사가 있다.
계정 쪽은 정상이다. 주체(`parties.status`) 쪽만 문제이며 DR-44로 좁혀 기록했다.

---

> **진행 (2026-08-15) — 차단 2건 중 1.5건이 해소됐다.** `DR-39`(임계 `NOT NULL` + 시드 값 + NULL 거부)는 완료. `DR-38`은 **부분** — `op_load_opening_balance()`를 추가해 이관 계획의 실행 불가 상태를 풀었지만, 베팅·포인트·파트너 쉐어의 `tx_kind`는 여전히 op 함수가 없다. 앞의 둘은 `A1`·`A2` 보류(아바타 개선 진행 중)에, 케이지 포인트는 [`DR-68`](design-review-6.md) 사업 결정에 묶여 있다. 그 사실을 `ddl/001`의 `tx_kind` 선언부에 명시했다 — "선언 = 구현"으로 읽히는 것이 이 결함의 발생 원인 그 자체였기 때문이다. 반영 내역 전체는 [design-review.md](design-review.md) 머리말의 진행 표에 있다.

## 1. 요약

| ID | 항목 | 등급 | 영향 | 근거 |
|---|---|---|---|---|
| [DR-38](#dr-38) | 선언만 있고 op 함수가 없는 도메인 4개 — 앱이 기록할 방법이 없다 | ~~차단~~ **부분 해소** | M1 | `001:86-92` · `009`~`011` 전수 |
| [DR-39](#dr-39) | 4-eyes 승인 임계가 기본값 NULL — 승인이 한 번도 발동하지 않는다 | ~~차단~~ **해소** | M1 | `001:204` · `001:209` · `009:99` |
| [DR-40](#dr-40) | 파트너 계층에 순환 방지가 없다 — 주석이 애플리케이션에 위임 | 높음 | M4 | `003:240-241` |
| [DR-41](#dr-41) | 비-PHP 통화에 상대 계정이 없다 — 시드된 USD · KRW가 사용 불가 | 높음 | M1 | `001:186-189` · `003:283-299` |
| [DR-42](#dr-42) | 물리 칩 재고가 대사 대상이 아니다 | 높음 | M1 | `005:286` · `013` R1~R7 |
| [DR-43](#dr-43) | `games.chips_account_id`가 종류 · 소유자 · 통화와 결속되지 않는다 | 중간 | M1 | `005:27` · `005:222` |
| [DR-44](#dr-44) | `ledger.parties.status`를 어떤 연산도 검사하지 않는다 | 중간 | M1 | `008:436` |
| [DR-45](#dr-45) | 트리거의 `FOR SHARE`가 잠금 승격 함정 — 규율로만 가려져 있다 | 중간 | M1 | `005:129` · `005:153` · `010:17` |
| [DR-46](#dr-46) | 분개는 불변인데 계정 정의는 가변 | 중간 | M1 | `003:44` · `004` 불변성 트리거 |
| [DR-47](#dr-47) | `identity.staff.partner_party_id`에 주체 종류 검사가 없다 | 중간 | M4 | `003:316-318` · `003:250` |
| [DR-48](#dr-48) | 지점 누계 인덱스에 지점이 없다 | 낮음 | M2 | `005:82-83` · `013:331` |
| [DR-49](#dr-49) | 주석이 R4 위치를 `010`이라고 쓴다 — 실제는 `013` | 낮음 | M2 | `005:38` · `013:128` |

---

## 2. 차단 2건

<a id="dr-38"></a>
### DR-38 · 선언만 있고 op 함수가 없는 도메인 4개 — 앱이 기록할 방법이 없다

**등급: 차단** · 근거 [`001:86-92`](ddl/001_types_and_extensions.sql#L86) · [`009`](ddl/009_operations_money.sql) · [`010`](ddl/010_operations_game.sql) · [`011`](ddl/011_operations_admin.sql) 전수

#### 증상

`001`이 선언한 타입 중 상당수가 어떤 `op_*` 함수에서도 쓰이지 않는다.

op 함수는 전부 18개다.

| 파일 | 함수 |
|---|---|
| [`009`](ddl/009_operations_money.sql) | `op_deposit` · `op_withdraw` · `op_transfer` · `op_branch_transfer` · `op_wallet_transfer` · `op_adjustment` |
| [`010`](ddl/010_operations_game.sql) | `op_open_game` · `op_add_buyin` · `op_record_rolling` · `op_settle_game` · `op_cancel_game` · `op_main_cage_entry` |
| [`011`](ddl/011_operations_admin.sql) | `op_request_approval` · `op_cast_vote` · `op_record_balancing` · `op_freeze_period` · `op_settle_period` · `op_shift_event` · `op_open_account` |

이 18개가 다루지 않는 도메인:

| 도메인 | 선언된 `tx_kind` | 선언된 `account_kind` | 문서 | op |
|---|---|---|---|---|
| 온라인 베팅 | `bet` · `payout` | `house_gaming` | 04 §13 | **없다** |
| 포인트 | `point_earn` · `point_convert` | `player_points` | 04 §13-2 | **없다** |
| 파트너 쉐어 | `share_accrue` · `share_settle` | `partner_share_payable` · `commission_expense` | 04 §13-3 | **없다** |
| 마이그레이션 개시 | `opening_balance` | `opening_equity` | 04 §14 · 07 전체 | **없다** |

`tx_kind` 18종 중 **7종**, `account_kind` 14종 중 **5종**이 op 함수 어디에도 등장하지 않는다.
`ledger.partner_profiles` 테이블([`003:227`](ddl/003_accounts.sql#L227))도 `009`~`011`·`013`
어디에서도 읽히지 않는다.

#### 왜 차단인가

[ADR-013](08-adr.md) 때문이다. 이 설계의 핵심 방어는 **`ledger.post_transaction()`을 앱에
노출하지 않는 것**이며, `ledger_app`이 가진 권한은 `op_*` EXECUTE뿐이다
([README:69](README.md#L69)가 이를 "이 계층이 설계의 핵심"이라고 명시한다).

그 구조에서 **op 함수가 없는 자금은 애플리케이션이 기록할 방법이 존재하지 않는다.**
"나중에 추가하면 되는 기능"이 아니라 지금 뚫려 있는 구멍이다.

특히 `opening_balance`가 심각하다. [`003:303-308`](ddl/003_accounts.sql#L303)이
`OPENING-EQUITY` 주체와 계정을 부트스트랩에서 정성껏 만들어 두고,
[07-migration.md](07-migration.md) 전체가 이 계정에 개시 잔액을 싣는 것을 전제로 서 있다.
**그 분개를 발행할 함수가 없다.** 마이그레이션 계획 문서가 현재 실행 불가능하다.

부수 효과: [00-system-map.md](00-system-map.md)의 도메인 커버리지 매트릭스가
이 4개 도메인을 "설계됨"으로 표시하고 있다면 그 표가 사실과 다르다.
**타입이 있다 ≠ 실행 경로가 있다.**

#### 개선 방안

세 갈래 중 하나를 고르되, **고르지 않은 상태로 구현에 들어가면 안 된다.**

**(a) op 함수를 만든다.** 최소 7개가 필요하다.

```
ledger.op_place_bet(p_idempotency_key, ...)             -- bet    → house_gaming
ledger.op_settle_bet(p_idempotency_key, ...)            -- payout → house_gaming
ledger.op_earn_points(p_idempotency_key, ...)           -- point_earn
ledger.op_convert_points(p_idempotency_key, ...)        -- point_convert
ledger.op_accrue_share(p_idempotency_key, ...)          -- share_accrue → partner_share_payable
ledger.op_settle_share(p_idempotency_key, ...)          -- share_settle
ledger.op_load_opening_balance(p_idempotency_key, ...)  -- opening_balance (system 인증 전용)
```

각 함수는 [04-posting-rules.md](04-posting-rules.md) §13 · §13-2 · §13-3 · §14의 분개 정의를
그대로 구현하고, `012`의 `ledger_app` GRANT 목록에 등재돼야 한다.
`op_accrue_share`는 **DR-40(파트너 순환)을 먼저 해결하지 않으면 안전하게 쓸 수 없다.**

**(b) 마이그레이션 개시는 예외로 명시한다.** `opening_balance`만은 앱이 아니라
소유자 권한 배치가 `post_transaction()`을 직접 호출하는 **일회성 관리 경로**로 규정한다.
그렇게 정한다면 [07-migration.md](07-migration.md)에 그 사실과 실행 주체 · 감사 방법을
명시해야 한다. 지금은 어디에도 없다.

**(c) 범위를 줄인다.** 이번 이관에서 베팅 · 포인트 · 쉐어를 다루지 않기로 한다면
`001`의 해당 `tx_kind` · `account_kind`와 `003`의 `partner_profiles`를 **DDL에서 뺀다.**
못 쓰는 타입을 선언해 두면 다음 사람이 "구현됐다"고 읽는다. 이것이 이번 결함의 발생 원인 그 자체다.

#### 검증

```sql
-- 선언됐지만 어떤 op 함수 본문에도 등장하지 않는 account_kind
SELECT e.enumlabel AS orphan_kind
FROM pg_enum e
JOIN pg_type t      ON t.oid = e.enumtypid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'ledger' AND t.typname = 'account_kind'
  AND NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace pn ON pn.oid = p.pronamespace
    WHERE pn.nspname IN ('ledger','cage','identity')
      AND p.proname LIKE 'op\_%'
      AND p.prosrc LIKE '%' || e.enumlabel || '%'
  );
```

`tx_kind`에 대해 같은 질의를 돌린다. **결과가 비어야 한다.**
(b)를 택했다면 `opening_balance` · `opening_equity`만 예외로 허용하고 그 사실을 주석에 남긴다.

---

<a id="dr-39"></a>
### DR-39 · 4-eyes 승인 임계가 기본값 NULL — 승인이 한 번도 발동하지 않는다

**등급: 차단** · 근거 [`001:204`](ddl/001_types_and_extensions.sql#L204) · [`001:209`](ddl/001_types_and_extensions.sql#L209) · [`009:99`](ddl/009_operations_money.sql#L99)

#### 증상

```sql
-- 001:204  기본값이 없다
approval_threshold_minor BIGINT CHECK (approval_threshold_minor > 0),

-- 001:209  세 지점을 넣으면서 이 값을 주지 않는다
INSERT INTO ledger.branch_config (branch) VALUES ('HANN'), ('NUSTAR'), ('ONLINE');
```

[`009:99`](ddl/009_operations_money.sql#L99)의 임계 검사가 읽는 값은
**신규 설치 직후 항상 NULL**이다. 그리고 [`001:202`](ddl/001_types_and_extensions.sql#L202)의
주석이 그 의미를 정의한다 — **"NULL 이면 임계 없음"**.

#### 왜 차단인가

`ddl/001`~`013`을 순서대로 적용한 시스템은 **금액이 얼마든 승인 없이 출금 · 지점이체를 통과시킨다.**

그 상태로 다음 자산이 전부 잠들어 있다.

- `identity.approvals` · `identity.approval_votes` 테이블
- `consume_approval()`의 6단 검사
- [`011`](ddl/011_operations_admin.sql)의 `op_request_approval` · `op_cast_vote`
- [06-security.md](06-security.md)의 4-eyes 절 전체
- [05-api-contract.md](05-api-contract.md) §6-2 "임계 금액 초과 → approval"

이 결함의 성질이 나쁘다. **오류가 나지 않는다. 로그가 남지 않는다. 화면이 달라지지 않는다.**
관측 가능한 신호가 하나도 없이 통제 하나가 통째로 비활성이다.
발견되는 시점은 대개 사후 감사다.

DR-38과 묶어 보면 그림이 분명해진다 — 이번 회차의 차단 2건은 모두
**"만들어 놓고 연결하지 않은 것"** 이다. DR-38은 함수를, DR-39는 값을 연결하지 않았다.

#### 개선 방안

**안전한 기본값은 "제한 없음"이 아니라 "쓸 수 없음"이다.** 두 가지를 함께 적용한다.

```sql
-- 001 수정 (1) — 값을 반드시 주게 한다
CREATE TABLE ledger.branch_config (
  ...
  approval_threshold_minor BIGINT NOT NULL
    CHECK (approval_threshold_minor > 0),
  ...
);

-- 001 수정 (2) — 시드에 실제 값을 넣는다. 아래는 예시이며 운영이 확정할 값이다.
INSERT INTO ledger.branch_config (branch, approval_threshold_minor) VALUES
  ('HANN',   50000000),   -- ₱500,000.00
  ('NUSTAR', 50000000),
  ('ONLINE', 20000000);   -- ₱200,000.00
```

`NOT NULL`을 택하면 "임계 없음" 의미가 사라지므로 [`001:202`](ddl/001_types_and_extensions.sql#L202)
주석도 함께 고친다. 임계를 실제로 끄고 싶은 지점이 있다면 `BIGINT` 최댓값을 넣게 하고,
그것이 명시적 선택임을 데이터로 남긴다.

**대안(임계 없음을 유지해야 한다면)**: [`009:99`](ddl/009_operations_money.sql#L99)가 NULL을 만나면
통과가 아니라 **거부**하게 바꾼다.

```sql
IF v_threshold IS NULL THEN
  RAISE EXCEPTION 'branch % has no approval threshold configured', p_branch
    USING ERRCODE = 'configuration_limit_exceeded',
          HINT = 'ledger.branch_config.approval_threshold_minor 를 설정하라';
END IF;
```

#### 검증

```sql
-- 임계 미설정 지점이 하나라도 있으면 안 된다
SELECT branch FROM ledger.branch_config WHERE approval_threshold_minor IS NULL;
```

그리고 골든 테스트 1건: **임계 초과 출금이 승인 없이 통과하면 실패**.
이 테스트 한 줄이면 이 결함은 애초에 존재하지 못했다 — [DR-12](design-review.md#dr-12).

---

## 3. 높음 3건

<a id="dr-40"></a>
### DR-40 · 파트너 계층에 순환 방지가 없다

**등급: 높음** · 근거 [`003:240-241`](ddl/003_accounts.sql#L240)

```sql
-- 자기 자신을 상위로 둘 수 없다. 더 깊은 순환은 애플리케이션이 막는다.
CONSTRAINT partner_no_self_parent CHECK (parent_id IS NULL OR parent_id <> party_id)
```

주석이 항복 선언이다. `A → B → A`는 통과한다.
[`depth`](ddl/003_accounts.sql#L232)는 부모의 `depth`와 대조되지 않아 장식이며,
`CHECK (depth BETWEEN 1 AND 8)`은 각 행을 따로 볼 뿐 트리를 보지 않는다.

순환이 있는 트리에서 쉐어를 상향 정산하면 무한 루프이거나 이중 지급이다.
[README:35](README.md#L35)가 이 문서 세트의 논지를 이렇게 쓴다 —
**"무결성을 데이터베이스가 강제한다."** 그 논지를 포기한 자리가 하필 돈이 나가는 트리다.

그리고 이것은 DB가 못 하는 일이 아니다.

```sql
CREATE FUNCTION ledger.assert_partner_no_cycle() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_cur   BIGINT   := NEW.parent_id;
  v_depth SMALLINT := 0;
BEGIN
  WHILE v_cur IS NOT NULL LOOP
    IF v_cur = NEW.party_id THEN
      RAISE EXCEPTION 'partner hierarchy cycle at party %', NEW.party_id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    v_depth := v_depth + 1;
    IF v_depth > 8 THEN
      RAISE EXCEPTION 'partner hierarchy deeper than 8 at party %', NEW.party_id
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    SELECT parent_id INTO v_cur FROM ledger.partner_profiles WHERE party_id = v_cur;
  END LOOP;

  -- depth 를 장식이 아니라 사실로 만든다
  IF NEW.depth <> v_depth + 1 THEN
    RAISE EXCEPTION 'partner depth must be %, got %', v_depth + 1, NEW.depth
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
```

기존 `partner_profiles_party_kind` 트리거([`003:268`](ddl/003_accounts.sql#L268))에 이어 붙인다.

> **함께 처리할 것**: 순환은 지금 발생하지 않는다 — 쉐어 정산 함수가 없기 때문이다(DR-38).
> **DR-38의 `op_accrue_share`를 만드는 커밋에 이 트리거가 함께 들어가야 한다.**

<a id="dr-41"></a>
### DR-41 · 비-PHP 통화에 상대 계정이 없다

**등급: 높음** · 근거 [`001:186-189`](ddl/001_types_and_extensions.sql#L186) · [`003:283-299`](ddl/003_accounts.sql#L283)

`001`이 PHP · USD · KRW 세 통화를 시드한다.
`003`의 지점 하우스 부트스트랩은 `'PHP'`가 하드코딩돼 있어, 지점당 하우스 계정 8종이 전부 PHP다.

USD 회원 계좌를 열면 상대편 `house_cash` USD 계정이 **존재하지 않는다.**
분개가 성립하지 못하고 런타임에 실패한다.

더 나쁜 것은 탐지되지 않는다는 점이다. [`013:19-26`](ddl/013_reconciliation.sql#L19)의 R1은
통화별로 나눠 합산하므로, **USD 쪽이 통째로 비뚤어져도 PHP가 맞으면 R1은 초록불이다.**
2차의 [DR-24](design-review-2.md#dr-24) · [DR-28](design-review-2.md#dr-28)과 같은 사각 —
검사가 자기 사각지대를 모른다.

**권고**: U2(다통화 실사용 계획, [08-adr.md](08-adr.md))가 미확정인 동안
**통화 시드를 PHP 하나로 줄인다.**

```sql
-- 001:186-189
INSERT INTO ledger.currencies (code, scale, symbol) VALUES
  ('PHP', 2, '₱');
-- USD · KRW 는 하우스 계정 부트스트랩(003)이 해당 통화를 지원할 때 함께 추가한다.
```

다통화를 실제로 쓴다면 `003`의 부트스트랩을 통화 배열로 돌리고,
**계정 개설 시 상대 하우스 계정 존재를 강제하는 검사**를 함께 넣어야 한다.

<a id="dr-42"></a>
### DR-42 · 물리 칩 재고가 대사 대상이 아니다

**등급: 높음** · 근거 [`005:286`](ddl/005_games_rolling.sql#L286) · [`013`](ddl/013_reconciliation.sql) R1~R7

`cage.chip_inventory_events`는 불변성 트리거가 걸려 있고 append-only다. 거기까지는 좋다.

`013`에서 이 테이블이 등장하는 곳은 [`013:274`](ddl/013_reconciliation.sql#L274) 한 군데,
`v_shift_counters`의 **표시용 집계**뿐이다. **R1~R7 어디에도 없다.**

즉 발행된 `chips_outstanding` 합과 금고에서 빠져나간 재고를 대조하는 검사가 없다.
금고에서 칩을 꺼내고 게임에 싣지 않아도, 게임에 실었는데 금고 기록을 남기지 않아도
**어떤 알람도 울리지 않는다.** 케이지에서 자금이 실제로 유실되는 경로가
기록은 되지만 검증되지 않는 상태다.

R9를 추가한다(R8은 2차 [DR-26](design-review-2.md#dr-26)의 앵커 대조가 쓴다).

```sql
-- R9 · 물리 칩 재고 대사 — 금고 순유출 = 미상환 칩 잔액
-- 스케치. chip_type(nn/cc) ↔ entry_category 매핑은 04-posting-rules.md 확정 후 고정한다.
CREATE VIEW cage.v_check_chip_inventory WITH (security_invoker = true) AS
WITH vault AS (
  SELECT branch, chip_type, -sum(delta_minor) AS net_issued_minor
    FROM cage.chip_inventory_events
   GROUP BY branch, chip_type
),
outstanding AS (
  SELECT g.branch, sum(b.balance_minor) AS outstanding_minor
    FROM cage.games g
    JOIN ledger.account_balances b ON b.account_id = g.chips_account_id
   GROUP BY g.branch
)
SELECT v.branch,
       sum(v.net_issued_minor)                            AS vault_net_issued_minor,
       max(o.outstanding_minor)                           AS chips_outstanding_minor,
       sum(v.net_issued_minor) - max(o.outstanding_minor) AS variance_minor,
       sum(v.net_issued_minor) = max(o.outstanding_minor) AS ok
  FROM vault v LEFT JOIN outstanding o ON o.branch = v.branch
 GROUP BY v.branch;
```

`ledger.v_integrity_status`의 R 목록에 `R9_chip_inventory`를 등재하고,
`security_invoker`를 반드시 붙인다(2차 [DR-24](design-review-2.md#dr-24)).

> **부수**: [`005:291`](ddl/005_games_rolling.sql#L291)의 `reason ledger.entry_category`는
> 자금 분류 ENUM을 물리 재고 사유에 재사용한다. R9를 넣을 때 전용 ENUM 분리를 함께 검토할 것.

---

## 4. 중간 5건 · 낮음 2건

<a id="dr-43"></a>
### DR-43 · `games.chips_account_id`가 종류 · 소유자 · 통화와 결속되지 않는다

**등급: 중간** · 근거 [`005:27`](ddl/005_games_rolling.sql#L27) · [`005:222`](ddl/005_games_rolling.sql#L222)

FK만 걸려 있다. 그 계정이 `chips_outstanding`인지, `game_party_id` 소유인지,
`games.currency`와 통화가 같은지 **아무것도 검사하지 않는다.**
`UNIQUE (chips_account_id)`도 없어 두 게임이 한 계정을 가리킬 수 있다.

지금은 [`010:111`](ddl/010_operations_game.sql#L111)이 항상 옳게 만들어 주지만,
**검사가 데이터가 아니라 코드에 있다.** 결속이 깨지면
[`assert_chips_settled`](ddl/005_games_rolling.sql#L222)가 엉뚱한 계정 잔액을 0으로 요구한다 —
게임이 영원히 종료되지 않거나, 칩 발행 분개가 하우스 현금에 꽂힌다.

트리거 하나로 세 가지를 함께 검사하고, `UNIQUE (chips_account_id)`를 추가한다.

<a id="dr-44"></a>
### DR-44 · `ledger.parties.status`를 어떤 연산도 검사하지 않는다

**등급: 중간** · 근거 [`008:436`](ddl/008_post_transaction.sql#L436)

`post_transaction`이 검사하는 것은 `accounts.status`뿐이다.
`ledger.parties.status`는 `active` · `suspended` · `closed` 세 값을 갖지만 아무도 읽지 않는다.

회원 하나를 정지시키려면 그 주체의 계정 행을 전부 손대야 하고,
주체를 `closed`로 바꿔도 거래는 그대로 통과한다.
`008:436`의 계정 검사에 주체 상태 검사를 나란히 추가하거나,
주체 상태 변경이 계정 상태로 전파되게 만든다. 둘 중 하나를 명시적으로 고른다.

<a id="dr-45"></a>
### DR-45 · 트리거의 `FOR SHARE`가 잠금 승격 함정

**등급: 중간** · 근거 [`005:129`](ddl/005_games_rolling.sql#L129) · [`005:153`](ddl/005_games_rolling.sql#L153) · [`010:17`](ddl/010_operations_game.sql#L17)

`assert_game_ongoing()`이 게임 행을 `FOR SHARE`로 잡고,
같은 트랜잭션의 AFTER 트리거 `apply_rolling_projection()`이 그 행을 `UPDATE`한다.
`FOR SHARE` 보유 후 `UPDATE`는 전형적인 **잠금 승격**이며,
같은 행에 대해 두 트랜잭션이 동시에 하면 교착이다.

**지금은 교착이 나지 않는다.** [`010:17` `cage.lock_ongoing_game()`](ddl/010_operations_game.sql#L17)이
`FOR UPDATE`를 먼저 잡아 승격 구간을 없애기 때문이다.

문제는 그 안전이 **규율에만 의존한다**는 점이다. 그리고
[`005:118`](ddl/005_games_rolling.sql#L118)의 주석을 보면 트리거 저자는 `FOR SHARE` 자체가
보호 수단이라고 믿고 있다 — `010`이 이미 더 강한 잠금을 잡는다는 사실을 인지하지 못한 상태다.
두 계층이 서로 상대가 지키고 있다고 가정한다.

`lock_ongoing_game()`을 거치지 않는 삽입 경로가 하나라도 추가되는 순간
같은 게임에 대한 동시 삽입 두 건이 교착한다.

**비용 0의 수정**: 트리거의 잠금을 `FOR NO KEY UPDATE`로 바꾼다.
그러면 규율이 아니라 잠금 자체가 안전을 보장한다.

```sql
-- 005:129
  SELECT g.status, g.game_no INTO v_status, v_no
    FROM cage.games g WHERE g.id = NEW.game_id FOR NO KEY UPDATE;
```

<a id="dr-46"></a>
### DR-46 · 분개는 불변인데 계정 정의는 가변

**등급: 중간** · 근거 [`003:44`](ddl/003_accounts.sql#L44)

`ledger.accounts`와 `ledger.parties`에 `deny_mutation` 트리거가 없다.
`accounts.currency`나 `accounts.party_id`를 UPDATE하면
**이미 쌓인 모든 분개의 의미가 소급해서 바뀐다.**

`kind` · `normal_balance`는 [`003:118`](ddl/003_accounts.sql#L118) 트리거가 짝을 강제하지만,
짝을 함께 바꾸는 것은 막지 못한다.

원장 불변성이 분개 행에서만 성립하고 그 분개가 가리키는 좌표에서는 성립하지 않는다.
분개가 하나라도 달린 계정에 대해 `currency` · `party_id` · `kind` 변경을 거부하는 트리거를 건다.
(`status` 변경은 정상 운영이므로 허용해야 한다.)

<a id="dr-47"></a>
### DR-47 · `identity.staff.partner_party_id`에 주체 종류 검사가 없다

**등급: 중간** · 근거 [`003:316-318`](ddl/003_accounts.sql#L316) · [`003:250`](ddl/003_accounts.sql#L250)

`003`이 FK만 건다. 같은 파일의 `partner_profiles`는
[`assert_partner_party()`](ddl/003_accounts.sql#L250)로 `party_type = 'partner'`를 강제하는데
staff 쪽은 하지 않는다. **한 파일 안에서 같은 종류의 검사가 한쪽에만 있다.**

`partner_operator` 주체가 `member` 주체에 묶이면 파트너 계층 스코프 판정이 어긋나고,
그 스코프는 RLS 정책이 읽는 값이다.

<a id="dr-48"></a>
### DR-48 · 지점 누계 인덱스에 지점이 없다

**등급: 낮음** · 근거 [`005:82-83`](ddl/005_games_rolling.sql#L82) · [`013:331`](ddl/013_reconciliation.sql#L331)

```sql
CREATE INDEX rolling_events_branch_total_idx
  ON cage.rolling_events (business_date) WHERE counts_toward_branch_total;
```

이름은 "지점 누계"인데 `cage.rolling_events`에 `branch` 컬럼이 없다.
[`013:331`](ddl/013_reconciliation.sql#L331)의 `v_branch_rolling_total`은
`cage.games`를 조인해야 지점을 얻으며, 이 인덱스는 그 질의를 돕지 못한다.

`rolling_events`에 `branch`를 비정규화하거나(다른 테이블들이 이미 그렇게 한다) 인덱스 이름을 고친다.

<a id="dr-49"></a>
### DR-49 · 주석이 R4 위치를 `010`이라고 쓴다

**등급: 낮음** · 근거 [`005:38`](ddl/005_games_rolling.sql#L38) · [`013:128`](ddl/013_reconciliation.sql#L128)

```sql
-- 프로젝션. rolling_events 합과 상시 대조한다 (010 R4)
```

R4는 [`013:128`](ddl/013_reconciliation.sql#L128) `cage.v_check_rolling_projection`이다.
`010`이 아니라 `013`이다. 검사 자체는 정상적으로 존재한다.

---

## 5. 1 · 2차 등록부와의 연결

이번 회차가 기존 항목의 근거를 강화하거나 범위를 넓힌다.

| 기존 | 이번 회차가 더하는 것 |
|---|---|
| [DR-12](design-review.md#dr-12) 골든 테스트 0건 | **DR-39는 테스트 한 줄이면 존재할 수 없었다.** DR-38도 타입/함수 대조 질의 하나로 잡힌다. 12건 중 최소 3건 |
| [DR-24](design-review-2.md#dr-24) 정의자 뷰 | DR-42의 R9 뷰를 새로 만들 때 `security_invoker`를 처음부터 붙여야 한다. 재발 방지 질의(2차 §2)의 적용 대상이 늘어난다 |
| [DR-26](design-review-2.md#dr-26) 앵커 R8 | R 번호가 겹치지 않게 **DR-42는 R9**를 쓴다 |
| [DR-28](design-review-2.md#dr-28) R2 INNER JOIN | DR-41과 같은 유형 — **대사 질의가 자기 사각지대를 모른다.** R1은 통화별로, R2는 조인으로 놓친다. 대사 계층 전체를 "무엇을 못 보는가" 관점으로 한 번 훑어야 한다 |
| [DR-34](design-review-2.md#dr-34) 파트너 4-eyes 불가 | DR-38 · DR-40 · DR-47과 합치면 **파트너 도메인은 인증 · 권한 · 자금 · 계층 네 축이 모두 미완성**이다. 개별 결함이 아니라 도메인 하나가 통째로 준비되지 않았다 |

**파트너 도메인 종합**: DR-34(투표 권한 없음) · DR-38(쉐어 op 없음) · DR-40(순환 방지 없음) ·
DR-47(주체 종류 미검증). 네 건을 따로 고치면 네 번 손댄다.
**파트너 도메인 하나로 묶어 한 번에 설계하는 편이 옳다.**

---

## 6. 착수 순서 (49건 통합)

| 순서 | 대상 | 건수 | 만지는 파일 | 병행 |
|---|---|---|---|---|
| 0 | **DR-39** 승인 임계 시드 | 1 | `001` | 즉시. 단독 커밋 |
| 1 | 2차 권한 · 감사 묶음 (DR-25 → DR-24 → DR-27 → DR-28 · 37 → DR-26) | 4+ | `012` · `013` · `006` | 1주차 CI와 병행 |
| 2 | **DR-38 결정** — (a) op 추가 / (b) 예외 명시 / (c) 범위 축소 | 1 | 결정 문서 | **1 · 3번 착수 전에 결정만은 끝나야 한다** |
| 3 | 게임 도메인 (DR-43 · DR-45 · DR-42/R9 · DR-48 · DR-49) | 5 | `005` · `013` | 원장 코어와 독립 |
| 4 | 계정 체계 (DR-41 · DR-44 · DR-46) | 3 | `001` · `003` · `008` | |
| 5 | **파트너 도메인 일괄** (DR-34 · DR-38 일부 · DR-40 · DR-47) | 4 | `002` · `003` · `009` · `012` | 2번 결정 이후 |
| 6 | 1차 원장 코어 차단 5건 | 5 | `008`~`011` | 2~3주차 |

**DR-39가 0번인 이유**: 한 줄이고, 다른 어떤 작업과도 충돌하지 않으며,
고치지 않은 채로 배포되면 통제 하나가 조용히 없는 상태가 된다.

**DR-38이 2번인 이유**: 결정이 뒤로 밀리면 나중에 권한(`012`) · 대사(`013`) ·
분개 정의표([04](04-posting-rules.md))를 **전부 다시 손대야 한다.**
구현이 아니라 **결정**이 앞에 와야 한다.

---

## 7. 이 문서에 대해

**범위**: `ddl/001` · `003` · `005` 전량(886줄) 정독 + `009`~`011`의 `op_*` 함수 18개 전수 조사 +
`013`의 R 검사 목록 대조.

**아직 읽지 않은 것**: [01-current-system.md](01-current-system.md)(581줄) ·
[references.md](references.md) · [`004_ledger.sql`](ddl/004_ledger.sql) 전량(1차에서 부분만).
**49건이 전부라는 뜻이 아니다.**

**철회**: "계정 상태를 아무도 검사하지 않는다"는 의심은
[`008:436`](ddl/008_post_transaction.sql#L436)의 `AND a.status <> 'active'`로 반증됐다.
같은 지적이 다시 제기되지 않도록 근거를 남긴다. 남은 문제는 주체 상태뿐이며 DR-44다.

**검증 수준**: 전부 파일 · 행 근거가 있다. 런타임 재현은 없다.
DR-45는 PostgreSQL 행 잠금 충돌 규칙에 근거하며 동시성 테스트로 확인해야 한다.

**칭찬할 것 하나**: [`003:87-93`](ddl/003_accounts.sql#L87)은 `account_kind` CASE에서
`v_expected IS NULL`을 명시적으로 막고, 그 이유를 주석에 남긴다 —
"ENUM 에 값을 추가하고 이 CASE 를 빠뜨리면 검사가 조용히 통과한다."
**조용한 통과를 경계할 줄 아는 저자다.**

그런데 [`005:97`](ddl/005_games_rolling.sql#L97)의 `correction` 분기는 검사 없이 `RETURN NEW`한다.
같은 규율이 한 파일에서는 적용되고 다른 파일에서는 적용되지 않는다.
**규율이 사람의 기억에만 있으면 파일마다 다르게 적용된다** — [DR-12](design-review.md#dr-12)가
이번에도 근거를 하나 더 얻었다.
