# 설계 검토 8차 — 플레이어 사이트 코드 ↔ 설계

**검토일:** 2026-08-15
**대상:** [`avatar/app.js`](../../avatar/app.js) 1,202줄 · [`avatar/index.html`](../../avatar/index.html) 241줄 · [`speed/index.html`](../../speed/index.html) 21줄 · [`shared/game-engine.js`](../../shared/game-engine.js) 300줄 전량
**대조 기준:** [`00`](00-system-map.md) §4-3·§5·§8 · [`02`](02-target-architecture.md) §4-2 · [`04`](04-posting-rules.md) §13 · [`ddl/001`](ddl/001_types_and_extensions.sql)·[`004`](ddl/004_ledger.sql)·[`005`](ddl/005_games_rolling.sql)·[`008`](ddl/008_post_transaction.sql) · [`docs/avatar-speed/`](../avatar-speed/README.md) 8종
**상태:** 미해결 5건 — 차단 0 · 높음 2 · 중간 2 · 낮음 1 · 반증 7건

> **후속**: [design-review-9.md](design-review-9.md) — 9차 `DR-83`~`DR-86` (차단 0 · 높음 2 · 중간 2). 케이지 기준선 정정(6차 §6-1) 작업에서 파생됐다. 이 문서의 `DR-78`(멱등키 충돌)·`DR-81`(배당 권위 부재)과 각각 짝을 이루는 항목이 있다 — `DR-85`(멱등키 부재)·`DR-84`(커미션 요율 권위 부재). 아홉 문서 합계 **86건 · 차단 13**

> **이 회차의 전제.** 사용자 확인(2026-08-15): *"avatar는 다른 곳에서 개선하고 있어서 바뀔 여지가 있다."* 따라서 **라운드·베팅 구조 자체는 지적 대상에서 뺐다.** 아래 5건은 전부 **아바타 개선과 무관하게 변하지 않는 축** — 원장 멱등성, 행위자 모델, 실시간 채널, 배당 권위, 문서 정합 — 에서만 골랐다. 개선 결과가 어떻게 나오든 이 5건은 그대로 남는다.
>
> 플레이어 사이트 자체의 결함은 [`G-01`~`G-12`](../avatar-speed/explanation-known-gaps.md)로 이미 자기등록돼 있다. 중복 등록하지 않았고, 전수 재확인 결과는 §5에 있다.

---

## 1. 요약

| ID | 등급 | 제목 | 위치 |
| --- | --- | --- | --- |
| `DR-78` | 높음 | 페이아웃 멱등키가 베팅 키와 같다 — 지급이 422로 막힌다 | [`04`](04-posting-rules.md) §13 (:433) |
| `DR-79` | 높음 | 거래 행위자 모델에 플레이어가 없다 | [`ddl/004`](ddl/004_ledger.sql):69·90-91 · [`ddl/001`](ddl/001_types_and_extensions.sql):123-129 |
| `DR-80` | 중간 | 실시간 채널 8종이 전부 케이지 어드민 것이다 | [`02`](02-target-architecture.md) §4-2 (:116-127) |
| `DR-81` | 중간 | 배당률·커미션의 권위 소재가 설계 어디에도 없다 | [`04`](04-posting-rules.md) §13 · [`ddl/005`](ddl/005_games_rolling.sql) |
| `DR-82` | 낮음 | psql 적용 검증 상태가 문서 간 모순 | [`README`](README.md):76 ↔ [`00`](00-system-map.md) §8 |

---

## 2. 높음

### DR-78 — 페이아웃 멱등키가 베팅 키와 같다. 지급이 422로 막힌다

[`04-posting-rules.md`](04-posting-rules.md) §13은 베팅 표(:421-424)와 페이아웃 표(:428-431)를 나란히 놓고, **멱등키를 한 줄만** 준다 (:433):

```
**멱등키:** `bet:{round_id}:{member_code}:{bet_type}` — 자연키다.
```

두 표 뒤에 놓여 있고 이름은 `bet:`이다. 베팅과 페이아웃은 **서로 다른 시점의 서로 다른 거래**다 — 코드에서도 딜링 단계의 `placeBet`([game-engine.js:95](../../shared/game-engine.js#L95))과 결과 단계의 `settleBet`([:102](../../shared/game-engine.js#L102))로 나뉘어 있다.

멱등키 공간이 전역이라 이 둘은 충돌한다:

| 근거 | 위치 |
| --- | --- |
| `ledger.idempotency_keys.key TEXT PRIMARY KEY` — 연산 이름 스코프 없음 | [`ddl/004`](ddl/004_ledger.sql):501-502 |
| `transactions.idempotency_key TEXT NOT NULL UNIQUE` | [`ddl/004`](ddl/004_ledger.sql):64 |
| 같은 키 + 다른 페이로드 → `422 idempotency-key-reused` 예외 | [`ddl/008`](ddl/008_post_transaction.sql):176-179 |
| 키 없이 호출 → `idempotency key is required` 예외 | [`ddl/008`](ddl/008_post_transaction.sql):144-146 |

**결과.** 페이아웃이 §13에 적힌 키를 그대로 쓰면 `begin_idempotent()`가 베팅 행을 찾아내고, 요청 지문이 다르므로 422로 거절한다. **어떤 회원도 지급받지 못한다.** 키를 비우면 008이 필수라며 거절한다. 두 경로 모두 지급이 불가능하다.

무승부 푸시가 이 문제를 매 라운드로 끌어올린다 — [`game-engine.js:104-105`](../../shared/game-engine.js#L104)는 타이일 때 플레이어/뱅커 베팅에 `mult = 1`을 주므로 **원금과 같은 금액의 페이아웃 분개**가 발생한다. 금액까지 같아 사람 눈으로도 중복으로 보인다.

**대조군이 같은 문서 안에 있다.** §13-2는 하위 연산마다 키를 따로 준다 — `point_earn:{member_code}:{source_ref}`, `point_convert:{member_code}:{client_request_id}`. §13만 하나다.

**이 절은 보류 대상이 아니다.** [`04`:437](04-posting-rules.md)의 보류 선언은 *"13절의 나머지(라운드 취소 · 결과 정정 · 팁 · 가입 보너스)"* 로 범위를 명시한다. 베팅·페이아웃 두 표는 확정분이며, A2 착수 시 그대로 구현 입력이 된다.

**필요 조치.** `payout:{round_id}:{member_code}:{bet_type}` 로 분리. 라운드 취소·정정 키도 같은 접두사 규칙으로 미리 예약해 둔다. A2 착수 시점에는 차단 등급이다.

---

### DR-79 — 거래 행위자 모델에 플레이어가 없다

[`ddl/004`](ddl/004_ledger.sql):61의 `ledger.transactions`가 행위자를 이렇게 잡는다:

```sql
actor_staff_id  BIGINT REFERENCES identity.staff,     -- :69
auth_method     identity.auth_method NOT NULL,
...
CONSTRAINT tx_actor_required                          -- :90-91
  CHECK (auth_method = 'system' OR actor_staff_id IS NOT NULL)
```

행위자는 **직원뿐**이다. `auth_method` ENUM([`ddl/001`](ddl/001_types_and_extensions.sql):123-129)도 `pin` · `totp` · `withdraw_pw` · `approval` · `system` 다섯 값이고, 마지막 값의 주석은 *"배치 · 마이그레이션"* 이다. 회원이 자기 이름으로 인증했다는 것을 표현할 값이 없다.

플레이어 사이트의 자금 이동은 두 종류인데 **둘 다 표현되지 않는다**:

| 흐름 | 실제 행위자 | 현행 기록 | 목표 스키마에서 |
| --- | --- | --- | --- |
| 스피드 자가 베팅 | 회원 본인 | `staff:'system'` ([app.js:1166](../../avatar/app.js#L1166)) | `auth_method='system'` + 행위자 NULL — **누가 걸었는지 사라진다** |
| 아바타 대리 베팅 | 회원(지시) + 직원(집행) | `staff:'avatar'` 리터럴 ([app.js:787](../../avatar/app.js#L787)) | 행위자 칸이 하나뿐이라 **둘 중 하나만 남는다** |
| 팁 | 회원 본인 | `staff:'member'` 리터럴 ([app.js:718](../../avatar/app.js#L718)) | 같음 |

대리 베팅은 지시자와 집행자가 분리된 구조다 — 지시는 `avatarRequests.betSide`·`betAmount`, 집행자는 `avatarRequests.avatarStaffId`([app.js:470-474](../../avatar/app.js#L470))에 따로 있다. 자금 기록에 둘을 함께 남길 자리가 없으면 **"직원이 회원 돈으로 건 베팅"의 책임 추적이 성립하지 않는다.** 케이지 측 4-eyes가 지키려는 것과 정확히 같은 종류의 위험인데, 이쪽에는 장치가 없다.

**이 공백은 보류 밖에 있다.** `002`(identity)와 `004`(ledger)는 §8에서 ✅ 완료다. A1이 정하는 것은 `game` 스키마이지 `transactions`의 행위자 컬럼이 아니다. 아바타 개선이 어떻게 끝나든 이 두 컬럼은 바뀌지 않는다.

7차 [`DR-75`](design-review-7.md)와 짝이다 — DR-75는 *온라인 회원이 어느 주체 테이블에 속하는지* 가 없다는 것이고, 이 건은 *주체가 생겨도 거래가 그를 가리킬 수 없다* 는 것이다. 둘을 함께 풀어야 한다.

**필요 조치.** ① `auth_method`에 회원 인증 값 추가 ② 행위자를 `actor_party_id`로 일반화하거나 `on_behalf_of_party_id`를 더해 2행 모델로 ③ `tx_actor_required` CHECK 재작성 ④ [`ddl/004`](ddl/004_ledger.sql):551의 감사 조회 뷰가 `identity.staff`만 LEFT JOIN하므로 함께 수정.

---

## 3. 중간

### DR-80 — 실시간 채널 8종이 전부 케이지 어드민 것이다

[`02`](02-target-architecture.md) §4-1(:89)은 *"현행 `onSnapshot` 8채널을 WebSocket 8채널로 그대로 매핑한다"* 고 선언하고, §4-2(:118-127)가 그 8종을 나열한다. 여덟 개 모두 `index.html`의 `subscribe*Cloud` 함수다 — `staff` · `ledger` · `games` · `rolling` · `maincage` · `shift` · `cageconfig` · `branchtransfers`.

실제 구독 지점을 세면 8이 아니다:

| 앱 | `onSnapshot` 호출 | 매핑된 채널 |
| --- | --- | --- |
| `index.html` | 20곳 (명명 함수 8종 포함) | 8종 |
| `partner-admin/app.js` | 5곳 | **0** |
| `avatar/app.js` | 1곳 — 채팅 ([:845](../../avatar/app.js#L845)) | **0** |

"8채널"은 **케이지 어드민만 센 값**이다. 파트너 콘솔과 플레이어 앱의 실시간 축에는 대응 채널이 없다. [`README`](README.md) 한 장 요약의 `onSnapshot × 8 → WebSocket × 8 채널` 행도 같은 누락을 반복한다.

플레이어 쪽은 A1 보류로 설명되지만 **파트너 콘솔 쪽은 아니다.** §8은 A8(케이지·파트너 부분)을 *"A1과 무관. 착수 가능"* 으로 분류한다. 엔드포인트를 설계하면서 그 화면들이 쓰는 실시간 채널을 빼면 A8이 반쪽으로 끝난다.

**필요 조치.** §4-2 표에 파트너 채널 행 추가 (승인 대기열 · 회원 목록 · 정산 상태가 후보). 플레이어 채널은 A1과 함께. "8채널"이라는 수치를 케이지 범위로 한정 표기.

---

### DR-81 — 배당률·커미션의 권위 소재가 설계 어디에도 없다

[`04`](04-posting-rules.md) §13 페이아웃 표는 금액을 `P`로만 쓴다. **`P`가 어디서 오는지 정의한 곳이 없다.**

현행에서 `P`의 유일한 출처는 클라이언트 상수다 ([`game-engine.js:14`](../../shared/game-engine.js#L14)):

```js
const PAYOUT = { player: 2.0, banker: 1.95, tie: 9.0, playerPair: 12.0, bankerPair: 12.0 };
```

목표 설계에는 대응물이 없다 — [`ddl/005_games_rolling.sql`](ddl/005_games_rolling.sql)에서 `배당`·`payout`·`odds`·`commission` 검색 결과 **0건**. 게임별 배당표를 담을 테이블도, 값을 검증할 제약도 없다.

두 가지가 걸린다:

**규약 함정.** 이 값들은 *배당*이 아니라 **원금 포함 반환 배수**다. 화면 표기는 `1:1` · `0.95:1` · `8:1` · `11:1`([app.js:912-914](../../avatar/app.js#L912), [:1056-1062](../../avatar/app.js#L1056))인데 상수는 `2.0` · `1.95` · `9.0` · `12.0`이다. 이관·구현 시 둘을 혼동하면 지급액이 **정확히 2배 또는 절반**이 된다. 7차 `DR-77`의 `shareRate` %→bp 함정과 같은 계열이다.

**커미션이 숨어 있다.** 뱅커 `1.95`는 5% 커미션을 배수 안에 접어 넣은 값이다. 별도 분개도, 수입 계정도 없다 — `commission_expense`([`ddl/001`](ddl/001_types_and_extensions.sql):64)는 파트너 쉐어·롤링용 차변 계정이라 이 자리에 쓸 수 없다. 커미션을 따로 보고 싶으면 지금 정해야 한다.

**필요 조치.** `game` 스키마에 배당표 (게임 종류 × 베팅 종류 → 배수 + 커미션율), `op_payout`이 클라이언트가 보낸 금액이 아니라 이 표에서 계산하도록 명시. 배수/배당 규약을 04 §13에 한 줄로 못박기. A1과 함께 움직이되 **규약 표기는 지금 가능**하다.

---

## 4. 낮음

### DR-82 — psql 적용 검증 상태가 문서 간 모순

[`README.md`](README.md):76:

> **아직 실제 psql 적용으로 검증되지 않았다.** 자체 검토만 거친 상태다.

[`00-system-map.md`](00-system-map.md) §8 "DDL 검증 상태":

> **2026-08-14: `ddl/` 001~013 전 파일이 PostgreSQL 18에 클린 적용되는 것을 처음으로 확인했다.**

두 문서의 최종 갱신일이 같은데 정반대를 말한다. 00 쪽은 그 과정에서 `008`의 `begin_idempotent()`와 `012`의 GRANT 순서 역전을 잡았다는 구체적 산출물까지 있어 신빙성이 높다.

1차 [`DR-12`](design-review.md)(psql 실적용 미검증)도 이 확인으로 해소된 것으로 보이는데 등록부에는 반영되지 않았다. 7차 §7이 이월한 "미검증 잔여 — ddl psql 실적용" 항목도 마찬가지다.

**필요 조치.** README:76 문장을 검증 완료로 교체(잔여 위험이 있으면 그것만 남긴다). `DR-12` 상태 갱신. 문서 일괄 수정 대기열로 넘긴다.

---

## 5. 반증 — 7건

지적하려다 코드·문서 확인으로 취소한 것들이다. **플레이어 측 기준선도 건전하다** — 7차의 파트너 측 판정과 같다.

| # | 의심 | 확인 결과 |
| --- | --- | --- |
| 1 | `G-08` 카지노 목록 불일치가 이관 위험 | **아니다.** 가입 select는 `NUSTAR`/`HANN`/`ONLINE`([index.html:117](../../avatar/index.html#L117))로 `branch_code` ENUM([`ddl/001`](ddl/001_types_and_extensions.sql):41)과 정확히 일치. `SOLAIRE`는 로비 필터 상수([app.js:250](../../avatar/app.js#L250))에만 있고 **회원 데이터에 들어갈 경로가 없다.** 화면 결함이지 이관 결함이 아니다 |
| 2 | 팁이 어느 항목에도 배정 안 됨 | **배정돼 있다.** 계정 종류 `tips_dealer`·`tips_house`가 [`ddl/001`](ddl/001_types_and_extensions.sql):58-59에 실재하고, 분개 규칙은 A2가 명시 소유 (*"취소 · 정정 · 팁 · 보너스가 없다"*). §8이 A4에서 뺀 이유도 명시 |
| 3 | 04 §13이 없는 계정을 참조 | **전부 실재.** `player_wallet`([`001`](ddl/001_types_and_extensions.sql):54) · `house_gaming`([:60](ddl/001_types_and_extensions.sql#L60)) |
| 4 | `G-01`~`G-12`에 과장·오류 | **전량 실코드 확인.** `G-12` "베팅완료" 버튼은 토스트만 띄우고([app.js:1103](../../avatar/app.js#L1103)) 확정 로직 없음, `G-10` `avatarServiceRequests`는 쓰기만 있고([:729](../../avatar/app.js#L729)) 소비자 없음, `G-03` 자동베팅 경로([:786-788](../../avatar/app.js#L786))에 잔액 검사 없음 — 셋 다 기술대로 |
| 5 | 서드카드 룰 부재·클라이언트 RNG 미등록 | **의도된 단순화로 명시.** [known-gaps:494-512](../avatar-speed/explanation-known-gaps.md) 표에 9항목으로 정리. `randCard()`가 복원추출인 것도 같은 전제 |
| 6 | `/speed/`가 별도 앱 | **껍데기 맞다.** [`speed/index.html`](../../speed/index.html):10 meta refresh + :19 `location.replace` 이중 리다이렉트, 총 21줄. [`00`](00-system-map.md):152 기술과 일치 |
| 7 | 파트너 콘솔이 아바타 신청을 처리하지 않음 | **처리한다.** 신청 생성은 플레이어([app.js:470](../../avatar/app.js#L470)), 승인은 파트너 측이며 가드 부재가 [`P-05`](../partner-admin/explanation-known-gaps.md)로 등록돼 있고 §7 위험표에도 올라 있다 |

---

## 6. 아바타 개선 진행에 대한 취급

사용자 지시(2026-08-15): *"avatar는 다른 곳에서 개선하고 있어서 바뀔 여지가 있다. 감안해서 확인하고 후순위로 밀림"*

7차 §6에서 이월했던 전수 대조를 이번에 수행하되, **개선으로 바뀔 축과 바뀌지 않을 축을 갈라서** 후자만 등록했다.

| 축 | 개선으로 바뀌나 | 이번 처리 |
| --- | --- | --- |
| 라운드 루프 · 페이즈 타이밍 · 시뮬레이션 | 바뀐다 | 지적 안 함 |
| `rounds`·`avatarRequests` 문서 구조 | 바뀐다 | 지적 안 함 (A1 보류 유지) |
| 로비·테이블 화면 구성 | 바뀐다 | 지적 안 함 |
| **원장 멱등키 규약** | 안 바뀐다 | `DR-78` |
| **거래 행위자 모델** | 안 바뀐다 | `DR-79` |
| **실시간 채널 설계** | 파트너 부분 안 바뀐다 | `DR-80` |
| **배당 권위 소재 · 규약 표기** | 표 내용은 바뀌어도 *어디가 권위인가*는 안 바뀐다 | `DR-81` |

[`00`](00-system-map.md) §8과 [`07`](07-migration.md) §8의 A1·A2·A8(플레이어) 보류 판단은 **유지가 맞다.** 재개 조건(`docs/avatar-speed/` 갱신)도 그대로 유효하다 — 이번 대조에서 그 문서 세트가 현행 코드와 정확히 일치함을 확인했으므로, 갱신 여부가 재개 신호로 기능한다.

---

## 7. 착수 순서

```
지금 (아바타 개선과 무관)
  DR-80  02 §4-2에 파트너 채널 행         ← A8(파트너) 착수 전
  DR-82  README:76 검증 상태 정정          ← 문서 일괄 수정
  DR-81  배수/배당 규약 한 줄 못박기        ← 표 자체는 A1

DR-75와 함께 (주체 모델 확정 시)
  DR-79  auth_method + 행위자 일반화

A2 착수 시 차단
  DR-78  payout: 멱등키 분리
```

**미검증 잔여.** [`ddl/005`](ddl/005_games_rolling.sql)·[`010`](ddl/010_operations_game.sql)의 케이지 게임·롤링 계층은 이번 범위 밖이다 (3차에서 op 함수 전수 조사는 했으나 `01` §7~§11의 케이지 게임 흐름과의 대조는 미수행). [`05`](05-api-contract.md) 줄 참조 재검증도 이월.

---

## 관련 문서

- **선행:** [design-review-7.md](design-review-7.md) — 7차, 파트너 콘솔 코드↔설계 (`DR-73`~`DR-77`)
- **플레이어 사이트 사실 기준선:** [`docs/avatar-speed/`](../avatar-speed/README.md) 8종 · 결함 [`G-01`~`G-12`](../avatar-speed/explanation-known-gaps.md)
- **추적 장치:** [`00-system-map.md`](00-system-map.md) §7 결함 지도 · §8 개선 항목
