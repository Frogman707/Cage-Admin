# 설계 검토 4차 — 원장 코어 결함 등록부

> **분류**: 작업 문서 (Issue Register)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **대상**: [`ddl/004_ledger.sql`](ddl/004_ledger.sql) 전량 (556줄) + [references.md](references.md) · 교차 검증 `006`·`008`·`010`·`012`·`013`
> **상태**: 미해결 11건. **차단 1 · 높음 1 · 중간 5 · 낮음 4**
> **선행 문서**: [design-review.md](design-review.md) DR-01~DR-23 · [design-review-2.md](design-review-2.md) DR-24~DR-37 · [design-review-3.md](design-review-3.md) DR-38~DR-49
> **후속**: [design-review-5.md](design-review-5.md) — 5차 `DR-61`~`DR-65` (높음 2 · 중간 2 · 낮음 1) · [design-review-6.md](design-review-6.md) — 6차 `DR-66`~`DR-72` (차단 1 · 높음 2 · 중간 3 · 낮음 1). 여섯 문서 합계 **72건 · 차단 13**

---

## 검토 방법

`004`는 1차에서 부분만 읽었다. 이번엔 전량이다. 축은 셋:

1. **제약이 실제로 걸리는 경로인가** — 트리거의 발화 조건을 역으로 따져 "이 검사가 절대 안 도는 입력"을 찾았다.
2. **선언된 규칙표가 규칙을 강제하는가** — `posting_rules` 176~251행의 세 INSERT를 순서대로 실행해 최종 행 집합을 손으로 전개했다.
3. **내부 함수에 애플리케이션 경로가 있는가** — 3차 DR-38의 축을 `008`의 함수 전체로 확장했다. 3차는 타입을, 이번엔 함수를 봤다.

3번이 이번 차단을 냈다.

**반증한 의심 4건은 §7에 남겼다.** 다음 검토에서 같은 것을 다시 제기하지 않기 위해서다.

---

## 1. 요약

| ID | 항목 | 등급 | 영향 | 근거 |
|---|---|---|---|---|
| **DR-50** | 역분개를 부를 애플리케이션 경로가 없다 | **차단** | M5 · M6 | [`008:518`](ddl/008_post_transaction.sql#L518) · [`012:7`](ddl/012_roles_and_grants.sql#L7) · [05:173](05-api-contract.md) |
| **DR-51** | `posting_rules` 와일드카드가 3개 kind로 전파된다 | **높음** | — | [`004:237-251`](ddl/004_ledger.sql#L237) |
| **DR-52** | 분개 0개 거래는 스키마 그물 밖이다 | 중간 | M6 | [`004:331`](ddl/004_ledger.sql#L331) · [`004:489`](ddl/004_ledger.sql#L489) |
| **DR-53** | `reverses_tx_id`와 `kind`가 묶여 있지 않다 | 중간 | — | [`004:74`](ddl/004_ledger.sql#L74) · [`004:100`](ddl/004_ledger.sql#L100) |
| **DR-54** | 멱등성 키에 주체 스코프가 없다 | 중간 | M5 | [`004:502`](ddl/004_ledger.sql#L502) |
| **DR-55** | `posting_rules` 표 자신에 불변성 가드가 없다 | 중간 | — | [`004:165`](ddl/004_ledger.sql#L165) · [`013 R7`](ddl/013_reconciliation.sql) |
| **DR-60** | 지점 추가 절차가 5곳에 흩어져 있다 | 중간 | — | [`004:56`](ddl/004_ledger.sql#L56) · `001` · `003` |
| **DR-56** | `TRUNCATE`가 어디에서도 막히지 않는다 | 낮음 | — | [`004:468`](ddl/004_ledger.sql#L468) · `012` |
| **DR-57** | `device_id`·`idempotency_key`에 컬럼 제약이 없다 | 낮음 | — | [`004:64`](ddl/004_ledger.sql#L64) · [`004:71`](ddl/004_ledger.sql#L71) |
| **DR-58** | 기간 행에 개설자·시각 순서 검사가 없다 | 낮음 | — | [`004:22-37`](ddl/004_ledger.sql#L22) |
| **DR-59** | `references.md`가 존재하지 않는 사용처를 가리킨다 | 낮음 | — | [references.md:19](references.md) |

---

## 2. 차단 1건

### DR-50 · 역분개를 부를 애플리케이션 경로가 없다

**증상.**

`ledger.reverse_transaction()`은 [`008:518`](ddl/008_post_transaction.sql#L518)에 온전히 구현돼 있다. 원 거래를 미러링하고, 이미 역분개됐는지 검사하고([`008:542`](ddl/008_post_transaction.sql#L542)), 원 `category`를 보존한다([`008:547`](ddl/008_post_transaction.sql#L547)).

그런데 `008`은 **내부 전용**이다. ADR-013이 그렇게 정했고 [`012:7`](ddl/012_roles_and_grants.sql#L7) 주석이 명시한다:

> `ledger_app` 은 008 의 코어 함수(post_transaction · reverse_transaction · …

`012`의 `GRANT EXECUTE` 목록에 `reverse_transaction`은 없다. `ledger_app`이 받는 것은 `business_date_of` · `account_id_of` · `house_account_id` 세 개의 조회 헬퍼와 `009`~`011`의 `op_*`뿐이다.

`reverse_transaction`의 호출자를 전수 조사했다. **하나다** — [`010`의 `op_cancel_game()`](ddl/010_operations_game.sql). 그것도 대상이 한정돼 있다:

```sql
SELECT DISTINCT e.transaction_id
  FROM ledger.entries e
 WHERE e.account_id = v_g.chips_account_id
```

**그 게임의 칩 계정을 건드린 거래만** 역분개한다.

[05-api-contract.md](05-api-contract.md) 전체에서 정정에 해당하는 엔드포인트는 하나다:

| `POST /v1/games/{game_no}/cancel` | `cancelGame` `:6824` | **역분개** (삭제 아님) |

**왜 차단인가.**

잘못 입력한 입금·출금·계좌 이체·지점 이체·지갑 이체를 되돌릴 수단이 시스템에 없다.

- `DELETE`는 [`004:433`](ddl/004_ledger.sql#L433)이 금지한다 — `append-only violation`
- `UPDATE`는 [`004:437`](ddl/004_ledger.sql#L437)이 금지한다 — `이미 봉인된 거래`
- 역분개는 권한이 없다

그리고 설계 문서 전체가 세 번째 길을 유일한 답으로 제시한다. [`004:439`](ddl/004_ledger.sql#L439)의 오류 메시지가 직접 그렇게 말한다:

> `transaction % is already sealed — 정정은 역분개(reverses_tx_id)로만 가능하다`

**운영자에게 그 문장은 실행 불가능한 지시다.**

`op_adjustment`가 대안이 되지 못한다. [04-posting-rules.md](04-posting-rules.md) §11의 `adjustment`는 `house_cash`와 `suspense`만 건드린다([`004:211-214`](ddl/004_ledger.sql#L211)). 회원 예치금에 잘못 찍힌 금액을 되돌릴 조합이 규칙표에 없다.

**DR-38과 같은 병이되 더 나쁘다.** DR-38은 함수가 없다. 여기는 **함수가 완성돼 있고 권한 한 줄이 없다.** 그래서 설계자가 이미 만들었다고 착각하기 쉽다.

**개선 방안.**

`011`에 얇은 래퍼를 추가한다. 역분개는 자금을 되돌리는 조작이므로 승인 없이 열면 안 된다.

```sql
CREATE FUNCTION ledger.op_reverse_transaction(
  p_idempotency_key TEXT,
  p_actor_staff_id  BIGINT,
  p_auth_method     identity.auth_method,
  p_device_id       TEXT,
  p_original_ext_id UUID,
  p_approval_id     BIGINT,          -- NULL 불가. 역분개는 항상 4-eyes 다
  p_memo            TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ledger, identity, pg_temp
AS $$
DECLARE
  v_tx  ledger.transactions;
  v_rev ledger.posted_tx;
BEGIN
  SELECT * INTO v_tx FROM ledger.transactions WHERE external_id = p_original_ext_id;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'transaction % not found', p_original_ext_id
      USING ERRCODE = 'no_data_found';
  END IF;

  PERFORM identity.assert_actor_authorized(p_actor_staff_id, v_tx.branch, 'ledger.reverse');

  IF p_approval_id IS NULL THEN
    RAISE EXCEPTION 'reversal requires an approval'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_rev := ledger.reverse_transaction(
             p_idempotency_key, v_tx.id, p_actor_staff_id,
             p_auth_method, p_device_id, p_memo, 'reversal');
  ...
END;
$$;
```

함께 필요한 것:

- `012`에 `GRANT EXECUTE ON FUNCTION ledger.op_reverse_transaction(...) TO ledger_app`
- `identity`의 권한 카탈로그에 `ledger.reverse` 추가 — 2차 DR-34가 지적한 권한 목록 누락과 같은 자리다
- [05-api-contract.md](05-api-contract.md)에 `POST /v1/transactions/{external_id}/reverse`
- `consume_approval`의 승인 종류에 역분개 항목 추가

**검증.**

```sql
-- 008 의 함수 중 어떤 것도 op_ 래퍼가 없으면 애플리케이션이 부를 수 없다
SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'ledger'
   AND p.proname NOT LIKE 'op\_%'
   AND has_function_privilege('ledger_app', p.oid, 'EXECUTE');
-- 기대: business_date_of · account_id_of · house_account_id 세 개뿐
```

그리고 **DR-38의 검증 쿼리를 함수 축으로도 돌려야 한다.** 3차는 "선언된 타입에 op가 있는가"를 물었다. 이번 건은 "구현된 내부 함수에 op가 있는가"다. 같은 질문의 다른 방향이고, 둘 다 빈칸을 냈다.

---

## 3. 높음 1건

### DR-51 · `posting_rules` 와일드카드가 3개 kind로 전파된다

**증상.**

`posting_rules`의 목적을 [`004:162-164`](ddl/004_ledger.sql#L162)가 직접 쓴다:

> 잔액 합이 0이라는 것만으로는 도둑질을 막지 못한다. 예: `member_deposit` 을 대변 기록하고 `suspense` 를 차변 기록하면 합은 0이지만 돈이 창조된다. 이 표가 그 조합을 존재하지 않게 만든다.

표는 세 번의 INSERT로 채워진다. 순서대로 전개하면:

**① [`004:176-234`](ddl/004_ledger.sql#L176)** — 명시 규칙 45행. 의도대로다.

**② [`004:237-240`](ddl/004_ledger.sql#L237)** — 기초 잔액:

```sql
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT 'opening_balance', 'opening_balance', k, s
  FROM unnest(enum_range(NULL::ledger.account_kind)) AS k,
       unnest(ARRAY[1, -1]::SMALLINT[])              AS s;
```

`account_kind` 14종 × 부호 2 = **28행**. 주석은 "마이그레이션 전용"이라고 쓰지만 그 한정을 강제하는 것은 없다.

**③ [`004:246-251`](ddl/004_ledger.sql#L246)** — 역분개 생성기:

```sql
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT DISTINCT rk, r.category, r.account_kind, (-r.sign)::SMALLINT
  FROM ledger.posting_rules r,
       unnest(ARRAY['reversal','game_cancel']::ledger.tx_kind[]) AS rk
 WHERE r.kind NOT IN ('reversal', 'game_cancel')
```

`WHERE`가 제외하는 것은 `reversal`과 `game_cancel`뿐이다. **②가 넣은 28행이 그대로 통과한다.**

결과:

| kind | category | account_kind | sign |
|---|---|---|---|
| `opening_balance` | `opening_balance` | **전 14종** | **±** |
| `reversal` | `opening_balance` | **전 14종** | **±** |
| `game_cancel` | `opening_balance` | **전 14종** | **±** |

**왜 높음인가.**

`entries_posting_rule` 트리거([`004:280`](ddl/004_ledger.sql#L280))는 행 단위로 `(kind, category, account_kind, sign)`을 조회한다. 위 세 kind에서 `category='opening_balance'`를 쓰면 **어떤 계정 종류든 어떤 방향으로든 통과한다.** 004:164가 예로 든 "합은 0이지만 돈이 창조되는" 조합이 정확히 그 세 kind에서 합법이다.

여기까지면 중간이다. 등급을 올리는 것은 **`013`의 R7이 같은 표를 기준으로 쓴다**는 점이다. R7의 주석이 자기 존재 이유를 이렇게 쓴다:

> `entries_posting_rule` 트리거가 삽입 시점에 막지만, 트리거를 우회하는 경로(`session_replication_role='replica'` 슈퍼유저 세션 등)가 남긴 흔적을 잡는다.

**트리거를 우회한 공격자가 고를 kind가 바로 그 세 개다.** 우회 흔적을 잡으려고 만든 그물이, 우회할 사람이 가장 먼저 고를 자리에서 구멍이 나 있다. 예방과 탐지 두 층이 같은 지점에서 같이 실패한다.

애플리케이션 입력으로 직접 도달하지는 않는다 — `op_cancel_game`은 원 거래를 미러링할 뿐 호출자가 분개를 지정하지 않고, `opening_balance`는 3차 DR-38대로 op 자체가 없다. 그래서 차단이 아니라 높음이다. 다만 DR-38을 (a)안(op 추가)으로 해소하면 **즉시 차단으로 승격한다.**

**개선 방안.**

세 층으로 나눠 고친다.

```sql
-- ① 역분개 생성기에서 와일드카드를 제외한다
 WHERE r.kind NOT IN ('reversal', 'game_cancel', 'opening_balance')

-- ② opening_balance 를 실제 이관 대상 조합으로 좁힌다.
--    전 계정 종류가 필요한 게 아니라, 잔액이 있는 계정 종류만 필요하다.
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT 'opening_balance', 'opening_balance', k, s
  FROM unnest(ARRAY[
         'house_cash','member_deposit','marker_receivable','chips_outstanding',
         'player_wallet','opening_equity'
       ]::ledger.account_kind[]) AS k,
       unnest(ARRAY[1,-1]::SMALLINT[]) AS s;
```

③ 근본적으로는 역분개를 **표로 검증하지 않아야 한다.** 역분개의 정당성은 "원 거래의 분개와 정확히 부호 반전된 미러인가"이지 "(category, account_kind, sign) 조합이 표에 있는가"가 아니다. `reverse_transaction`이 원 분개에서 직접 생성하므로 이미 그 성질을 만족한다. 트리거에 예외를 두고, 대신 `013`에 R10을 추가한다 — **역분개 거래의 분개 합이 원 거래 분개와 정확히 반대인가**를 상시 대조한다. 그러면 `reversal`·`game_cancel` 행 자체가 표에서 사라진다.

**검증.**

```sql
SELECT kind, count(*) AS rules
  FROM ledger.posting_rules
 GROUP BY kind
 ORDER BY rules DESC;
-- reversal · game_cancel · opening_balance 가 28행 이상이면 와일드카드가 살아 있다
```

---

## 4. 중간 5건 · 낮음 4건

### DR-52 · 분개 0개 거래는 스키마 그물 밖이다 (중간)

`assert_transaction_balanced`는 `AFTER INSERT ON ledger.entries`다([`004:331`](ddl/004_ledger.sql#L331)). **분개가 하나도 없으면 트리거가 발화하지 않는다.** 안에 있는 `v_legs < 2` 검사([`004:306`](ddl/004_ledger.sql#L306))는 분개가 1개일 때만 도는 반쪽 그물이다.

커밋 시점 그물인 `transactions_sealed`([`004:489`](ddl/004_ledger.sql#L489))는 `hash IS NULL`만 본다. 해시는 분개와 독립적으로 계산된다 — `entries_canon`이 `COALESCE(string_agg(...), '')`이므로([`008:84`](ddl/008_post_transaction.sql#L84)) 분개 0개도 정상 봉인된다.

`008:277-281`이 `p_entries` 길이를 검사하므로 정상 경로로는 만들 수 없다. **문제는 그 검사가 애플리케이션 층에만 있다는 것이다.** `004`라는 파일 전체의 존재 이유가 "앱이 약속한 것을 DB가 강제한다"인데, `≥2 legs`만 그 원칙에서 빠져 있다.

만들어지면 어디에도 안 잡힌다:
- R1은 통화별 합을 보므로 0-leg 거래는 기여가 0 — 초록색 유지
- `v_transaction_detail`은 `JOIN ledger.entries` INNER([`004:548`](ddl/004_ledger.sql#L548)) — 감사 뷰에서 안 보인다
- 해시 체인에는 들어간다

**체인에는 있고 감사에는 없는 행**이 남는다.

**개선.** 이미 있는 지연 트리거에 쿼리 하나를 더한다. 새 트리거가 필요 없다.

```sql
-- assert_transaction_sealed() 안에 추가
IF (SELECT count(*) FROM ledger.entries WHERE transaction_id = NEW.id) < 2 THEN
  RAISE EXCEPTION 'transaction % has fewer than 2 entries at commit', NEW.id
    USING ERRCODE = 'integrity_constraint_violation';
END IF;
```

---

### DR-53 · `reverses_tx_id`와 `kind`가 묶여 있지 않다 (중간)

[`004:100`](ddl/004_ledger.sql#L100)의 부분 UNIQUE 인덱스는 좋은 설계다. 주석이 이유까지 정확히 쓴다 — 일반 인덱스면 "이미 역분개됐는가" 검사가 Read Committed의 check-then-act가 되어 잔액이 과복구된다.

그런데 `reverses_tx_id`를 채울 수 있는 `kind`가 제한되지 않는다. [`004:245`](ddl/004_ledger.sql#L245) 주석은 이미 그 결합을 전제로 쓴다:

> 역분개 여부는 `transactions.kind='reversal'` 과 `reverses_tx_id` 로 구분한다.

**전제일 뿐 제약이 아니다.** `kind='deposit'` 거래가 `reverses_tx_id`를 채우면 그 UNIQUE 슬롯을 선점한다. 이후 그 거래에 대한 **진짜 역분개는 영구히 불가능하다** — `008:542`의 검사와 UNIQUE 인덱스 양쪽에서 막힌다. 되돌릴 수 없는 봉쇄다.

**개선.** 한 줄.

```sql
CONSTRAINT tx_reverses_kind CHECK (
  reverses_tx_id IS NULL OR kind IN ('reversal', 'game_cancel')
)
```

---

### DR-54 · 멱등성 키에 주체 스코프가 없다 (중간)

`key TEXT PRIMARY KEY`([`004:502`](ddl/004_ledger.sql#L502)) — 전역 단일 네임스페이스다.

[05-api-contract.md](05-api-contract.md) §2가 인용한 IETF 초안은 "The idempotency key MUST be unique"라고만 쓴다. **무엇에 대해 유일한지는 규정하지 않는다.** 스코프는 구현의 책임이고, 여기서는 아무 스코프도 없다.

결과: 키가 같고 `request_fingerprint`가 같으면, 호출자가 누구든 저장된 `response_body`가 그대로 재생된다([`004:498`](ddl/004_ledger.sql#L498)의 규약). 지문은 `SHA-256(method || path || canonical body)`이므로 **행위자를 포함하지 않는다.** 같은 조작을 같은 인자로 요청한 다른 지점 스태프가 앞사람의 응답 — 거래 `external_id`, 잔액 — 을 받는다.

지점 RLS는 여기서 도움이 안 된다. `idempotency_keys`는 `012:296-302`의 RLS 대상 목록에 없고, 응답은 이미 JSONB로 굳어 있어 정책이 필터할 행 구조가 아니다.

**개선.** 지문에 행위자를 넣는 것이 가장 작은 수정이다.

```sql
-- ledger.request_fingerprint(p_op TEXT, p_args JSONB) 시그니처에 actor 추가
ledger.request_fingerprint('deposit', v_args, p_actor_staff_id)
```

키 자체를 `(actor_staff_id, key)` 복합 PK로 바꾸면 더 명확하지만 `009`~`011`의 모든 `begin_idempotent` 호출을 고쳐야 한다. 최소한 `complete_idempotent` 재생 시점에 행위자 일치를 확인해야 한다.

---

### DR-55 · `posting_rules` 표 자신에 불변성 가드가 없다 (중간)

`004`는 자금 테이블에 불변성을 건다 — `entries_immutable`([`004:468`](ddl/004_ledger.sql#L468)), `transactions_seal_only`([`004:464`](ddl/004_ledger.sql#L464)). `posting_rules`에는 아무것도 없다.

`ledger_app`은 SELECT만 갖는다([`012:123`](ddl/012_roles_and_grants.sql#L123)). 그러나 소유자 세션과 마이그레이션 스크립트는 쓸 수 있고, **행 하나를 넣으면 그 조합이 합법이 된다.** 감사 흔적은 남지 않는다 — 이 표에는 `updated_at`도 변경 이력도 없다.

DR-51과 같은 곳을 다른 방향에서 친다. `013`의 R7이 이 표를 **대조의 기준**으로 삼기 때문이다. 표가 오염되면 R7은 오염된 기준으로 초록색을 낸다. **자기 자신을 검증하지 않는 기준 데이터**다.

**개선.**

```sql
CREATE TRIGGER posting_rules_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON ledger.posting_rules
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_mutation();
```

`004` 안에서는 트리거 생성을 INSERT 뒤로 옮기면 된다. 더 강하게 하려면 표 전체의 해시를 `ledger.schema_fingerprints`에 저장하고 R7이 매번 그 해시를 함께 검증한다 — 그래야 "기준이 바뀌지 않았다"까지 대사에 들어간다.

---

### DR-60 · 지점 추가 절차가 5곳에 흩어져 있다 (중간)

지점 하나를 추가하려면:

| # | 위치 | 작업 |
|---|---|---|
| 1 | [`001`](ddl/001_types_and_extensions.sql) | `ALTER TYPE ledger.branch_code ADD VALUE` |
| 2 | [`001:209`](ddl/001_types_and_extensions.sql#L209) | `branch_config` 행 (DR-39의 임계값 포함) |
| 3 | [`004:56`](ddl/004_ledger.sql#L56) | `chain_heads` 행 — 제네시스 해시 생성 |
| 4 | [`003:283`](ddl/003_accounts.sql#L283) | `MAIN-{branch}` 하우스 계정 부트스트랩 (DR-41의 PHP 하드코딩) |
| 5 | `identity` | 스태프 지점 배정 |

3번을 빠뜨리면 그 지점의 **첫 거래**에서 터진다 — `chain head missing for branch %`([`008:391`](ddl/008_post_transaction.sql#L391)). 스키마 적용 시점이 아니라 운영 중에 터진다는 게 나쁘다.

[README.md](README.md) 미확정 사항 4번("지점 확장 계획 — 현행 `HANN`/`NUSTAR`/`ONLINE` 하드코딩")이 이 문제다. 다만 README는 "확장할 것인가"를 묻고, 여기서는 **확장하기로 하면 절차가 원자적이지 않다**는 점을 지적한다.

**개선.** `ledger.provision_branch(p_code)` 하나로 모은다. `ALTER TYPE`은 트랜잭션 안에서 제약이 있으므로 2단계로 나눈다 — 타입 확장은 마이그레이션 파일, 나머지 4개는 함수 하나. 함수가 끝나면 그 지점은 즉시 거래 가능이어야 한다.

---

### DR-56 · `TRUNCATE`가 어디에서도 막히지 않는다 (낮음)

`entries_immutable`은 `FOR EACH ROW` 트리거다. **행 트리거는 `TRUNCATE`에 발화하지 않는다.** `012`에 `REVOKE TRUNCATE`도 없다(전 파일 grep 무결과).

`001:246`의 `deny_mutation` 주석은 `session_replication_role='replica'` 우회를 인정한다. `TRUNCATE`는 그와 별개의 경로이고, 더 쉽다 — 세션 설정을 바꿀 필요조차 없다. append-only 원장의 실질적 우회 경로는 `DELETE`가 아니라 이쪽이다.

**개선.**

```sql
CREATE TRIGGER entries_no_truncate
  BEFORE TRUNCATE ON ledger.entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();
```

`transactions` · `rolling_events` · `main_cage_events`에도 같이 건다. 소유자는 트리거를 지울 수 있으므로 완전한 방어는 아니다 — 그러나 사고성 `TRUNCATE`는 막고, 고의는 흔적을 남긴다.

---

### DR-57 · `device_id`·`idempotency_key`에 컬럼 제약이 없다 (낮음)

둘 다 `TEXT NOT NULL`뿐이다([`004:64`](ddl/004_ledger.sql#L64), [`004:71`](ddl/004_ledger.sql#L71)). `''`가 유효한 값이다.

`008:283-289`가 정상 경로에서 막는다 — 확인했다. 그래서 낮음이다. 남는 것은 원칙 문제다: 이 파일의 다른 모든 불변식은 스키마에 있는데 이 둘만 함수에 있다.

빈 멱등성 키가 한 번 들어가면 UNIQUE이므로 **이후 모든 빈 키 요청이 409/422**가 된다. 사소한 자기 DoS이자 디버깅하기 어려운 종류다.

**개선.** `CHECK (length(device_id) BETWEEN 1 AND 255)` · `CHECK (length(idempotency_key) BETWEEN 1 AND 255)`. 상한은 초안이 권고하는 UUID 길이를 여유 있게 덮는다.

---

### DR-58 · 기간 행에 개설자·시각 순서 검사가 없다 (낮음)

두 가지다.

**① `closed_by`는 있고 `opened_by`는 없다**([`004:29`](ddl/004_ledger.sql#L29)). 마감은 누가 했는지 남고 개설은 안 남는다. `ensure_period_row`([`006:76`](ddl/006_periods_balancing.sql#L76))가 첫 거래 시 자동 생성하므로 "사람이 없다"가 맞는 답일 수 있다 — 그렇다면 컬럼 대신 주석으로 명시해야 한다. 지금은 비대칭이 의도인지 누락인지 읽어서 알 수 없다.

**② `periods_status_timestamps` CHECK**([`004:32`](ddl/004_ledger.sql#L32))는 NULL 여부만 본다. `frozen_at >= opened_at`, `settled_at >= frozen_at`은 검사하지 않는다. `011`의 마감 함수가 `clock_timestamp()`를 쓰므로 정상 경로에서는 성립하지만, 순서 자체가 제약에 없다.

**개선.** CHECK에 두 항 추가. `opened_by`는 결정 후 컬럼 추가 또는 주석.

---

### DR-59 · `references.md`가 존재하지 않는 사용처를 가리킨다 (낮음)

[references.md:19](references.md):

| `SET CONSTRAINTS` | [`ddl/README`](ddl/README.md) | https://www.postgresql.org/docs/current/sql-set-constraints.html |

`ddl/*.sql`과 `ddl/README.md` 어디에도 `SET CONSTRAINTS`가 없다(전 파일 grep 무결과).

인용만 있고 사용처가 없다는 것 자체는 사소하다. **문제는 그 자리에 있어야 할 경고가 없다는 것이다.** 이 설계의 I1·I2는 전부 `DEFERRABLE INITIALLY DEFERRED` 제약 트리거다([`004:332`](ddl/004_ledger.sql#L332), [`004:381`](ddl/004_ledger.sql#L381)). 세션이 `SET CONSTRAINTS ALL IMMEDIATE`를 실행하면:

- I1이 분개 삽입 순서에 의존하게 된다 — 첫 분개에서 `has 1 entry(ies)`로 실패
- I2가 [`004:339`](ddl/004_ledger.sql#L339) 주석이 경고한 바로 그 상태가 된다 — 게임 종료 정산 7개 계정이 삽입 순서에 좌우된다

**설계 전체를 한 문장으로 무력화하는 명령인데 그 사실이 어디에도 적혀 있지 않다.**

**개선.** `ddl/README.md`에 한 문단:

> 이 스키마에서 `SET CONSTRAINTS ALL IMMEDIATE`를 실행하면 안 된다. I1(분개 균형)·I2(잔액 하한)가 지연 제약 트리거이며, 즉시 평가하면 분개 삽입 순서에 의존하는 스키마가 된다. 다중 분개 거래는 첫 분개에서 실패한다.

---

## 5. 1~3차 등록부와의 연결

### DR-50이 3차 DR-38의 형태를 바꾼다

3차는 **"타입을 선언하고 함수를 만들지 않았다"**를 찾았다. 이번 건은 한 칸 더 안쪽이다 — **"함수를 만들고 권한을 주지 않았다."**

| 층 | 3차 DR-38 | 4차 DR-50 |
|---|---|---|
| 타입 선언 | ✅ | ✅ |
| 내부 함수 | — | ✅ |
| `op_*` 래퍼 | ❌ | ❌ |
| `GRANT EXECUTE` | ❌ | ❌ |
| API 계약 항목 | ❌ | ❌ |

DR-38 검증 쿼리는 `pg_enum` × `pg_proc`를 대조했다. **그것만으로는 DR-50을 못 잡는다** — `reversal`은 `tx_kind`에 있고 `reverse_transaction`도 있어서 이름 대조를 통과한다. 빠진 것은 권한이다. 그래서 §2의 `has_function_privilege` 쿼리가 별도로 필요하다.

**둘을 한 검사로 합쳐야 한다.** "선언된 도메인마다 `ledger_app`이 실행 가능한 함수가 하나 이상 있는가" — 이것이 옳은 질문이고, 지금까지 세 번 다른 형태로 실패한 질문이다.

### DR-51 + DR-55는 하나의 결정이다

둘 다 `posting_rules`를 건드리고, 둘 다 `013` R7의 신뢰성에 걸린다. DR-51은 표의 **내용**이 넓고, DR-55는 표의 **경계**가 없다. 따로 고치면 두 번 연다.

그리고 3차 **DR-38의 결정이 이 둘의 답을 바꾼다.** DR-38을 (a)안(`op_*` 7개 추가)으로 가면 `bet`·`point_earn`·`share_accrue` 규칙이 실제 경로가 되므로 DR-51의 등급이 오른다. (c)안(타입 삭제)으로 가면 `004:221-234`의 14행이 같이 사라진다.

**따라서 착수 순서에서 DR-38 · DR-51 · DR-55는 한 묶음이다.**

### 원장 코어 잔여 6건의 공통점

DR-52 · DR-53 · DR-56 · DR-57은 전부 같은 형태다 — **불변식이 `008`에는 있고 스키마에는 없다.**

| 불변식 | `008` | `004` 스키마 |
|---|---|---|
| 분개 ≥ 2개 | ✅ `008:277` | ❌ (0개는 그물 밖) |
| `device_id` 비어 있지 않음 | ✅ `008:287` | ❌ |
| 멱등성 키 비어 있지 않음 | ✅ `008:283` | ❌ |
| `reverses_tx_id` ↔ `kind` | 암묵 | ❌ |
| `TRUNCATE` 금지 | — | ❌ |

`008`이 유일한 쓰기 경로인 한 전부 무해하다. 그런데 `013`의 R-체크 전체가 **`008`이 우회됐다는 가정 위에** 만들어져 있다. R7의 주석이 그 가정을 명시한다. 두 문서가 서로 다른 위협 모델을 쓰고 있고, `004`는 `008`을 믿는 쪽, `013`은 안 믿는 쪽이다.

**어느 쪽이 맞는지 정해야 한다.** `013`이 맞다면 위 다섯 줄을 스키마로 내려야 한다. 전부 합쳐 CHECK 3개 · 트리거 2개 · 기존 트리거 안의 쿼리 1개다.

---

## 6. 착수 순서 (60건 통합)

3차 §6을 갱신한다. 변경점은 DR-50이 1번으로 들어오고, DR-51·DR-55가 DR-38 결정과 한 묶음이 된 것이다.

| # | 묶음 | 항목 | 비고 |
|---|---|---|---|
| **0** | 승인 임계 | DR-39 | 한 줄. 단독 커밋. 오늘 끝난다 |
| **1** | **역분개 경로** | **DR-50** | 함수는 이미 있다. `op_*` 래퍼 + `GRANT` + 05 계약 + 권한 카탈로그. 다른 어떤 것과도 충돌하지 않는다 |
| **2** | 권한 · 감사 | 2차 DR-24~DR-30 계열 | 주차 1 CI와 병행 |
| **3** | **분개 정의표 결정** | **DR-38 + DR-51 + DR-55** | 셋이 같은 표와 `04`를 연다. 밀리면 2·4가 다시 열린다 |
| **4** | 게임 도메인 | 3차 DR-42·43·45·48·49 | `005`/`013` |
| **5** | 원장 스키마 잔여 | DR-52·53·54·56·57·58 | §5의 "어느 쪽이 맞는지" 결정 이후. 전부 작다 |
| **6** | 계정 체계 | 3차 DR-41·46 + DR-60 | 지점·통화 하드코딩이 같은 자리다 |
| **7** | 파트너 도메인 | 2차 DR-34 + 3차 DR-38·40·47 | 미완성 도메인 하나로 설계한다 |
| **8** | 1차 원장 코어 차단 | DR-01~DR-23 중 차단 5건 | |
| **9** | 문서 | DR-59 | 한 문단 |

**0과 1은 오늘 할 수 있다.** 둘 다 작고, 둘 다 차단이고, 둘 다 다른 항목과 충돌하지 않는다.

---

## 7. 이 문서에 대해

### 반증한 의심 4건

이번 검토에서 제기했다가 근거를 찾고 철회한 것들이다. **다음 검토에서 다시 제기하지 않기 위해 남긴다.**

| 의심 | 반증 근거 |
|---|---|
| `ledger.transactions`·`entries`에 RLS가 없다 | [`012:296-302`](ddl/012_roles_and_grants.sql#L296)의 `DO` 루프가 배열로 켠다. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` 문자열 grep에 안 잡힌다 — `format()` 안에 있다 |
| R6가 모든 `branch_transfer`를 오탐으로 잡는다 | [`013`의 `v_check_entry_branch`](ddl/013_reconciliation.sql)가 [`008:421`](ddl/008_post_transaction.sql#L421)과 **같은 CASE 식**을 쓴다. 오탐 없다. [`004:121`](ddl/004_ledger.sql#L121) 주석의 "부모와의 일치"라는 표현만 부정확하다 — 실제로는 "계정 귀속 또는 부모" |
| 회계 기간 행을 만들 경로가 없다 | [`006:76`](ddl/006_periods_balancing.sql#L76) `ensure_period_row()`가 있고 [`008:361`](ddl/008_post_transaction.sql#L361)이 부른다. 이름이 `ensure_period_open`에서 바뀐 이력까지 주석에 있다 |
| 빈 `device_id`·멱등성 키가 통과한다 | [`008:283-289`](ddl/008_post_transaction.sql#L283)가 막는다. DR-57은 **컬럼 제약 부재**로만 남겼다 |

첫 번째가 특히 중요하다. **`format()` 안의 DDL은 문자열 검색으로 안 잡힌다.** 앞선 세 차례 검토에서 `012`의 RLS 커버리지를 판단할 때 같은 방식으로 놓쳤을 가능성이 있다. 다음 검토는 `012`의 `DO` 블록 세 개를 손으로 전개해야 한다.

### 잘 되어 있는 것

이번 파일은 앞선 셋보다 밀도가 높다. 특히:

- [`004:97-101`](ddl/004_ledger.sql#L97) — `reverses_tx_id` UNIQUE 부분 인덱스. 주석이 "일반 인덱스면 Read Committed의 check-then-act가 되어 잔액이 과복구된다"까지 쓴다. 왜 이 인덱스가 성능이 아니라 **정합성** 장치인지 읽는 사람이 안다
- [`004:394-399`](ddl/004_ledger.sql#L394) — `FOR SHARE` 주석. 경합 시나리오를 3단계로 쓰고, **외래키가 자동으로 잡는 `FOR KEY SHARE`로는 왜 부족한지**까지 설명한다. 3차 DR-45가 지적한 `005`의 잠금 실수가 여기서는 정확하다
- [`004:443-453`](ddl/004_ledger.sql#L443) — 봉인 가드가 컬럼을 나열하지 않고 행 전체를 비교한다. 주석: "컬럼을 나열해 비교하면 나중에 컬럼이 추가될 때 검사에서 조용히 빠진다." 미래의 자기 자신을 막는 코드다
- [`004:242-245`](ddl/004_ledger.sql#L242) — 역분개가 원 `category`를 유지하는 이유. `'reversal'`로 덮으면 `013`의 파생 뷰가 정정을 반영하지 못한다는 것까지 추적했다

**DR-45(잠금)와 004:394의 대비가 3차 §7의 관찰을 다시 확인한다.** 같은 저자가 한 파일에서는 잠금 종류를 세 단계로 따지고, 다른 파일에서는 `FOR SHARE` 뒤에 `UPDATE`를 놓는다. 규율이 사람 기억에 있으면 파일마다 다르다.

### 이 문서가 검증하지 않은 것

- **실행 검증 없음.** DR-51의 최종 행 집합은 세 INSERT를 손으로 전개한 결과다. 실제 PostgreSQL에서 `SELECT kind, count(*) FROM ledger.posting_rules GROUP BY 1`을 돌리면 5초에 확인된다. **아직 아무도 돌리지 않았다** — 1차 DR-12(골든 테스트 0건)가 네 번째 등록부에서도 같은 자리에 있다
- **DR-52·DR-56은 우회 경로 전제다.** 정상 경로에서는 재현되지 않는다. §5가 지적한 "`004`와 `013`이 서로 다른 위협 모델을 쓴다"를 먼저 정리해야 등급이 확정된다
- **`01-current-system.md` 581줄은 아직 안 읽었다.** 현행 시스템 서술과 목표 설계의 대조는 다섯 번째 축이고, 지금까지 네 번 모두 `ddl/`과 설계 문서만 봤다

**60건이 전부라는 뜻이 아니다.** 네 번 읽었고 네 번 다 새 차단이 나왔다.

---

**인덱스:** [README](README.md) · **선행:** [1차](design-review.md) · [2차](design-review-2.md) · [3차](design-review-3.md)
