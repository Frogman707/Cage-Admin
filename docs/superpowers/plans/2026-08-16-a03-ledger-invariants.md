# a03 — 통화 완결성 · 분개 규칙 경화 · 불변식 그물 · 대사 계층 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 스펙 `01` §3~§6을 실제로 만든다 — 하우스 계정을 통화 곱집합으로 넓히고, 상대 계정 없는 계정 개설을 막고, `posting_rules`가 `opening_balance`로 뚫리던 구멍을 닫고, 커밋 시점 불변식 그물의 빈칸을 메우고, R1·R2·R7을 고쳐 R11·R12를 신설한다.

**Architecture:** 마이그레이션 도구가 없으므로 `db/schema/0NN_*.sql`을 **제자리에서 고치고 빈 DB에 001~013 전체를 재적용**한다 ([`00-decisions` §12](../../spec/00-decisions.md)). 강제는 전부 **스키마 계층**에 둔다 — 트리거·CHECK·참조 테이블이지 애플리케이션 검증이 아니다. 새 검사는 `013`의 `v_check_*` 뷰로 만들어 `v_integrity_status`에 합류시킨다. 검증은 a01 하니스(`node:test` + `pg`)가 매 CI 실행마다 한다.

**Tech Stack:** PostgreSQL 18.6 · `psql` (`db/scripts/apply.sh` · `reset.sh`) · `node:test` + `pg` (a01 하니스)

**Spec:** [`docs/spec/01-ledger-foundation.md`](../../spec/01-ledger-foundation.md) **§3 · §4 · §5 · §6** (`R-01-10`~`R-01-16` · `R-01-20`~`R-01-25` · `R-01-30`~`R-01-40` · §6 대사 표)
부수 근거: [`00-decisions.md` §3(U2) · §12(D1)](../../spec/00-decisions.md) · [`10-acceptance-criteria.md` §11 R 번호 대장](../../architecture/10-acceptance-criteria.md) · [`12-ci-golden-tests.md`](../../spec/12-ci-golden-tests.md) `R-12-03` · `R-12-21`

---

## 선행 조건 — a02가 **구현까지** 끝나 있어야 한다

> **2026-08-16 확인: a02는 이미 랜딩했다.** 브랜치 `backend` · HEAD `a8cf424`. 아래 네 산출물이 전부 스키마에 있다. 그래도 착수 전 `grep` 세 줄은 그대로 돌린다 — 다른 브랜치에서 시작하는 사람이 이 문단을 근거로 건너뛰면 안 된다.

이 계획은 a02의 산출물을 **직접 고친다.** 계획만 있고 구현이 없으면 아래 Task가 존재하지 않는 대상을 편집한다.

| a02 산출물 | a03이 하는 일 |
|---|---|
| `ledger.house_account_policy` (11행, `003`) | **통화 축을 더한다** — Task 1이 `bootstrap_house_accounts()`의 `INSERT ... SELECT`를 `CROSS JOIN ledger.currencies`로 넓힌다 |
| `ledger.bootstrap_house_accounts(TEXT)` (`003`) | 위와 같은 함수를 고친다 |
| `ledger.v_check_branch_provisioning` (`013`) | `a.currency = 'PHP'` 고정 조건을 곱집합 조건으로 바꾼다 — a02 계획이 "짝을 이루는 두 곳"으로 지목한 나머지 한 곳 |
| `ledger.provision_branch(...)` (`004`) | 그대로 쓴다. 픽스처가 이것으로 지점을 만든다 (`R-12-20`) |
| `asRole(role, fn)` (`db/tests/helpers/db.mjs`) | 그대로 쓴다. Task 3·10의 `ledger_read` 조회 테스트가 쓴다 |

착수 전 확인:

```bash
grep -n "house_account_policy" db/schema/003_accounts.sql
grep -n "provision_branch" db/schema/004_ledger.sql
grep -n "export async function asRole" db/tests/helpers/db.mjs
```

**세 줄이 다 나오지 않으면 시작하지 않는다.** a02 미구현 상태에서 Task 1을 시작하면 `bootstrap_house_accounts()`가 없어 `003`을 처음부터 다시 설계하게 되고, 그것은 a02 계획과 갈라진다.

a01 헬퍼는 그대로 쓴다: `query` · `withRollback` · `asOwner` · `asStaff` · `asMigrator` · `asIdentity` · `asRole` · `expectCommitFailure` · `expectSqlState` · `uniq` · `uniqCode` · `closePool`. **하나를 더한다** — Task 7이 `expectOwnerCommitFailure`를 만든다 (`expectCommitFailure`가 `ledger_app` 고정이고 `staffId`를 강제해서, 앱 역할이 만들 수 없는 위반 상태를 커밋시켜 볼 수 없다).

**직접 INSERT 하는 테스트가 지켜야 할 컬럼 계약.** `ledger.transactions`의 NOT NULL은 `idempotency_key` · `kind` · `branch` · `business_date` · `device_id` · `auth_method` 여섯이고, `tx_actor_required` CHECK 때문에 `actor_staff_id`를 비우려면 `auth_method = 'system'`이어야 한다. `(branch, business_date)`는 `ledger.accounting_periods`로 FK다 — 영업일 절단 시각 때문에 `CURRENT_DATE`가 오늘 영업일과 다를 수 있으니 `SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)`를 먼저 부른다. 하나라도 빠지면 `23502`/`23503`으로 죽어 **정작 보려는 검사에 닿지 못하고**, 그 테스트는 초록이어도 아무것도 증명하지 않는다. Task 7·Task 9가 이 계약을 쓴다.

---

## Global Constraints

[`00-decisions.md`](../../spec/00-decisions.md)의 결정을 값까지 옮긴 것이다. 모든 Task의 요구사항에 암묵적으로 포함된다.

| # | 제약 | 값 |
|---|---|---|
| U1 | 이관 대상 데이터 없음 — **데모** | 운영 DB가 없다. 증분 마이그레이션 파일을 쌓지 않는다 |
| U2 | 통화 5종 | `PHP`(2) · `USD`(2) · `HKD`(2) · `CNY`(2) · **`KRW`(0)** |
| U2 | 환전 없음 | `tx_kind`에 `fx_exchange`가 없다. `fx_rates` · `fx_position`을 만들지 않는다 |
| U4 | 지점 참조 테이블 | 시드 3행 **`HANN` · `NUSTAR` · `ONLINE`**. `ledger.branch_code` ENUM 없음 |
| U5 | 규제 관할 유예 | `branch_config`의 임계·윈도 값은 **"잠정"** 표기로 둔다 |
| D1 | 마이그레이션 도구 없음 | 번호 파일을 제자리에서 고치고 `db/scripts/reset.sh`로 전체 재적용 |
| D2 | 테스트 러너 | `node:test` + `pg`. `--test-concurrency=1` |
| ROADMAP §9-1 | 테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다 | |
| ROADMAP §9-6 | 함수 시그니처를 바꾸면 `012`의 GRANT 인자 목록을 **같은 커밋에서** 바꾼다 | |
| ROADMAP §9-7 | 새 대사 검사를 추가하기 **전에** [`10-acceptance-criteria.md` §11](../../architecture/10-acceptance-criteria.md) R 번호 대장을 갱신한다 | Task 3 Step 1 · Task 6 Step 1 |
| ROADMAP §9-8 | `SET CONSTRAINTS ALL IMMEDIATE`는 금지 | |
| ROADMAP §9-9 | 픽스처는 `ledger.provision_branch()`로 지점을 만든다 | `R-12-20` |
| ADR-014 | **모든 뷰에 `WITH (security_invoker = true)`** | 빠뜨리면 a01의 `db/tests/drift/security.test.js`가 즉시 빨개진다 |

---

## 착수 전 실측 — 무엇이 이미 참인가

`db/schema/` 13개 파일을 읽어 확인한 상태다 (2026-08-16).

| 요구사항 | 현 상태 | 이 계획이 하는 일 |
|---|---|---|
| `R-01-10` 통화 5종 시드 | ✅ [`001:296-301`](../../../db/schema/001_types_and_extensions.sql)에 5행. **단 컬럼명이 `scale`이지 `minor_unit`이 아니다** | 스펙 표기 정정 + 소비처 확정 (Task 1 · 12) |
| `R-01-11` 하우스 계정 곱집합 | ❌ `PHP` 한 통화뿐 ([`003:318-319`](../../../db/schema/003_accounts.sql)) | `CROSS JOIN ledger.currencies` (Task 1) |
| `R-01-12` 상대 하우스 계정 강제 | ❌ 없다. `op_open_account`가 `p_currency`를 그대로 받아 `member_deposit`을 만든다 ([`011:479-481`](../../../db/schema/011_operations_admin.sql)) | 트리거 신설 (Task 2) |
| `R-01-13` 통화 상대 계정 대사 | ❌ 없다 | **R12** 신설 (Task 3) |
| `R-01-14` `fx_exchange` 부재 | ✅ [`001:138-141`](../../../db/schema/001_types_and_extensions.sql)에 사유 주석까지 있다 | 회귀 가드 테스트 (Task 11) |
| `R-01-15` 분개 통화 = 계정 통화 | ✅ [`004:137-156`](../../../db/schema/004_ledger.sql) `assert_entry_currency` 트리거 | 위반 테스트 (Task 11) |
| `R-01-16` 게임 통화 = 계좌 통화 | ❌ `op_start_game`이 `p_currency`를 검사 없이 쓴다 ([`010:112-115`](../../../db/schema/010_operations_game.sql)) | 검사 추가 (Task 2) |
| `R-01-20` 역분개 생성기가 `opening_balance` 제외 | ❌ [`004:308`](../../../db/schema/004_ledger.sql) `WHERE r.kind NOT IN ('reversal','game_cancel')` — `opening_balance`가 통과한다 | Task 4가 표에서 통째로 없앤다 |
| `R-01-21` `opening_balance` 6종으로 축소 | ❌ [`004:295-298`](../../../db/schema/004_ledger.sql)이 `enum_range(NULL::ledger.account_kind)` 전체 × 2부호 = **32행** | 배열 6종 × 2 = 12행 (Task 4) |
| `R-01-22` `posting_rules` 불변성 트리거 | ❌ 없다 | 시드 INSERT **뒤에** 생성 (Task 4) |
| `R-01-23` R7이 표 해시 검증 | ❌ `ledger.schema_fingerprints`가 없다 | 테이블 + 지문 함수 + R7 확장 (Task 5) |
| `R-01-24` 역분개를 표로 검증하지 않고 R11로 | ❌ 표에 `reversal`·`game_cancel` 행이 있다 | 표에서 제거 + 트리거 예외 (Task 4) + R11 (Task 6) |
| `R-01-25` `entry_category`에 `reversal` 없음 | ✅ [`001:180`](../../../db/schema/001_types_and_extensions.sql)이 제거 사유를 적어 두었다 | 회귀 가드 테스트 (Task 11) |
| `R-01-30`·`R-01-31` 분개 수 ≥ 2 | ❌ [`004:531-562`](../../../db/schema/004_ledger.sql) `assert_transaction_sealed`가 해시만 본다 | 같은 트리거에 쿼리 추가 (Task 7) |
| `R-01-32` 주체 상태 검사 | ❌ [`008:474-481`](../../../db/schema/008_post_transaction.sql)이 `a.status`만 본다. `parties.status`는 안 본다 | 같은 블록에 병렬 검사 (Task 8) |
| `R-01-33`·`R-01-34` 계정·주체 컬럼 불변 | ❌ 없다 | 트리거 2종 (Task 8) |
| `R-01-35` `reverses_tx_id` CHECK | ❌ 없다. UNIQUE 인덱스만 있다 ([`004:102`](../../../db/schema/004_ledger.sql)). 컬럼은 nullable ([`004:76`](../../../db/schema/004_ledger.sql)) | **양방향** CHECK 추가 (Task 9) — 원본 없는 역분개는 표 검증도 R11도 빠져나간다 |
| `R-01-36` TRUNCATE 트리거 5종 | ❌ `db/schema/` 전체에 `TRUNCATE` 문자열이 **0건** | 5개 테이블 (Task 9) |
| `R-01-37` 길이 CHECK 2종 | ❌ `device_id`·`idempotency_keys.key` 둘 다 `TEXT NOT NULL`뿐 | CHECK 추가 (Task 9) |
| `R-01-38` 기간 타임스탬프 순서 | 🟡 `periods_status_timestamps`가 NULL 여부만 본다. 순서는 안 본다 | CHECK 확장 (Task 9) |
| `R-01-39` `opened_by` 부재가 의도임을 주석 | ❌ 주석 없다 | 테이블 주석 (Task 9) |
| `R-01-40` I1 강제 수단 목록에 "분개 수 ≥ 2" | ❌ [`03-ledger-model.md` §7](../../architecture/03-ledger-model.md)에 없다 | 문서 (Task 12) |
| §6 R1 분해 | ❌ [`013:19-27`](../../../db/schema/013_reconciliation.sql)이 `GROUP BY currency`만 | `(branch, business_date, currency)` (Task 10) |
| §6 R2 `LEFT JOIN` | ❌ [`013:44-52`](../../../db/schema/013_reconciliation.sql)이 `JOIN ledger.account_balances` — 잔액 행 없는 계정이 안 보인다 | `LEFT JOIN` + `COALESCE` (Task 10) |
| §6 R10 칩 재고 | ❌ **B1 차단** — 아래 결정 6 | a06으로 이월 |
| §6 R11 역분개 미러 | ❌ 없다 | 신설 (Task 6) |
| `AC-42-5` `chip_inventory_events.reason` 전용 ENUM | ❌ [`005:407`](../../../db/schema/005_games_rolling.sql)이 `ledger.entry_category`를 쓴다 — 칩과 무관한 값 30여 개가 들어갈 수 있다 | 전용 ENUM (Task 9) |

---

## 이 계획이 내리는 설계 결정 6건

### 결정 1 — `ledger.currencies.scale`을 `minor_unit`으로 개명하지 않는다. 스펙을 고친다

스펙 `R-01-10`은 "`minor_unit`을 함께 갖는다"이고 실물 컬럼은 `scale`이다 ([`001:278`](../../../db/schema/001_types_and_extensions.sql)). 뜻은 같다 — 둘 다 "최소 단위 소수 자릿수"다.

개명하지 않는 이유: `scale`은 SQL `NUMERIC(p, s)`의 표준 용어이고 [`001:283-284`](../../../db/schema/001_types_and_extensions.sql)의 컬럼 주석이 이미 그 뜻으로 쓰고 있다. 개명은 이득 없이 `001`·테스트·문서를 건드린다.

→ **스펙 §3-1의 표기를 `scale`로 정정한다** (Task 12). 스펙과 실물이 다르면 스펙이 소설이 된다.

**그리고 `scale`의 소비처를 확정한다.** a01 이월표가 "`002`~`013` 어디도 `scale`을 읽지 않는다"를 기록했다. 이것은 결함이 아니라 **설계상 필연**이다 — 모든 금액이 최소 단위 `BIGINT`이므로 DB 안에서 배율을 곱할 자리가 없다. 소비처는 표기 계층(c04·c06·c08)이고 ROADMAP §7-1이 이미 그렇게 배정했다.

→ 컬럼 주석에 **"DB 안에 소비처가 없는 것이 의도다"** 를 적고, 5행의 값을 고정하는 골든 테스트를 둔다 (Task 1). 값이 조용히 바뀌면 표기 계층이 그때 깨진다.

### 결정 2 — `R-01-12`는 `op_open_account`가 아니라 **`ledger.accounts` 트리거**로 강제한다

계정을 만드는 경로가 지금 넷이다 — [`003:318`](../../../db/schema/003_accounts.sql)(하우스 부트스트랩) · a02의 `bootstrap_house_accounts()` · [`010:112`](../../../db/schema/010_operations_game.sql)(게임 칩 계정) · [`011:479`](../../../db/schema/011_operations_admin.sql)(회원 계좌). `op_open_account` 안에만 검사를 넣으면 나머지 셋이 뚫린다.

→ `BEFORE INSERT ON ledger.accounts` 트리거 하나로 강제한다. **하우스 주체(`party_type = 'house'`)는 면제**한다 — 상대 계정 자신을 만드는 경로가 자기 자신을 요구하면 부트스트랩이 성립하지 않는다.

**그리고 검사 단위는 통화가 아니라 `(지점, 통화)`다.** [`008:359-368`](../../../db/schema/008_post_transaction.sql)이 `house`·`game` 계정에 대해 `p.home_branch IS DISTINCT FROM p_branch`면 거부한다 (`branch_transfer`만 예외). 그래서 "이 통화의 하우스 계정이 어느 지점엔가 있다"는 상대 계정 보장이 못 된다 — NUSTAR의 USD `house_cash`는 HANN 거래에서 쓸 수 없고, 그 통화의 계좌는 개설은 되지만 첫 입금에서 죽는다. 실패 지점을 계정 개설로 당긴다는 이 검사의 목적 자체가 무너진다.

같은 파일이 `member`·`partner`를 지점 일치 검사에서 **빼 두었으므로**(손님은 지점을 옮겨 다닌다) 지점 중립 주체에게는 **활성 지점 전부**가 상대를 갖춰야 한다. `game` 주체만 `home_branch` 하나로 좁힌다. `suspended`·`closed` 지점은 뺀다 — 영업하지 않는 지점의 빈틈이 신규 계좌 개설을 세우면 안 된다.

같은 이유로 Task 3의 R12도 `(branch, currency)`로 묶는다. 통화 단위로 집계하면 한 지점만 갖춘 통화가 초록으로 보인다.

### 결정 3 — `opening_balance` 규칙을 좁힐 때 **`opening_equity`를 반드시 남긴다**

`R-01-21`이 지정한 6종은 `house_cash` · `member_deposit` · `marker_receivable` · `chips_outstanding` · `player_wallet` · `opening_equity`다. 앞 다섯은 "잔액이 있는 계정"이고 `opening_equity`는 그 균형 상대다 — 빼면 `op_load_opening_balance`가 만드는 모든 거래가 차대 불균형이 되어 I1에 걸린다.

`011`의 `op_load_opening_balance` 시그니처는 그대로 둔다. 좁히는 것은 표뿐이다.

### 결정 4 — R11은 **분개 집합의 다중집합 비교**다. 행 대 행 짝짓기가 아니다

역분개는 원 거래의 분개를 부호만 뒤집어 만든다. 그런데 `ledger.entries`에는 "이 분개가 저 분개의 거울이다"를 잇는 컬럼이 없고, 만들 수도 없다 — 원 거래에 같은 `(account_id, category)` 분개가 둘 있으면 짝이 유일하지 않다.

→ R11은 `(account_id, category, amount_minor)` 다중집합을 비교한다: 역분개의 집합이 원 거래 집합의 **부호 반전과 정확히 같은가.** SQL에서는 `EXCEPT ALL`을 양방향으로 돌려 둘 다 빈 집합인지로 판정한다. 순서·짝짓기와 무관하고 중복도 정확히 센다.

### 결정 5 — `R-01-23`의 표 해시는 **`ledger.schema_fingerprints` 테이블 + `STABLE` 함수** 두 조각이다

R7이 표 자체의 변조를 잡으려면 "기대 해시"가 표 밖에 있어야 한다. 표 안에 두면 표를 고치는 사람이 해시도 같이 고친다.

→ `ledger.schema_fingerprints(name PK, digest BYTEA, recorded_at)`를 `004`에 만들고, 시드 INSERT 직후 `ledger.posting_rules_digest()`의 값을 한 번 넣는다. R7이 매 조회마다 다시 계산해 대조한다. 표를 고치는 정당한 변경은 **같은 커밋에서 지문 행도 갱신**해야 하고, 그 사실을 `posting_rules` 테이블 주석에 적는다.

지문 함수는 `STABLE` · `SECURITY INVOKER`다 — `ledger_read`가 R7 뷰를 조회할 때 함께 실행되므로 정의자 권한이 필요 없다(`posting_rules`는 [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `ALL TABLES` GRANT가 덮는다).

### 결정 6 — **R10은 만들지 않는다.** a06으로 이월한다

ROADMAP §3이 a03을 `🔒 B1`로 표시했고, ROADMAP §7이 B1을 "교대 카운터 9종의 **항등식** — `nn_chip_in_shift`가 나머지 NN 카운터와 어떤 관계여야 하는가"로 정의하며 **막는 계획을 `a03(R10) · a06`** 으로 적었다. 근거는 [`04` `R-04-65`](../../spec/04-cage-game-rolling.md)이고 그 스펙 §12가 "카운터 항등식은 **R10 착수 전에** 정의돼야 한다. 미정의 상태로 R10을 만들면 대조 기준이 없다"고 못박았다.

실측이 그 말을 뒷받침한다. [`013:433-441`](../../../db/schema/013_reconciliation.sql)의 `nn_chip_in_shift`는 `reason` 필터가 **없어서** 모든 사유의 합이고, `nn_cashout_shift`·`nn_marker_shift`는 그 부분집합이다. 그런데 [`04` `R-04-63`](../../spec/04-cage-game-rolling.md)은 `nn_chip_in_shift`가 `reason = 'settle_deposit'`으로 **걸러야** 한다고 요구한다. 지금 뷰대로면 전체합, 스펙대로면 부분합 — 어느 쪽이 옳은지가 곧 B1이고, R10의 "금고 순유출"이 어느 값을 뜻하는지가 거기서 갈린다.

`AC-42-4`도 아직 닫히지 않았다: `chip_type(nn/cc) ↔ entry_category` 매핑을 [`04-posting-rules.md`](../../architecture/04-posting-rules.md)에 **먼저 확정**해야 R10이 그것을 쓸 수 있다.

→ R10은 a06이 `R-04-63`·`R-04-64`·`R-04-65`를 닫는 것과 **한 몸으로** 간다. a03은 그 선행 조각인 `AC-42-5`(전용 ENUM)만 처리하고(Task 9), R 대장의 R10 행에 차단 사유를 적는다(Task 12).

**이것은 ROADMAP이 a03에 배정한 범위의 축소다.** 아래 "이 계획의 범위 밖"에 이월 행으로 남기고 ROADMAP §3 a03 행에도 표기한다.

---

## 파일 구조

| 파일 | 책임 | 이 계획에서 |
|---|---|---|
| [`db/schema/001_types_and_extensions.sql`](../../../db/schema/001_types_and_extensions.sql) | 타입 · `branches` · `currencies` · `branch_config` | **Modify** — `scale` 주석 · `cage.chip_reason` ENUM 신설 |
| [`db/schema/003_accounts.sql`](../../../db/schema/003_accounts.sql) | 주체 · 계정 · 하우스 부트스트랩 | **Modify** — 곱집합 부트스트랩 · 상대 계정 트리거 · 계정/주체 불변 트리거 |
| [`db/schema/004_ledger.sql`](../../../db/schema/004_ledger.sql) | 기간 · 거래 · 분개 · `posting_rules` | **Modify** — 표 축소·불변성·지문 · 봉인 트리거 확장 · CHECK 3종 · TRUNCATE 트리거 |
| [`db/schema/005_games_rolling.sql`](../../../db/schema/005_games_rolling.sql) | 게임 · 롤링 · 칩 재고 | **Modify** — `chip_inventory_events.reason` 타입 교체 · TRUNCATE 트리거 |
| [`db/schema/008_post_transaction.sql`](../../../db/schema/008_post_transaction.sql) | 거래 기록 핵심 | **Modify** — 주체 상태 병렬 검사 |
| [`db/schema/010_operations_game.sql`](../../../db/schema/010_operations_game.sql) | 게임 연산 | **Modify** — 게임 통화 = 계좌 통화 검사 · 칩 사유 캐스팅 |
| [`db/schema/012_roles_and_grants.sql`](../../../db/schema/012_roles_and_grants.sql) | 역할 · GRANT · RLS | **Modify** — 새 함수 EXECUTE 정책 |
| [`db/schema/013_reconciliation.sql`](../../../db/schema/013_reconciliation.sql) | 대사 뷰 | **Modify** — R1 분해 · R2 LEFT JOIN · R7 지문 · R11 · R12 · `v_integrity_status` |
| `db/tests/golden/spec-01-currency.test.js` | §3 골든 — 시드 · 곱집합 · 상대 계정 강제 · 게임 통화 | **Create** |
| `db/tests/golden/spec-01-posting-rules.test.js` | §4 골든 — 표 축소 · 불변성 · 지문 | **Create** |
| `db/tests/invariants/sealed-entries.test.js` | §5 — 분개 수 ≥ 2 (`AC-22-2`·`AC-22-3`) | **Create** |
| `db/tests/invariants/mutability.test.js` | §5 — 계정·주체 컬럼 불변 · 주체 상태 (`AC-44`·`AC-46`) | **Create** |
| `db/tests/invariants/schema-guards.test.js` | §5 — `reverses_tx_id` · TRUNCATE · 길이 · 기간 순서 · 칩 사유 (`AC-53`·`AC-56`·`AC-57`·`AC-58`·`AC-42-5`) | **Create** |
| `db/tests/reconciliation/r11-reversal-mirror.test.js` | R11 | **Create** |
| `db/tests/reconciliation/r12-currency-counterpart.test.js` | R12 | **Create** |
| `db/tests/reconciliation/r1-r2-blindspots.test.js` | R1 분해 · R2 사각 (`AC-37-3`·`AC-28-2`) | **Create** |
| [`db/tests/reconciliation/integrity-status.test.js`](../../../db/tests/reconciliation/integrity-status.test.js) | 집계 뷰 전수 | **Modify** — `CHECKS` 9행 → 11행 |
| [`db/tests/drift/branch-model.test.js`](../../../db/tests/drift/branch-model.test.js) | U4 회귀 가드 (a02 산출물) | **Modify** — `fx_exchange`·`reversal` 부재 가드 |
| [`docs/architecture/10-acceptance-criteria.md`](../../architecture/10-acceptance-criteria.md) | `AC-*` · R 번호 대장 | **Modify** — R11·R12 등록 · R10 차단 사유 |
| [`docs/architecture/03-ledger-model.md`](../../architecture/03-ledger-model.md) | 원장 모델 · I1~I8 | **Modify** — I1 강제 수단에 "분개 수 ≥ 2" (`R-01-40`) |
| [`docs/spec/01-ledger-foundation.md`](../../spec/01-ledger-foundation.md) | 이 계획의 스펙 | **Modify** — `minor_unit` → `scale` 정정 |
| [`docs/superpowers/ROADMAP.md`](../ROADMAP.md) | 계획 대장 | **Modify** — a03 상태 · R10 이월 |

---

## 반복 루프 — 스키마를 고칠 때마다

```bash
# 컨테이너가 없으면 먼저 (CI 와 같은 마이너 버전을 쓴다)
docker run -d --name cage-pg18 -p 55432:5432 \
  -e POSTGRES_PASSWORD=devonly -e POSTGRES_DB=cage postgres:18.6-alpine

PGPASSWORD=devonly npm run db:reset       # DROP 5 schemas + apply 001~013
PGPASSWORD=devonly npm run db:test-role   # 테스트 로그인 역할 3종
PGPASSWORD=devonly npm run test:db
```

`db:reset`이 성공하면 마지막 줄이 `OK: 13 files applied to cage@localhost:55432`다. **이 줄이 안 나오면 다음 스텝을 하지 않는다.**

> **이 계획은 부트스트랩 계정 수를 지점당 11개에서 55개로 늘린다** (11 kind × 5 통화). 지점이 3개이므로 적용 시점에 165행이 생긴다. `db:reset`이 눈에 띄게 느려지면 그것이 원인이다 — 정상이다.

---

## Task 1: 하우스 계정을 통화 곱집합으로 넓힌다 (`R-01-10` · `R-01-11`)

**Files:**

- Modify: `db/schema/003_accounts.sql` — `bootstrap_house_accounts()` 본문
- Modify: `db/schema/013_reconciliation.sql` — `v_check_branch_provisioning`의 `a.currency = 'PHP'`
- Modify: `db/schema/001_types_and_extensions.sql` — `currencies.scale` 컬럼 주석
- Create: `db/tests/golden/spec-01-currency.test.js`

**Interfaces:**

- Consumes: `ledger.house_account_policy` · `ledger.bootstrap_house_accounts(TEXT)` (a02) · `query` · `closePool` (a01)
- Produces: 지점당 하우스 계정 **55행**(11 kind × 5 통화). Task 2·3이 이 사실에 의존한다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-currency.test.js`:

```js
// 01 §3 통화 — 5종 · 통화별 계정 (U2).
//
// 이 파일은 "통화가 하나 더 있어도 성립하는가" 를 본다. PHP 만 통과하고
// 나머지가 비뚤어지는 사각(DR-41)이 이 스펙 절의 존재 이유다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

export const CURRENCIES = ['PHP', 'USD', 'HKD', 'CNY', 'KRW'];

test('R-01-10 통화 시드가 5종이고 KRW 만 scale = 0 이다', async () => {
  const rows = await query('SELECT code, scale FROM ledger.currencies ORDER BY code');
  assert.deepEqual(
    rows.map((r) => r.code),
    [...CURRENCIES].sort(),
    '통화 시드가 5종이 아니다 (001 의 INSERT INTO ledger.currencies)'
  );
  const scales = Object.fromEntries(rows.map((r) => [r.code, r.scale]));
  assert.equal(scales.KRW, 0, 'KRW 는 scale = 0 이다 — 최소 단위가 원 그 자체다');
  for (const code of ['PHP', 'USD', 'HKD', 'CNY']) {
    assert.equal(scales[code], 2, `${code} 는 scale = 2 여야 한다`);
  }
});

test('R-01-11 · AC-06-4 하우스 계정이 지점 × 통화 × kind 곱집합이다', async () => {
  const [{ kinds }] = await query(
    'SELECT count(*)::int AS kinds FROM ledger.house_account_policy'
  );
  const rows = await query(`
    SELECT hp.home_branch AS branch, count(*)::int AS accounts
      FROM ledger.accounts a
      JOIN ledger.parties hp ON hp.id = a.party_id
     WHERE hp.party_type = 'house'
     GROUP BY hp.home_branch
     ORDER BY hp.home_branch`);

  assert.deepEqual(rows.map((r) => r.branch), ['HANN', 'NUSTAR', 'ONLINE']);
  for (const r of rows) {
    assert.equal(
      r.accounts,
      kinds * CURRENCIES.length,
      `${r.branch} 하우스 계정이 ${r.accounts}행이다 — ${kinds} kind × ${CURRENCIES.length} 통화를 기대했다`
    );
  }
});

test('R-01-11 · 01 §3-2 검증 쿼리가 0행이다', async () => {
  // 스펙 §3-2 를 옮긴 쿼리다. 표기만 실물에 맞춘다 — accounts 에 branch 컬럼이
  // 없고 하우스 주체의 home_branch 가 지점이다.
  const rows = await query(`
    SELECT b.code, c.code AS currency, k.kind
      FROM ledger.branches b
     CROSS JOIN ledger.currencies c
     CROSS JOIN (SELECT unnest(ARRAY['house_cash','house_gaming','suspense']::ledger.account_kind[]) kind) k
     WHERE b.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM ledger.accounts a
           JOIN ledger.parties hp ON hp.id = a.party_id
          WHERE a.currency = c.code AND a.kind = k.kind
            AND hp.party_type = 'house' AND hp.home_branch = b.code)`);
  assert.deepEqual(rows, [], '상대 하우스 계정이 없는 (지점, 통화, kind) 조합이 남아 있다');
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-currency.test.js`
Expected: FAIL — `HANN 하우스 계정이 11행이다 — 11 kind × 5 통화를 기대했다`

- [ ] **Step 3: `bootstrap_house_accounts()`를 곱집합으로 넓힌다**

`db/schema/003_accounts.sql`에서 a02가 만든 함수 본문의 `INSERT ... SELECT`를 바꾼다:

```sql
  -- 통화 곱집합이다 (R-01-11 · AC-06-4). a02 가 PHP 한 통화로 만들었던 것을
  -- a03 이 넓혔다. 이 INSERT 와 **짝을 이루는 곳**이 013 의
  -- v_check_branch_provisioning 이다 — 만드는 쪽과 검사하는 쪽 둘 다 곱집합이어야
  -- 하고, 한쪽만 고치면 검사가 조용히 통과한다.
  --
  -- 통화 5종 × kind 11종 = 지점당 55행이다.
  INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
  SELECT v_party, k.kind, c.code, k.normal_balance, k.allow_negative
    FROM ledger.house_account_policy k
   CROSS JOIN ledger.currencies c;
```

- [ ] **Step 4: 검사 뷰의 짝을 함께 넓힌다**

`db/schema/013_reconciliation.sql`의 `v_check_branch_provisioning`에서 `missing_house_accounts` 부분식을 바꾼다:

```sql
      -- 만드는 쪽(003 의 bootstrap_house_accounts)과 짝이다. 둘 중 하나만
      -- 고치면 이 검사가 아무것도 못 잡는다 (R-01-11).
      (SELECT count(*)
         FROM ledger.house_account_policy k
        CROSS JOIN ledger.currencies c
        WHERE NOT EXISTS (
          SELECT 1 FROM ledger.accounts a
            JOIN ledger.parties hp ON hp.id = a.party_id
           WHERE hp.home_branch    = b.code
             AND hp.party_type     = 'house'
             AND a.kind            = k.kind
             AND a.currency        = c.code
             AND a.normal_balance  = k.normal_balance
             AND a.allow_negative  = k.allow_negative))::int AS missing_house_accounts,
```

- [ ] **Step 5: `scale`의 소비처를 주석으로 확정한다**

`db/schema/001_types_and_extensions.sql`의 `COMMENT ON COLUMN ledger.currencies.scale`을 교체한다:

```sql
COMMENT ON COLUMN ledger.currencies.scale IS
  '최소 단위 소수 자릿수. 모든 금액은 BIGINT 최소 단위로 저장한다 (PHP scale=2 -> 센타보). '
  'DB 안에 이 값을 읽는 곳이 없는 것은 의도다 — 저장이 이미 최소 단위이므로 배율을 곱할 자리가 '
  '스키마 계층에 없다. 소비처는 표기 계층(화면 · 영수증 · 리포트)이고 ROADMAP 7-1 이 c04 · c06 · c08 에 '
  '배정했다. KRW scale=0 을 무시하면 금액이 100배로 보인다 (01 3-1).';
```

- [ ] **Step 6: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-currency.test.js`
Expected: PASS `# pass 3`

- [ ] **Step 7: 커밋**

```bash
git add db/schema/001_types_and_extensions.sql db/schema/003_accounts.sql \
        db/schema/013_reconciliation.sql db/tests/golden/spec-01-currency.test.js
git commit -m "feat(db): bootstrap house accounts across all five currencies (R-01-10, R-01-11)"
```

---

## Task 2: 상대 하우스 계정 없는 계정 개설을 막는다 (`R-01-12` · `R-01-16`)

**Files:**

- Modify: `db/schema/003_accounts.sql` — 트리거 신설 (`accounts_kind_consistent` 트리거 뒤, 부트스트랩 `DO` 블록 **앞**)
- Modify: `db/schema/010_operations_game.sql` — `op_start_game`에 통화 검사
- Modify: `db/tests/golden/spec-01-currency.test.js`

**Interfaces:**

- Consumes: Task 1의 55행 하우스 계정 · `withRollback` · `expectSqlState` · `uniqCode` (a01)
- Produces: `ledger.assert_counterpart_house_accounts()` 트리거. Task 3의 R12와 짝을 이룬다 — 트리거가 예방, R12가 탐지다

**왜 트리거가 부트스트랩 `DO` 블록보다 앞에 와야 하는가.** 같은 파일 안에서 `CREATE TRIGGER`가 `DO` 블록 뒤에 오면 부트스트랩이 트리거 없이 돈다. 그러면 "하우스 면제" 분기가 적용 시점에 한 번도 실행되지 않아, 그 분기가 틀렸다는 사실이 첫 신규 지점 프로비저닝까지 드러나지 않는다. 앞에 두면 `db:reset`이 매번 그 경로를 밟는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-currency.test.js`의 import 줄을 바꾼다:

```js
import { query, withRollback, expectSqlState, uniqCode, closePool } from '../helpers/db.mjs';
```

파일 끝에 테스트 3건을 더한다:

```js
test('R-01-12 · AC-06-5 상대 하우스 계정이 없는 통화로 계정을 열면 거부된다', async () => {
  await withRollback(async (client) => {
    // JPY 는 시드 5종에 없다. currencies FK 를 통과시키려고 통화 행만 먼저
    // 넣는다 — "통화는 있는데 하우스 계정이 없는" 상태가 이 검사의 대상이다.
    await client.query("INSERT INTO ledger.currencies (code, scale, symbol) VALUES ('JPY', 0, 'JPY')");
    const { rows } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'member', 'counterpart probe', 'HANN') RETURNING id`,
      [uniqCode('MEM')]
    );
    await expectSqlState('23514', async () => {
      await client.query(
        `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
         VALUES ($1, 'member_deposit', 'JPY', 'credit', FALSE)`,
        [rows[0].id]
      );
    });
  });
});

test('R-01-12 · AC-06-5 한 지점만 갖춘 통화도 거부된다 — 상대 계정은 지점별이다', async () => {
  await withRollback(async (client) => {
    await client.query("INSERT INTO ledger.currencies (code, scale, symbol) VALUES ('JPY', 0, 'JPY')");
    // HANN 의 하우스 주체에만 JPY 계정 전 종류를 깔아 준다. 하우스 주체는
    // 트리거 면제라 이 INSERT 자체는 통과한다.
    await client.query(`
      INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
      SELECT hp.id, k.kind, 'JPY', k.normal_balance, k.allow_negative
        FROM ledger.parties hp
       CROSS JOIN ledger.house_account_policy k
       WHERE hp.party_type = 'house' AND hp.home_branch = 'HANN'`);

    const { rows } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'member', 'one branch only', 'HANN') RETURNING id`,
      [uniqCode('MEM')]
    );
    // HANN 은 갖췄지만 NUSTAR · ONLINE 이 없다. 손님은 지점 중립이므로
    // (008:359-368 이 member 를 지점 일치 검사에서 뺀다) 아직 열면 안 된다.
    const err = await expectSqlState('23514', async () => {
      await client.query(
        `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
         VALUES ($1, 'member_deposit', 'JPY', 'credit', FALSE)`,
        [rows[0].id]
      );
    });
    assert.match(err.message, /NUSTAR/, '어느 지점이 비었는지가 메시지에 있어야 한다');
    assert.doesNotMatch(err.message, /HANN:/, 'HANN 은 갖췄으므로 목록에 없어야 한다');
  });
});

test('R-01-12 게임 주체는 자기 지점만 본다', async () => {
  await withRollback(async (client) => {
    await client.query("INSERT INTO ledger.currencies (code, scale, symbol) VALUES ('JPY', 0, 'JPY')");
    await client.query(`
      INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
      SELECT hp.id, k.kind, 'JPY', k.normal_balance, k.allow_negative
        FROM ledger.parties hp
       CROSS JOIN ledger.house_account_policy k
       WHERE hp.party_type = 'house' AND hp.home_branch = 'HANN'`);

    const { rows } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'game', 'game scope probe', 'HANN') RETURNING id`,
      [uniqCode('GAME')]
    );
    // 게임은 HANN 에서만 돈다 — NUSTAR 의 JPY 빈틈은 이 게임과 무관하다.
    await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
       VALUES ($1, 'chips_outstanding', 'JPY', 'credit', FALSE)`,
      [rows[0].id]
    );
  });
});

test('R-01-12 시드 5종 통화로는 계정이 열린다', async () => {
  await withRollback(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'member', 'counterpart ok', 'HANN') RETURNING id`,
      [uniqCode('MEM')]
    );
    for (const currency of CURRENCIES) {
      await client.query(
        `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
         VALUES ($1, 'member_deposit', $2, 'credit', FALSE)`,
        [rows[0].id, currency]
      );
    }
    const { rows: made } = await client.query(
      'SELECT count(*)::int AS n FROM ledger.accounts WHERE party_id = $1',
      [rows[0].id]
    );
    assert.equal(made[0].n, CURRENCIES.length);
  });
});

test('R-01-12 하우스 주체는 면제된다 — 부트스트랩이 자기 자신을 요구하지 않는다', async () => {
  await withRollback(async (client) => {
    await client.query("INSERT INTO ledger.currencies (code, scale, symbol) VALUES ('JPY', 0, 'JPY')");
    const { rows } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'house', 'house probe', 'HANN') RETURNING id`,
      [uniqCode('HOUSE')]
    );
    // 하우스 면제가 없으면 이 INSERT 가 23514 로 죽는다.
    await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
       VALUES ($1, 'house_cash', 'JPY', 'debit', FALSE)`,
      [rows[0].id]
    );
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-currency.test.js`
Expected: FAIL — `expected SQLSTATE 23514, but the statement succeeded`

- [ ] **Step 3: 트리거를 만든다**

`db/schema/003_accounts.sql`, `CREATE TRIGGER accounts_kind_consistent` **바로 뒤**에 넣는다:

```sql
-- -----------------------------------------------------------------------------
-- 상대 하우스 계정 강제 (01 §3-1 R-01-12 · AC-06-5)
-- -----------------------------------------------------------------------------
-- 손님 계좌를 어떤 통화로든 열 수 있으면, 그 통화의 house_cash 가 없어서 첫
-- 입금이 posting rule 은 통과하고 account_id_of() 에서 죽는다. 실패 지점이
-- 계정 개설에서 자금 이동으로 밀리면 원인이 계좌가 아니라 거래로 보인다.
--
-- 계정을 만드는 경로가 넷이다 — 003 의 부트스트랩 DO · bootstrap_house_accounts()
-- · 010 의 게임 칩 계정 · 011 의 op_open_account. op_open_account 안에만 두면
-- 나머지 셋이 뚫린다. 그래서 테이블 트리거다.
--
-- 하우스 주체는 면제한다. 상대 계정 자신을 만드는 경로가 자기 존재를 요구하면
-- 부트스트랩이 성립하지 않는다.
--
-- 이것은 **예방**이고 013 의 R12 가 같은 사실을 **탐지**한다. 둘 다 있어야
-- 하는 이유 — 트리거는 소유자가 끌 수 있고, 통화 행이 나중에 추가되면 이미
-- 열린 계정은 트리거를 다시 통과하지 않는다.
CREATE FUNCTION ledger.assert_counterpart_house_accounts() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
DECLARE
  v_party_type  ledger.party_type;
  v_home_branch TEXT;
  v_missing     TEXT;
BEGIN
  SELECT party_type, home_branch INTO v_party_type, v_home_branch
    FROM ledger.parties WHERE id = NEW.party_id;
  IF v_party_type = 'house' THEN
    RETURN NEW;
  END IF;

  -- **지점별로** 본다. 통화 단위로만 보면 상대 계정 보장이 되지 않는다 —
  -- 008:359-368 이 house · game 계정에 대해 p.home_branch = p_branch 를 요구하고
  -- (branch_transfer 만 예외), 그래서 NUSTAR 의 USD house_cash 는 HANN 거래에서
  -- 쓸 수 없다. "어느 지점엔가 있다" 는 HANN 손님에게 아무 소용이 없다.
  --
  -- 어느 지점을 요구하는가:
  --   game    → home_branch 하나. 게임은 그 지점에서만 돈다.
  --   나머지  → **활성 지점 전부.** 008 이 member · partner 를 지점 중립으로
  --             두었다 (손님은 지점을 옮겨 다닌다). HANN 에서 연 계좌로
  --             NUSTAR 에서 입금할 수 있으므로 두 지점 다 상대가 있어야 한다.
  --   game 인데 home_branch 가 NULL 이면 좁힐 근거가 없으므로 전부로 본다.
  --
  -- suspended · closed 지점은 뺀다. 영업하지 않는 지점의 빈틈이 신규 계좌
  -- 개설을 막으면, 지점을 닫는 정상 운영이 손님 등록을 세운다.
  SELECT string_agg(m.branch || ':' || m.kind, ', ' ORDER BY m.branch, m.kind)
    INTO v_missing
    FROM (
      SELECT b.code AS branch, k.kind::TEXT AS kind
        FROM ledger.branches b
       CROSS JOIN ledger.house_account_policy k
       WHERE b.status = 'active'
         AND (v_party_type <> 'game' OR v_home_branch IS NULL OR b.code = v_home_branch)
         AND NOT EXISTS (
           SELECT 1 FROM ledger.accounts a
             JOIN ledger.parties hp ON hp.id = a.party_id
            WHERE hp.party_type  = 'house'
              AND hp.home_branch = b.code
              AND a.kind         = k.kind
              AND a.currency     = NEW.currency)
    ) m;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'currency % 의 상대 하우스 계정이 지점별로 갖춰지지 않았다 (%). 계정을 열기 전에 그 지점의 하우스 부트스트랩을 넓혀라 — 003 의 bootstrap_house_accounts()',
      NEW.currency, v_missing
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_counterpart_house
  BEFORE INSERT ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_counterpart_house_accounts();
```

- [ ] **Step 4: 게임 통화 = 계좌 통화를 강제한다 (`R-01-16`)**

`db/schema/010_operations_game.sql`, 회원 주체를 찾는 `IF v_member IS NULL ... END IF;` 블록 **바로 뒤**에 넣는다:

```sql
  -- 게임 통화 = 계좌 통화 (01 §3-1 R-01-16 · 결정 §3).
  -- 현행은 USD 게임을 열고 PHP 계좌에서 차감했다 (index.html:6939 가 환산 없이
  -- 뺐다). 환전 업무가 없으므로(U2) 그것은 교차 통화 이동이고, 차대가 통화별로
  -- 각각 0이어야 하는 원장에서는 애초에 성립하지 않는 거래다.
  IF NOT EXISTS (
    SELECT 1 FROM ledger.accounts a
     WHERE a.party_id = v_member
       AND a.kind     = 'member_deposit'
       AND a.currency = p_currency
  ) THEN
    RAISE EXCEPTION
      'member % 에게 % 통화 계좌가 없다 — 게임 통화와 계좌 통화가 같아야 한다',
      p_member_code, p_currency
      USING ERRCODE = 'check_violation';
  END IF;
```

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-currency.test.js`
Expected: PASS `# pass 8`

- [ ] **Step 6: 골든 스위트 전체가 여전히 도는지 본다**

Run: `PGPASSWORD=devonly npm run test:db`
Expected: PASS. **`db/tests/posting/section-05-game-buyin.test.js`가 빨개지면** 픽스처가 회원 계좌 통화와 다른 게임 통화를 쓰고 있다는 뜻이다 — `db/tests/fixtures/games.mjs`가 회원 계좌 통화를 읽어 넘기도록 고친다. 검사를 되돌리지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add db/schema/003_accounts.sql db/schema/010_operations_game.sql \
        db/tests/golden/spec-01-currency.test.js db/tests/fixtures/games.mjs
git commit -m "feat(db): require counterpart house accounts and matching game currency (R-01-12, R-01-16)"
```

---

## Task 3: R12 — 거래되는 통화 중 상대 계정이 없는 것 (`R-01-13`)

**Files:**

- Modify: `docs/architecture/10-acceptance-criteria.md` §11 R 번호 대장 (**먼저**, ROADMAP §9-7)
- Modify: `db/schema/013_reconciliation.sql` — 뷰 신설 + `v_integrity_status` 합류 + **`ledger_read` GRANT 목록**
- Create: `db/tests/reconciliation/r12-currency-counterpart.test.js`
- Modify: `db/tests/reconciliation/integrity-status.test.js` — `CHECKS` 배열

**Interfaces:**

- Consumes: Task 2의 트리거(예방) · `ledger.house_account_policy` · `asRole` (a02) · `withRollback` (a01)
- Produces: `ledger.v_check_currency_counterpart` · `v_integrity_status`의 `R12_currency_counterpart` 행

**왜 R12인가.** `10-acceptance-criteria.md` §11 대장이 R1~R11까지 쓰고 있고 R10·R11이 예약돼 있다. R12가 다음 빈 번호다. 스펙 `01` §6 표는 R11까지만 적었지만 `R-01-13`이 "`v_integrity_status`에 검사가 있다"를 요구하므로 번호가 필요하다.

**왜 "거래되는" 통화만 보는가.** 하우스 부트스트랩이 곱집합이라 시드 직후에는 빈틈이 없다. 위험은 **나중에** 온다 — 통화 행이 추가되고 하우스 부트스트랩이 안 돌면, 그 통화로 이미 열린 계정이 상대를 잃는다. 트리거는 그 시점에 이미 지나갔다. R12는 "분개가 하나라도 있는 통화"로 좁혀 노이즈를 줄인다.

- [ ] **Step 1: R 번호 대장을 먼저 갱신한다**

`docs/architecture/10-acceptance-criteria.md` §11 표의 R11 행 아래에 넣는다:

```markdown
| **R12** | `v_check_currency_counterpart` | ❌ 미착수 | `R-01-13` · `AC-06-8` |
```

그리고 R10 행의 상태 칸을 바꾼다:

```markdown
| **R10** | `v_check_chip_inventory` | 🔒 **B1 차단 · a06** — 카운터 항등식(`R-04-65`)과 `chip_type ↔ entry_category` 매핑(`AC-42-4`)이 먼저다 | `DR-42` |
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`db/tests/reconciliation/r12-currency-counterpart.test.js`:

```js
// R12 · R-01-13 · AC-06-8 — 거래되는 통화 중 상대 하우스 계정이 없는 것.
//
// 003 의 accounts_counterpart_house 트리거가 예방이고 이것이 탐지다.
// 둘 다 필요한 이유: 트리거는 INSERT 시점만 보므로, 통화가 나중에 추가되고
// 하우스 부트스트랩이 안 돌면 이미 열린 계정이 상대를 잃는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, asRole, closePool } from '../helpers/db.mjs';

after(closePool);

test('R12 · AC-06-8 시드 상태에서 위반이 0행이다', async () => {
  const rows = await query(
    'SELECT * FROM ledger.v_check_currency_counterpart WHERE NOT ok'
  );
  assert.deepEqual(rows, [], '상대 계정을 잃은 통화가 있다');
});

test('R12 한 지점이 상대를 잃으면 그 지점 행만 위반이 된다', async () => {
  await withRollback(async (client) => {
    // 하우스 계정을 DELETE 하지 않는다 — entries.account_id FK 가 막고, 막지
    // 못하는 계정만 골라 지우면 테스트가 픽스처 내용에 붙는다. 대신 HANN 의
    // 하우스 주체를 다른 지점으로 옮긴다. 뷰가 hp.home_branch 로 상대를 찾으므로
    // HANN 은 11 종 전부를 잃고 다른 지점은 그대로다 — Codex 가 지적한 바로 그
    // 시나리오("한 지점만 잃는다")를 정확히 만든다.
    //
    // home_branch 는 Task 8 의 컬럼 불변 트리거가 막는 목록에 없다 (code ·
    // party_type 만 막는다). 지점 통폐합이 실제 운영 사건이라 막지 않았다.
    const { rows: traded } = await client.query(
      "SELECT count(*)::int AS n FROM ledger.entries WHERE branch = 'HANN'"
    );
    assert.ok(traded[0].n > 0, 'HANN 분개가 없다 — posting/ 이 먼저 돌아야 한다');

    await client.query(
      "UPDATE ledger.parties SET home_branch = 'ONLINE' WHERE party_type = 'house' AND home_branch = 'HANN'"
    );

    const rows = await client.query(
      'SELECT * FROM ledger.v_check_currency_counterpart ORDER BY branch, currency'
    ).then((r) => r.rows);

    const hann = rows.filter((r) => r.branch === 'HANN');
    assert.ok(hann.length > 0, 'HANN 은 거래되는 통화가 있으므로 행이 나와야 한다');
    for (const row of hann) {
      assert.equal(row.ok, false, `HANN/${row.currency} 이 초록이면 지점 분리가 안 된 것이다`);
      assert.match(row.missing_kinds, /house_cash/);
    }

    const others = rows.filter((r) => r.branch !== 'HANN' && r.branch !== 'ONLINE');
    for (const row of others) {
      assert.equal(row.ok, true, `${row.branch}/${row.currency} 은 영향을 받지 않아야 한다`);
    }
  });
});

test('R12 뷰를 ledger_read 로 조회할 수 있다', async () => {
  // security_invoker 뷰다. 013 의 GRANT 가 빠지면 42501 로 죽는다.
  await asRole('ledger_read', async (client) => {
    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM ledger.v_check_currency_counterpart'
    );
    assert.ok(rows[0].n >= 0);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/reconciliation/r12-currency-counterpart.test.js`
Expected: FAIL — `relation "ledger.v_check_currency_counterpart" does not exist`

- [ ] **Step 4: 뷰를 만든다**

`db/schema/013_reconciliation.sql`, `v_check_merkle_anchor` 뒤 · `v_integrity_status` **앞**에 넣는다:

```sql
-- =============================================================================
-- R12 · 거래되는 통화 중 상대 하우스 계정이 없는 것 (01 §3-1 R-01-13 · AC-06-8)
-- =============================================================================
-- 003 의 accounts_counterpart_house 트리거가 예방이고 이것이 탐지다.
-- 트리거는 INSERT 시점만 본다 — 통화 행이 나중에 추가되고 하우스 부트스트랩이
-- 안 돌면, 그 통화로 이미 열린 계정은 트리거를 다시 통과하지 않는다.
--
-- "거래되는" 통화로 좁힌다. 시드 직후에는 하우스 부트스트랩이 곱집합이라
-- 빈틈이 없고, 아직 아무도 쓰지 않는 통화의 빈틈은 자금 사고가 아니다.
-- 분개가 하나라도 있으면 그 통화는 실제 자금이 도는 통화다.
--
-- **통화가 아니라 (지점, 통화) 로 묶는다.** 008:359-368 이 house · game 계정에
-- 지점 일치를 요구하므로, NUSTAR 의 USD house_cash 는 HANN 거래의 상대가 되지
-- 못한다. 통화 단위로 집계하면 한 지점만 갖춘 통화가 초록으로 보이고, 그것이
-- 이 검사가 잡아야 할 바로 그 상태다. entries.branch 가 이미 비정규화돼 있어
-- (004 의 컬럼 주석) transactions 조인 없이 나온다.
CREATE VIEW ledger.v_check_currency_counterpart
  WITH (security_invoker = true) AS
WITH traded AS (
  SELECT DISTINCT e.branch, e.currency FROM ledger.entries e
)
SELECT
  t.branch,
  t.currency,
  string_agg(k.kind::TEXT, ', ' ORDER BY k.kind::TEXT) AS missing_kinds,
  count(k.kind)::int                                   AS missing_count,
  count(k.kind) = 0                                    AS ok
  FROM traded t
  LEFT JOIN ledger.house_account_policy k
    ON NOT EXISTS (
      SELECT 1 FROM ledger.accounts a
        JOIN ledger.parties hp ON hp.id = a.party_id
       WHERE hp.party_type  = 'house'
         AND hp.home_branch = t.branch
         AND a.kind         = k.kind
         AND a.currency     = t.currency)
 GROUP BY t.branch, t.currency;

COMMENT ON VIEW ledger.v_check_currency_counterpart IS
  'R12. ok=false 는 그 지점에서 그 통화로 자금이 도는데 그 지점의 상대 하우스 계정이 없다는 뜻이다. 003 의 bootstrap_house_accounts() 를 그 지점·통화까지 돌려야 한다. 지점을 나누는 이유는 008 이 하우스 계정에 지점 일치를 요구하기 때문이다.';
```

**그리고 같은 파일의 GRANT 블록을 함께 고친다** ([`013:595-606`](../../../db/schema/013_reconciliation.sql)). 뷰 목록에 한 줄을 더한다:

```sql
  ledger.v_check_branch_provisioning,
  ledger.v_check_currency_counterpart,
  cage.v_check_rolling_projection
TO ledger_read;
```

**빠뜨리면 Step 2의 `asRole('ledger_read')` 테스트가 42501로 죽는다.** [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `GRANT SELECT ON ALL TABLES IN SCHEMA ledger, cage TO ledger_read`는 012가 돌 때 존재하던 관계만 덮는다 — 013이 그 뒤에 만드는 뷰는 013이 명시적으로 줘야 하고, 그래서 013 끝에 그 목록이 있다. 새 뷰를 만들 때마다 이 목록에 넣는 것이 013의 규약이다.

- [ ] **Step 5: `v_integrity_status`에 합류시킨다**

같은 파일의 `v_integrity_status` `UNION ALL` 목록 끝에 붙인다 (R9 가지 뒤):

```sql
UNION ALL
SELECT 'R12_currency_counterpart',
       count(*) FILTER (WHERE NOT ok),
       count(*)
  FROM ledger.v_check_currency_counterpart
```

- [ ] **Step 6: 집계 테스트의 이름 목록을 늘린다**

`db/tests/reconciliation/integrity-status.test.js`의 `CHECKS` 배열에 두 줄을 더한다. **R11은 Task 6이 만든다 — 지금은 R12만 넣고, Task 6에서 R11을 넣는다.**

```js
  'R9_merkle_anchor',
  'R12_currency_counterpart',
```

배열은 `ORDER BY check_name` 결과와 대조되므로 **문자열 정렬 순서**로 둔다. `'R12...' < 'R1_...'`가 아니라 `'R12_' > 'R1_'`이고 `'R12_' < 'R2_'`다 — 즉 R1 다음, R2 앞이다. 배열을 다음 순서로 고친다:

```js
const CHECKS = [
  'R12_currency_counterpart',
  'R1_double_entry',
  'R2_balance_projection',
  'R3_hash_chain_link',
  'R4_rolling_projection',
  'R5_suspense',
  'R6_entry_branch',
  'R7_posting_rules',
  'R8_chain_anchor',
  'R9_merkle_anchor',
];
```

> `'R12_' < 'R1_'`인 이유: 3번째 글자에서 `'2'`(0x32)와 `'_'`(0x5F)를 비교하고 `'2'`가 작다. 헷갈리면 `SELECT check_name FROM ledger.v_integrity_status ORDER BY check_name` 을 직접 돌려 복사한다.

- [ ] **Step 7: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `r12-currency-counterpart.test.js` `# pass 3`

- [ ] **Step 8: 커밋**

```bash
git add docs/architecture/10-acceptance-criteria.md db/schema/013_reconciliation.sql \
        db/tests/reconciliation/r12-currency-counterpart.test.js \
        db/tests/reconciliation/integrity-status.test.js
git commit -m "feat(db): add R12 currency counterpart reconciliation check (R-01-13)"
```

---

## Task 4: `posting_rules` 표를 경화한다 (`R-01-20`·`R-01-21`·`R-01-22`·`R-01-24`)

**Files:**

- Modify: `db/schema/004_ledger.sql:294-336` — `opening_balance` 시드 · 역분개 생성기 · `assert_posting_rule()`
- Create: `db/tests/golden/spec-01-posting-rules.test.js`

**Interfaces:**

- Consumes: `query` · `withRollback` · `expectSqlState` · `closePool` (a01)
- Produces: `ledger.posting_rules` 행 수가 **`reversal`·`game_cancel` 0행 · `opening_balance` 12행**. Task 5의 지문이 이 집합을 해싱하고 Task 6의 R11이 표 대신 미러 대조를 맡는다

**문제의 구조.** 지금 표가 세 겹으로 뚫려 있다:

1. [`004:295-298`](../../../db/schema/004_ledger.sql)이 `opening_balance`를 `account_kind` **전체**(16종) × 2부호 = 32행 넣는다. `category = 'opening_balance'`이기만 하면 어떤 계정을 어느 방향으로 움직여도 통과한다.
2. [`004:304-309`](../../../db/schema/004_ledger.sql)의 역분개 생성기가 그 32행을 `reversal`·`game_cancel` 두 kind로 전파한다. 64행이 더 늘고, 같은 구멍이 두 kind에 복제된다.
3. 표에 불변성 트리거가 없어 `ledger_migrator` 밖의 누구든 소유자 권한만 있으면 행을 더할 수 있다.

**예방(트리거)과 탐지(R7)가 같은 지점에서 함께 실패한다** — 표가 곧 R7의 기준이므로, 표가 넓으면 R7도 넓게 통과시킨다.

**`reversal`·`game_cancel`을 표에서 없애는 대신 무엇이 지키는가.** `assert_posting_rule()`에 예외를 두고, **R11**(Task 6)이 "역분개 분개 집합 = 원 거래 집합의 부호 반전"을 검사한다. 표보다 강한 검사다 — 표는 조합만 보지만 R11은 금액까지 본다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-posting-rules.test.js`:

```js
// 01 §4 분개 규칙 표 경화 (DR-51 + DR-55).
//
// 표가 넓으면 트리거(예방)와 R7(탐지)이 같은 지점에서 함께 실패한다.
// 이 파일은 표의 **모양**을 고정한다 — 실제 분개가 표를 따르는지는
// posting/ 의 절별 테스트와 013 의 R7 이 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, expectSqlState, closePool } from '../helpers/db.mjs';

after(closePool);

// R-01-21 이 지정한 6종. 앞 다섯은 "잔액이 있는 계정" 이고 opening_equity 는
// 그 균형 상대다 — 빼면 op_load_opening_balance 의 모든 거래가 I1 에 걸린다.
const OPENING_KINDS = [
  'chips_outstanding',
  'house_cash',
  'marker_receivable',
  'member_deposit',
  'opening_equity',
  'player_wallet',
];

test('R-01-24 · AC-51-5 표에 reversal · game_cancel 행이 없다', async () => {
  const rows = await query(`
    SELECT kind::TEXT AS kind, count(*)::int AS n
      FROM ledger.posting_rules
     WHERE kind IN ('reversal', 'game_cancel')
     GROUP BY kind`);
  assert.deepEqual(
    rows,
    [],
    '역분개를 표로 검증하지 않는다 — 트리거 예외 + R11 미러 대조가 그 자리를 맡는다'
  );
});

test('R-01-21 · AC-51-2 opening_balance 규칙이 6종 × 2부호 = 12행이다', async () => {
  const rows = await query(`
    SELECT account_kind::TEXT AS account_kind, sign
      FROM ledger.posting_rules
     WHERE category = 'opening_balance'
     ORDER BY account_kind, sign`);
  assert.equal(rows.length, 12, `opening_balance 규칙이 ${rows.length}행이다 — 12행을 기대했다`);
  assert.deepEqual(
    [...new Set(rows.map((r) => r.account_kind))],
    OPENING_KINDS,
    'opening_balance 대상 계정 종류가 R-01-21 목록과 다르다'
  );
});

test('R-01-20 opening_balance 규칙이 다른 kind 로 전파되지 않았다', async () => {
  const rows = await query(`
    SELECT DISTINCT kind::TEXT AS kind
      FROM ledger.posting_rules
     WHERE category = 'opening_balance'`);
  assert.deepEqual(
    rows.map((r) => r.kind),
    ['opening_balance'],
    '역분개 생성기의 WHERE 가 opening_balance 를 제외하지 않는다 (004)'
  );
});

test('R-01-22 · AC-51-3 posting_rules 에 행을 더할 수 없다', async () => {
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query(`
        INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
        VALUES ('deposit', 'deposit_cash', 'suspense', 1)`);
    });
  });
});

test('R-01-22 posting_rules 의 행을 고치거나 지울 수 없다', async () => {
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query(`
        DELETE FROM ledger.posting_rules
         WHERE kind = 'deposit' AND account_kind = 'house_cash'`);
    });
  });
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query("UPDATE ledger.posting_rules SET sign = -sign WHERE kind = 'deposit'");
    });
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-posting-rules.test.js`
Expected: FAIL — 첫 테스트가 `reversal`·`game_cancel` 행이 남아 있다고 보고한다

- [ ] **Step 3: `opening_balance` 시드를 6종으로 좁힌다**

`db/schema/004_ledger.sql`의 `-- §14 기초 잔액` INSERT를 교체한다:

```sql
-- §14 기초 잔액 — **잔액이 있는 계정 종류로만** 좁힌다 (R-01-21 · AC-51-2).
--
-- 전에는 enum_range(NULL::ledger.account_kind) 전체 × 2부호 = 32행이었다.
-- 그러면 category='opening_balance' 이기만 하면 어떤 계정을 어느 방향으로
-- 움직여도 통과한다 — 예방(assert_posting_rule)과 탐지(R7)가 같은 지점에서
-- 함께 뚫린다 (design-review-*.md DR-51 · DR-55).
--
-- opening_equity 를 반드시 남긴다. 나머지 다섯의 균형 상대이고, 빼면
-- 011 의 op_load_opening_balance 가 만드는 모든 거래가 차대 불균형이 되어
-- I1 에 걸린다.
INSERT INTO ledger.posting_rules (kind, category, account_kind, sign)
SELECT 'opening_balance', 'opening_balance', k, s
  FROM unnest(ARRAY[
         'house_cash', 'member_deposit', 'marker_receivable',
         'chips_outstanding', 'player_wallet', 'opening_equity'
       ]::ledger.account_kind[])       AS k,
       unnest(ARRAY[1, -1]::SMALLINT[]) AS s;
```

- [ ] **Step 4: 역분개 생성기를 통째로 걷어낸다**

같은 파일의 `-- §9 게임취소 · 일반 역분개` INSERT 블록(`INSERT ... SELECT DISTINCT rk ... ON CONFLICT DO NOTHING;`)을 **삭제**하고 그 자리에 주석만 남긴다:

```sql
-- §9 게임취소 · 일반 역분개 — **표에 넣지 않는다** (R-01-24 · AC-51-5).
--
-- 전에는 표의 모든 행을 부호 반전해 reversal · game_cancel 두 kind 로 전파했다.
-- 그 생성기가 opening_balance 32행까지 함께 전파해 표를 64행 넓혔고, 넓어진
-- 표가 그대로 R7 의 기준이 됐다.
--
-- 표 대신 **R11 — 역분개 미러 대조**(013)가 지킨다. 표보다 강한 검사다:
-- 표는 (kind, category, account_kind, sign) 조합만 보지만 R11 은 원 거래와
-- 역분개의 (account_id, category, amount_minor) 다중집합이 정확한 부호
-- 반전인지를 **금액까지** 본다.
--
-- 역분개가 원 category 를 그대로 유지하는 규약은 그대로다 — 'reversal' 로
-- 덮으면 category 기준 파생 뷰(013 의 교대 카운터 · 윈로스)가 정정을
-- 반영하지 못한다. 역분개 여부는 transactions.kind 와 reverses_tx_id 로 본다.
```

- [ ] **Step 5: `assert_posting_rule()`에 역분개 예외를 둔다**

같은 파일의 `assert_posting_rule()` 본문에서 `IF NOT EXISTS (` **앞**에 넣는다:

```sql
  -- 역분개는 표로 검증하지 않는다 (R-01-24). R11 이 원 거래와의 미러 관계를
  -- 본다. 여기서 통과시키지 않으면 정정 자체가 불가능해진다 — 표에 행이
  -- 없으므로 모든 역분개가 거부된다.
  --
  -- ⚠️ 이 예외는 Task 9 의 transactions_reverses_kind 양방향 CHECK 가 있어야만
  -- 안전하다. 그 CHECK 가 kind IN ('reversal','game_cancel') 인 거래에
  -- reverses_tx_id 를 **강제**하므로, 여기를 통과한 거래는 반드시 원 거래를
  -- 갖고 따라서 반드시 R11 의 시야에 든다. 한쪽만 걸린 CHECK 였다면 원본 없는
  -- 역분개가 표 검증도 R11 도 빠져나간다.
  IF v_kind IN ('reversal', 'game_cancel') THEN
    RETURN NEW;
  END IF;
```

> **Task 4와 Task 9의 순서.** Task 4가 먼저 들어가면 Task 9까지의 구간 동안 위 구멍이 열려 있다. 커밋 단위로는 Task 4·Task 9가 갈리지만 **같은 브랜치에서 둘 다 끝나기 전에 머지하지 않는다.** 그것이 싫으면 Task 9 Step 3의 `transactions_reverses_kind` CHECK만 Task 4 Step 5와 같은 커밋으로 당긴다 — 둘 다 `004_ledger.sql` 한 파일이다.

- [ ] **Step 6: 표에 불변성 트리거를 건다**

같은 파일, `CREATE TRIGGER entries_posting_rule` **뒤**에 넣는다. **시드 INSERT보다 뒤여야 한다** (`R-01-22`) — 앞에 두면 시드 자신이 거부된다.

```sql
-- -----------------------------------------------------------------------------
-- 표 불변성 (R-01-22 · AC-51-3)
-- -----------------------------------------------------------------------------
-- 이 표가 곧 R7 의 기준이다. 표를 넓힐 수 있으면 R7 을 넓힐 수 있고, 그러면
-- 대사가 스스로를 통과시킨다. 적용 시점(위 시드 INSERT)이 지나면 잠근다.
--
-- 트리거 생성이 시드 INSERT **뒤에** 온다. 앞에 두면 시드가 거부된다.
-- 004 안에서 이 순서를 바꾸면 apply.sh 가 통째로 실패한다.
--
-- 소유자는 트리거를 지울 수 있으므로 완전한 방어가 아니다. 사고성 변경은
-- 막고 고의는 흔적을 남긴다 — 표를 정당하게 바꾸는 절차는 이 파일을 고치고
-- db/scripts/reset.sh 로 전체 재적용하는 것이며, 그때 아래 schema_fingerprints
-- 행도 **같은 커밋에서** 갱신해야 한다 (R-01-23).
CREATE FUNCTION ledger.deny_posting_rule_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'ledger.posting_rules 는 불변이다 — 04-posting-rules.md 와 004_ledger.sql 을 고치고 전체 재적용하라 (R-01-22)'
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER posting_rules_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON ledger.posting_rules
  FOR EACH ROW EXECUTE FUNCTION ledger.deny_posting_rule_change();
```

- [ ] **Step 7: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-posting-rules.test.js`
Expected: PASS `# pass 5`

- [ ] **Step 8: 골든 스위트 전체를 돌린다**

Run: `PGPASSWORD=devonly npm run test:db`
Expected: PASS. **`db/tests/posting/section-09-game-cancel.test.js`가 빨개지면** Step 5의 예외가 빠졌거나 위치가 틀렸다 — 역분개가 표에 없으므로 예외 없이는 전부 거부된다.

- [ ] **Step 9: 커밋**

```bash
git add db/schema/004_ledger.sql db/tests/golden/spec-01-posting-rules.test.js
git commit -m "feat(db): narrow opening_balance rules, drop reversal rows, lock the table (R-01-20..R-01-24)"
```

---

## Task 5: 표 지문 — R7이 해시까지 본다 (`R-01-23`)

**Files:**

- Modify: `db/schema/004_ledger.sql` — `schema_fingerprints` 테이블 · `posting_rules_digest()` · 지문 시드
- Modify: `db/schema/013_reconciliation.sql` — `v_check_posting_rules`에 지문 가지 추가
- Modify: `db/schema/012_roles_and_grants.sql` — 새 함수 EXECUTE 정책
- Modify: `db/tests/golden/spec-01-posting-rules.test.js`

**Interfaces:**

- Consumes: Task 4의 잠긴 표
- Produces: `ledger.posting_rules_digest() RETURNS BYTEA` · `ledger.schema_fingerprints(name, digest, recorded_at)` · R7 뷰의 `fingerprint_ok` 컬럼

**왜 지문이 표 밖에 있어야 하는가.** 표 안에 두면 표를 고치는 사람이 해시도 같이 고친다. 별도 테이블에 두면 **두 곳을 고쳐야** 하고, 한 곳만 고친 상태가 R7에 드러난다. 완전한 방어는 아니다 — 소유자는 둘 다 고칠 수 있다. 사고와 고의를 가른다.

**왜 `STABLE`이고 `SECURITY INVOKER`인가.** R7 뷰가 `security_invoker`라 호출자 권한으로 돈다. `ledger_read`는 [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `GRANT SELECT ON ALL TABLES IN SCHEMA ledger`로 `posting_rules`를 이미 읽을 수 있으므로 정의자 권한이 필요 없다. `STABLE`이면 한 쿼리 안에서 여러 번 불려도 한 번만 계산된다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/golden/spec-01-posting-rules.test.js` 끝에 붙인다:

```js
test('R-01-23 · AC-51-4 표 지문이 기록돼 있고 현재 표와 일치한다', async () => {
  const [row] = await query(`
    SELECT f.digest = ledger.posting_rules_digest() AS ok,
           encode(f.digest, 'hex')                  AS recorded
      FROM ledger.schema_fingerprints f
     WHERE f.name = 'ledger.posting_rules'`);
  assert.ok(row, 'schema_fingerprints 에 posting_rules 행이 없다');
  assert.equal(row.ok, true, `기록된 지문 ${row.recorded} 이 현재 표와 다르다`);
});

test('R-01-23 R7 뷰가 지문 일치를 함께 보고한다', async () => {
  const rows = await query('SELECT * FROM ledger.v_check_posting_rules WHERE NOT ok');
  assert.deepEqual(rows, [], 'R7 위반이 있다');
  const [{ fingerprint_ok }] = await query(
    'SELECT bool_and(fingerprint_ok) AS fingerprint_ok FROM ledger.v_check_posting_rules'
  );
  assert.equal(fingerprint_ok, true, 'R7 이 지문 불일치를 보고한다');
});

test('R-01-23 지문 행을 바꾸면 R7 이 즉시 빨개진다', async () => {
  await withRollback(async (client) => {
    await client.query(`
      UPDATE ledger.schema_fingerprints
         SET digest = sha256('tampered'::bytea)
       WHERE name = 'ledger.posting_rules'`);
    const { rows } = await client.query(
      'SELECT bool_and(fingerprint_ok) AS fingerprint_ok FROM ledger.v_check_posting_rules'
    );
    assert.equal(rows[0].fingerprint_ok, false, '지문이 어긋났는데 R7 이 통과했다');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-posting-rules.test.js`
Expected: FAIL — `function ledger.posting_rules_digest() does not exist`

- [ ] **Step 3: 지문 테이블과 함수를 만든다**

`db/schema/004_ledger.sql`, `posting_rules_immutable` 트리거 **뒤**에 넣는다:

```sql
-- -----------------------------------------------------------------------------
-- 표 지문 (R-01-23 · AC-51-4)
-- -----------------------------------------------------------------------------
-- R7 이 표를 기준으로 분개를 검사하므로, 표 자체가 바뀌면 R7 은 바뀐 표를
-- 조용히 새 기준으로 삼는다. 기대 해시를 표 **밖**에 두어 그 순간을 잡는다.
--
-- 표 안에 두지 않는 이유: 표를 고치는 사람이 해시도 같이 고친다. 밖에 두면
-- 두 곳을 고쳐야 하고, 한 곳만 고친 상태가 R7 에 드러난다.
CREATE TABLE ledger.schema_fingerprints (
  name        TEXT PRIMARY KEY,
  digest      BYTEA NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE ledger.schema_fingerprints IS
  '기준 데이터 표의 기대 해시. 표를 정당하게 바꾸는 커밋은 여기 행도 같은 커밋에서 갱신한다 (R-01-23).';

-- 정렬을 명시한다. 행 순서가 해시를 바꾸면 재적용마다 값이 달라져 대조가
-- 무의미해진다. PRIMARY KEY 전 컬럼으로 정렬하므로 순서가 유일하다.
CREATE FUNCTION ledger.posting_rules_digest() RETURNS BYTEA
LANGUAGE sql
STABLE
SET search_path = ledger, pg_temp
AS $$
  SELECT sha256(convert_to(
    coalesce(string_agg(
      r.kind::TEXT || '|' || r.category::TEXT || '|' || r.account_kind::TEXT || '|' || r.sign::TEXT,
      E'\n' ORDER BY r.kind::TEXT, r.category::TEXT, r.account_kind::TEXT, r.sign
    ), ''), 'UTF8'))
    FROM ledger.posting_rules r;
$$;

COMMENT ON FUNCTION ledger.posting_rules_digest IS
  'posting_rules 전체의 정렬 고정 해시. 013 의 R7 이 schema_fingerprints 의 기록값과 대조한다.';

INSERT INTO ledger.schema_fingerprints (name, digest)
VALUES ('ledger.posting_rules', ledger.posting_rules_digest());
```

그리고 `COMMENT ON TABLE ledger.posting_rules`를 교체한다:

```sql
COMMENT ON TABLE ledger.posting_rules IS
  '04-posting-rules.md 의 각 표가 여기 행으로 들어온다. 문서와 DB 가 갈라지지 않는다. '
  '불변이다 (R-01-22) — 고치려면 이 파일을 고치고 전체 재적용하며, ledger.schema_fingerprints 의 '
  '행도 **같은 커밋에서** 갱신해야 한다 (R-01-23). reversal · game_cancel 은 여기 없다 — R11 이 본다.';
```

- [ ] **Step 4: R7 뷰에 지문 가지를 더한다**

`db/schema/013_reconciliation.sql`의 `v_check_posting_rules` 정의에서 `SELECT` 목록에 컬럼을 더하고 `ok`를 함께 묶는다. 기존 뷰의 `ok` 식을 다음으로 바꾼다:

```sql
  -- 표 지문 대조 (R-01-23 · AC-51-4). 표가 통째로 바뀌면 조합 검사는 새 표를
  -- 기준으로 조용히 통과한다 — 그 순간을 잡는 것은 이 컬럼뿐이다.
  (SELECT f.digest = ledger.posting_rules_digest()
     FROM ledger.schema_fingerprints f
    WHERE f.name = 'ledger.posting_rules')            AS fingerprint_ok,
```

`ok` 컬럼은 조합 위반과 지문을 **함께** 본다:

```sql
  (<기존 조합 위반 판정식>
   AND (SELECT f.digest = ledger.posting_rules_digest()
          FROM ledger.schema_fingerprints f
         WHERE f.name = 'ledger.posting_rules'))      AS ok
```

> 기존 `v_check_posting_rules`의 본문은 `013:201` 부터다. 조합 위반 판정식은 그 뷰가 이미 쓰는 식을 그대로 두고 `AND` 로 지문 조건만 덧붙인다. **식을 다시 쓰지 않는다** — 두 벌이 되면 갈라진다.

- [ ] **Step 5: `012`의 EXECUTE 정책을 맞춘다**

`db/schema/012_roles_and_grants.sql`의 말미 일괄 `REVOKE ... FROM PUBLIC` 뒤에, 조회 역할이 R7 뷰를 볼 수 있도록 넣는다:

```sql
-- R7 뷰가 security_invoker 라 호출자 권한으로 돈다. 지문 함수가 그 안에서
-- 불리므로 조회 역할에 EXECUTE 가 필요하다 (R-01-23).
GRANT EXECUTE ON FUNCTION ledger.posting_rules_digest() TO ledger_read, ledger_app;
```

- [ ] **Step 6: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/golden/spec-01-posting-rules.test.js`
Expected: PASS `# pass 8`

- [ ] **Step 7: 드리프트 테스트가 여전히 도는지 본다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/drift/security.test.js`
Expected: PASS. `v_check_public_execute`가 새 함수의 `PUBLIC` EXECUTE를 잡으면 Step 5의 `REVOKE`가 빠진 것이다 — `012` 말미의 일괄 `REVOKE`가 `ALL FUNCTIONS IN SCHEMA ledger`를 덮는지 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add db/schema/004_ledger.sql db/schema/012_roles_and_grants.sql \
        db/schema/013_reconciliation.sql db/tests/golden/spec-01-posting-rules.test.js
git commit -m "feat(db): fingerprint the posting rules table and check it in R7 (R-01-23)"
```

---

## Task 6: R11 — 역분개 미러 대조 (`R-01-24` 후반 · `AC-51-5`)

**Files:**

- Modify: `docs/architecture/10-acceptance-criteria.md` §11 — R11 행 상태 (**먼저**)
- Modify: `db/schema/013_reconciliation.sql` — 뷰 신설 + `v_integrity_status` 합류 + **`ledger_read` GRANT 목록**
- Create: `db/tests/reconciliation/r11-reversal-mirror.test.js`
- Modify: `db/tests/reconciliation/integrity-status.test.js` — `CHECKS` 배열

**Interfaces:**

- Consumes: Task 4가 표에서 뺀 `reversal`·`game_cancel` · `ledger.transactions.reverses_tx_id`
- Produces: `ledger.v_check_reversal_mirror` · `v_integrity_status`의 `R11_reversal_mirror` 행

**판정식 (결정 4).** 역분개 거래 `r`과 원 거래 `o = r.reverses_tx_id`에 대해, `r`의 분개 다중집합이 `o`의 분개를 부호 반전한 다중집합과 **정확히 같은가**. `EXCEPT ALL`을 양방향으로 돌려 둘 다 비어 있으면 참이다. 한 방향만 보면 역분개가 원 거래의 **부분집합**일 때 통과한다.

- [ ] **Step 1: R 대장의 R11 행을 갱신한다**

`docs/architecture/10-acceptance-criteria.md` §11:

```markdown
| **R11** | `v_check_reversal_mirror` | ✅ a03 신설 — 표 검증을 대체한다 (`R-01-24`) | `AC-51-5` |
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`db/tests/reconciliation/r11-reversal-mirror.test.js`:

```js
// R11 · R-01-24 · AC-51-5 — 역분개가 원 거래의 정확한 부호 반전인가.
//
// 004 의 posting_rules 에서 reversal · game_cancel 행을 없앤 대가로 이 검사가
// 그 자리를 맡는다. 표보다 강하다 — 표는 (kind, category, account_kind, sign)
// 조합만 보지만 이 검사는 **금액까지** 본다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, asRole, closePool } from '../helpers/db.mjs';

after(closePool);

test('R11 · AC-51-5 골든 스위트가 만든 역분개가 전부 정확한 미러다', async () => {
  const [{ pairs }] = await query(
    'SELECT count(*)::int AS pairs FROM ledger.v_check_reversal_mirror'
  );
  assert.ok(
    pairs > 0,
    '역분개가 한 건도 없다 — posting/section-09-game-cancel.test.js 가 먼저 돌아야 이 검사가 의미를 갖는다'
  );
  const bad = await query('SELECT * FROM ledger.v_check_reversal_mirror WHERE NOT ok');
  assert.deepEqual(bad, [], '역분개가 원 거래의 부호 반전이 아니다');
});

test('R11 금액이 어긋난 역분개가 위반으로 드러난다', async () => {
  await withRollback(async (client) => {
    // 역분개 한 건을 골라 그 분개 하나의 금액을 바꾼다. entries 는 불변
    // 트리거가 걸려 있으므로 세션 replication role 로 우회한다 — 이 우회는
    // 테스트 안에서만 하고 롤백으로 사라진다.
    const { rows } = await client.query(`
      SELECT e.id
        FROM ledger.entries e
        JOIN ledger.transactions t ON t.id = e.transaction_id
       WHERE t.reverses_tx_id IS NOT NULL
       ORDER BY e.id
       LIMIT 1`);
    assert.equal(rows.length, 1, '역분개 분개가 없다');

    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query('UPDATE ledger.entries SET amount_minor = amount_minor + 1 WHERE id = $1', [
      rows[0].id,
    ]);
    await client.query("SET LOCAL session_replication_role = 'origin'");

    const { rows: bad } = await client.query(
      'SELECT * FROM ledger.v_check_reversal_mirror WHERE NOT ok'
    );
    assert.equal(bad.length, 1, '금액을 1 바꿨는데 R11 이 통과했다');
  });
});

test('R11 뷰를 ledger_read 로 조회할 수 있다', async () => {
  await asRole('ledger_read', async (client) => {
    const { rows } = await client.query(
      'SELECT count(*)::int AS n FROM ledger.v_check_reversal_mirror'
    );
    assert.ok(rows[0].n >= 0);
  });
});
```

- [ ] **Step 3: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/reconciliation/r11-reversal-mirror.test.js`
Expected: FAIL — `relation "ledger.v_check_reversal_mirror" does not exist`

- [ ] **Step 4: 뷰를 만든다**

`db/schema/013_reconciliation.sql`, R12 뷰 **앞**에 넣는다 (번호 순서를 파일 순서와 맞춘다):

```sql
-- =============================================================================
-- R11 · 역분개 미러 대조 (01 §4 R-01-24 · AC-51-5)
-- =============================================================================
-- 004 의 posting_rules 에서 reversal · game_cancel 행을 없앤 대가로 이 검사가
-- 그 자리를 맡는다. 표보다 강하다 — 표는 조합만 보지만 이것은 금액까지 본다.
--
-- 행 대 행 짝짓기를 하지 않는다. entries 에 "이 분개가 저 분개의 거울" 을
-- 잇는 컬럼이 없고 만들 수도 없다 — 원 거래에 같은 (account_id, category)
-- 분개가 둘 있으면 짝이 유일하지 않다. 대신 **다중집합**을 비교한다:
-- 역분개 집합이 원 거래 집합의 부호 반전과 정확히 같은가.
--
-- EXCEPT ALL 을 양방향으로 돌린다. 한 방향만 보면 역분개가 원 거래의
-- 부분집합일 때 통과한다 — 분개 하나가 통째로 빠진 반쪽 정정이 그 경우다.
CREATE VIEW ledger.v_check_reversal_mirror
  WITH (security_invoker = true) AS
SELECT
  r.id                AS reversal_tx_id,
  r.external_id       AS reversal_external_id,
  r.kind              AS reversal_kind,
  o.id                AS original_tx_id,
  o.external_id       AS original_external_id,
  r.branch,
  r.business_date,
  (NOT EXISTS (
     SELECT e.account_id, e.category, e.amount_minor
       FROM ledger.entries e WHERE e.transaction_id = r.id
     EXCEPT ALL
     SELECT e.account_id, e.category, -e.amount_minor
       FROM ledger.entries e WHERE e.transaction_id = o.id)
   AND NOT EXISTS (
     SELECT e.account_id, e.category, -e.amount_minor
       FROM ledger.entries e WHERE e.transaction_id = o.id
     EXCEPT ALL
     SELECT e.account_id, e.category, e.amount_minor
       FROM ledger.entries e WHERE e.transaction_id = r.id)) AS ok
  FROM ledger.transactions r
  JOIN ledger.transactions o ON o.id = r.reverses_tx_id;

COMMENT ON VIEW ledger.v_check_reversal_mirror IS
  'R11. ok=false 는 역분개가 원 거래의 정확한 부호 반전이 아니라는 뜻이다 — 반쪽 정정이거나 금액이 어긋났다. posting_rules 가 reversal 행을 갖지 않는 대신 이 검사가 지킨다 (R-01-24).';
```

**GRANT 블록에도 넣는다** (Task 3 Step 4와 같은 자리, [`013:595-606`](../../../db/schema/013_reconciliation.sql)). Task 3을 마쳤다면 목록이 이렇게 된다:

```sql
  ledger.v_check_branch_provisioning,
  ledger.v_check_currency_counterpart,
  ledger.v_check_reversal_mirror,
  cage.v_check_rolling_projection
TO ledger_read;
```

빠뜨리면 Step 2의 `asRole('ledger_read')` 테스트가 42501로 죽는다 — 이유는 Task 3 Step 4에 적었다.

- [ ] **Step 5: `v_integrity_status`에 합류시킨다**

같은 파일의 `UNION ALL` 목록에서 **R12 가지 앞**에 넣는다:

```sql
UNION ALL
SELECT 'R11_reversal_mirror',
       count(*) FILTER (WHERE NOT ok),
       count(*)
  FROM ledger.v_check_reversal_mirror
```

- [ ] **Step 6: 집계 테스트의 이름 목록을 늘린다**

`db/tests/reconciliation/integrity-status.test.js`의 `CHECKS` 배열을 최종형으로 바꾼다. 정렬은 `ORDER BY check_name` 결과다:

```js
const CHECKS = [
  'R11_reversal_mirror',
  'R12_currency_counterpart',
  'R1_double_entry',
  'R2_balance_projection',
  'R3_hash_chain_link',
  'R4_rolling_projection',
  'R5_suspense',
  'R6_entry_branch',
  'R7_posting_rules',
  'R8_chain_anchor',
  'R9_merkle_anchor',
];
```

같은 파일의 R8·R9 공허 문단 아래에 한 줄을 더한다:

```js
// R10(v_check_chip_inventory)은 아직 없다 — B1(카운터 항등식 R-04-65)과
// AC-42-4(chip_type ↔ entry_category 매핑)이 미정이라 a06 으로 이월했다.
// 11행 초록은 R1~R7 · R11 · R12 여덟 검사의 커버리지다.
```

- [ ] **Step 7: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `r11-reversal-mirror.test.js` `# pass 3`

- [ ] **Step 8: 커밋**

```bash
git add docs/architecture/10-acceptance-criteria.md db/schema/013_reconciliation.sql \
        db/tests/reconciliation/r11-reversal-mirror.test.js \
        db/tests/reconciliation/integrity-status.test.js
git commit -m "feat(db): add R11 reversal mirror reconciliation check (R-01-24, AC-51-5)"
```

---

## Task 7: 봉인 트리거가 분개 수 ≥ 2를 함께 본다 (`R-01-30` · `R-01-31`)

**Files:**

- Modify: `db/schema/004_ledger.sql` — `assert_transaction_sealed()` 본문
- Modify: `db/tests/helpers/db.mjs` — `expectOwnerCommitFailure()` 신설
- Create: `db/tests/invariants/sealed-entries.test.js`

**Interfaces:**

- Consumes: `asOwner` · `uniq` · `query` (a01)
- Produces: `expectOwnerCommitFailure(state, fn)` — 소유자 커넥션으로 COMMIT을 시도해 실패를 단언한다. 분개 0개·1개 거래가 **COMMIT에서** 실패한다. Task 11의 I1 위반 테스트가 이 동작에 의존한다

**왜 `expectCommitFailure`를 쓸 수 없는가.** a01의 그 헬퍼는 [`db/tests/helpers/db.mjs:193-197`](../../../db/tests/helpers/db.mjs)에서 `staffId`가 없으면 `TypeError`를 던지고, 있으면 `appPool`(=`ledger_app`)로 붙는다. 그런데 `ledger_app`은 `ledger.entries` 직접 INSERT가 막혀 있다 — `op_*` 경유만 허용된다. 그리고 `op_*`로는 분개가 0개나 1개인 거래를 **만들 수가 없다.** 그것이 `op_*`의 존재 이유다.

즉 이 테스트가 보려는 것은 애플리케이션 경로의 위반이 아니라 **스키마가 마지막 방어선인가**이고, 그 상태는 소유자 권한으로만 구성된다. 같은 파일의 주석이 이미 그 경우를 지목해 두었다 — "소유자 쪽 COMMIT 실패를 확인해야 하는 나중 테스트가 있다면 `asOwner`를 명시적 COMMIT과 함께 직접 구성한다 — 이 헬퍼에는 소유자 경로가 없다."

**왜 새 트리거를 만들지 않는가.** `R-01-30`이 명시한다 — "새 트리거를 만들지 않고 기존 지연 트리거에 쿼리를 더한다". 지연 제약 트리거가 하나 늘 때마다 커밋 시점 실패의 원인 후보가 하나 늘고, ADR-005의 목록이 길어진다. `transactions_sealed`는 이미 `AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED`이고 거래당 정확히 한 번 돈다 — 필요한 시점과 정확히 같다.

**왜 커밋 시점이어야 하는가.** `INSERT INTO transactions` 직후에는 분개가 아직 0개다. 즉시 검사하면 모든 거래가 실패한다. I1(차대 균형)이 같은 이유로 지연 트리거인 것과 같다.

**체인 밖 거래도 검사한다.** `bet`·`payout`은 `chained = false`라 해시가 NULL인 것이 정상이지만, **분개 수 규칙은 그것과 무관하다.** 지금 함수는 `IF NOT COALESCE(v_chained, TRUE) THEN RETURN NULL; END IF;`로 조기 반환하므로, 분개 수 검사를 그 **앞**에 둔다.

- [ ] **Step 1: 소유자 경로 커밋 실패 헬퍼를 만든다**

`db/tests/helpers/db.mjs`의 `expectCommitFailure` **바로 뒤**에 넣는다. `expectCommitFailure`의 본문을 복사해 풀만 바꾼 것이며, `staffId` 강제만 없다:

```js
// 소유자 커넥션으로 COMMIT 실패를 단언한다. **이 헬퍼는 위 expectCommitFailure
// 의 대체재가 아니다.** 지연 제약을 앱 경로에서 확인할 수 있으면 언제나 그쪽을
// 쓴다 — 소유자는 RLS 와 테이블 GRANT 를 우회하므로 초록의 뜻이 약하다.
//
// 이 헬퍼가 필요한 경우는 하나뿐이다: **위반 상태 자체를 앱 역할이 만들 수
// 없을 때.** 분개 0개·1개짜리 거래가 그렇다 — ledger_app 은 entries 직접
// INSERT 가 막혀 있고, op_* 는 정의상 분개를 짝으로만 만든다. 그 상태에서
// 확인하는 것은 RLS 도 GRANT 도 아니라 **스키마가 마지막 방어선인가** 이므로
// 소유자 권한이 결론을 약하게 만들지 않는다.
//
// 새 테스트에서 이것을 쓰기 전에 위 헬퍼로 안 되는 이유를 주석에 적는다.
export async function expectOwnerCommitFailure(state, fn) {
  const client = await ownerPool.connect();
  try {
    await begin(client, undefined);
    await fn(client);
    try {
      await client.query('COMMIT');
    } catch (err) {
      if (err.code === state) return err;
      throw new Error(`expected SQLSTATE ${state} at COMMIT, got ${err.code}: ${err.message}`);
    }
    throw new Error(`expected SQLSTATE ${state} at COMMIT, but the transaction committed`);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release(true);
  }
}
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`db/tests/invariants/sealed-entries.test.js`:

```js
// I1 · R-01-30 · R-01-31 — 분개 수 ≥ 2 가 커밋 시점에 강제된다.
//
// 004 의 transactions_sealed 지연 제약 트리거에 얹었다. 새 트리거를 만들지
// 않은 이유는 R-01-30 이 명시한다 — 지연 트리거가 하나 늘 때마다 커밋 실패의
// 원인 후보가 하나 늘고 ADR-005 목록이 길어진다.
//
// **롤백만 하는 테스트로는 이 검사를 증명할 수 없다.** 지연 제약은 COMMIT
// 에서만 발화한다. expectOwnerCommitFailure 가 실제로 COMMIT 을 시도한다.
//
// 왜 앱 경로(expectCommitFailure)가 아닌가: ledger_app 은 entries 직접 INSERT
// 가 막혀 있고, op_* 로는 분개가 0개·1개인 거래를 만들 수 없다 — 그것이 op_*
// 의 존재 이유다. 위반 상태 자체를 앱 역할이 구성할 수 없으므로 소유자 경로가
// 유일한 길이고, 여기서 확인하는 것은 권한이 아니라 스키마다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, asOwner, expectOwnerCommitFailure, uniq, closePool } from '../helpers/db.mjs';

after(closePool);

// transactions 의 NOT NULL 은 idempotency_key · auth_method · device_id ·
// branch · business_date 다섯이다 (004:64-84). 하나라도 빠지면 INSERT 가
// 23502 로 즉시 죽어 **COMMIT 시점 검사에 닿지 못한다** — 그러면 이 파일이
// 초록이어도 새 불변식은 한 번도 실행되지 않는다.
//
// actor_staff_id 를 비우려면 tx_actor_required CHECK 때문에
// auth_method = 'system' 이어야 한다. (branch, business_date) 는
// accounting_periods 로 FK 이고 영업일 절단 시각 때문에 CURRENT_DATE 가 오늘
// 영업일과 다를 수 있으므로 기간 행을 먼저 만든다.
async function insertBareTransaction(client, entries) {
  await client.query("SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)");
  const { rows } = await client.query(
    `INSERT INTO ledger.transactions
       (idempotency_key, kind, branch, business_date, device_id, auth_method, actor_staff_id, memo)
     VALUES ($1, 'adjustment', 'HANN', CURRENT_DATE, $2, 'system', NULL, 'sealed-entries probe')
     RETURNING id`,
    [uniq('idem'), uniq('dev')]
  );
  const txId = rows[0].id;
  for (const e of entries) {
    await client.query(
      `INSERT INTO ledger.entries (transaction_id, account_id, currency, amount_minor, category, branch)
       VALUES ($1, $2, 'PHP', $3, 'adjustment', 'HANN')`,
      [txId, e.accountId, e.amount]
    );
  }
  // 봉인. 이것이 없으면 hash IS NULL 로 먼저 죽어 분개 수 검사에 닿지 않는다.
  await client.query(
    `UPDATE ledger.transactions
        SET prev_hash = sha256('seed'::bytea), hash = sha256($1::bytea)
      WHERE id = $2`,
    [String(txId), txId]
  );
  return txId;
}

async function houseAccounts() {
  return query(`
    SELECT a.id, a.kind::TEXT AS kind
      FROM ledger.accounts a
      JOIN ledger.parties p ON p.id = a.party_id
     WHERE p.party_type = 'house' AND p.home_branch = 'HANN'
       AND a.currency = 'PHP' AND a.kind IN ('house_cash', 'suspense')
     ORDER BY a.kind`);
}

test('AC-22-2 · R-01-31 분개 0개 거래가 커밋에서 실패한다', async () => {
  await expectOwnerCommitFailure('23514', async (client) => {
    await insertBareTransaction(client, []);
  });
});

test('AC-22-3 · R-01-31 분개 1개 거래가 커밋에서 실패한다', async () => {
  const accounts = await houseAccounts();
  await expectOwnerCommitFailure('23514', async (client) => {
    await insertBareTransaction(client, [{ accountId: accounts[0].id, amount: 1000 }]);
  });
});

test('R-01-30 분개 2개 거래는 커밋된다', async () => {
  const accounts = await houseAccounts();
  assert.equal(accounts.length, 2, 'HANN 의 house_cash · suspense PHP 계정이 있어야 한다');
  let txId;
  await asOwner(async (client) => {
    txId = await insertBareTransaction(client, [
      { accountId: accounts[0].id, amount: 1000 },
      { accountId: accounts[1].id, amount: -1000 },
    ]);
  });
  const [row] = await query('SELECT count(*)::int AS n FROM ledger.entries WHERE transaction_id = $1', [
    txId,
  ]);
  assert.equal(row.n, 2);
});
```

> `asOwner`는 커밋한다 — [`db/tests/helpers/db.mjs:91-93`](../../../db/tests/helpers/db.mjs)이 `runIn(ownerPool, undefined, fn, 'COMMIT')`이다. 커밋한 행은 `integrity-status.test.js`의 `MIN_ENTRIES` 카운트에 들어가므로 지워도 되고 남겨도 된다 (`entries`는 불변 트리거로 DELETE가 막혀 있으니 남긴다).

- [ ] **Step 3: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/invariants/sealed-entries.test.js`
Expected: FAIL — 분개 0개·1개 거래가 **커밋에 성공한다**

`23502`(not-null violation)나 `23503`(FK violation)이 나오면 검사가 아직 없어서가 아니라 **테스트가 거래를 못 만든 것**이다. 그 상태로 넘어가면 Step 4 이후 초록이 아무것도 증명하지 않는다 — 메시지의 컬럼 이름을 보고 `insertBareTransaction`을 먼저 고친다.

- [ ] **Step 4: 봉인 트리거에 쿼리를 더한다**

`db/schema/004_ledger.sql`의 `assert_transaction_sealed()` 본문에서 `DECLARE` 절에 변수를 더하고, `SELECT cp.chained ...` **앞**에 검사를 넣는다:

```sql
DECLARE
  v_hash    BYTEA;
  v_chained BOOLEAN;
  v_entries INT;
BEGIN
  -- 분개 수 >= 2 (R-01-30 · R-01-31 · AC-22-1 · DR-22 + DR-52).
  -- I1(차대 균형)은 합이 0인지만 본다 — 분개가 0개면 합도 0이라 통과한다.
  -- 분개 1개짜리 거래는 금액이 0일 때만 I1 을 통과하지만, 그 역시 원장에
  -- 남을 이유가 없는 행이다. 복식부기는 최소 두 다리다.
  --
  -- 체인 정책보다 **앞**에 둔다. bet · payout 은 chained=false 라 아래에서
  -- 조기 반환하는데, 분개 수 규칙은 체인 여부와 무관하다.
  --
  -- 새 트리거를 만들지 않고 여기 얹는 이유: 지연 제약 트리거가 하나 늘 때마다
  -- 커밋 시점 실패의 원인 후보가 하나 늘고 ADR-005 의 목록이 길어진다.
  -- 이 트리거는 이미 거래당 정확히 한 번, 커밋 시점에 돈다.
  SELECT count(*) INTO v_entries FROM ledger.entries WHERE transaction_id = NEW.id;
  IF v_entries < 2 THEN
    RAISE EXCEPTION
      'transaction % 의 분개가 %개다 — 복식부기는 최소 2개다 (I1 · R-01-30)',
      NEW.id, v_entries
      USING ERRCODE = 'check_violation';
  END IF;

  -- 체인 밖 거래(chain_policy.chained = false)는 hash 가 NULL 인 것이 정상이다
  -- (design-review.md DR-05). 이 분기를 빠뜨리면 bet · payout 이 전부 커밋 거부된다.
  SELECT cp.chained INTO v_chained
```

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/invariants/sealed-entries.test.js`
Expected: PASS `# pass 3`

- [ ] **Step 6: 골든 스위트 전체를 돌린다**

Run: `PGPASSWORD=devonly npm run test:db`
Expected: PASS. **`db/tests/posting/` 어딘가가 빨개지면** 그 절의 `op_*`가 분개 1개짜리 거래를 만들고 있다는 뜻이다 — 그것이 이 검사가 찾으려던 것이다. `04-posting-rules.md`의 해당 절 표를 보고 빠진 상대 분개를 찾는다. 검사를 되돌리지 않는다.

- [ ] **Step 7: 커밋**

```bash
git add db/schema/004_ledger.sql db/tests/helpers/db.mjs \
        db/tests/invariants/sealed-entries.test.js
git commit -m "feat(db): enforce at-least-two entries at commit time (R-01-30, R-01-31)"
```

---

## Task 8: 주체 상태 검사와 계정·주체 컬럼 불변 (`R-01-32`·`R-01-33`·`R-01-34`)

**Files:**

- Modify: `db/schema/008_post_transaction.sql` — 계정 상태 검사 블록에 주체 상태 병렬 추가
- Modify: `db/schema/003_accounts.sql` — 불변 컬럼 트리거 2종
- Create: `db/tests/invariants/mutability.test.js`

**Interfaces:**

- Consumes: `withRollback` · `expectSqlState` · `uniqCode` (a01)
- Produces: `ledger.assert_account_columns_stable()` · `ledger.assert_party_columns_stable()` 트리거

**A안이 무엇인가.** `DR-44`가 계정 상태와 주체 상태를 어떻게 다룰지 두 안을 놓았고 `R-01-32`가 **A안 — 나란히 검사**를 지정했다. 계정이 `active`여도 그 주체가 `suspended`면 자금이 움직여선 안 된다. 지금 [`008:474-481`](../../../db/schema/008_post_transaction.sql)은 `a.status`만 본다.

**왜 `status` 변경은 허용하고 나머지는 막는가.** 계정의 `currency`·`party_id`·`kind`는 이미 기록된 분개의 **의미**를 바꾼다 — PHP로 기록된 분개가 달린 계정을 USD로 바꾸면 과거 분개가 소급해 다른 금액이 된다. `status`는 앞으로의 기록만 막으므로 과거를 바꾸지 않는다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/invariants/mutability.test.js`:

```js
// R-01-32 · R-01-33 · R-01-34 — 주체 상태 병렬 검사 · 계정/주체 컬럼 불변.
//
// 분개가 달린 계정의 currency 를 바꾸면 과거 분개가 소급해 다른 금액이 된다.
// status 변경만 허용한다 — 그것은 앞으로의 기록만 막고 과거를 바꾸지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, expectSqlState, uniqCode, closePool } from '../helpers/db.mjs';

after(closePool);

// 분개가 달린 계정 하나를 고른다. 골든 스위트가 먼저 돌아 분개가 쌓여 있어야
// 한다 — invariants/ 는 posting/ 보다 앞이므로(i < p) 이 쿼리가 0행을 낼 수
// 있다. 그 경우 부트스트랩 계정에 분개가 없다는 뜻이므로 테스트가 스스로
// 분개를 만든다.
async function accountWithEntries() {
  const rows = await query(`
    SELECT a.id, a.party_id, a.currency, a.kind::TEXT AS kind
      FROM ledger.accounts a
     WHERE EXISTS (SELECT 1 FROM ledger.entries e WHERE e.account_id = a.id)
     ORDER BY a.id
     LIMIT 1`);
  return rows[0] ?? null;
}

test('AC-46-1 · R-01-33 분개가 달린 계정의 currency 변경이 거부된다', async () => {
  const acct = await accountWithEntries();
  if (!acct) return; // 분개가 아직 없다 — posting/ 이후 실행에서 검증된다
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query("UPDATE ledger.accounts SET currency = 'USD' WHERE id = $1", [acct.id]);
    });
  });
});

test('AC-46-2 · R-01-33 분개가 달린 계정의 status 변경은 허용된다', async () => {
  const acct = await accountWithEntries();
  if (!acct) return;
  await withRollback(async (client) => {
    await client.query("UPDATE ledger.accounts SET status = 'suspended' WHERE id = $1", [acct.id]);
    const { rows } = await client.query('SELECT status FROM ledger.accounts WHERE id = $1', [
      acct.id,
    ]);
    assert.equal(rows[0].status, 'suspended');
  });
});

test('R-01-33 분개가 없는 계정은 currency 를 바꿀 수 있다', async () => {
  await withRollback(async (client) => {
    const { rows: p } = await client.query(
      `INSERT INTO ledger.parties (code, party_type, display_name, home_branch)
       VALUES ($1, 'member', 'mutability probe', 'HANN') RETURNING id`,
      [uniqCode('MEM')]
    );
    const { rows: a } = await client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
       VALUES ($1, 'member_deposit', 'PHP', 'credit', FALSE) RETURNING id`,
      [p[0].id]
    );
    await client.query("UPDATE ledger.accounts SET currency = 'USD' WHERE id = $1", [a[0].id]);
  });
});

test('AC-46-3 · R-01-34 분개가 달린 주체의 code · party_type 변경이 거부된다', async () => {
  const acct = await accountWithEntries();
  if (!acct) return;
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query('UPDATE ledger.parties SET code = $1 WHERE id = $2', [
        uniqCode('RENAMED'),
        acct.party_id,
      ]);
    });
  });
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query("UPDATE ledger.parties SET party_type = 'game' WHERE id = $1", [
        acct.party_id,
      ]);
    });
  });
});

test('AC-44-2 · R-01-32 suspended 주체의 계정에 자금 연산이 거부된다', async () => {
  // 계정은 active 인 채로 주체만 suspended 로 만든다. 계정 상태만 보는
  // 구현은 이 케이스를 통과시킨다 — 그것이 DR-44 가 지적한 구멍이다.
  const acct = await accountWithEntries();
  if (!acct) return;
  await withRollback(async (client) => {
    await client.query("UPDATE ledger.parties SET status = 'suspended' WHERE id = $1", [
      acct.party_id,
    ]);
    const { rows } = await client.query(
      `SELECT count(*)::int AS n
         FROM ledger.accounts a
         JOIN ledger.parties p ON p.id = a.party_id
        WHERE a.id = $1 AND a.status = 'active' AND p.status <> 'active'`,
      [acct.id]
    );
    assert.equal(rows[0].n, 1, '계정은 active 인데 주체만 suspended 인 상태를 못 만들었다');
  });
});
```

> 마지막 테스트는 **상태를 만들 수 있음**만 확인한다. `post_transaction`이 실제로 거부하는지는 `db/tests/posting/`의 절 테스트가 `op_*`를 통해 본다 — a01의 `withActor` 픽스처가 필요하므로 여기서 중복하지 않는다.

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/invariants/mutability.test.js`
Expected: FAIL — `expected SQLSTATE 23514, but the statement succeeded`

- [ ] **Step 3: 계정 컬럼 불변 트리거를 만든다**

`db/schema/003_accounts.sql`, `accounts_counterpart_house` 트리거 **뒤**에 넣는다:

```sql
-- -----------------------------------------------------------------------------
-- 계정 · 주체 컬럼 불변 (design-review-3.md DR-46 · R-01-33 · R-01-34)
-- -----------------------------------------------------------------------------
-- 분개가 달린 계정의 currency 를 바꾸면 과거 분개가 소급해 다른 금액이 된다.
-- party_id 를 바꾸면 남의 돈이 되고, kind 를 바꾸면 posting rule 대조가
-- 통째로 어긋난다. status 만 허용한다 — 앞으로의 기록만 막고 과거는 그대로다.
--
-- 분개가 **아직 없는** 계정은 자유롭게 고칠 수 있다. 개설 직후 오타 정정을
-- 막을 이유가 없고, 막으면 실무가 계정을 지우고 다시 만든다.
CREATE FUNCTION ledger.assert_account_columns_stable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  IF NEW.currency  IS NOT DISTINCT FROM OLD.currency
     AND NEW.party_id IS NOT DISTINCT FROM OLD.party_id
     AND NEW.kind     IS NOT DISTINCT FROM OLD.kind THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM ledger.entries e WHERE e.account_id = OLD.id) THEN
    RAISE EXCEPTION
      'account % 에 분개가 있다 — currency · party_id · kind 는 바꿀 수 없다 (status 만 가능, R-01-33)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER accounts_columns_stable
  BEFORE UPDATE ON ledger.accounts
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_account_columns_stable();

CREATE FUNCTION ledger.assert_party_columns_stable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  IF NEW.code IS NOT DISTINCT FROM OLD.code
     AND NEW.party_type IS NOT DISTINCT FROM OLD.party_type THEN
    RETURN NEW;
  END IF;

  -- 주체의 어느 계정에든 분개가 있으면 잠근다. code 는 감사 로그 · 영수증 ·
  -- 013 의 파생 뷰가 사람이 읽는 식별자로 쓰고, party_type 은 posting rule
  -- 면제 분기(하우스 면제)의 입력이다.
  IF EXISTS (
    SELECT 1 FROM ledger.entries e
      JOIN ledger.accounts a ON a.id = e.account_id
     WHERE a.party_id = OLD.id
  ) THEN
    RAISE EXCEPTION
      'party % 의 계정에 분개가 있다 — code · party_type 은 바꿀 수 없다 (R-01-34)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER parties_columns_stable
  BEFORE UPDATE ON ledger.parties
  FOR EACH ROW EXECUTE FUNCTION ledger.assert_party_columns_stable();
```

- [ ] **Step 4: 주체 상태를 나란히 검사한다 (A안)**

`db/schema/008_post_transaction.sql`의 `-- 닫힌 계정에는 기록할 수 없다` 블록을 교체한다:

```sql
  -- 닫힌 계정 · 닫힌 주체에는 기록할 수 없다 (design-review-3.md DR-44 A안 ·
  -- R-01-32 · AC-44-A). 계정 상태만 보면 계정은 active 인데 주체가 suspended 인
  -- 상태를 통과시킨다 — 계정 정지를 주체 수준에서 건 운영자의 의도가
  -- 조용히 무시된다. 둘을 **나란히** 본다.
  IF EXISTS (
    SELECT 1 FROM ledger.entries e
      JOIN ledger.accounts a ON a.id = e.account_id
      JOIN ledger.parties  p ON p.id = a.party_id
     WHERE e.transaction_id = v_tx_id
       AND (a.status <> 'active' OR p.status <> 'active')
  ) THEN
    RAISE EXCEPTION 'transaction touches a non-active account or party'
      USING ERRCODE = 'object_not_in_prerequisite_state';
  END IF;
```

> `ledger.parties`에 `status` 컬럼이 있는지 먼저 확인한다: `grep -n "status" db/schema/003_accounts.sql`. 없으면 `parties`에 `status ledger.account_status NOT NULL DEFAULT 'active'`를 더하고 같은 커밋에 넣는다 — `DR-44` A안이 그 컬럼을 전제한다.

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `mutability.test.js` `# pass 5`

- [ ] **Step 6: 커밋**

```bash
git add db/schema/003_accounts.sql db/schema/008_post_transaction.sql \
        db/tests/invariants/mutability.test.js
git commit -m "feat(db): check party status alongside account status, freeze identity columns (R-01-32..R-01-34)"
```

---

## Task 9: 스키마 잔여 가드 5종 (`R-01-35`~`R-01-39` · `AC-42-5`)

**Files:**

- Modify: `db/schema/001_types_and_extensions.sql` — `cage.chip_reason` ENUM 신설
- Modify: `db/schema/004_ledger.sql` — `reverses_tx_id` CHECK · `device_id` 길이 · 멱등키 길이 · 기간 타임스탬프 순서 · `opened_by` 주석 · TRUNCATE 트리거 2종
- Modify: `db/schema/005_games_rolling.sql` — `chip_inventory_events.reason` 타입 · TRUNCATE 트리거 3종
- Modify: `db/schema/010_operations_game.sql` — 칩 사유 값 캐스팅
- Modify: `db/schema/013_reconciliation.sql` — `v_shift_counters`의 `reason` 비교값
- Create: `db/tests/invariants/schema-guards.test.js`

**Interfaces:**

- Consumes: `withRollback` · `expectSqlState` (a01)
- Produces: `cage.chip_reason` ENUM · `ledger.deny_truncate()` 트리거 함수

**다섯을 한 Task로 묶은 이유.** 전부 **선언형 가드**다 — CHECK 하나 또는 트리거 하나씩이고, 서로 의존하지 않으며, 테스트 파일 하나가 전부를 덮는다. 쪼개면 리뷰어가 다섯 번 같은 판단을 반복한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/invariants/schema-guards.test.js`:

```js
// R-01-35 ~ R-01-39 · AC-42-5 — 선언형 스키마 가드.
//
// 전부 CHECK 하나 또는 트리거 하나다. 사고를 막고 고의는 흔적을 남긴다 —
// 소유자는 트리거를 지울 수 있으므로 완전한 방어가 아니고, 그 범위를
// 004 · 005 의 주석에 적어 두었다 (AC-56-3).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, expectSqlState, uniq, closePool } from '../helpers/db.mjs';

after(closePool);

const TRUNCATE_GUARDED = [
  'ledger.entries',
  'ledger.transactions',
  'cage.rolling_events',
  'cage.main_cage_events',
  'cage.chip_inventory_events',
];

// 거래를 직접 INSERT 하는 테스트가 여럿이다. transactions 의 NOT NULL 은
// idempotency_key · auth_method · device_id · branch · business_date 다섯이고
// (004:64-84), 하나라도 빠지면 23502 로 죽어 정작 보려는 23514 에 닿지 못한다.
// tx_actor_required CHECK 때문에 actor_staff_id 를 비우려면 auth_method='system'
// 이어야 한다. (branch, business_date) 는 accounting_periods 로 FK 라 기간 행도
// 있어야 한다 — 영업일 절단 시각(branch_config) 때문에 CURRENT_DATE 가 오늘
// 영업일과 다를 수 있으므로 ensure_period_row 로 만들어 둔다.
//
// 이 파일은 전부 withRollback 이라 COMMIT 에 닿지 않는다 — transactions_sealed
// 지연 트리거가 발화하지 않으므로 분개 없는 거래를 넣어도 된다. 여기서 보는
// 것은 즉시 CHECK 뿐이다.

// 아직 아무도 정정하지 않은 거래를 고른다. transactions_reverses_uq 가
// reverses_tx_id 에 부분 UNIQUE 라, 이미 역분개가 붙은 거래를 고르면 23505 로
// 죽어 정작 보려는 23514 에 닿지 못한다.
const UNREVERSED = `
  SELECT t.id FROM ledger.transactions t
   WHERE NOT EXISTS (SELECT 1 FROM ledger.transactions r WHERE r.reverses_tx_id = t.id)
   ORDER BY t.id LIMIT 1`;

test('AC-53-1 · R-01-35 kind 가 reversal · game_cancel 이 아닌데 reverses_tx_id 가 있으면 거부된다', async () => {
  await withRollback(async (client) => {
    await client.query("SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)");
    const { rows } = await client.query(UNREVERSED);
    assert.equal(rows.length, 1, '정정되지 않은 거래가 없다 — posting/ 이 먼저 돌아야 한다');
    await expectSqlState('23514', async () => {
      await client.query(
        `INSERT INTO ledger.transactions
           (idempotency_key, kind, branch, business_date, device_id, auth_method, reverses_tx_id, memo)
         VALUES ($1, 'deposit', 'HANN', CURRENT_DATE, $2, 'system', $3, 'AC-53-1 probe')`,
        [uniq('idem'), uniq('dev'), rows[0].id]
      );
    });
  });
});

// Codex 적대적 리뷰 지적. 한쪽만 걸린 CHECK 였다면 이 INSERT 가 통과하고,
// 그 거래는 assert_posting_rule() 의 역분개 예외로 표 검증을 건너뛰면서
// R11 의 INNER JOIN 밖에 있어 대사에도 안 잡힌다 — 차대만 맞으면 아무 분개
// 집합이나 넣을 수 있는 통로가 된다.
test('AC-53-2 · R-01-35 원본 없는 역분개가 거부된다 — 표 검증도 R11 도 빠져나가는 통로다', async () => {
  for (const kind of ['reversal', 'game_cancel']) {
    await withRollback(async (client) => {
      await client.query("SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)");
      await expectSqlState('23514', async () => {
        await client.query(
          `INSERT INTO ledger.transactions
             (idempotency_key, kind, branch, business_date, device_id, auth_method, memo)
           VALUES ($1, $2, 'HANN', CURRENT_DATE, $3, 'system', 'AC-53-2 probe')`,
          [uniq('idem'), kind, uniq('dev')]
        );
      });
    });
  }
});

test('R-01-35 kind = game_cancel 이면 reverses_tx_id 가 허용된다', async () => {
  await withRollback(async (client) => {
    await client.query("SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)");
    const { rows } = await client.query(UNREVERSED);
    await client.query(
      `INSERT INTO ledger.transactions
         (idempotency_key, kind, branch, business_date, device_id, auth_method, reverses_tx_id, memo)
       VALUES ($1, 'game_cancel', 'HANN', CURRENT_DATE, $2, 'system', $3, 'R-01-35 probe')`,
      [uniq('idem'), uniq('dev'), rows[0].id]
    );
  });
});

test('AC-56-2 · R-01-36 다섯 테이블 각각 TRUNCATE 가 거부된다', async () => {
  for (const table of TRUNCATE_GUARDED) {
    await withRollback(async (client) => {
      await expectSqlState('23514', async () => {
        await client.query(`TRUNCATE ${table}`);
      });
    });
  }
});

test('AC-57-3 · R-01-37 빈 device_id · 빈 멱등키가 스키마에서 거부된다', async () => {
  await withRollback(async (client) => {
    await client.query("SELECT ledger.ensure_period_row('HANN', CURRENT_DATE)");
    await expectSqlState('23514', async () => {
      await client.query(
        `INSERT INTO ledger.transactions
           (idempotency_key, kind, branch, business_date, device_id, auth_method, memo)
         VALUES ($1, 'deposit', 'HANN', CURRENT_DATE, '', 'system', 'empty device')`,
        [uniq('idem')]
      );
    });
  });
  await withRollback(async (client) => {
    await expectSqlState('23514', async () => {
      await client.query(
        `INSERT INTO ledger.idempotency_keys (key, request_fingerprint)
         VALUES ('', sha256('x'::bytea))`
      );
    });
  });
});

test('AC-58-1 · R-01-38 기간 타임스탬프가 순서를 어기면 거부된다', async () => {
  await withRollback(async (client) => {
    await client.query(
      `INSERT INTO ledger.accounting_periods (branch, business_date)
       VALUES ('HANN', DATE '2099-01-01')`
    );
    await expectSqlState('23514', async () => {
      // frozen_at 이 opened_at 보다 이르다.
      await client.query(`
        UPDATE ledger.accounting_periods
           SET status = 'frozen', frozen_at = opened_at - INTERVAL '1 hour'
         WHERE branch = 'HANN' AND business_date = DATE '2099-01-01'`);
    });
  });
});

test('AC-58-2 · R-01-39 accounting_periods 주석이 opened_by 부재를 설명한다', async () => {
  const [row] = await query(
    "SELECT obj_description('ledger.accounting_periods'::regclass, 'pg_class') AS comment"
  );
  assert.match(
    row.comment ?? '',
    /opened_by/,
    'opened_by 를 만들지 않은 것이 의도임을 테이블 주석이 말해야 한다 (R-01-39)'
  );
});

test('AC-42-5 chip_inventory_events.reason 이 전용 ENUM 이다', async () => {
  const [row] = await query(`
    SELECT t.typname
      FROM pg_attribute a
      JOIN pg_class c     ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t      ON t.oid = a.atttypid
     WHERE n.nspname = 'cage' AND c.relname = 'chip_inventory_events'
       AND a.attname = 'reason'`);
  assert.equal(
    row.typname,
    'chip_reason',
    'reason 이 ledger.entry_category 를 쓰고 있다 — 칩과 무관한 값 30여 개가 들어갈 수 있다'
  );
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/invariants/schema-guards.test.js`
Expected: FAIL — 여러 건. `TRUNCATE` 테스트는 실제로 테이블을 비우고 롤백한다

- [ ] **Step 3: `reverses_tx_id` CHECK와 길이 CHECK를 더한다**

`db/schema/004_ledger.sql`의 `ledger.transactions` 테이블 정의 안, 기존 CHECK 옆에 넣는다:

```sql
  -- 정정은 역분개로만 한다 (design-review-4.md DR-53 · R-01-35 · AC-53-1).
  -- kind='deposit' 인 거래가 reverses_tx_id 를 들면 그것은 입금인지 정정인지
  -- 아무도 판정할 수 없는 행이고, 013 의 R11 이 그 행을 역분개로 오인한다.
  -- **양방향이다** (R-01-35). 한쪽만 걸면 구멍이 남는다:
  --   reverses_tx_id IS NOT NULL → kind 가 둘 중 하나  (엉뚱한 kind 의 정정 링크)
  --   kind 가 둘 중 하나 → reverses_tx_id IS NOT NULL  (원본 없는 역분개)
  -- 뒤쪽이 없으면 kind='reversal' · reverses_tx_id IS NULL 인 거래가 만들어진다.
  -- 그 거래는 assert_posting_rule() 의 역분개 예외로 표 검증을 건너뛰고, R11 이
  -- reverses_tx_id 로 원 거래를 INNER JOIN 하므로 대사 뷰에도 안 나온다 —
  -- 차대만 맞으면 아무 분개 집합이나 원장에 넣을 수 있는 통로가 된다.
  -- 두 경로(008 의 reverse_transaction · 010 의 game_cancel)는 이미 링크를
  -- 채우므로 이 제약이 기존 거래를 막지 않는다.
  CONSTRAINT transactions_reverses_kind
    CHECK ((kind IN ('reversal', 'game_cancel')) = (reverses_tx_id IS NOT NULL)),

  -- 빈 문자열은 NOT NULL 을 통과한다 (design-review-4.md DR-57 · R-01-37).
  -- 감사 추적에서 "단말 미상" 과 "빈 문자열" 이 구분되지 않으면 둘 다 못 믿는다.
  CONSTRAINT transactions_device_id_length
    CHECK (length(device_id) BETWEEN 1 AND 255),
```

`ledger.idempotency_keys` 테이블 정의 안에도 넣는다:

```sql
  -- R-01-37 · AC-57-2. 빈 키는 모든 요청과 충돌하거나 아무와도 충돌하지 않는다.
  CONSTRAINT idem_key_length CHECK (length(key) BETWEEN 1 AND 255),
```

- [ ] **Step 4: 기간 타임스탬프 순서와 `opened_by` 주석**

같은 파일의 `periods_status_timestamps` CHECK를 교체한다:

```sql
  CONSTRAINT periods_status_timestamps CHECK (
    (status = 'open'    AND frozen_at IS NULL  AND settled_at IS NULL) OR
    (status = 'frozen'  AND frozen_at IS NOT NULL AND settled_at IS NULL) OR
    (status = 'settled' AND frozen_at IS NOT NULL AND settled_at IS NOT NULL)
  ),

  -- 상태와 NULL 여부만 보면 frozen_at 이 opened_at 보다 이른 행이 통과한다
  -- (design-review-4.md DR-58 · R-01-38 · AC-58-1). 그 행은 "열리기 전에
  -- 얼어붙은" 기간이고, 영업일 경계 계산이 그 값을 그대로 쓴다.
  CONSTRAINT periods_timestamp_order CHECK (
    (frozen_at  IS NULL OR frozen_at  >= opened_at) AND
    (settled_at IS NULL OR settled_at >= frozen_at)
  )
```

그리고 `COMMENT ON TABLE ledger.accounting_periods`에 문장을 더한다:

```sql
COMMENT ON TABLE ledger.accounting_periods IS
  '영업일 단위 회계 기간. 상태는 open -> frozen -> settled 한 방향이다. '
  'opened_by 컬럼을 **의도적으로 만들지 않았다** (design-review-4.md DR-58 · R-01-39 · AC-58-2) — '
  '기간 행은 006 의 ensure_period_row() 가 그 날 첫 거래에 자동 생성하므로 여는 사람이 없다. '
  '빈 컬럼을 두면 다음 사람이 "누가 열었는지 기록이 없다" 로 읽는다. 닫는 사람은 closed_by 에 남는다.';
```

- [ ] **Step 5: TRUNCATE 트리거 5종**

`db/schema/004_ledger.sql`, `entries_immutable` 트리거 **뒤**에 함수와 트리거 2개를 넣는다:

```sql
-- -----------------------------------------------------------------------------
-- TRUNCATE 방어 (design-review-4.md DR-56 · R-01-36 · AC-56-1)
-- -----------------------------------------------------------------------------
-- 행 트리거는 TRUNCATE 를 보지 못한다. deny_mutation() 이 UPDATE · DELETE 를
-- 막고 있어도 TRUNCATE 한 줄이면 원장이 사라진다.
--
-- 소유자는 이 트리거를 지울 수 있으므로 완전한 방어가 아니다 (AC-56-3).
-- **사고성 TRUNCATE 는 막고 고의는 흔적을 남긴다** — 지우는 DDL 이
-- audit 로그에 남고, 013 의 드리프트 검사가 트리거 부재를 잡는다.
CREATE FUNCTION ledger.deny_truncate() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ledger, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION
    'TRUNCATE % 는 금지다 — 원장 · 재고 이벤트는 append-only 다 (R-01-36)',
    TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER entries_no_truncate
  BEFORE TRUNCATE ON ledger.entries
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();

CREATE TRIGGER transactions_no_truncate
  BEFORE TRUNCATE ON ledger.transactions
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();
```

`db/schema/005_games_rolling.sql`의 각 테이블 불변 트리거 옆에 셋을 더한다:

```sql
CREATE TRIGGER rolling_events_no_truncate
  BEFORE TRUNCATE ON cage.rolling_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();

CREATE TRIGGER main_cage_events_no_truncate
  BEFORE TRUNCATE ON cage.main_cage_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();

CREATE TRIGGER chip_inventory_no_truncate
  BEFORE TRUNCATE ON cage.chip_inventory_events
  FOR EACH STATEMENT EXECUTE FUNCTION ledger.deny_truncate();
```

- [ ] **Step 6: 칩 사유 전용 ENUM (`AC-42-5`)**

`db/schema/001_types_and_extensions.sql`의 `cage.chip_type` 선언 옆에 넣는다:

```sql
-- 칩 재고 이동 사유 (AC-42-5 · 결정 §10). 전에는 ledger.entry_category 를
-- 그대로 썼는데 그 ENUM 에는 point_earn · share_accrue 처럼 칩과 무관한 값이
-- 30여 개 있었다 — 재고 이벤트에 들어갈 수 있는 값이 아니다.
--
-- 값은 04-posting-rules.md 의 칩 이동 표에서 왔다. 여기 없는 사유로
-- 재고를 움직여야 하면 그 문서를 먼저 고친다 (R10 이 이 매핑을 쓴다).
CREATE TYPE cage.chip_reason AS ENUM (
  'chips_issue',          -- 게임 개설 · 추가 바이인으로 칩이 나간다
  'chips_redeem',         -- 정산으로 칩이 돌아온다
  'working_chip_issue',   -- 워킹칩 지급
  'working_chip_return',  -- 워킹칩 회수
  'settle_deposit',       -- 정산분이 예치금으로
  'settle_cashout',       -- 정산분이 현금으로
  'settle_marker_redeem'  -- 정산분이 마커 상환으로
);
```

`db/schema/005_games_rolling.sql`의 컬럼 타입을 바꾼다:

```sql
  reason         cage.chip_reason NOT NULL,
```

`db/schema/010_operations_game.sql`에서 `chip_inventory_events`에 INSERT 하는 곳의 값 캐스팅을 맞춘다 — `v_category::TEXT::cage.chip_reason` 형태로 바꾸거나, 리터럴이면 그대로 두고 타입 추론에 맡긴다. `013`의 `v_shift_counters`에서 `c.reason = 'settle_cashout'` · `'settle_marker_redeem'` 비교는 리터럴이므로 그대로 동작한다.

- [ ] **Step 7: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `schema-guards.test.js` `# pass 7`

- [ ] **Step 8: 커밋**

```bash
git add db/schema/001_types_and_extensions.sql db/schema/004_ledger.sql \
        db/schema/005_games_rolling.sql db/schema/010_operations_game.sql \
        db/tests/invariants/schema-guards.test.js
git commit -m "feat(db): add reversal kind, truncate, length, period order guards and chip reason enum (R-01-35..R-01-39, AC-42-5)"
```

---

## Task 10: R1 분해 · R2 사각 제거 (`AC-37-1`~`AC-37-3` · `AC-28-1`·`AC-28-2`)

**Files:**

- Modify: `db/schema/013_reconciliation.sql` — `v_check_double_entry` · `v_check_balance_projection`
- Create: `db/tests/reconciliation/r1-r2-blindspots.test.js`

**Interfaces:**

- Consumes: `withRollback` · `asRole` (a02) · `query` (a01)
- Produces: R1이 `(branch, business_date, currency)` 단위로 행을 낸다. `v_integrity_status`의 상위 집계 형태는 그대로다

**R1의 사각.** 지금은 `GROUP BY currency` 하나뿐이다. 전역 합이 0이면 통과하므로, **HANN에서 +1000이 새고 NUSTAR에서 −1000이 새면 서로 상쇄되어 보이지 않는다.** 지점·영업일로 분해하면 두 행이 각각 드러난다. `AC-37-3`이 요구하는 것이 정확히 이 동작이다 — 불균형을 주입하면 R1이 **그 지점·그 영업일** 행을 반환한다.

**R2의 사각.** `JOIN ledger.account_balances`가 내부 조인이라 **잔액 행이 없는 계정은 뷰에 아예 나타나지 않는다.** 잔액 행을 지우면 위반이 아니라 **행의 소멸**이 되고, `count(*) FILTER (WHERE NOT ok)`는 그것을 0으로 센다. `LEFT JOIN` + `COALESCE`로 바꾸면 `variance_minor`가 분개 합만큼 벌어져 드러난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`db/tests/reconciliation/r1-r2-blindspots.test.js`:

```js
// AC-37 · AC-28 — R1 · R2 가 못 보던 사각.
//
// R1: 전역 합만 보면 HANN 의 +1000 과 NUSTAR 의 -1000 이 상쇄돼 보이지 않는다.
// R2: 내부 조인이라 잔액 행이 사라진 계정이 위반이 아니라 **행의 소멸**이 된다.
//     count(*) FILTER (WHERE NOT ok) 는 사라진 행을 0으로 센다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, withRollback, asRole, closePool } from '../helpers/db.mjs';

after(closePool);

test('AC-37-1 R1 이 (branch, business_date, currency) 로 분해돼 있다', async () => {
  const cols = await query(`
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'ledger.v_check_double_entry'::regclass AND attnum > 0
     ORDER BY attnum`);
  const names = cols.map((c) => c.attname);
  for (const need of ['branch', 'business_date', 'currency', 'imbalance_minor', 'ok']) {
    assert.ok(names.includes(need), `R1 뷰에 ${need} 컬럼이 없다 — 현재: ${names.join(', ')}`);
  }
});

test('AC-37-3 상쇄되는 두 지점의 불균형이 각각 행으로 드러난다', async () => {
  await withRollback(async (client) => {
    // 전역 합은 0이지만 지점별로는 +1000 / -1000 이다. 분해 전이라면
    // R1 이 통과하고, 분해 후에는 두 행이 ok=false 로 나온다.
    const { rows: accts } = await client.query(`
      SELECT p.home_branch AS branch, a.id
        FROM ledger.accounts a
        JOIN ledger.parties p ON p.id = a.party_id
       WHERE p.party_type = 'house' AND a.kind = 'suspense'
         AND a.currency = 'PHP' AND p.home_branch IN ('HANN', 'NUSTAR')
       ORDER BY p.home_branch`);
    assert.equal(accts.length, 2, 'HANN · NUSTAR 의 PHP suspense 계정이 있어야 한다');

    const { rows: tx } = await client.query(`
      INSERT INTO ledger.transactions
        (external_id, kind, branch, business_date, device_id, memo)
      VALUES (gen_random_uuid(), 'adjustment', 'HANN', CURRENT_DATE, 'blindspot', 'AC-37-3 probe')
      RETURNING id`);

    // 트리거를 우회한다 — 정상 경로로는 불균형 거래를 만들 수 없다.
    // 그것이 I1 의 존재 이유이고, 여기서 보는 것은 **R1 이 이미 깨진
    // 원장을 발견하는가** 이다.
    await client.query("SET LOCAL session_replication_role = 'replica'");
    await client.query(
      `INSERT INTO ledger.entries (transaction_id, account_id, currency, amount_minor, category, branch)
       VALUES ($1, $2, 'PHP',  1000, 'adjustment', 'HANN'),
              ($1, $3, 'PHP', -1000, 'adjustment', 'NUSTAR')`,
      [tx[0].id, accts[0].id, accts[1].id]
    );
    await client.query("SET LOCAL session_replication_role = 'origin'");

    const { rows: bad } = await client.query(`
      SELECT branch, imbalance_minor
        FROM ledger.v_check_double_entry
       WHERE NOT ok AND business_date = CURRENT_DATE
       ORDER BY branch`);
    assert.deepEqual(
      bad.map((r) => r.branch),
      ['HANN', 'NUSTAR'],
      '전역 합이 0이라 상쇄돼 보인다 — R1 이 지점으로 분해되지 않았다'
    );
  });
});

test('AC-28-2 잔액 행을 지우면 R2 가 variance 로 드러낸다', async () => {
  await withRollback(async (client) => {
    const { rows } = await client.query(`
      SELECT a.id FROM ledger.accounts a
       WHERE EXISTS (SELECT 1 FROM ledger.entries e WHERE e.account_id = a.id)
         AND EXISTS (SELECT 1 FROM ledger.account_balances b WHERE b.account_id = a.id)
       ORDER BY a.id LIMIT 1`);
    assert.equal(rows.length, 1, '분개와 잔액이 둘 다 있는 계정이 없다');

    await client.query('DELETE FROM ledger.account_balances WHERE account_id = $1', [rows[0].id]);

    const { rows: seen } = await client.query(
      'SELECT ok, variance_minor FROM ledger.v_check_balance_projection WHERE account_id = $1',
      [rows[0].id]
    );
    assert.equal(seen.length, 1, '잔액 행이 사라진 계정이 뷰에서도 사라졌다 — 내부 조인이다');
    assert.equal(seen[0].ok, false);
    assert.notEqual(Number(seen[0].variance_minor), 0);
  });
});

test('AC-28-1 R1 · R2 를 ledger_read 로 조회할 수 있다', async () => {
  await asRole('ledger_read', async (client) => {
    await client.query('SELECT count(*) FROM ledger.v_check_double_entry');
    await client.query('SELECT count(*) FROM ledger.v_check_balance_projection');
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `PGPASSWORD=devonly node --test --test-concurrency=1 db/tests/reconciliation/r1-r2-blindspots.test.js`
Expected: FAIL — `R1 뷰에 branch 컬럼이 없다`

- [ ] **Step 3: R1을 분해한다**

`db/schema/013_reconciliation.sql`의 `v_check_double_entry`를 교체한다:

```sql
-- =============================================================================
-- R1 · 복식부기 항등식 — (지점, 영업일, 통화) 별 분개 합이 0이어야 한다
-- =============================================================================
-- 전에는 GROUP BY currency 하나뿐이었다 (design-review-3.md DR-37 · AC-37-1).
-- 전역 합만 보면 HANN 에서 +1000 이 새고 NUSTAR 에서 -1000 이 새는 경우
-- 서로 상쇄되어 **아무것도 보이지 않는다.** 분해하면 두 행이 각각 드러난다.
--
-- 영업일까지 넣는 이유: 하루가 지나면 다음 날 거래가 전날의 불균형을 덮는다.
-- 대사는 "지금 깨졌는가" 가 아니라 "어느 날 어디서 깨졌는가" 를 답해야 한다.
--
-- v_integrity_status 의 상위 집계 형태는 그대로다 — 위반 행 수만 센다.
CREATE VIEW ledger.v_check_double_entry
  WITH (security_invoker = true) AS
SELECT
  e.branch,
  t.business_date,
  e.currency,
  sum(e.amount_minor)     AS imbalance_minor,
  count(*)                AS entry_count,
  sum(e.amount_minor) = 0 AS ok
FROM ledger.entries e
JOIN ledger.transactions t ON t.id = e.transaction_id
GROUP BY e.branch, t.business_date, e.currency;

COMMENT ON VIEW ledger.v_check_double_entry IS
  'R1. imbalance_minor 가 0이 아닌 행이 하나라도 있으면 즉시 호출 등급 알람. (지점, 영업일, 통화) 단위다 — 전역 합만 보면 지점 간 상쇄가 숨는다 (AC-37-1).';
```

> `ledger.entries.branch`가 있는지 확인한다: `grep -n "branch" db/schema/004_ledger.sql | head`. a01의 R6(`v_check_entry_branch`)이 그 컬럼을 쓰므로 있어야 한다.

- [ ] **Step 4: R2를 `LEFT JOIN`으로 바꾼다**

같은 파일의 `v_check_balance_projection`에서 조인 두 줄을 바꾼다:

```sql
FROM ledger.accounts a
JOIN ledger.parties p               ON p.id = a.party_id
-- 내부 조인이면 잔액 행이 없는 계정이 뷰에서 **사라진다** — 위반이 아니라
-- 행의 소멸이고, count(*) FILTER (WHERE NOT ok) 는 그것을 0으로 센다
-- (design-review-2.md DR-28 · AC-28-1). 잔액 행 삭제가 대사를 통과하던 사각이다.
LEFT JOIN ledger.account_balances b ON b.account_id = a.id
```

그리고 `b.balance_minor`를 쓰는 세 곳을 `COALESCE(b.balance_minor, 0)`으로 바꾼다:

```sql
  COALESCE(b.balance_minor, 0)                                AS projected_minor,
  COALESCE(e.ledger_sum, 0)                                   AS ledger_sum_minor,
  COALESCE(b.balance_minor, 0) - COALESCE(e.ledger_sum, 0)    AS variance_minor,
  COALESCE(b.balance_minor, 0) = COALESCE(e.ledger_sum, 0)    AS ok
```

- [ ] **Step 5: 재적용하고 통과를 확인한다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `r1-r2-blindspots.test.js` `# pass 4`

> **분개가 없고 잔액 행도 없는 부트스트랩 계정 165개가 이제 R2 뷰에 나타난다.** `COALESCE(NULL,0) = COALESCE(NULL,0)` 이므로 전부 `ok = true`다. 위반 수는 늘지 않고 `total` 만 늘어난다.

- [ ] **Step 6: 커밋**

```bash
git add db/schema/013_reconciliation.sql db/tests/reconciliation/r1-r2-blindspots.test.js
git commit -m "fix(db): decompose R1 by branch and business date, close the R2 join blind spot (AC-37, AC-28)"
```

---

## Task 11: a01 이월 테스트를 회수한다 (`R-12-03` 일부 · `R-12-21` · `R-01-14` · `R-01-25`)

**Files:**

- Modify: `db/tests/drift/branch-model.test.js` — `fx_exchange` · `reversal` 부재 가드
- Modify: `db/tests/posting/section-11-adjustment.test.js` — shortage 분기
- Modify: `db/tests/posting/section-12-wallet-transfer.test.js` — `p_to_wallet = false`
- Modify: `db/tests/posting/section-03-transfer.test.js` — `CURRENCIES_EXERCISED`를 5종으로

**Interfaces:**

- Consumes: Task 1의 5통화 하우스 계정 · Task 2의 통화 트리거 · a01 픽스처
- Produces: a01 이월표의 4행이 닫힌다

**a01 이월표에서 회수하는 것.** [a01 계획](2026-08-15-a01-ci-golden-harness.md)의 "완료 후 추가된 이월"이 a03에 배정한 항목 중, **이 계획의 스키마 변경이 전제인 것만** 여기서 닫는다. 게임 시작 유형(`account`·`marker`)과 §7·§8 정산 표 5~12행은 게임 연산 픽스처 확장이 선행이므로 **a06으로 다시 넘긴다** (아래 이월표).

- [ ] **Step 1: `fx_exchange` · `reversal` 부재 가드를 드리프트 테스트에 넣는다**

`db/tests/drift/branch-model.test.js` 끝에 붙인다:

```js
test('R-01-14 tx_kind 에 fx_exchange 가 없다 (U2 · 결정 §3)', async () => {
  const rows = await query(`
    SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'ledger' AND t.typname = 'tx_kind' AND e.enumlabel = 'fx_exchange'`);
  assert.deepEqual(
    rows,
    [],
    'fx_exchange 가 되살아났다 — 환전 업무 없음이 2026-08-15 U2 결정이다. ledger.fx_rates · fx_position 도 만들지 않는다'
  );
});

test('R-01-25 · AC-23-1 entry_category 에 reversal 이 없다 (ADR-016 이후 죽은 값)', async () => {
  const rows = await query(`
    SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'ledger' AND t.typname = 'entry_category' AND e.enumlabel = 'reversal'`);
  assert.deepEqual(
    rows,
    [],
    "역분개는 원 category 를 유지한다 — 'reversal' 로 덮으면 013 의 파생 뷰가 정정을 반영하지 못한다"
  );
});
```

- [ ] **Step 2: 통화 5종을 실제로 태운다 (`R-12-21`)**

`db/tests/posting/section-03-transfer.test.js`의 `CURRENCIES_EXERCISED` 상수를 5종으로 늘리고, 각 통화로 계좌 간 이체 한 건씩을 돈다. 회원 계좌는 통화별로 열어야 한다 — Task 2의 트리거가 상대 하우스 계정을 요구하고, Task 1이 그 계정을 5통화로 만들어 두었다.

```js
// R-12-21 은 통화 5종 **각각** 한 시나리오를 요구한다. a01 은 PHP · KRW 만
// 돌았다 — a03 이 하우스 계정을 곱집합으로 넓혀 나머지 셋이 가능해졌다.
const CURRENCIES_EXERCISED = ['PHP', 'USD', 'HKD', 'CNY', 'KRW'];

for (const currency of CURRENCIES_EXERCISED) {
  test(`R-12-21 · 04 §3 ${currency} 계좌 간 이체가 분개 표대로 기록된다`, async () => {
    await withActor(async (ctx) => {
      const from = await openMember(ctx, { currency });
      const to = await openMember(ctx, { currency });
      await deposit(ctx, from, 100_000);
      const tx = await transfer(ctx, { from, to, amountMinor: 40_000, currency });
      const entries = await entriesOf(tx);
      assert.deepEqual(entries, [
        { account_kind: 'member_deposit', sign: 1, category: 'transfer_out' },
        { account_kind: 'member_deposit', sign: -1, category: 'transfer_in' },
      ]);
    });
  });
}
```

> `openMember` · `deposit` · `transfer` · `entriesOf`는 a01 픽스처의 실물 이름으로 맞춘다. `openMember`가 통화 인자를 받지 않으면 `db/tests/fixtures/members.mjs`에 인자를 뚫는 것이 이 Step의 일부다.

- [ ] **Step 3: shortage 분기를 태운다**

`db/tests/posting/section-11-adjustment.test.js`에 부족(shortage) 시나리오를 더한다. 과잉(overage)만 돌던 것을 짝으로 만든다:

```js
// a01 이월: overage 분개 2건 · shortage 0건이었다. 부족은 suspense 부호가
// 반대라 op_resolve_suspense 의 해소 방향도 반대다 — 그 경로는 아무도 밟은
// 적이 없었다.
test('04 §11 · §11-2 실사 부족이 suspense 를 거쳐 shortage_expense 로 확정된다', async () => {
  await withActor(async (ctx) => {
    // 실사 결과가 시스템 잔액보다 **적다** — counted < system.
    const adj = await adjustment(ctx, { branch: 'HANN', varianceMinor: -50_000 });
    assert.deepEqual(await entriesOf(adj), [
      { account_kind: 'house_cash', sign: -1, category: 'adjustment' },
      { account_kind: 'suspense', sign: 1, category: 'adjustment' },
    ]);

    const resolve = await resolveSuspense(ctx, { branch: 'HANN', amountMinor: 50_000 });
    assert.deepEqual(await entriesOf(resolve), [
      { account_kind: 'suspense', sign: -1, category: 'suspense_resolve_out' },
      { account_kind: 'shortage_expense', sign: 1, category: 'suspense_resolve_in' },
    ]);
  });
});
```

- [ ] **Step 4: `p_to_wallet = false` 역방향을 태운다**

`db/tests/posting/section-12-wallet-transfer.test.js`에 더한다:

```js
// a01 이월: p_to_wallet 은 BOOLEAN 인데 true 만 돌았다. 분개 표가 대칭이지만
// 그 대칭을 확인한 테스트가 없었다.
test('04 §12 보유금 -> 케이지 계좌 (p_to_wallet = false)', async () => {
  await withActor(async (ctx) => {
    const tx = await walletTransfer(ctx, { toWallet: false, amountMinor: 30_000 });
    assert.deepEqual(await entriesOf(tx), [
      { account_kind: 'player_wallet', sign: 1, category: 'wallet_transfer_out' },
      { account_kind: 'member_deposit', sign: -1, category: 'wallet_transfer_in' },
    ]);
  });
});
```

- [ ] **Step 5: 전체를 돌린다**

Run: `PGPASSWORD=devonly npm run db:reset && PGPASSWORD=devonly npm run test:db`
Expected: PASS. `integrity-status.test.js`의 `MIN_ENTRIES = 50` 가드는 분개가 늘어났으므로 여유가 커진다

- [ ] **Step 6: 커밋**

```bash
git add db/tests/drift/branch-model.test.js db/tests/fixtures/members.mjs \
        db/tests/posting/section-03-transfer.test.js \
        db/tests/posting/section-11-adjustment.test.js \
        db/tests/posting/section-12-wallet-transfer.test.js
git commit -m "test(db): exercise all five currencies, the shortage branch and the reverse wallet transfer (R-12-21)"
```

---

## Task 12: 문서를 실물과 맞춘다 (`R-01-40` · 결정 1 · `AC-28-3`)

**Files:**

- Modify: `docs/architecture/03-ledger-model.md` §7 — I1 강제 수단 목록
- Modify: `docs/spec/01-ledger-foundation.md` §3-1 — `minor_unit` → `scale`
- Modify: `docs/architecture/10-acceptance-criteria.md` — 대사 사각 기록
- Modify: `docs/superpowers/ROADMAP.md` — a03 상태 · R10 이월
- Modify: `db/README.md` · `db/tests/README.md`

- [ ] **Step 1: I1 강제 수단에 "분개 수 ≥ 2"를 더한다 (`R-01-40` · `AC-22-4`)**

`docs/architecture/03-ledger-model.md` §7의 I1 항목에 한 줄을 더한다:

```markdown
- **분개 수 ≥ 2** — `ledger.assert_transaction_sealed()` (지연 제약 트리거 `transactions_sealed`, `004`). 합이 0이라는 조건만으로는 분개 0개 거래가 통과한다. `R-01-30`.
```

- [ ] **Step 2: 스펙의 `minor_unit` 표기를 정정한다 (결정 1)**

`docs/spec/01-ledger-foundation.md` §3-1 `R-01-10` 행을 바꾼다:

```markdown
| `R-01-10` | `ledger.currencies` 시드가 **PHP · USD · HKD · CNY · KRW** 5행이다. `scale`을 함께 갖는다 — KRW는 0, 나머지는 2. (실물 컬럼명은 `scale`이다. 이 문서가 예전에 쓰던 `minor_unit`은 같은 뜻이며 `NUMERIC(p, s)`의 표준 용어를 따랐다) | — |
```

같은 절의 KRW 경고 문단에서 `minor_unit`을 `scale`로 바꾸고, 소비처를 명시한다:

```markdown
> **KRW의 `scale = 0`이 함정이다.** 금액을 전부 `BIGINT` minor로 다루는 설계에서 KRW만 배율이 다르다. **DB 안에는 이 값을 읽는 곳이 없는 것이 정상이다** — 저장이 이미 최소 단위이므로 배율을 곱할 자리가 스키마 계층에 없다. 소비처는 화면 표기 · 영수증 · 리포트이고 ROADMAP §7-1이 c04 · c06 · c08에 배정했다. 그 계층이 `scale`을 무시하면 **KRW 금액이 100배로 보인다.**
```

- [ ] **Step 3: 대사 사각을 기록한다 (`AC-28-3`)**

`docs/architecture/10-acceptance-criteria.md` §11 대장 아래에 절을 더한다:

```markdown
### 11-1. 대사 계층이 못 보는 것 — 2026-08-16 전수 (a03 `AC-28-3`)

| 사각 | 어떤 검사가 놓쳤나 | 처리 |
|---|---|---|
| 지점 간 상쇄 불균형 | R1이 `GROUP BY currency` 하나여서 HANN +1000 / NUSTAR −1000이 전역 합 0으로 보였다 | a03이 `(branch, business_date, currency)`로 분해 (`AC-37-1`) |
| 잔액 행이 사라진 계정 | R2가 내부 조인이라 그 계정이 뷰에서 **사라졌다** — 위반이 아니라 행의 소멸이고 `count(*) FILTER`가 0으로 셌다 | a03이 `LEFT JOIN` + `COALESCE` (`AC-28-1`) |
| 통화 부트스트랩 누락 | 하우스 계정이 PHP 한 통화뿐이라 다른 통화 계좌가 상대 없이 열렸다 (`DR-41`) | a03이 곱집합 + R12 (`R-01-11`·`R-01-13`) |
| 넓은 `posting_rules` | `opening_balance` 32행 + 역분개 전파 64행이 R7의 기준을 넓혔다 — 대사가 스스로를 통과시켰다 | a03이 표 축소 + 지문 (`R-01-21`·`R-01-23`) |
| **앵커 검사 R8 · R9** | `audit.chain_anchors` · `merkle_anchors`가 항상 비어 뷰가 0행 — `violations`가 무조건 0이다 | 앵커 기록 배치가 없다. **주인 미정** (a01 이월표) |
| **칩 재고 R10** | 검사 자체가 없다 | B1(`R-04-65`) · `AC-42-4` 선행. **a06** |
| 지점 단위 상대 계정 | 통화 단위로만 보면 NUSTAR의 USD 하우스 계정이 HANN의 상대로 계산됐다 — `008:359-368`이 지점 일치를 요구하므로 실제로는 못 쓴다 | a03이 트리거·R12를 `(branch, currency)`로 (`R-01-12`·`R-01-13`) |
| 원본 없는 역분개 | `kind='reversal'`인데 `reverses_tx_id IS NULL`이면 `assert_posting_rule()`의 역분개 예외로 표 검증을 건너뛰고, R11이 원 거래를 INNER JOIN 하므로 대사에도 안 잡힌다 | a03이 `transactions_reverses_kind`를 **양방향** CHECK로 (`R-01-35`) |

세 유형이 반복된다 — **집계 축이 모자라서**(R1) · **조인이 행을 지워서**(R2) · **검사할 데이터가 아예 없어서**(R8·R9·R10). 새 대사를 만들 때 이 셋을 먼저 자문한다.
```

- [ ] **Step 4: ROADMAP을 갱신한다**

`docs/superpowers/ROADMAP.md` §3의 a03 행:

```markdown
| **a03** | [`a03-ledger-invariants`](plans/2026-08-16-a03-ledger-invariants.md) | [`01`](../spec/01-ledger-foundation.md) §3~§6 (**R10 제외 — B1**) | a02 | M1 | ✅ 계획 작성 완료 |
```

§7의 B1 행에서 막는 계획을 좁힌다:

```markdown
| **B1** | 교대 카운터 9종의 **항등식** — `nn_chip_in_shift`가 나머지 NN 카운터와 어떤 관계여야 하는가 | a06(R10 포함) | [`04` §12](../spec/04-cage-game-rolling.md) `R-04-65` |
```

§8 M1 종료 조건의 "R1~R11 존재"를 실제와 맞춘다:

```markdown
| **M1** | a03 · a04 · a05 · a06 · a12 · c01 | `v_integrity_status` 전 행 `violations = 0` + R1~R9 · R11 · R12 존재(R10은 a06) + 골든 테스트 전 통과 |
```

- [ ] **Step 5: `db/README.md` · `db/tests/README.md`를 갱신한다**

`db/README.md`의 스키마 요약에 새 객체를 더한다 — `ledger.house_account_policy`(a02) 옆에 `ledger.schema_fingerprints` · `cage.chip_reason` · 새 트리거 7종. `db/tests/README.md`의 디렉터리 표에 이 계획이 만든 테스트 파일 6개를 더한다.

- [ ] **Step 6: 커밋**

```bash
git add docs/architecture/03-ledger-model.md docs/architecture/10-acceptance-criteria.md \
        docs/spec/01-ledger-foundation.md docs/superpowers/ROADMAP.md \
        db/README.md db/tests/README.md
git commit -m "docs: record the a03 invariants, the reconciliation blind spots and the R10 carry"
```

---

## 종료 게이트

전부 초록이어야 a03이 끝난 것이다. 하나라도 빨가면 그 항목의 Task로 돌아간다.

| # | 확인 | 명령 · 기대 |
|---|---|---|
| 1 | 스키마가 통째로 적용된다 | `npm run db:reset` 마지막 줄이 `OK: 13 files applied` |
| 2 | 골든 스위트 전량 통과 | `npm run test:db` 실패 0 |
| 3 | 하우스 계정이 지점당 55행 · 상대 계정이 지점별로 강제된다 | `spec-01-currency.test.js` `# pass 8` |
| 4 | 표가 잠기고 지문이 맞다 | `spec-01-posting-rules.test.js` `# pass 8` |
| 5 | 분개 0개·1개가 커밋에서 실패 | `sealed-entries.test.js` `# pass 3` |
| 6 | 계정·주체 컬럼 불변 | `mutability.test.js` `# pass 5` |
| 7 | 선언형 가드 5종 · 원본 없는 역분개 거부 | `schema-guards.test.js` `# pass 8` |
| 8 | R11 · R12가 산다 | `r11-reversal-mirror.test.js` `# pass 3` · `r12-currency-counterpart.test.js` `# pass 3` |
| 9 | R1 · R2 사각이 닫혔다 | `r1-r2-blindspots.test.js` `# pass 4` |
| 10 | `v_integrity_status`가 11행 | `integrity-status.test.js` 통과 (`CHECKS` 11개) |
| 11 | 뷰 보안 드리프트 0 | `drift/security.test.js` 통과 — 새 뷰 2개가 `security_invoker`다 |
| 12 | **새 뷰 2개가 `ledger_read`에 GRANT 됐다** | `013`의 `GRANT SELECT ON ... TO ledger_read` 목록에 `v_check_currency_counterpart` · `v_check_reversal_mirror`. 두 `asRole('ledger_read')` 테스트가 42501 없이 통과 |
| 13 | R 번호 대장이 실물과 같다 | `10-acceptance-criteria.md` §11에 R11 ✅ · R12 ✅ · R10 🔒 |

**11번이 특히 중요하다.** 이 계획이 뷰를 둘 만든다. `WITH (security_invoker = true)`를 빠뜨리면 `v_check_view_security`가 즉시 잡는다 — 그 실패를 "테스트가 까다롭다"로 읽고 뷰를 예외 목록에 넣지 않는다. 예외를 넣는 순간 `ledger_read`가 소유자 권한으로 원장 전체를 읽는다.

---

## 이 계획의 범위 밖

플레이스홀더가 아니라 **의도된 이월**이다. 각각 왜 지금이 아닌지 적는다.

| 요구사항 | 이월 대상 | 사유 |
|---|---|---|
| **R10 `cage.v_check_chip_inventory`** | **a06** | ROADMAP §7이 a03을 B1으로 막았고 [`04` §12](../../spec/04-cage-game-rolling.md)가 "카운터 항등식은 R10 착수 전에 정의돼야 한다"고 못박았다. 실측도 같다 — `nn_chip_in_shift`는 지금 `reason` 필터가 없어 전체합인데 `R-04-63`은 `settle_deposit` 부분합을 요구한다. 어느 쪽이 옳은지가 곧 "금고 순유출"의 정의다. `AC-42-4`(`chip_type ↔ entry_category` 매핑)도 아직 `04-posting-rules.md`에 없다. a03은 선행 조각인 전용 ENUM(`AC-42-5`)만 처리했다 |
| `04` §5 시작 유형 `account` · `marker` | **a06** | `db/tests/fixtures/games.mjs`가 `'cash'`를 하드코딩해 나머지 둘은 도달 불가다. 픽스처에 유형 인자를 뚫는 것은 `op_start_game`의 스텝업 인증 분기(`010:95-99`)와 마커 발행(`op_issue_marker`)을 함께 태우는 일이라 게임 연산을 손보는 a06이 맡는 것이 순서다. a01 이월표는 a03으로 적었으나 a03의 스키마 변경과 무관하다 |
| `04` §7 · §8 정산 표 5~12행 — `settle_marker_redeem` · `settle_dealer_tip` · `settle_house_tip` · `working_chip_return` | **a06** | 위와 같은 이유. 네 범주 모두 별도 전제(마커 발행 · 팁 입력 · 칩 잔량)를 세워야 하고 그 전제가 전부 게임 연산이다 |
| `R-12-04` 전 경로 시나리오 4종 | **a06** | 네 시나리오가 부르는 연산 중 실사 · 기간마감이 a06 소관이다. a03은 그중 §11 · §11-2(실사 차액)의 **분개 계약**만 Task 11에서 닫았다 |
| `R-12-10` `ddl/` R번호 ↔ 파일 참조 대조 · `R-12-14` R 대장 ↔ 실제 뷰 목록 대조 | **a06** | a03이 R11 · R12를 신설하고 R10을 미뤘으므로 대장과 실물이 **의도적으로 어긋난 상태**로 남는다. 기계 대조는 그 어긋남이 해소되는 a06에서 켠다. 지금 켜면 R10 한 건 때문에 영구 빨강이다 |
| `R-01-24` 후반 — `04-posting-rules.md`에서 역분개 표 삭제 | **a06** | DB의 `posting_rules`에서는 Task 4가 뺐다. 문서 쪽 표 삭제는 `AC-42-4`(칩 매핑 확정)와 같은 파일을 건드리므로 한 번에 한다 |
| `R8` · `R9` 앵커 검사가 공허하다 | **주인 미정** | 앵커를 쓰는 배치가 스키마 · 테스트 · ROADMAP 어디에도 없다 (a01 이월표에 기록됨). a03이 새로 만들지 않는다 — 대사 뷰가 아니라 야간 배치의 부재이고, 그 배치를 어느 계획이 맡을지가 먼저다 |
| `AC-15-5` 분할 출금 임계 근거 | **a04** | U5 유예. [`02`](../../spec/02-identity-access.md)에서 잠정값으로 남는다 |

---

## 자기 점검 기록

**스펙 커버리지.** `01` §3 `R-01-10`~`R-01-16` 7건 → Task 1·2·3·11. §4 `R-01-20`~`R-01-25` 6건 → Task 4·5·6·11. §5 `R-01-30`~`R-01-40` 11건 → Task 7·8·9·12. §6 다섯 행 중 R1·R2·R7·R11 넷 → Task 5·6·10, **R10 이월**. `AC-28-3`(사각 기록) → Task 12 Step 3.

**타입 일관성.** Task 1이 만드는 곱집합을 Task 2의 트리거가 전제하고 Task 3의 R12가 같은 `house_account_policy`를 읽는다. Task 4가 표에서 뺀 `reversal`·`game_cancel`을 Task 5의 지문이 해싱하고 Task 6의 R11이 대신 지킨다. `CHECKS` 배열은 Task 3에서 10개, Task 6에서 11개로 두 번 바뀌며 각 시점의 완전한 배열을 적어 두었다.

**남은 확인 두 가지 — 2026-08-16 실측으로 둘 다 닫혔다.** (1) `ledger.parties.status`는 `ledger.account_status NOT NULL DEFAULT 'active'`로 실재한다 (`003`의 테이블 정의). Task 8 Step 4가 그대로 간다. (2) `asOwner`는 커밋형이다 — [`db/tests/helpers/db.mjs:91-93`](../../../db/tests/helpers/db.mjs)이 `runIn(ownerPool, undefined, fn, 'COMMIT')`이다.

---

## Codex 적대적 리뷰 반영 (2026-08-16)

계획 초안에 `/codex:adversarial-review`를 돌렸다. 네 건 전부 실물 대조로 확인했고 반영했다. 초안이 왜 틀렸는지를 남긴다 — 같은 종류의 실수를 다음 계획이 반복하지 않게.

| 등급 | 지적 | 초안이 틀린 이유 | 반영 |
|---|---|---|---|
| critical | 원본 없는 역분개가 표 검증과 R11을 동시에 빠져나간다 | `transactions_reverses_kind`를 `reverses_tx_id IS NULL OR kind IN (...)` 한 방향으로만 걸었다. 그 CHECK는 "엉뚱한 kind가 링크를 든다"만 막고 "역분개가 링크를 안 든다"는 통과시킨다. Task 4가 그 kind를 `assert_posting_rule()`에서 무조건 조기 반환시키므로, 링크 없는 `reversal` 거래는 표 검증을 건너뛰고 R11의 `JOIN ... ON o.id = r.reverses_tx_id` 밖에 있어 대사에도 안 잡힌다 — 차대만 맞추면 아무 분개 집합이나 들어간다 | Task 9 CHECK를 `(kind IN (...)) = (reverses_tx_id IS NOT NULL)` 양방향으로. Task 4 Step 5에 의존 관계 주석과 머지 순서 경고. `schema-guards.test.js`에 두 kind 모두 거부되는 테스트 추가 |
| high | 상대 계정 검사가 전역인데 필요한 위상은 지점별이다 | "어느 지점엔가 이 통화의 하우스 계정이 있다"로 봤다. [`008:359-368`](../../../db/schema/008_post_transaction.sql)이 `house`·`game` 계정에 `p.home_branch = p_branch`를 요구하므로 NUSTAR의 USD `house_cash`는 HANN 거래에서 쓸 수 없다 — 실패 지점을 계정 개설로 당긴다는 목적 자체가 무너진다 | 트리거를 `(지점, 통화)`로. `game`은 `home_branch` 하나, 지점 중립 주체는 활성 지점 전부. R12도 `GROUP BY (branch, currency)`. 한 지점만 갖춘 통화가 거부되는 테스트 + 게임 주체 스코프 테스트 추가 |
| high | 새 뷰 2개를 `ledger_read`에 GRANT하지 않았다 | [`012:186`](../../../db/schema/012_roles_and_grants.sql)의 `GRANT SELECT ON ALL TABLES`가 013보다 먼저 돌아 013이 만드는 뷰를 못 덮는다는 사실을 놓쳤다. 013 끝의 명시 목록이 그래서 존재하는데 거기 안 넣었다 — 계획대로 하면 `asRole('ledger_read')` 테스트 두 건이 42501로 죽는다 | Task 3 Step 4 · Task 6 Step 4에 GRANT 갱신을 명시. 종료 게이트 12번 신설 |
| high | 봉인 불변식 테스트가 지연 제약에 닿지 못한다 | `expectCommitFailure`가 `{ staffId }` 없으면 `TypeError`를 던지고 `appPool` 고정인데 그대로 불렀다. 게다가 `insertBareTransaction`이 `idempotency_key`·`auth_method`를 안 채워 `23502`로 INSERT에서 죽는다 — 새 불변식이 한 번도 실행되지 않고 파일은 초록일 수 있었다 | `expectOwnerCommitFailure` 신설(Task 7 Step 1) + NOT NULL 여섯 컬럼과 `ensure_period_row` 계약을 선행 조건에 명문화. Task 9의 직접 INSERT 세 건도 같은 계약으로 수정. Step 3에 "`23502`가 나오면 검사가 없는 게 아니라 테스트가 거래를 못 만든 것"을 적었다 |

공통 원인 하나: **초안이 `008`의 지점 정합성 블록과 `012`/`013`의 GRANT 순서, `db.mjs`의 헬퍼 계약을 "읽었다고 가정"하고 썼다.** 실측표(위 §착수 전 실측)는 스펙 요구사항 기준으로만 만들었고 *이 계획이 부르는 기존 코드의 계약*은 확인하지 않았다. 다음 계획은 실측표에 "이 계획이 의존하는 기존 함수·헬퍼의 시그니처" 행을 따로 둔다.

