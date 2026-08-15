# 01 — 원장 기반 (Ledger Foundation)

> **마일스톤**: M0 · M1 · **선행**: 없음 (모든 스펙의 선행이다) · **후행**: `02` ~ `11` 전부
> **입력**: [`03-ledger-model.md`](../architecture/03-ledger-model.md) · [`04-posting-rules.md`](../architecture/04-posting-rules.md) · [`ddl/`](../architecture/ddl/) · [`00-decisions.md`](00-decisions.md) U2 · U4 · U5
> **닫는 수용 기준**: `AC-06-*` `AC-22-*` `AC-23-*` `AC-28-*` `AC-37-*` `AC-42-*` `AC-44-*` `AC-46-*` `AC-49-*` `AC-51-*` `AC-53-*` `AC-56-*` `AC-57-*` `AC-58-*` `AC-59-*` `AC-60-*`

---

## 1. 범위

복식부기 원장의 **기반 계층**이다. 이 위에 모든 도메인이 얹힌다.

포함: 지점 참조 테이블 전환 · 통화 5종 · 계정/주체 모델 · 분개 규칙 표 경화 · 불변식 I1~I8 · 대사 검사 R1~R11 · 봉인/해시 체인.
제외: 인증([`02`](02-identity-access.md)) · 멱등성([`03`](03-api-idempotency.md)) · 게임 도메인([`04`](04-cage-game-rolling.md)).

---

## 2. 지점 — ENUM에서 참조 테이블로 (U4)

**현행**: `HANN`/`NUSTAR`/`ONLINE` 3개가 코드 전반에 하드코딩. 설계는 ENUM이었다.
**결정**: 지점 추가 계획이 있으므로 참조 테이블로 간다 ([`00-decisions`](00-decisions.md) §5).

### 2-1. 데이터 모델

```sql
CREATE TABLE ledger.branches (
  code        TEXT PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z0-9_-]{1,15}$'),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  opened_on   DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- 시드: HANN · NUSTAR · ONLINE
```

전 테이블의 `branch` 컬럼이 `TEXT REFERENCES ledger.branches(code)`가 된다.

### 2-2. 요구사항

| ID | 요구사항 |
|---|---|
| `R-01-01` | `ledger.branch_code` ENUM이 스키마에 존재하지 않는다 |
| `R-01-02` | `branch` 컬럼을 가진 모든 테이블이 `branches(code)` FK를 갖는다. FK 없는 `branch` 컬럼이 0개다 |
| `R-01-03` | `identity.current_branches()`가 `TEXT[]`를 반환하고 RLS 정책이 그 형으로 비교한다 |
| `R-01-04` | 지점 존재 여부를 묻는 모든 검증 쿼리가 `enum_range`가 아니라 `ledger.branches`를 읽는다 |
| `R-01-05` | **`ledger.provision_branch(p_code, p_name, p_opened_on)`가 한 트랜잭션에서 5종을 만든다** — `branches` 행 · `branch_config` 행 · `chain_heads` 행 · 하우스 주체 · 하우스 계정 곱집합(`currencies × house account_kind`) |
| `R-01-06` | `provision_branch` 없이 `branches`에 직접 INSERT하면 부수 4종 누락이 검사에 잡힌다 |

`AC-60-1`(절차 문서화) · `AC-60-2`(누락 검사) · `AC-60-3`(함수로 묶기)를 이 절이 닫는다.

### 2-3. 검증

```sql
-- 지점 프로비저닝 누락 탐지 (AC-60 검증 쿼리의 참조테이블 판)
SELECT b.code AS branch,
       EXISTS (SELECT 1 FROM ledger.branch_config    c WHERE c.branch = b.code) AS has_config,
       EXISTS (SELECT 1 FROM ledger.chain_heads      h WHERE h.branch = b.code) AS has_chain_head,
       EXISTS (SELECT 1 FROM ledger.parties          p WHERE p.home_branch = b.code
                 AND p.party_type = 'house')                                    AS has_house_party,
       EXISTS (SELECT 1 FROM identity.staff_branches s WHERE s.branch = b.code)  AS has_staff
  FROM ledger.branches b WHERE b.status = 'active';
-- 기대: 전 열 true
```

---

## 3. 통화 — 5종 · 통화별 계정 (U2)

### 3-1. 요구사항

| ID | 요구사항 | AC |
|---|---|---|
| `R-01-10` | `ledger.currencies` 시드가 **PHP · USD · HKD · CNY · KRW** 5행이다. `minor_unit`을 함께 갖는다 — KRW는 0, 나머지는 2 | — |
| `R-01-11` | 하우스 계정 부트스트랩이 `branches × currencies × house account_kind` 곱집합으로 돈다 | `AC-06-4` |
| `R-01-12` | 계정 개설이 **상대 하우스 계정 존재를 강제**한다. 없으면 거부 | `AC-06-5` |
| `R-01-13` | `ledger.v_integrity_status`에 **"거래되는 통화 조합 중 상대 계정이 없는 것"** 검사가 있다 | `AC-06-8` |
| `R-01-14` | `tx_kind`에 `fx_exchange`가 **없다.** `ddl/001` 주석에 "환전 업무 없음 — 2026-08-15 결정, `00-decisions` §3"이 적혀 있다 | 결정 §3 |
| `R-01-15` | `entries.currency`가 그 분개가 속한 계정의 통화와 같아야 한다 (트리거) | — |
| `R-01-16` | **게임 통화 = 계좌 통화**를 스키마가 강제한다. 현행이 허용하는 혼용(USD 게임 / PHP 계좌 차감)을 막는다 | 결정 §3 |

> **KRW의 `minor_unit = 0`이 함정이다.** 금액을 전부 `BIGINT` minor로 다루는 설계에서 KRW만 배율이 다르다. 화면 표기 · 영수증 · 리포트가 통화별 배율을 읽어야 하며, `minor_unit`을 무시하면 **KRW 금액이 100배로 보인다.**

### 3-2. 검증

```sql
SELECT b.code, c.code AS currency, k.kind
  FROM ledger.branches b
 CROSS JOIN ledger.currencies c
 CROSS JOIN (SELECT unnest(ARRAY['house_cash','house_gaming','suspense']::ledger.account_kind[]) kind) k
 WHERE b.status='active'
   AND NOT EXISTS (SELECT 1 FROM ledger.accounts a
                    WHERE a.currency=c.code AND a.kind=k.kind AND a.branch=b.code);
-- 기대: 0행
```

---

## 4. 분개 규칙 표 경화 (`DR-51` + `DR-55`)

**문제**: `opening_balance` 규칙이 `account_kind` 14종 × 부호 2 = 28행을 넣고, 역분개 생성기가 그 28행을 세 kind로 전파한다. 결과 — `category='opening_balance'`면 **어떤 계정 종류든 어떤 방향으로든 통과한다.** 예방(트리거)과 탐지(R7)가 같은 지점에서 함께 실패한다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-01-20` | 역분개 생성기의 `WHERE`가 `opening_balance`도 제외한다 | `AC-51-1` |
| `R-01-21` | `opening_balance` 규칙이 **잔액이 있는 계정 종류로만** 좁혀져 있다 — `house_cash` · `member_deposit` · `marker_receivable` · `chips_outstanding` · `player_wallet` · `opening_equity` | `AC-51-2` |
| `R-01-22` | `ledger.posting_rules`에 불변성 트리거가 걸려 있다. `004` 안에서 트리거 생성이 시드 INSERT **뒤**에 온다 | `AC-51-3` |
| `R-01-23` | R7이 표의 **해시까지** 검증한다 — `ledger.schema_fingerprints`에 표 전체 해시를 저장하고 매 대사에서 대조 | `AC-51-4` |
| `R-01-24` | **역분개를 표로 검증하지 않는다.** 트리거에 예외를 두고 **R11 — 역분개 분개가 원 거래의 정확한 부호 반전인가**를 추가한다. `reversal`·`game_cancel` 행이 표에서 사라진다 | `AC-51-5` |
| `R-01-25` | `entry_category`에서 `reversal` 값이 제거됐다 (ADR-016 이후 죽은 값) | `AC-23-1`·`AC-23-2` |

**검증**

```sql
SELECT kind, count(*) AS rules FROM ledger.posting_rules GROUP BY kind ORDER BY rules DESC;
-- reversal · game_cancel 이 표에 없어야 하고, opening_balance 가 12행(6종 × 2부호) 이하여야 한다
```

---

## 5. 불변식 그물 메우기

| ID | 요구사항 | 출처 | AC |
|---|---|---|---|
| `R-01-30` | `assert_transaction_sealed()`가 커밋 시점에 **분개 수 ≥ 2**를 검사한다. 새 트리거를 만들지 않고 기존 지연 트리거에 쿼리를 더한다 | `DR-22`+`DR-52` | `AC-22-1` |
| `R-01-31` | 분개 0개 · 1개 거래가 **커밋에서** 실패한다 | 같음 | `AC-22-2`·`AC-22-3` |
| `R-01-32` | `post_transaction`이 계정 상태와 **주체 상태를 나란히 검사**한다 (A안) | `DR-44` | `AC-44-A`·`AC-44-1`·`AC-44-2` |
| `R-01-33` | **분개가 달린 계정**의 `currency`·`party_id`·`kind` 변경이 거부된다. `status` 변경은 허용 | `DR-46` | `AC-46-1`·`AC-46-2` |
| `R-01-34` | `parties`의 `code`·`party_type` 변경에도 같은 규칙 | `DR-46` | `AC-46-3` |
| `R-01-35` | `CHECK (reverses_tx_id IS NULL OR kind IN ('reversal','game_cancel'))` | `DR-53` | `AC-53-1` |
| `R-01-36` | `ledger.entries`·`transactions`·`cage.rolling_events`·`main_cage_events`·`chip_inventory_events`에 `BEFORE TRUNCATE ... FOR EACH STATEMENT` 트리거 | `DR-56` | `AC-56-1` |
| `R-01-37` | `CHECK (length(device_id) BETWEEN 1 AND 255)` · `CHECK (length(idempotency_key) BETWEEN 1 AND 255)` | `DR-57` | `AC-57-1`·`AC-57-2` |
| `R-01-38` | `periods_status_timestamps` CHECK에 `frozen_at >= opened_at` · `settled_at >= frozen_at` | `DR-58` | `AC-58-1` |
| `R-01-39` | `opened_by` 컬럼을 만들지 않는다. **부재가 의도임을 테이블 주석에 적는다** — `ensure_period_row()`가 첫 거래에 자동 생성하므로 사람이 없다 | `DR-58` | `AC-58-2` |
| `R-01-40` | I1 강제 수단 목록([`03` §7](../architecture/03-ledger-model.md))에 "분개 수 ≥ 2"가 들어간다 | `DR-22` | `AC-22-4` |

> `R-01-36` 주의: 소유자는 트리거를 지울 수 있으므로 완전한 방어가 아니다. **사고성 `TRUNCATE`는 막고 고의는 흔적을 남긴다** — 이 범위를 주석에 적는다 (`AC-56-3`).

---

## 6. 대사 계층 (R1 ~ R11)

| R | 검사 | 이번 변경 | AC |
|---|---|---|---|
| R1 | `v_check_double_entry` | **`(branch, business_date, currency)`로 분해.** `v_integrity_status`의 상위 집계 형태는 유지 | `AC-37-1`~`AC-37-3` |
| R2 | `v_check_balance_projection` | **`LEFT JOIN` + `COALESCE(b.balance_minor,0)`.** 잔액 행이 없는 계정을 놓치던 사각 제거 | `AC-28-1`·`AC-28-2` |
| R7 | `v_check_posting_rules` | 표 해시 대조 추가 | `AC-51-4` |
| **R10** | `cage.v_check_chip_inventory` **신설** | 검사식 = **금고 순유출 = 미상환 칩 잔액**, 지점별. `WITH (security_invoker = true)` | `AC-42-1`~`AC-42-3` |
| **R11** | 역분개 미러 대조 **신설** | 역분개 분개가 원 거래의 정확한 부호 반전인가 | `AC-51-5` |

**추가 요구**: 대사 계층 전체를 **"무엇을 못 보는가"** 로 한 번 훑고 그 기록을 남긴다 (`AC-28-3`). R1(통화별) · R2(조인) · `DR-41`(통화 부트스트랩)이 같은 유형의 사각을 셋 만들었다.

`chip_type(nn/cc) ↔ entry_category` 매핑을 [`04-posting-rules.md`](../architecture/04-posting-rules.md)에 **먼저 확정**한다 — R10이 그 매핑을 쓴다 (`AC-42-4`). `chip_inventory_events.reason`은 **전용 ENUM**을 쓴다 (`AC-42-5`, 결정 §10).

R 번호 대장([`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) §11)을 새 검사 추가 전에 먼저 갱신한다.

---

## 7. 운영 가드

| ID | 요구사항 | AC |
|---|---|---|
| `R-01-50` | [`ddl/README.md`](../architecture/ddl/README.md)에 **`SET CONSTRAINTS ALL IMMEDIATE` 금지**가 명문화되고, 왜 금지인지(지연 제약 트리거 I1·I2가 삽입 순서 의존이 된다) 함께 적혀 있다 | `AC-59-1` |
| `R-01-51` | [`references.md`](../architecture/references.md)의 `SET CONSTRAINTS` 행이 그 문단을 가리킨다 | `AC-59-2` |
| `R-01-52` | 골든 테스트에 `SET CONSTRAINTS ALL IMMEDIATE` 후 다중 분개 거래가 **의도대로 실패**하는 테스트가 있다 | `AC-59-3` |
| `R-01-53` | `ddl/` 전 파일의 R번호 ↔ 파일 참조가 실제와 일치한다 (`005`의 R4 주석이 `013`을 가리킨다) | `AC-49-1`·`AC-49-2` |

---

## 8. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-22-2` 분개 0개 거래 | 커밋 실패 |
| `AC-22-3` 분개 1개 거래 | 커밋 실패 |
| `AC-28-2` 잔액 행 삭제 후 R2 | `variance_minor <> 0`으로 드러남 |
| `AC-37-3` 불균형 거래 주입 | R1이 **그 지점·그 영업일** 행을 반환 |
| `AC-44-2` `suspended` 주체의 계정에 자금 연산 | 거부 |
| `AC-46-1` 분개 달린 계정의 `currency` UPDATE | 거부 |
| `AC-53-2` `kind='deposit'` + `reverses_tx_id` | 거부 |
| `AC-56-2` 5개 테이블 각각 `TRUNCATE` | 거부 |
| `AC-57-3` 빈 `device_id` / 빈 멱등키 INSERT | 스키마 레벨 거부 |
| `AC-59-3` `SET CONSTRAINTS ALL IMMEDIATE` + 다중 분개 | 실패(의도된 동작) |
| `R-01-12` 상대 하우스 계정 없는 통화로 계정 개설 | 거부 |
| `R-01-15` 계정 통화와 다른 통화의 분개 | 거부 |
| `R-01-16` 계좌 통화 ≠ 게임 통화로 게임 개설 | 거부 |
| `R-01-05` `provision_branch('CEBU',...)` | `branches`+4종이 전부 생기고 §2-3 쿼리가 전 열 true |

---

## 9. 열린 항목

- **KRW `minor_unit = 0` 파급**: 화면·영수증·리포트 전 계층의 표기 배율 처리. [`09`](09-notifications.md)·[`10`](10-partner-console.md)와 함께 확인한다.
- `AC-15-5`(분할 출금 임계 근거)는 U5 유예로 [`02`](02-identity-access.md)에서 **잠정값**으로 남는다.
