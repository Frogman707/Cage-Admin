# 설계 검토 — 구현 착수 전 결함 등록부

> **분류**: 작업 문서 (Issue Register)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **대상**: `docs/architecture/` 문서 10건 + `ddl/` 13개 파일 (총 9,862줄)
> **상태**: 미해결 18건. ~~차단 5~~ **해소 (2026-08-15)** · 높음 7 · 중간 9 · 낮음 2
> **후속**: [design-review-2.md](design-review-2.md) `DR-24`~`DR-37` (차단 4) · [design-review-3.md](design-review-3.md) `DR-38`~`DR-49` (차단 2) · [design-review-4.md](design-review-4.md) `DR-50`~`DR-60` (차단 1) · [design-review-5.md](design-review-5.md) `DR-61`~`DR-65` (차단 0) · [design-review-6.md](design-review-6.md) `DR-66`~`DR-72` (차단 1) · [design-review-7.md](design-review-7.md) `DR-73`~`DR-77` (차단 0) · [design-review-8.md](design-review-8.md) `DR-78`~`DR-82` (차단 0) · [design-review-9.md](design-review-9.md) `DR-83`~`DR-86` (차단 0). 아홉 문서 합계 **86건 · 차단 13 — 2026-08-15 전부 해소** (`DR-38`만 부분 해소)

이 문서는 **설계 문서 세트의 일부가 아니라 그것에 대한 검토 결과**다. 각 항목이 해소되면
해당 설계 문서에 반영하고 여기서는 `해소`로 표시한다. 반영 대상 문서·절은 [§4](#4-문서-반영-필요-목록)에 있다.

> ## 진행 — 1단계 차단 13건 반영 (2026-08-15)
>
> 아홉 회차의 **차단 13건을 설계 문서와 `ddl/`에 반영했다.** `DR-38`만 부분 해소다.
>
> | 항목 | 반영 | 위치 |
> |---|---|---|
> | `DR-01` suspense 해소 경로 | `shortage_expense`·`overage_income` 계정 + `suspense_resolve` 거래종류 + `op_resolve_suspense()` | `001`·`003`·`004`·`009`·`012` · [04 §11-2](04-posting-rules.md) · [05 §3-3](05-api-contract.md) |
> | `DR-02` 자정 넘긴 게임 | `op_freeze_period`의 진행 중 게임 검사 제거 (판정 기준을 "새 거래 유입 없음"으로) | `011` |
> | `DR-03` 재인증 자기신고 | `identity.step_up_tokens` + `consume_step_up()` + `identity_app` 역할 분리. **`op_*` 19개의 `p_auth_method`를 `p_step_up_id`로 교체** | `002`·`009`·`010`·`011`·`012` · [05 §6-2](05-api-contract.md) |
> | `DR-04` 멱등키 만료 모순 | `begin_idempotent`가 캐시 만료·삭제 양쪽에서 `transactions`를 확인 → `422` | `008` · [05 §2-3](05-api-contract.md) |
> | `DR-05` 해시 체인 직렬화 | `ledger.chain_policy` + `post_transaction` 분기 + 봉인 검사·R3·마감 검사 필터 + `audit.merkle_anchors`·R9 | `004`·`007`·`008`·`011`·`013` |
> | `DR-24` 정의자 뷰 | 뷰 13개에 `security_invoker` + `integrity_ok()` 정의자화 + 드리프트 검사 뷰 | `007`·`013` |
> | `DR-25` audit 조회 역할 부재 | `audit_reader` 신설 | `012` · [06 §4-1](06-security.md) |
> | `DR-26` 앵커 대조 부재 | R8 `v_check_chain_anchor` + `audit_anchorer` 분리 + 외부 서명 규약 | `007`·`012`·`013` · [06 §9-2](06-security.md) |
> | `DR-27` 생성 열 함정 | 트리거가 식을 직접 평가 + 저장소 전수 확인(같은 함정 1곳뿐) | `006` |
> | `DR-38` op 없는 도메인 | **부분** — `op_load_opening_balance()` 추가. 베팅·포인트·쉐어는 `A1`·`A2` 보류와 `DR-68` 사업 결정에 묶여 남는다 | `001`·`002`·`011`·`012` · [07 §3-1](07-migration.md) |
> | `DR-39` 승인 임계 NULL | `NOT NULL` + 시드 값(잠정) + NULL 거부 | `001`·`009` · [05 §6-4](05-api-contract.md) |
> | `DR-50` 역분개 경로 | `op_reverse_transaction()` + `approval_subject.reversal` + `ledger.reverse` 권한 + GRANT | `001`·`002`·`011`·`012` · [05 §3-6](05-api-contract.md) |
> | `DR-66` 롤링 커미션 정산 | `commission_payout` 거래종류 + 분개 2행 + `cage.commission_settlements` + `op_settle_commission()` | `001`·`002`·`004`·`005`·`010`·`012` · [04 §6-1](04-posting-rules.md) · [05 §3-2](05-api-contract.md) |
>
> **함께 해소된 것**: [9차](design-review-9.md) `DR-84`(요율 권위 — `games.commission_rate_bp` 스냅샷, `bet_type`은 표시용 격하)와 `DR-85`(재정산 방지 — 롤링 소진량 제약)는 `DR-66` 설계에 편입됐다.
>
> ⚠️ **검증되지 않았다.** 이 환경에 PostgreSQL이 없다. `ddl/README.md`가 기록한 마지막 클린 적용 확인은 2026-08-14이고 **위 변경은 그 이후다.** 특히 `DR-03`은 함수 19개의 시그니처와 `012`의 `GRANT` 인자 목록을 함께 바꾼 기계적 일괄 변경이라, 실제 `psql` 적용 확인 전에는 완료로 보지 않는다. 검증 방법은 [ddl/README.md](ddl/README.md) 참조.
>
> **바뀌지 않은 것**: 높음 이하 73건. 그것들이 [2단계](00-system-map.md)의 대상이다.

ID 접두사 `DR-`는 저장소의 기존 체계(`TA-` · `G-` · `P-` · `M*` · `A*` · `U*`)와 충돌하지 않는다
— [`00-system-map.md` §7](00-system-map.md) 참조.

## 검토 방법

문서와 DDL을 **서로 대조**했다. 문서가 약속한 것이 DDL에 있는지, DDL이 하는 일이 문서와 같은지를
항목별로 확인했다. 코드 인용은 전부 실제 파일에서 가져왔고 줄 번호를 명시한다.

**확인하지 않은 것**: 실제 PostgreSQL 18 인스턴스에서의 런타임 동작. `ddl/` 전 파일이 클린
적용된다는 사실은 [`00-system-map.md` §8](00-system-map.md)이 기록하지만, **연산 함수의 동작을
검증한 테스트는 존재하지 않는다** (DR-12).

---

## 1. 요약

| ID | 항목 | 등급 | 영향 | 근거 |
|---|---|---|---|---|
| [DR-01](#dr-01) | `suspense` 해소 경로 부재 → 기간 마감 영구 불가 | ~~차단~~ **해소** | M1 | `011:309` · `004:213` |
| [DR-02](#dr-02) | 자정 넘긴 게임이 기간 동결을 막는다 | ~~차단~~ **해소** | M1 | `011:284` · `005:236` |
| [DR-03](#dr-03) | 재인증(`auth_method`)을 애플리케이션이 자기신고한다 | ~~차단~~ **해소** | M1 | `009:206` · `06 §2` |
| [DR-04](#dr-04) | 멱등키 24시간 만료가 `transactions` UNIQUE와 모순 | ~~차단~~ **해소** | M1 | `008:165` · `004:64` |
| [DR-05](#dr-05) | 해시 체인이 전 거래를 직렬화 — 베팅 제외 미구현 | ~~차단~~ **해소** | M1 | `008:387` · `03 §7-5` |
| [DR-06](#dr-06) | 다통화가 반쪽 — 하우스 계정 PHP만, 환전 연산 없음 | 높음 | M1 | `003:298` |
| [DR-07](#dr-07) | 포인트 · 파트너 쉐어 연산 함수가 전무 | 높음 | M2 | `ddl/` 전체 |
| [DR-08](#dr-08) | 파트너 · 회원지갑 · 포인트 계정 개설 경로 없음 | 높음 | M2 | `011:455` |
| [DR-09](#dr-09) | `409 request-in-progress`가 도달 불가 + 무한 대기 | 높음 | M1 | `008:182` · `05 §2-2` |
| [DR-10](#dr-10) | `outbox`에 지점 경계가 없다 | 높음 | M2 | `012:159` |
| [DR-11](#dr-11) | 롤링 정정이 지점 누계를 오염시킨다 | 높음 | M2 | `010:328` · `005:101` |
| [DR-12](#dr-12) | 골든 테스트 0건 · CI에 DB 없음 | 높음 | M0 | `07 §7` |
| [DR-13](#dr-13) | 게임 취소가 손님 잔액 부족으로 실패, 회복 경로 없음 | 중간 | M2 | `010:588` |
| [DR-14](#dr-14) | `op_deposit`에 재인증 요구가 없다 | 중간 | M1 | `009:120` |
| [DR-15](#dr-15) | 분할 출금(structuring) 방어 없음 | 중간 | M1 | `009:86` |
| [DR-16](#dr-16) | 파트너 운영자가 전 직원 목록을 조회할 수 있다 | 중간 | M2 | `012:144` |
| [DR-17](#dr-17) | 윈로스 원천이 둘 — 스냅샷과 뷰가 갈린다 | 중간 | M2 | `010:519` · `013:350` |
| [DR-18](#dr-18) | 게임 개설 중복이 매핑되지 않은 23505로 터진다 | 중간 | M2 | `010:106` |
| [DR-19](#dr-19) | 파생 멱등키가 규약 밖에 있다 | 중간 | M1 | `011:185` · `010:589` |
| [DR-20](#dr-20) | U1 · U2 미확정 상태로 M0 종료 불가 | 중간 | M0 | `08 §미확정` |
| [DR-21](#dr-21) | M11 계좌 마스터 수집 실행 계획 부재 | 중간 | M0 | `07 §2-3` |
| [DR-22](#dr-22) | 분개 0행 거래에 대한 최종 방어선 부재 | 낮음 | M1 | `004:294` |
| [DR-23](#dr-23) | `entry_category.reversal`이 죽은 값 | 낮음 | — | `004:246` |

> **등급 정의**
> **차단** — 해소 전에 M1을 시작하면 원장 코어를 다시 열어야 한다
> **높음** — 해당 마일스톤 착수 첫날 막힌다
> **중간** — 운영 중 발현. 사전 설계로 비용이 크게 줄어든다
> **낮음** — 정리 대상

---

## 2. 차단 항목

### DR-01

**`suspense` 잔액을 0으로 되돌리는 연산이 존재하지 않는다. 실사 차액이 한 번 발생하면 그 지점은 다시 마감되지 않는다.**

#### 증상

```
1. 실사에서 차액 발생 → op_record_balancing 이 adjustment 거래 생성
   house_cash  +V  /  suspense  −V         (또는 반대)
2. suspense 잔액 ≠ 0
3. op_freeze_period 호출 → 거부
4. suspense 를 0으로 되돌릴 op_* 함수가 없다 → 3으로
```

#### 근거

[`db/schema/011_operations_admin.sql:304-313`](../../db/schema/011_operations_admin.sql#L304):

```sql
SELECT COALESCE(sum(b.balance_minor), 0) INTO v_suspense
  FROM ledger.accounts a ... WHERE a.kind = 'suspense' AND p.home_branch = p_branch;
IF v_suspense <> 0 THEN
  RAISE EXCEPTION 'cannot freeze %/%: suspense balance is % (미해소 차액)', ...
```

[`db/schema/004_ledger.sql:241`](../../db/schema/004_ledger.sql#L241) — `posting_rules`에서 `suspense`가 등장하는
조합은 `adjustment` 하나뿐이다:

```sql
('adjustment', 'adjustment', 'house_cash',  1),
('adjustment', 'adjustment', 'house_cash', -1),
('adjustment', 'adjustment', 'suspense',    1),
('adjustment', 'adjustment', 'suspense',   -1),
```

`op_adjustment`를 다시 호출해도 `house_cash ↔ suspense` 사이를 왕복할 뿐이다. 차액을 **최종
귀착시킬 계정**이 `ledger.account_kind`에 없다.

[`04-posting-rules.md` §11](04-posting-rules.md)은 이렇게 쓴다:

> `suspense` 잔액이 0이 아니면 알람이 울린다. **원인을 조사해 확정 분개로 해소해야 한다.**

그 "확정 분개"가 정의되지 않았다.

#### 왜 심각한가

실사 차액은 예외 상황이 아니라 **실사의 정상 산출물**이다. 차액이 나지 않는다면 실사할 이유가 없다.
현행 시스템은 차액을 `memberCompanyDiffVal` 스칼라에 숫자로 남기고 넘어간다 — 나쁜 설계지만 멈추지는
않는다. 신규 설계는 멈춘다.

그리고 멈춘 상태에서 사람이 하는 일은 정해져 있다: **DBA에게 직접 UPDATE를 요청한다.** 그 순간
불변식 전체가 무의미해진다. 탈출구 없는 제약은 우회를 만든다.

#### 개선 방안

차액의 **종착지 계정**을 만들고, 해소 연산과 분개 규칙을 정의한다.

**(1) 계정 종류 추가** — [`ddl/001`](../../db/schema/001_types_and_extensions.sql)

```sql
-- ledger.account_kind 에 추가
'shortage_expense',   -- debit   실사 부족분 확정 손실 (하우스 부담)
'overage_income'      -- credit  실사 과잉분 확정 이익
```

`ledger.tx_kind`에 `suspense_resolve` 추가. `ledger.entry_category`에
`suspense_resolve_out` · `suspense_resolve_in` 추가.

> [`ddl/003:63-120`](../../db/schema/003_accounts.sql#L63)의 `assert_account_kind_consistent()` CASE 문에
> 두 종류를 함께 추가해야 한다. 빠뜨리면 `v_expected IS NULL` 분기가 잡아 준다 — 그 방어가
> 여기서 실제로 작동한다.

**(2) 분개 정의** — [`04-posting-rules.md`](04-posting-rules.md)에 §11-2 신설

부족분 확정 (`suspense` 차변 잔액 V > 0 해소):

| 계정 | 부호 | 금액 | `category` |
|---|---|---|---|
| `shortage_expense[branch]` | `+` | V | `suspense_resolve_in` |
| `suspense[branch]` | `−` | V | `suspense_resolve_out` |

과잉분 확정 (`suspense` 대변 잔액 V < 0 해소)은 부호 반전 — `overage_income` 대변.

**(3) 연산 함수** — `ddl/009`에 `ledger.op_resolve_suspense()`

```sql
-- 필수 조건
--   · 4-eyes 승인 (금액 무관 — op_adjustment 와 동일 등급)
--   · p_resolution TEXT NOT NULL — 조사 결과를 반드시 기록한다
--   · 호출 후 suspense 잔액이 정확히 0 이 되어야 한다 (부분 해소 금지)
--   · 현재 잔액을 함수가 직접 읽어 금액을 정한다. 호출자가 지정하지 않는다
```

`identity.approval_subject`에 `suspense_resolve` 추가.

**(4) 마감 조건은 그대로 둔다.** `op_freeze_period`가 `suspense ≠ 0`을 거부하는 것은 옳다.
해소 경로가 생기면 그 제약이 정당해진다.

#### 검증

- 차액 발생 → 해소 → 마감의 전 경로 골든 테스트 1건
- `R5`(`v_check_suspense`)가 해소 후 `ok = true`로 복귀
- 4-eyes 없이 `op_resolve_suspense` 호출 시 `approval-required`

---

### DR-02

**영업일 컷오프를 넘겨 진행 중인 게임이 있으면 그 영업일은 영구히 동결되지 않는다.**

#### 근거

[`db/schema/011_operations_admin.sql:284-291`](../../db/schema/011_operations_admin.sql#L284):

```sql
SELECT count(*) INTO v_open_games
  FROM cage.games
 WHERE branch = p_branch AND business_date = p_business_date AND status = 'ongoing';
IF v_open_games > 0 THEN
  RAISE EXCEPTION 'cannot freeze %/%: % ongoing game(s)', ...
```

`cage.games.business_date`는 **개설 시점**에 확정된다 —
[`db/schema/010_operations_game.sql:122`](../../db/schema/010_operations_game.sql#L122):

```sql
ledger.business_date_of(p_branch, clock_timestamp())
```

컷오프는 06:00 — [`ddl/001:199`](../../db/schema/001_types_and_extensions.sql#L199).

#### 왜 심각한가

**게임을 끝내는 것으로 피해 갈 수 없다.** 게임 종료는 `chips_outstanding = 0`을 요구한다 —
[`ddl/005:236`](../../db/schema/005_games_rolling.sql#L236). 손님이 칩을 들고 앉아 있으면 종료가
DB 레벨에서 거부된다. 즉:

```
새벽 3시 게임 개설 (business_date = D-1)
오전 6시 컷오프
오전 10시 — D-1 을 동결하려 한다 → 거부. 그 게임이 ongoing
게임은 손님이 칩을 반납할 때까지 끝낼 수 없다
D-1 은 그때까지 열려 있다
```

VIP 세션이 며칠 이어지면 그 기간 전부가 동결 불가다. 그리고 `op_settle_period`는 `frozen`을
전제하므로 **월정산도 연쇄로 막힌다** —
[`ddl/011:369`](../../db/schema/011_operations_admin.sql#L369).

카지노에서 게임이 영업일 경계를 넘는 것은 예외가 아니라 **정상 운영**이다.

#### 개선 방안

세 가지 선택지. **(A)를 권장한다.**

**(A) 게임을 영업일에 묶지 않는다 — 기간 마감의 판정 기준을 바꾼다**

동결이 보장해야 하는 것은 "이 영업일에 **새 거래가 들어오지 않는다**"이지 "이 영업일에 시작한
모든 활동이 끝났다"가 아니다. 게임 정산 거래는 이미 **정산 시점의 영업일**로 귀속된다 —
`post_transaction`이 `business_date_of(clock_timestamp())`를 쓰기 때문이다
([`ddl/008:360`](../../db/schema/008_post_transaction.sql#L360)). 진행 중 게임이 남아 있어도 그 게임의
미래 거래는 미래 기간으로 간다.

```sql
-- op_freeze_period 에서 진행 중 게임 검사를 제거한다.
-- 남는 검사: 미봉인 거래(v_unsealed) · suspense 잔액 · 상태 전이 잠금
```

`cage.games.business_date`는 통계·조회용으로 남기되 마감 판정에서 제외한다.
**단, 이 변경은 "게임 단위 정산 이력이 여러 기간에 걸칠 수 있다"를 받아들이는 것이다** —
[`04 §7-4`](04-posting-rules.md)의 `game_settlements`가 이미 그렇게 설계돼 있으므로 모순이 없다.

**(B) 게임 이월 연산을 만든다**

`cage.op_rollover_game()` — 진행 중 게임의 `business_date`를 다음 영업일로 옮기고 이월 이력을
남긴다. 게임은 끊기지 않고 기간은 닫힌다.

```sql
CREATE TABLE cage.game_rollovers (
  game_id       BIGINT NOT NULL REFERENCES cage.games,
  from_date     DATE NOT NULL,
  to_date       DATE NOT NULL,
  staff_id      BIGINT NOT NULL REFERENCES identity.staff,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (game_id, from_date)
);
```

`op_freeze_period`가 진행 중 게임을 발견하면 자동 이월하거나, 이월 없이는 거부한다.
(A)보다 이력이 명시적이지만 테이블과 연산이 하나씩 는다.

**(C) 강제 종료 + 재개설 (권장하지 않음)**

칩 잔액을 강제로 다음 게임으로 넘긴다. 게임 단위 윈로스가 잘리고 `chips_outstanding = 0`
불변식에 특수 분기를 내야 한다. **불변식에 예외를 만드는 방식이라 채택하지 않는다.**

#### 검증

- D-1 03:00 게임 개설 → 06:00 이후 D-1 동결 성공 → 그 게임이 D+0에 정상 정산
- 동결 후 D-1로 귀속되는 신규 거래가 `period-frozen`으로 거부되는지
- 진행 중 게임의 정산 거래가 D+0 기간으로 들어가는지

---

### DR-03

**`op_*`의 `p_auth_method`는 애플리케이션이 자유롭게 지정하는 문자열이다. 재인증이 실제로 일어났는지 DB가 확인할 방법이 없다.**

#### 근거

[`db/schema/009_operations_money.sql:206-210`](../../db/schema/009_operations_money.sql#L206):

```sql
IF p_auth_method NOT IN ('withdraw_pw', 'totp', 'approval') THEN
  RAISE EXCEPTION 'withdraw requires step-up auth (withdraw_pw · totp · approval), got %',
    p_auth_method
    USING ERRCODE = 'insufficient_privilege', HINT = 'step-up-required';
```

같은 패턴이 여섯 곳: `op_withdraw`(`009:206`) · `op_transfer`(`009:275`) ·
`op_open_game`(`010:94`) · `op_add_buyin`(`010:225`) · `op_settle_game`(`010:404`) ·
`op_cast_vote`(`011:97`).

검사 대상이 **입력 파라미터 그 자체**다. `ledger_app`이 `'withdraw_pw'`를 넘기면 통과한다.
그리고 그 값이 [`ddl/004:70`](../../db/schema/004_ledger.sql#L70)의 `transactions.auth_method`에 그대로
저장된다.

#### 왜 심각한가

[`06-security.md` §2](06-security.md)의 핵심 주장이 여기서 성립하지 않는다:

> **각 계층이 아래 계층을 신뢰하지 않는다.** 앱이 뚫려도 DB 불변식이 남고, DB 계정이 뚫려도 트리거가 남는다.

두 가지가 무너진다.

1. **인가 우회.** 침해된 `ledger_app` 자격증명이 재인증 없이 출금을 실행할 수 있다.
   [ADR-017](08-adr.md)이 인정한 "특정 직원을 사칭할 수는 있으나 존재하지 않는 권한을 만들어 낼
   수는 없다"보다 한 단계 더 나쁘다 — **재인증은 권한이 아니라 사실이고, 그 사실을 앱이
   날조할 수 있다.**
2. **감사 무효.** [`06 §3-4`](06-security.md)가 "어떤 인증으로 승인된 거래인지 사후에 확인할 수
   있다"고 약속한 컬럼이, 실제로는 **앱이 무엇이라고 주장했는지**만 기록한다.

같은 문서 안에서 4-eyes는 다르게 처리된다. `identity.consume_approval()`이 투표 행을 실제로
세고 payload를 대조한다 — [`ddl/002:316`](../../db/schema/002_identity.sql#L316). **승인은 DB가 검증하는데
재인증은 앱이 자기신고한다.** 신뢰 모델이 두 갈래다.

#### 개선 방안

**4-eyes와 같은 패턴을 재인증에도 적용한다.** 이미 방 안에 있는 해법이다.

**(1) 1회용 step-up 토큰** — `ddl/002`

```sql
CREATE TABLE identity.step_up_tokens (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id     BIGINT NOT NULL REFERENCES identity.staff,
  method       identity.auth_method NOT NULL,   -- pin | totp | withdraw_pw
  device_id    TEXT NOT NULL,
  scope        TEXT NOT NULL,                   -- 'ledger.withdraw' 등 permission 문자열
  issued_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at   TIMESTAMPTZ NOT NULL,            -- 수명 짧게 (90초 권장)
  consumed_at  TIMESTAMPTZ,
  consumed_tx  BIGINT REFERENCES ledger.transactions
);
```

발급 주체는 **Identity 서비스뿐이다.** PIN/TOTP/출금비밀번호를 실제로 검증한 직후에만 행을 만든다.
`ledger_app`은 이 테이블에 INSERT 권한이 없다 — **`identity_app` 역할이 별도로 필요하다.**
이 역할 분리가 이 대책의 핵심이다. 한 역할이 발급과 소비를 모두 할 수 있으면 원래 문제로 돌아간다.

**(2) 소비 함수** — `identity.consume_step_up()`

```sql
-- consume_approval() 과 같은 구조:
--   1. FOR UPDATE 잠금
--   2. consumed_at IS NULL · 미만료
--   3. staff_id 일치
--   4. device_id 일치            ← 다른 단말의 토큰을 훔쳐 쓰는 경로 차단
--   5. scope 가 요구 permission 을 덮는가
--   6. method 가 연산이 요구하는 등급인가
--   7. consumed_at · consumed_tx 기록 → 1회용
-- 반환: 실제로 사용된 method (transactions.auth_method 에 이 값을 저장한다)
```

**(3) `op_*` 시그니처 변경**

`p_auth_method identity.auth_method` → `p_step_up_id BIGINT`.
`auth_method = 'system'`(배치·마이그레이션)만 토큰 없이 허용하고, 그 경로는
`ledger_migrator` 역할로 분리한다 — `ledger_app`이 `'system'`을 참칭하는 경로를 없앤다.

#### 왜 지금인가

`op_*` 함수는 M1에서 확정된다. M2가 끝난 뒤에 하면 **함수 17개의 시그니처와 그에 딸린
`GRANT EXECUTE` 전부**를 바꾸는 일이 된다 — [`ddl/012:60-105`](../../db/schema/012_roles_and_grants.sql#L60)는
인자 타입을 전부 나열한다.

#### 검증

- 토큰 없이 `op_withdraw` 호출 → `step-up-required`
- 같은 토큰 두 번 사용 → 거부
- A 단말 토큰으로 B 단말에서 실행 → 거부
- 만료 토큰 → 거부
- `ledger_app`으로 `step_up_tokens` INSERT 시도 → `permission denied`

---

### DR-04

**멱등키 24시간 만료 재사용과 `transactions.idempotency_key UNIQUE`가 서로 모순된다. 만료 후 같은 키로 요청하면 매핑되지 않은 23505로 터진다.**

#### 근거

[`db/schema/008_post_transaction.sql:164-174`](../../db/schema/008_post_transaction.sql#L164):

```sql
-- 만료된 키는 새 요청으로 취급한다 (보존 24시간)
IF v_row.expires_at <= clock_timestamp() THEN
  UPDATE ledger.idempotency_keys
     SET request_fingerprint = p_fingerprint, state = 'in_progress', ...
  RETURN ROW(TRUE, NULL::INT, NULL::JSONB, NULL::BIGINT)::ledger.idem_result;
END IF;
```

`fresh = TRUE`를 받은 호출자는 연산을 진행한다. 그런데
[`ddl/004:64`](../../db/schema/004_ledger.sql#L64):

```sql
idempotency_key TEXT NOT NULL UNIQUE,
```

**원 거래는 24시간이 지나도 그 키를 들고 있다.** `post_transaction`의 INSERT가
`unique_violation`(23505)으로 실패한다.

#### 왜 심각한가

두 문장이 동시에 참일 수 없다:

| 출처 | 주장 |
|---|---|
| [`05 §2-3`](05-api-contract.md) | 만료된 키는 **새 요청으로 취급된다** |
| [`04 §17`](04-posting-rules.md) · `004:64` | 같은 멱등키는 **거래 1건** (불변식 I4) |

그리고 발생하는 오류가 [`05 §7`](05-api-contract.md) 표준 오류 목록에 **없다**. API 계층이
`insufficient-balance`도 `idempotency-key-reused`도 아닌 raw 23505를 받아 500을 뱉는다.

자연키를 쓰는 연산에서 특히 어긋난다. `game_end:{game_no}` · `mid_settle:{game_no}:{seq}` ·
`bet:{round_id}:{member}:{bet_type}`는 **영구 유일해야 하는 값**이라 24시간 만료 개념 자체가
맞지 않는다.

#### 개선 방안

**만료 정책을 두 갈래로 나눈다.** 하나의 테이블이 두 가지 일을 하고 있는 것이 근본 원인이다.

| | **응답 캐시** | **거래 유일성** |
|---|---|---|
| 목적 | 재시도에 저장된 응답 재생 | 같은 사건을 두 번 기록하지 않음 |
| 수명 | 24시간 (IETF 초안 요구) | **영구** |
| 저장 | `ledger.idempotency_keys` | `transactions.idempotency_key UNIQUE` |

**(1) 만료 분기를 고친다** — `begin_idempotent`

```sql
IF v_row.expires_at <= clock_timestamp() THEN
  -- 응답 본문은 만료됐지만 거래는 남아 있을 수 있다.
  IF EXISTS (SELECT 1 FROM ledger.transactions WHERE idempotency_key = p_key) THEN
    RAISE EXCEPTION 'idempotency key % was already used by a committed transaction', p_key
      USING ERRCODE = 'invalid_parameter_value', HINT = 'idempotency-key-reused';
  END IF;
  -- 거래가 없으면 진짜로 새 요청이다 (실패했거나 자금 이동이 없는 연산)
  UPDATE ledger.idempotency_keys SET ... ;
  RETURN ROW(TRUE, ...);
END IF;
```

**(2) 최소 요약을 영구 보존한다 (선택)**

`purge_expired_idempotency()`가 행을 지우기 전에 `key → transaction_id` 매핑만
`ledger.idempotency_archive`로 옮기면, 만료 후 재시도에도 오류 대신
"이미 처리됨 + 거래 식별자"를 돌려줄 수 있다. **화면이 다음 행동을 안내할 수 있다.**

**(3) 문서 정정** — [`05 §2-3`](05-api-contract.md)

"만료된 키는 새 요청으로 취급된다"를 삭제하고 위 두 갈래를 명시한다.
**보존 기간이 24시간인 것은 응답 본문이지 키 자체가 아니다.**

#### 검증

- 성공한 거래의 키를 25시간 뒤 재사용 → `422 idempotency-key-reused` (500 아님)
- 실패한(롤백된) 요청의 키를 25시간 뒤 재사용 → 정상 처리
- `purge_expired_idempotency()` 실행 후에도 위 두 동작이 유지되는지

---

### DR-05

**모든 자금 거래가 지점 해시 체인 헤드를 `FOR UPDATE`로 잠근다. 문서가 명시한 "베팅은 체인 제외" 예외가 구현되어 있지 않다.**

#### 근거

[`db/schema/008_post_transaction.sql:386-393`](../../db/schema/008_post_transaction.sql#L386):

```sql
-- ---- 잠금 3: 해시 체인 헤드 ----------------------------------------------
SELECT last_hash INTO v_prev_hash
  FROM ledger.chain_heads WHERE branch = p_branch FOR UPDATE;
```

`p_kind`를 보지 않는다. 예외 분기가 없다.

[`03-ledger-model.md` §7-5](03-ledger-model.md):

> **처리량 주의:** 플레이어 베팅처럼 고빈도 거래에 지점 체인을 걸면 병목이 된다.
> **베팅은 체인 대상에서 제외하고 일 단위 머클 앵커링으로 대체한다.** ADR-006.

[`04 §13`](04-posting-rules.md)도 같은 문장을 반복한다. **DDL에는 없다.**

#### 왜 심각한가

`ledger.chain_heads`는 **지점당 1행**이다 — [`ddl/004:47`](../../db/schema/004_ledger.sql#L47).
`ONLINE` 지점의 모든 자금 거래가 그 한 행 뒤에 직렬화된다.

아바타 39초 루프 · 스피드 21초 루프에서 라운드마다 `bet` + `payout`이 발생한다
([`00-system-map.md` §2](00-system-map.md)). 테이블 수 × 회원 수만큼의 거래가 **전역 단일
잠금**을 통과해야 한다.

M3(Player & Game)이 보류 중이라 지금은 발현하지 않는다. **그래서 지금 고쳐야 한다.**
`post_transaction()`은 M1에서 확정되고, 보류된 것은 `game` 스키마이지 원장 코어가 아니다.
M3에 가서 발견하면 **원장 코어 재수술 + 그 위에 쌓인 M2 전부의 회귀**가 된다.

#### 개선 방안

**(1) 체인 대상 판정을 데이터로 만든다** — `ddl/004`

```sql
CREATE TABLE ledger.chain_policy (
  kind     ledger.tx_kind PRIMARY KEY,
  chained  BOOLEAN NOT NULL
);
-- 고빈도 거래는 체인 제외, 나머지는 포함
INSERT INTO ledger.chain_policy
SELECT k, k NOT IN ('bet','payout')
  FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k;
```

`posting_rules`와 같은 방식이다 — `tx_kind`에 값이 추가될 때 정책을 빠뜨릴 수 없게 데이터화한다.

**(2) `post_transaction` 분기**

```sql
SELECT chained INTO v_chained FROM ledger.chain_policy WHERE kind = p_kind;

IF v_chained THEN
  SELECT last_hash INTO v_prev_hash FROM ledger.chain_heads WHERE branch = p_branch FOR UPDATE;
  ... 봉인 ...
ELSE
  -- 체인 밖 거래. hash / prev_hash 는 NULL 로 남는다.
END IF;
```

**(3) 봉인 검사와 체인 검증을 함께 고친다 — 이것을 빠뜨리면 다른 곳이 깨진다**

| 대상 | 현재 | 변경 |
|---|---|---|
| `transactions_sealed` 지연 트리거 ([`004:489`](../../db/schema/004_ledger.sql#L489)) | 모든 거래가 `hash NOT NULL` | 체인 대상만 |
| `v_check_hash_chain` R3(a) ([`013:67`](../../db/schema/013_reconciliation.sql#L67)) | 전 거래를 `lag()`로 연결 | `WHERE chained` 필터 |
| `op_freeze_period` 미봉인 검사 ([`011:296`](../../db/schema/011_operations_admin.sql#L296)) | `hash IS NULL`이면 거부 | 체인 대상 중 미봉인만 |

**(4) 머클 앵커링을 실제로 설계한다** — 체인 밖 거래의 무결성 대체 수단

```sql
CREATE TABLE audit.merkle_anchors (
  branch        ledger.branch_code NOT NULL,
  business_date DATE NOT NULL,
  tx_kind       ledger.tx_kind NOT NULL,
  tx_count      BIGINT NOT NULL,
  merkle_root   BYTEA NOT NULL,
  anchored_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  anchor_ref    TEXT,
  PRIMARY KEY (branch, business_date, tx_kind)
);
```

**ADR-006이 이 테이블을 전제하는데 [`ddl/007`](../../db/schema/007_outbox_audit.sql)의 `audit.chain_anchors`는
체인 헤드용이다.** 머클 루트 계산 방식(정렬 기준 · 리프 직렬화)을 `canonical_digest()`처럼
함수 하나로 고정해야 기록과 검증이 갈리지 않는다 — [`008:95`](../../db/schema/008_post_transaction.sql#L95)가
같은 이유로 그렇게 돼 있다.

#### 검증

- `bet` 거래 다수 동시 삽입 시 `chain_heads` 잠금 대기가 발생하지 않는지
- `deposit` 거래는 여전히 체인에 연결되는지
- R3(a)가 체인 밖 거래를 위반으로 잡지 않는지
- `op_freeze_period`가 체인 밖 거래 때문에 거부하지 않는지

---

## 3. 높음 이하

### DR-06

**다통화가 설계에는 있고 DDL에는 없다. PHP 외 통화로 자금 연산을 호출하면 실패한다.**

`ledger.currencies`에 PHP · USD · KRW 3종이 있고
([`ddl/001:186`](../../db/schema/001_types_and_extensions.sql#L186)), [`03 §5-1`](03-ledger-model.md)은
"손님이 PHP와 USD를 모두 보유하면 계정이 2개"라고 설계한다.

그런데 하우스 계정 부트스트랩은 **PHP만 만든다** —
[`ddl/003:297-298`](../../db/schema/003_accounts.sql#L297):

```sql
INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
VALUES (v_party, v_kind, 'PHP', v_normal, v_negok);
```

`op_deposit(p_currency := 'USD')`를 호출하면 `house_account_id`가 `no_data_found`로 터진다
([`ddl/008:595`](../../db/schema/008_post_transaction.sql#L595)). [`05 §7`](05-api-contract.md) 오류 표에도 없다.

그리고 **환전 연산이 정의되지 않았다** — [`08-adr.md` U2](08-adr.md)가 인정한다.
`tx_kind`에 `fx_exchange`가 없고 `posting_rules`에도 통화 간 분개가 없다. 현행 설계는
**분개 합 = 0을 통화별로 요구**하므로, 통화 A를 B로 바꾸는 단일 거래는 구조적으로 만들 수 없다.

#### 개선 방안 — U2를 먼저 답한다

- **PHP 단일이면**: `ledger.currencies`를 PHP 1행으로 줄이고, `op_*`의 `p_currency` 기본값을
  제거하고 상수로 고정한다. `entries.currency` 컬럼은 남기되 확장 여지로만 둔다.
- **다통화를 쓴다면**: 부트스트랩 루프를 `currencies × account_kind`로 돌리고,
  `fx_exchange` 거래 종류와 환율 스냅샷(`ledger.fx_rates`)을 [`04`](04-posting-rules.md)에 추가한다.
  환전은 통화별 합이 각각 0이어야 하므로 **`fx_position` 계정을 경유하는 2분개 쌍**이 된다:

  ```
  fx_position[PHP] 차변 / member_deposit[PHP] 대변      ← PHP 통화 합 0
  member_deposit[USD] 차변 / fx_position[USD] 대변      ← USD 통화 합 0
  두 fx_position 잔액의 환율 환산 차이 = 환차손익
  ```

  설계 분량이 작지 않다. **U2가 "안 쓴다"면 이 전부가 사라진다.**

---

### DR-07

**포인트 · 파트너 쉐어의 연산 함수가 하나도 없다. [`00-system-map.md` §8](00-system-map.md)의 A4 `✅ 완료` 표기가 사실과 다르다.**

| 산출물 | 위치 | 상태 |
|---|---|---|
| `account_kind`에 `player_points` · `partner_share_payable` · `commission_expense` | [`001:55-64`](../../db/schema/001_types_and_extensions.sql#L55) | ✅ |
| `entry_category` 5종 · `tx_kind` 4종 | [`001:88-108`](../../db/schema/001_types_and_extensions.sql#L88) | ✅ |
| `posting_rules` 8행 | [`004:226-234`](../../db/schema/004_ledger.sql#L226) | ✅ |
| 권한 문자열 `member.point_earn` · `partner.share_settle` 등 | [`002:145-148`](../../db/schema/002_identity.sql#L145) | ✅ |
| [`04 §13-2`](04-posting-rules.md) · [`§13-3`](04-posting-rules.md) 분개 정의 | 문서 | ✅ |
| **`op_point_earn` · `op_point_convert` · `op_share_accrue` · `op_share_settle`** | — | **없음** |

`ledger_app`은 `op_*`만 호출할 수 있다([`ddl/012:60`](../../db/schema/012_roles_and_grants.sql#L60)). 함수가
없으면 **그 분개를 만들 경로가 시스템에 존재하지 않는다.** 타입과 규칙표는 계약이고, 계약만으로는
아무것도 실행되지 않는다.

#### 개선 방안

1. [`00-system-map.md` §8](00-system-map.md)의 A4 상태를 `⚠ 부분 — 타입 · 규칙만`으로 정정한다.
   **나머지 `✅` 5건(A3 · A5 · A6 · A7 · A9)도 같은 기준으로 재검증한다** — "산출물 목록에
   적힌 파일이 존재하는가"가 아니라 "그 기능을 실행할 수 있는가"로.
2. `ddl/016_operations_partner.sql` 신설 — 위 4개 함수 + [`ddl/012`](../../db/schema/012_roles_and_grants.sql)에
   `GRANT EXECUTE`.
3. `op_share_accrue`의 멱등키는 [`04 §13-3`](04-posting-rules.md)이 정한
   `share_accrue:{partner_code}:{period_code}`를 그대로 쓴다 — 기간별 1회라 재계산해도 중복
   적립이 없다. **다만 요율 규칙(U3)이 미확정이므로 "무엇에 곱하는가"는 당분간 함수 인자로 받고
   계산은 호출자가 한다.** 규칙이 확정되면 함수 안으로 내린다.

---

### DR-08

**`member_deposit` 외의 계정을 만드는 경로가 없다. 파트너 주체를 등록할 방법 자체가 DDL에 없다.**

[`ddl/011:451-457`](../../db/schema/011_operations_admin.sql#L451) — `op_open_account`가 만드는 것:

```sql
INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
VALUES (p_account_code, 'member', ...);            -- party_type 이 'member' 로 고정

INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
VALUES (v_party, 'member_deposit', ...);           -- kind 가 'member_deposit' 로 고정
```

만들 수 없는 것:

| 계정 종류 | 필요한 곳 | 현재 |
|---|---|---|
| `player_wallet` | 회원 보유금 · `op_wallet_transfer`의 대상 | 개설 경로 없음 |
| `player_points` | 포인트 적립 · 전환 | 개설 경로 없음 |
| `partner_share_payable` | 파트너 쉐어 | 개설 경로 없음 |
| `party_type = 'partner'` 주체 | `partner_profiles` · `party_visible()` | **등록 경로 없음** |

`op_wallet_transfer`는 `account_id_of(p_member_code, 'player_wallet', ...)`를 호출한다
([`ddl/009:414`](../../db/schema/009_operations_money.sql#L414)). **그 계정을 만든 적이 없으므로 항상
`no_data_found`다.** [`04 §12`](04-posting-rules.md)가 정의한 신규 기능 전체가 동작하지 않는다.

#### 개선 방안 — [`ddl/011`](../../db/schema/011_operations_admin.sql)에 두 함수 추가

```sql
-- 1) 기존 주체에 계정을 추가한다. 계정 종류 화이트리스트로 제한.
ledger.op_open_ledger_account(p_party_code, p_kind, p_currency, ...)
--    허용: player_wallet · player_points · partner_share_payable
--    금지: house_* · chips_outstanding · opening_equity
--          (부트스트랩 · 게임개설 · 마이그레이션 전용)

-- 2) 파트너 주체 등록 + partner_profiles + partner_share_payable 을 한 트랜잭션에서
ledger.op_register_partner(p_partner_code, p_parent_code, p_share_rate_bp, ...)
```

`op_register_partner`가 **`depth = parent.depth + 1`을 강제해야 한다.**
[`ddl/003:232`](../../db/schema/003_accounts.sql#L232)의 `CHECK (depth BETWEEN 1 AND 8)`은 값 범위만 보고,
[`003:241`](../../db/schema/003_accounts.sql#L241)의 `partner_no_self_parent`는 직접 자기참조만 막는다.
A → B → A 순환은 아무도 막지 않는다.

`partner_subtree()`의 재귀 종료가 그 제약에 의존한다 —
[`ddl/012:277-284`](../../db/schema/012_roles_and_grants.sql#L277). `UNION`이 중복을 제거하므로 순환이 있어도
실제로는 종료하지만, **`WITH RECURSIVE`의 종료가 우연에 기대는 구조는 남기지 않는다.**
이 함수는 RLS 정책이 매 조회마다 호출한다.

---

### DR-09

**`409 request-in-progress`는 도달할 수 없는 코드다. 동시 요청은 409 대신 무한정 잠금 대기한다.**

[`ddl/008:182-186`](../../db/schema/008_post_transaction.sql#L182):

```sql
IF v_row.state = 'in_progress' THEN
  RAISE EXCEPTION 'request with idempotency key % is still in progress', p_key
    USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'request-in-progress';
```

같은 파일 [128-131줄](../../db/schema/008_post_transaction.sql#L128) 주석이 설계 의도를 스스로 설명한다:

> `DO UPDATE`는 그 행을 잠그고 **상대 트랜잭션이 끝날 때까지 대기한다.**

두 동작은 양립하지 않는다. 대기가 일어나면 409는 발생하지 않는다.

| 상대 트랜잭션 | B의 결과 |
|---|---|
| 커밋 | `state = 'completed'` → 저장된 응답 재생 |
| 롤백 | B의 INSERT 성공 → `fresh = TRUE` |

`state = 'in_progress'`가 **커밋된 채 남는 경로가 없다.** 연산과 `complete_idempotent()`가 같은
트랜잭션이기 때문이다.

**결과**: [`05 §2-2`](05-api-contract.md)의 409 행은 명세에만 존재하고, 실제로는 API가 상대
트랜잭션이 끝날 때까지 커넥션을 붙잡는다. 원 요청이 느리면 재시도가 쌓여 **커넥션 풀이 마른다.**

#### 개선 방안

1. **`lock_timeout`을 설정한다.** 연산 함수 진입 시 `SET LOCAL lock_timeout = '3s'`.
   타임아웃 시 `55P03`(`lock_not_available`)을 잡아 `request-in-progress`로 매핑한다.

   ```sql
   -- begin_idempotent 진입부
   SET LOCAL lock_timeout = '3s';
   BEGIN
     INSERT INTO ledger.idempotency_keys ... ON CONFLICT (key) DO UPDATE ...
   EXCEPTION WHEN lock_not_available THEN
     RAISE EXCEPTION 'request with idempotency key % is still in progress', p_key
       USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'request-in-progress';
   END;
   ```

2. **`statement_timeout`을 애플리케이션 커넥션에 전역 설정한다.** 이 문제와 무관하게
   자금 API에 필수다. [`02-target-architecture.md`](02-target-architecture.md)에 운영 파라미터
   절이 없다 — 신설한다.

3. [`05 §2-2`](05-api-contract.md)의 409 행에 "잠금 타임아웃 기준"임을 명시한다.

---

### DR-10

**`ledger.outbox`에 RLS가 없다. `ledger_app`이 전 지점의 거래 분개를 그대로 조회할 수 있다.**

[`ddl/012:158-160`](../../db/schema/012_roles_and_grants.sql#L158):

```sql
GRANT SELECT               ON ledger.outbox TO ledger_app;
GRANT UPDATE (published_at) ON ledger.outbox TO ledger_app;
```

`ledger.outbox.payload`에는 계좌 코드 · 계정 종류 · 금액 · 범주가 전부 들어 있다 —
[`ddl/008:481-495`](../../db/schema/008_post_transaction.sql#L481).

[`06 §4-3`](06-security.md)이 나열한 **RLS 대상 13개 테이블에 `outbox`가 없다.**
[`02 §4-2`](02-target-architecture.md)는 이렇게 주장한다:

> 신규 채널은 지점 스코프가 채널 이름에 들어가 **서버가 인가를 강제할 수 있다** — 다른 지점
> 데이터가 애초에 전송되지 않는다.

그 강제는 **Realtime Gateway의 애플리케이션 로직에만** 존재한다. DB 레벨 방어선이 없다.
`entries`에 RLS를 건 것과 같은 이유로([ADR-017](08-adr.md) — "조인 한 번으로 우회됐다")
`outbox`에도 필요하다.

#### 개선 방안 — 역할을 나눈다

relay는 정의상 전 지점을 봐야 하므로 RLS만으로는 풀리지 않는다.

```sql
-- 1) relay 전용 역할. outbox 만 본다.
CREATE ROLE ledger_relay NOLOGIN;
GRANT USAGE ON SCHEMA ledger TO ledger_relay;
GRANT SELECT, UPDATE (published_at) ON ledger.outbox TO ledger_relay;

-- 2) ledger_app 의 outbox 접근은 회수한다
REVOKE ALL ON ledger.outbox FROM ledger_app;

-- 3) 그래도 RLS 를 켠다.
--    relay 자격증명 침해에는 무력하지만, ledger_app 에 실수로 GRANT 가
--    다시 붙는 회귀를 기본거부로 잡는다.
ALTER TABLE ledger.outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY relay_all ON ledger.outbox FOR SELECT TO ledger_relay USING (TRUE);
```

Realtime Gateway는 `ledger_relay`로, API 서버는 `ledger_app`으로 붙는다.
[`02 §5-2`](02-target-architecture.md)의 역할 표에 `ledger_relay`를 추가한다.

---

### DR-11

**롤링 정정이 지점 누계를 오염시킨다. 바이인분 정정이 관측 롤링에서 차감된다.**

[`ddl/010:325-329`](../../db/schema/010_operations_game.sql#L325) — `op_record_rolling`은 항상 같은 값을 넣는다:

```sql
INSERT INTO cage.rolling_events
  (game_id, amount_minor, source, counts_toward_branch_total, staff_id, business_date)
VALUES
  (v_g.id, p_amount_minor, 'manual', TRUE, p_actor_staff_id, ...);
```

그리고 [`ddl/005:101-107`](../../db/schema/005_games_rolling.sql#L101)이 그 조합을 강제한다:

```sql
v_expected := (NEW.source = 'manual');
IF NEW.counts_toward_branch_total <> v_expected THEN RAISE EXCEPTION ...
```

`manual` ↔ `counts = TRUE`가 1:1로 묶여 있다.

**문제**: [`04 §6`](04-posting-rules.md)이 `op_record_rolling`의 `amount_minor`에 대해
"정정은 음수"라고 정의한다. 그런데 정정 대상이 **바이인 시드**(`source = 'buyin'`,
`counts = FALSE`)일 수 있다. 그 정정을 입력하면:

```
원본:  buyin        +2,000,000   counts = FALSE   → 지점 누계 미산입
정정:  manual       −2,000,000   counts = TRUE    → 지점 누계에서 차감

지점 관측 롤링 누계 = 넣은 적 없는 금액만큼 줄어든다
```

`cage.v_branch_rolling_total`([`ddl/013:331`](../../db/schema/013_reconciliation.sql#L331))과
`v_shift_counters.rolling_cash_shift`([`ddl/013:322`](../../db/schema/013_reconciliation.sql#L322))가 함께
틀린다. **R4는 이것을 잡지 못한다** — 게임별 총액은 여전히 이벤트 합과 일치하기 때문이다.

`op_cancel_game`은 이 문제를 정확히 인식하고 값별로 나눠 기록한다
([`ddl/010:599-609`](../../db/schema/010_operations_game.sql#L599)). **같은 인식이 `op_record_rolling`에는
적용되지 않았다.**

#### 개선 방안

```sql
-- op_record_rolling 에 정정 대상 인자를 추가한다
cage.op_record_rolling(..., p_corrects_source cage.rolling_source DEFAULT NULL)

-- p_corrects_source IS NULL       → source='manual', counts=TRUE   (신규 관측 입력)
-- p_corrects_source IS NOT NULL   → source='correction',
--                                    counts = (p_corrects_source = 'manual')
```

`assert_rolling_source_consistent`는 `correction`을 이미 예외 처리하므로 트리거 변경은 필요 없다
([`ddl/005:97`](../../db/schema/005_games_rolling.sql#L97)). [`04 §6`](04-posting-rules.md)에 정정 입력
규칙을 명시한다.

---

### DR-12

**DDL 9,862줄에 대한 골든 테스트가 0건이다. CI에 데이터베이스가 없다.**

검증된 것: `ddl/` 001~013이 PostgreSQL 18에 클린 적용된다는 사실
([`00-system-map.md` §8](00-system-map.md)).

검증되지 않은 것: **연산 함수가 만드는 분개가 [`04-posting-rules.md`](04-posting-rules.md)와
일치하는가.** 그 문서 첫 줄이 이렇게 선언한다:

> **이 표가 구현 계약이다.**

계약을 검증하는 테스트가 없다. [`07 §7`](07-migration.md)이 인정한다:

> **원장 재생 테스트와 대사 쿼리는 아직 없다.** ... CI에 DB를 붙이는 문제를 M0에서 함께 풀어야 한다.

**이 검토에서 나온 결함 대부분은 골든 테스트 한 벌이면 자동으로 드러났을 것들이다** —
DR-01(마감 불가) · DR-02(동결 불가) · DR-04(23505) · DR-06(`no_data_found`) ·
DR-08(`no_data_found`) · DR-11(누계 오염). 사람이 문서를 읽어서 찾을 일이 아니다.

#### 개선 방안 — M0의 첫 커밋

```
1. CI 에 PostgreSQL 18 컨테이너
2. ddl/ 001~013 순차 적용 → 스키마 스냅샷 고정
3. 골든 테스트 계층 3단
   (a) 분개 계약    04 의 각 절마다 op_* 호출 → entries 를 표와 정확 비교
   (b) 불변식       I1~I8 각각 "위반 시도 → 예외" 1건씩
   (c) 전 경로      개설 → 바이인 → 롤링 → 중간정산 → 종료 → 마감
                    개설 → 취소 (역분개 검증)
                    실사 차액 → 해소 → 마감 (DR-01 해소 후)
4. 대사 쿼리        시나리오 종료 시 v_integrity_status 전 항목 violations = 0
```

**(a)가 특히 중요하다.** `ledger.posting_rules` 테이블과 [`04`](04-posting-rules.md) 문서와
`op_*` 함수가 셋 다 같은 표를 표현하는데, 지금은 **셋이 일치하는지 아무도 확인하지 않는다.**

> [`07 §7`](07-migration.md)이 기록한 Track A의 함정을 반복하지 말 것 — **배포 트리거 경로
> 필터 누락으로 `firestore.rules` 변경이 배포되지 않던 인시던트**. CI 잡이 조용히 건너뛰면
> 테스트가 있어도 없는 것과 같다.

---

### DR-13

**게임 취소가 손님 잔액 부족으로 실패할 수 있고, 그때의 대응 절차가 없다.**

[`ddl/010:578-595`](../../db/schema/010_operations_game.sql#L578) — `op_cancel_game`은 칩 계정을 건드린
모든 거래를 역분개한다. 중간정산에서 손님 계좌로 입금된 건이 있으면 그 역분개는
`member_deposit` **차변**(+)이다 — 표시 잔액이 줄어든다.

손님이 이미 그 돈을 출금했으면 `member_deposit` 잔액이 양수가 되어 지연 제약 트리거
([`ddl/004:368`](../../db/schema/004_ledger.sql#L368))가 **커밋을 거부한다.**

설계상 옳은 동작이다 — 없는 돈을 회수할 수는 없다. 문제는 **그 상태에서 할 수 있는 일이
문서에 없다는 것**이다. 게임은 `ongoing`으로 남고, 그러면 DR-02에 의해 기간 마감도 막힌다.

#### 개선 방안

1. [`04 §9`](04-posting-rules.md)에 "취소가 실패하는 조건"을 명시한다.
2. 대안 경로를 정의한다. **부분 취소를 만들지 않는다** — 미회수분을 마커(받을 돈)로 전환한
   뒤 취소를 재시도하는 **2단계 절차**로 푼다.

   ```
   1) op_issue_marker(member, amount)     -- 신규
        marker_receivable[branch]  +A
        member_deposit[acct]       −A     ← 손님 잔액이 회수 가능해진다
   2) op_cancel_game 재시도 → 성공
   결과: 미회수분이 손님에 대한 채권으로 남는다. 흔적이 전부 남는다.
   ```

   `tx_kind`에 `marker_issue`, `entry_category`에 `marker_issue` 추가. 4-eyes 대상.
3. API가 이 실패를 `insufficient-balance`가 아니라 전용 오류 `cancel-would-overdraw`로
   구분해 화면이 위 절차를 안내할 수 있게 한다.

---

### DR-14

**`op_deposit`에만 재인증 요구가 없다. 실물 현금 없이 금고 잔액을 부풀릴 수 있다.**

[`ddl/009:120-167`](../../db/schema/009_operations_money.sql#L120) — `p_auth_method`를 받아 그대로
`post_transaction`에 넘길 뿐 검사하지 않는다. `op_withdraw` · `op_transfer` · `op_open_game` ·
`op_settle_game`에는 전부 있는 검사다.

[`06 §3-4`](06-security.md)의 조작별 재인증 표에도 입금이 없다. 현행 UX를 그대로 옮긴
결과지만, 신규 모델에서는 의미가 달라진다:

```
입금 기록 → house_cash 증가 (자산)
         → member_deposit 증가 (부채)

실물 현금이 들어오지 않았는데 기록만 하면 금고 장부가 부풀고,
그 위에서 출금 · 캐시아웃이 가능해진다.
```

현행에서는 실사 차액으로 드러나고 넘어간다. 신규에서는 실사 차액이 마감을 막으므로
(DR-01) **오히려 더 크게 터진다.**

DR-03과 결합하면 검사를 추가해도 앱이 참칭할 수 있다.
**DR-03을 먼저 해소한 뒤 이 항목을 적용한다.**

#### 개선 방안

`op_deposit`에 `pin` 이상을 요구한다. 4-eyes 임계는 적용하지 않는다(입금은 손님에게 유리한
방향). [`06 §3-4`](06-security.md) 표에 입금 행을 추가한다.

---

### DR-15

**분할 출금(structuring)에 대한 방어가 설계에 언급조차 없다.**

[`ddl/009:86-115`](../../db/schema/009_operations_money.sql#L86) — `require_approval_if_over_threshold()`는
**건별 금액**만 본다:

```sql
IF v_threshold IS NULL OR p_amount_minor < v_threshold THEN
  RETURN;                       -- 임계 미만 — 승인 불필요
END IF;
```

임계가 1,000,000이면 999,999씩 나눠 출금해 4-eyes를 영구 회피할 수 있다. 같은 계좌 · 같은
직원 · 같은 5분 안이어도 통과한다.

카지노 자금 시스템에서 이것은 **표준 위협 모델**이다(AML/CTR 맥락).
[`06-security.md`](06-security.md) 전체에 이 개념이 없다.

#### 개선 방안

```sql
-- ledger.branch_config 에 컬럼 2개
  approval_window           INTERVAL DEFAULT '24 hours',
  approval_cumulative_minor BIGINT               -- NULL 이면 누적 검사 없음

-- 판정: 건별 임계 OR (윈도 안 같은 계좌 출금 합 + 이번 건) >= 누적 임계
SELECT COALESCE(sum(e.amount_minor), 0) INTO v_recent
  FROM ledger.entries e
  JOIN ledger.transactions t ON t.id = e.transaction_id
 WHERE e.account_id = v_account_id
   AND t.kind IN ('withdraw', 'branch_transfer')
   AND t.recorded_at > clock_timestamp() - v_window;
```

**동시성 주의**: 이 검사는 check-then-act다. `post_transaction`이 계정 잔액 행을 `FOR UPDATE`로
잠그므로([`ddl/008:376`](../../db/schema/008_post_transaction.sql#L376)) 같은 계좌에 대해서는 직렬화되지만,
**`op_withdraw`는 `post_transaction` 호출 *전에* 임계를 검사한다**
([`ddl/009:212`](../../db/schema/009_operations_money.sql#L212)). 누적 검사 전에 해당 계정 잔액 행을
먼저 잠가야 두 요청이 동시에 통과하지 않는다.

**U5(규제 관할)와 함께 결정한다** — 임계값과 윈도는 법적 요건이 정한다.

---

### DR-16

**파트너 콘솔 운영자가 케이지 전 직원 목록과 역할 구성을 조회할 수 있다.**

파트너 운영자와 케이지 직원은 **같은 `ledger_app` 역할로 DB에 붙는다**.
[`ddl/002:30`](../../db/schema/002_identity.sql#L30)의 `principal_type`은 데이터 가시성용 컬럼이지 DB 역할이
아니다.

[`ddl/012:144-152`](../../db/schema/012_roles_and_grants.sql#L144):

```sql
GRANT SELECT (id, external_id, code, name, principal_type, partner_party_id,
              status, totp_enrolled_at, failed_attempts, locked_until, ...)
  ON identity.staff TO ledger_app;
GRANT SELECT ON
  identity.staff_branches, identity.staff_roles, identity.roles,
  identity.role_permissions, identity.approvals, identity.approval_votes,
  identity.shift_events
TO ledger_app;
```

이 테이블들에 **RLS가 없다**. `identity.approvals`만 지점 스코프가 걸려 있다 —
[`ddl/012:398`](../../db/schema/012_roles_and_grants.sql#L398).

인증 비밀값은 컬럼 GRANT로 막혔다 — [P-12](../partner-admin/explanation-known-gaps.md)의
재발은 아니다. 하지만 노출되는 것: 전 직원 명단 · 지점 배치 · 역할 구성 · 잠금 상태 · 교대 기록.
**파트너 운영자가 케이지 조직도 전체를 볼 수 있다.**

`ledger.party_visible()`이 파트너 계층 경계를 정교하게 만들어 놓았는데
([`ddl/012:340`](../../db/schema/012_roles_and_grants.sql#L340)) `identity` 쪽에는 그 경계가 없다.

#### 개선 방안

```sql
ALTER TABLE identity.staff          ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.staff_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity.shift_events   ENABLE ROW LEVEL SECURITY;
```

판정은 `party_visible()`과 같은 방식으로 **함수 하나에 모은다** — `identity.staff_visible()`:

```
· 자기 자신은 항상 보인다
· 파트너 운영자  → 같은 partner_subtree 소속 운영자만
· 케이지 직원    → current_branches() 에 걸치는 직원만
```

[`06 §4-3`](06-security.md)의 RLS 대상 목록을 13개에서 17개로 갱신한다.

---

### DR-17

**게임 윈로스의 원천이 둘이다. 저장된 스냅샷과 파생 뷰가 갈릴 수 있다.**

[`ddl/010:517-526`](../../db/schema/010_operations_game.sql#L517) — 종료 시 `cage.games.win_loss_minor`에
스냅샷을 저장한다.

[`ddl/013:350`](../../db/schema/013_reconciliation.sql#L350) — `cage.v_game_win_loss`가 같은 값을 원장에서
실시간 파생한다.

[`04 §8-3`](04-posting-rules.md):

> `cage.games.win_loss_minor`에 종료 시점 스냅샷으로 저장하되, **정정 거래가 들어오면 재계산한다.**

**재계산하는 주체가 없다.** 종료 후 역분개가 들어오면 뷰는 갱신되고 스냅샷은 안 된다.
그리고 이 불일치를 잡는 대사 항목이 없다 — R1~R7 어디에도 없다.

#### 개선 방안 — 셋 중 하나. **(A)를 권장한다**

- **(A) 스냅샷을 없앤다.** `cage.games.win_loss_minor` 컬럼을 삭제하고 뷰만 남긴다.
  이 설계의 다른 파생값(9개 교대 카운터)과 같은 원칙이다 — [`03 §4-3`](03-ledger-model.md).
  **"파생값을 저장하지 않는다"는 이 설계의 주장을 스스로 어기지 않는 유일한 선택지다.**
- **(B) 대사 항목 R8을 추가한다.** 스냅샷 ≠ 뷰이면 알람. `v_integrity_status`에 행 추가.
- **(C) 재계산 트리거.** `entries` INSERT 시 해당 게임의 스냅샷을 갱신. 쓰기 경로가 무거워진다.

---

### DR-18

**서로 다른 멱등키로 같은 `game_no`를 개설하면 매핑되지 않은 23505로 터진다.**

[`ddl/010:106-112`](../../db/schema/010_operations_game.sql#L106) — `op_open_game`은
`ledger.parties.code = 'GAME-' || p_game_no`를 INSERT한다. `parties.code`는 UNIQUE
([`ddl/003:24`](../../db/schema/003_accounts.sql#L24)), `games.game_no`도 UNIQUE
([`ddl/005:22`](../../db/schema/005_games_rolling.sql#L22)).

멱등키가 같으면 `begin_idempotent`가 막는다. **다르면 막지 못한다.** 두 단말이 같은 게임 번호를
동시에 생성하면(현행은 클라이언트가 `'YYMMDD'`+3자리로 만든다 —
[`ddl/005:22`](../../db/schema/005_games_rolling.sql#L22) 주석) 두 번째가 23505로 실패한다.

[`05 §7`](05-api-contract.md) 오류 표에 없어 API가 500을 뱉는다.

#### 개선 방안

1. **게임 번호를 서버가 발급한다.** 클라이언트가 제안하지 않는다.
   일자별 리셋이 필요하므로 `(branch, business_date)` 카운터 테이블 + `FOR UPDATE`로 만든다.
   (전역 시퀀스는 일자 리셋과 맞지 않는다.)
2. 클라이언트 제안을 유지한다면 `op_open_game`이 `unique_violation`을 잡아
   `game-no-taken`(409)으로 매핑하고, [`05 §7`](05-api-contract.md) 표에 추가한다.

---

### DR-19

**파생 멱등키가 멱등성 규약 밖에 있다.**

두 곳에서 `post_transaction`을 파생 키로 호출한다:

| 위치 | 키 |
|---|---|
| [`011:185`](../../db/schema/011_operations_admin.sql#L185) `op_record_balancing` | `p_idempotency_key \|\| ':adj'` |
| [`010:589`](../../db/schema/010_operations_game.sql#L589) `op_cancel_game` | `p_idempotency_key \|\| ':' \|\| v_tx_id` |

이 키들은 `transactions.idempotency_key`에는 들어가지만 `ledger.idempotency_keys` 테이블에는
**행이 만들어지지 않는다.** `complete_idempotent()`도 호출되지 않는다.

기능적으로는 부모 키가 재생을 막으므로 동작한다. 문제는 두 가지다:

1. **규약이 두 갈래가 된다.** "모든 자금 거래는 `idempotency_keys`에 행을 갖는다"가 참이 아니다.
   운영 조회(`key → transaction_id`)가 이 거래들을 찾지 못한다.
2. **DR-04와 결합한다.** 부모 키가 만료 후 재사용되면 파생 키도 함께 충돌한다.

#### 개선 방안

파생 키 규칙을 [`05 §2`](05-api-contract.md)에 명시하고, `post_transaction`에
`p_parent_key TEXT` 인자를 두어 부모-자식 관계를 `idempotency_keys`에 기록한다.
운영 조회가 "이 요청이 만든 거래 전부"를 한 번에 찾을 수 있어야 한다.

---

### DR-20

**U1(실거래 여부)과 U2(다통화)가 미확정인 채로는 M0을 종료할 수 없다.**

[`08-adr.md` 미확정 사항](08-adr.md)과 [`07 §7`](07-migration.md)의 M0 목록이 이미 명시한다.
검토 시점(2026-08-15) 기준 **다섯 항목 모두 미확정**이다.

| 항목 | 영향 | 왜 지금인가 |
|---|---|---|
| **U1** 실거래 여부 | 마이그레이션 4~6주 존폐 | 판별 절차가 [`07 §1`](07-migration.md)에 있다. **하루면 끝난다.** |
| **U2** 다통화 | 계정 체계 확정 (DR-06) | 부트스트랩 · 환전 설계가 여기 달렸다 |
| **U3** 롤링 요율 | M4 전체 · DR-07의 함수 시그니처 | M4까지 미룰 수 있으나 골든 테스트를 못 만든다 |
| **U4** 지점 확장 | `branch_code` ENUM vs 테이블 | ENUM은 값 추가는 되나 제거가 어렵다 |
| **U5** 규제 관할 | 보존 기간 · RNG 인증 · DR-15 임계 | 오픈 전. 리드타임이 길다 |

**U1을 가장 먼저 답한다.** 나머지 전부보다 영향이 크고 확인 비용이 가장 작다.

> [`07 §1`](07-migration.md)의 판별 절차를 쓸 때 **갱신된 6명 시드 목록**(`Eric · Jena · Woni ·
> Liv · Minami · May`)을 쓸 것. 초판의 7명 목록을 쓰면 `Eric`이 "시드에 없는 직원"으로 잡혀
> **데모 데이터를 실거래로 오판한다.**

---

### DR-21

**M11(계좌 마스터가 `localStorage`에만 존재)에 실행 계획이 없다.**

[`07 §2-3`](07-migration.md)이 문제를 정확히 서술하고 M0 선행 조건으로 올려놓았다. 그리고
이렇게 끝난다:

> **수집 방법 자체는 이 문서의 범위 밖이다.** 내보내기 스크립트를 만들지, 운영자가 수동으로
> 옮길지는 이관 실행 시점의 운영 결정이다.

담당자 · 기한 · 도구가 전부 비어 있다. **이것이 원장 이관의 선행 조건이므로, 비어 있는 동안
M0이 끝나지 않는다.**

그리고 이 작업은 코드 문제가 아니라 **사람 문제라 리드타임이 길다** — 단말이 몇 대인지,
누가 접근할 수 있는지부터 모른다.

#### 개선 방안 — 이번 주 착수

```
1. 운영 책임자에게 확인: 케이지 어드민을 로그인해 쓴 단말(브라우저 프로필) 전수
2. 내보내기 도구 — 브라우저 콘솔 스니펫 한 장. 배포 불필요
   DB.accounts 를 JSON 으로 덤프 + 단말 식별자 + 수집 시각
3. 수집 → 병합 → 충돌 목록 생성 (자동 병합 금지)
4. Firestore ledger 의 accountId 전수와 대조
   → 없는 ID = 계좌 마스터 유실. 이관 중단 사유
```

**U1이 "데모"로 판명되면 이 작업 전체가 사라진다.** 그래서 DR-20보다 뒤에 있다.
다만 단말 목록 확인(1단계)은 답을 기다리지 않고 시작한다 — 리드타임 때문이다.

---

### DR-22

**분개 0행 거래를 막는 최종 방어선이 없다.**

[`ddl/004:294-333`](../../db/schema/004_ledger.sql#L294) — `assert_transaction_balanced`는
`AFTER INSERT ON ledger.entries`다. **분개가 한 행도 없으면 트리거가 아예 실행되지 않는다.**

`transactions_sealed` 지연 트리거는 `hash IS NOT NULL`만 본다
([`ddl/004:473`](../../db/schema/004_ledger.sql#L473)).

현재는 `post_transaction`의 `IF NOT FOUND` 검사가 막는다
([`ddl/008:427`](../../db/schema/008_post_transaction.sql#L427)). 즉 **방어가 함수 안에만 있고 스키마에는
없다.** 이 설계의 다른 불변식은 전부 두 겹인데 I1만 한 겹이다.

#### 개선 방안

`transactions_sealed` 지연 트리거에 분개 수 검사를 합친다.

```sql
IF NOT EXISTS (SELECT 1 FROM ledger.entries WHERE transaction_id = NEW.id) THEN
  RAISE EXCEPTION 'transaction % has no entries', NEW.id ...
END IF;
```

이미 커밋 시점에 도는 트리거라 비용이 거의 없다.

---

### DR-23

**`ledger.entry_category`의 `'reversal'` 값이 어디에서도 쓰이지 않는다.**

[ADR-016](08-adr.md)이 역분개를 "원 `category` 유지"로 바꾸면서 `'reversal'` category는
사용처가 사라졌다. `posting_rules` 어느 행에도 없고, 역분개 규칙 자동 생성
([`ddl/004:246-251`](../../db/schema/004_ledger.sql#L246))은 원 category를 그대로 쓴다.

그런데 [`04 §16`](04-posting-rules.md)의 `entry_category` 목록에는 남아 있고
[`ddl/001:109`](../../db/schema/001_types_and_extensions.sql#L109)의 ENUM에도 있다.

#### 개선 방안

ENUM에서 제거하거나(PostgreSQL은 ENUM 값 제거에 타입 재생성이 필요하다), 남겨 두되
[`04 §16`](04-posting-rules.md)에 "미사용 — ADR-016 이후"를 명시한다.
**M1 착수 전이면 지금 제거하는 편이 싸다.**

---

## 4. 문서 반영 필요 목록

각 항목이 해소되면 아래를 함께 고친다. **DDL만 고치고 문서를 두면 이 검토가 발견한 것과 같은
종류의 불일치가 다시 쌓인다.**

| 문서 · 절 | 반영 내용 | 관련 |
|---|---|---|
| [`00-system-map.md` §8](00-system-map.md) | A4 상태를 `⚠ 부분`으로 정정. 나머지 ✅ 5건 재검증 | DR-07 |
| [`02-target-architecture.md` §5-2](02-target-architecture.md) | 역할 표에 `ledger_relay` · `identity_app` 추가 | DR-03 · DR-10 |
| [`02-target-architecture.md` §5](02-target-architecture.md) | 운영 파라미터 절 신설 (`statement_timeout` · `lock_timeout`) | DR-09 |
| [`03-ledger-model.md` §7](03-ledger-model.md) | I1 강제 수단에 "분개 수 ≥ 1" 추가 | DR-22 |
| [`04-posting-rules.md` §6](04-posting-rules.md) | 롤링 정정 입력 규칙 | DR-11 |
| [`04-posting-rules.md` §8-3](04-posting-rules.md) | 윈로스 원천 단일화 | DR-17 |
| [`04-posting-rules.md` §9](04-posting-rules.md) | 취소 실패 조건과 마커 전환 절차 | DR-13 |
| [`04-posting-rules.md` §11-2](04-posting-rules.md) | **신설** — `suspense` 해소 분개 | DR-01 |
| [`04-posting-rules.md` §16](04-posting-rules.md) | `reversal` 미사용 표기 또는 제거. 신규 category 추가 | DR-01 · DR-13 · DR-23 |
| [`05-api-contract.md` §2-2](05-api-contract.md) | 409를 "잠금 타임아웃 기준"으로 정정 | DR-09 |
| [`05-api-contract.md` §2-3](05-api-contract.md) | 만료 정책을 응답 캐시 / 거래 유일성으로 분리 | DR-04 |
| [`05-api-contract.md` §2](05-api-contract.md) | 파생 멱등키 규칙 | DR-19 |
| [`05-api-contract.md` §7](05-api-contract.md) | 오류 3종 추가 — `game-no-taken` · `cancel-would-overdraw` · `currency-not-configured` | DR-06 · DR-13 · DR-18 |
| [`06-security.md` §3-4](06-security.md) | 재인증 표에 입금 행 추가. `step_up_tokens` 절 신설 | DR-03 · DR-14 |
| [`06-security.md` §4-3](06-security.md) | RLS 대상 13개 → 17개 (`identity.staff` 계열 + `outbox`) | DR-10 · DR-16 |
| [`06-security.md` §5](06-security.md) | 분할 출금 방어 절 신설 | DR-15 |
| [`07-migration.md` §7](07-migration.md) | M0에 CI+DB · 골든 테스트 명시. M11 실행 계획 | DR-12 · DR-21 |
| [`08-adr.md`](08-adr.md) | ADR-018(step-up 토큰) · ADR-019(체인 정책 데이터화) 추가 | DR-03 · DR-05 |
| [`README.md`](README.md) · [`references.md`](references.md) | 이 문서를 문서 구성 표에 추가 | — |

---

## 5. 착수 순서

의존 관계와 "지금 고치면 싼가"가 순서를 정한다.

```
0주차 — 결정만 (코드 없음)
  DR-20  U1 실거래 여부 판별            하루. 나머지 전부의 전제
  DR-20  U2 다통화 결정                 계정 체계 확정 (DR-06 의 입력)
  DR-21  M11 단말 목록 확인 착수         리드타임이 길다. 병렬로 시작

1주차 — M0 기반
  DR-12  CI + PostgreSQL 18 + 스키마 적용 파이프라인
         ※ 이후의 모든 수정이 이 위에서 검증된다

2~3주차 — 차단 항목 설계 확정 (M1 착수 전)
  DR-03  step_up_tokens + identity_app 역할     op_* 시그니처가 여기서 확정된다
  DR-05  chain_policy + 머클 앵커링              post_transaction 이 여기서 확정된다
  DR-04  멱등 만료 분기
  DR-01  suspense 해소 (계정 2종 + 분개 + op_resolve_suspense)
  DR-02  기간 마감 판정 기준 변경
  DR-06  통화 부트스트랩 (U2 결정 반영)

  → 이 여섯이 끝나야 ddl/ 001~013 을 "확정"이라 부를 수 있다

4주차 이후 — M1 구현과 병행
  DR-22 · DR-23 · DR-09 · DR-14 · DR-18 · DR-19    (스키마 소규모)
  DR-12  골든 테스트 (a) 분개 계약 — op_* 를 만들면서 함께 쓴다

M2 착수 전
  DR-07 · DR-08    파트너 · 포인트 연산 함수와 계정 개설 경로
  DR-10 · DR-16    ledger_relay 분리 · identity RLS
  DR-11 · DR-13 · DR-17

U5 확정 후
  DR-15  분할 출금 임계 (법적 요건이 값을 정한다)
```

**차단 6건(DR-01 ~ DR-06)을 해소하기 전에 M1을 시작하지 않는다.** 전부
`post_transaction()` · `op_*` 시그니처 · 계정 체계에 닿아 있어서, 나중에 고치면 그 위에 쌓인
것을 전부 다시 열어야 한다.

---

## 6. 이 문서에 대해

- **작성 방법**: [`docs/architecture/`](README.md)의 문서 10건과 [`ddl/`](ddl/)의 13개 파일을
  전부 읽고 **서로 대조**했다. 문서가 약속한 동작이 DDL에 존재하는지, DDL이 하는 일이 문서와
  일치하는지를 항목별로 확인했다.
- **직접 확인한 것**: `ledger.posting_rules` 44행과 [`04`](04-posting-rules.md) 각 절의 대응,
  `op_*` 함수 17개의 인가 · 재인증 · 멱등 호출 순서, `GRANT EXECUTE` 대상과 함수 시그니처의
  일치, RLS 정책이 걸린 테이블 15개, `account_kind` 14종 중 개설 경로가 있는 것 2종.
- **확인하지 않은 것**: 실제 PostgreSQL 인스턴스에서의 런타임 동작. 이 검토는 정적 대조이며,
  DR-12가 해소되면 여기 나온 항목 대부분이 자동 검증 대상이 된다.
- **검토에서 기각한 항목**: `game_no`가 연 단위로 순환해 자연 멱등키
  `game_end:{game_no}`가 재사용된다는 지적 — `game_no`는 `YYMMDD`+3자리로 연도를 포함하고
  `cage.games.game_no`가 UNIQUE이므로 성립하지 않는다.
