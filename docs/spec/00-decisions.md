# 00 — 결정 대장

> **분류**: 결정 기록 (Decision log)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **입력**: [`08-adr.md`](../architecture/08-adr.md) 미확정 U1~U5 · [`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) §2 결정 선행 6건 · `[결정]` 표기 11건
> **효력**: 이 문서의 결정이 `docs/spec/` 전 산출물의 전제다. 스펙과 이 문서가 어긋나면 **이 문서가 맞다.**

---

## 0. 이 문서가 하는 일

[`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) `AC-20-1`이 요구한다 — **"미확정 항목 각각에 결정 · 결정일 · 결정자가 기록돼 있다. '검토 중'은 결정이 아니다."** 이 문서가 그 요구를 충족한다.

각 결정에는 **결정의 입력이 된 코드 근거**를 함께 적는다. 근거 없이 내려진 결정은 나중에 되짚을 수 없고, 되짚을 수 없는 결정은 같은 논쟁을 다시 부른다.

---

## 1. 결정 요약

| # | 항목 | 결정 | 결정일 | 결정자 |
|---|---|---|---|---|
| **U1** | 현재 Firestore 데이터가 실거래인가 | **데모다 — 데이터는 이관하지 않는다.** 단 **기능과 스키마는 전부 이식 대상이다** | 2026-08-15 | ungkey |
| **U2** | 다통화 실사용 | **통화별 계정 정식 지원. 환전 연산은 만들지 않는다** | 2026-08-15 | ungkey |
| **U3** | 롤링 커미션 산정 기준 | **관측 롤링 × 요율. 요율은 시점 스냅샷, 소급 없음** | 2026-08-15 | ungkey |
| **U4** | 지점 확장 계획 | **있다 — `branch_code` ENUM을 참조 테이블로 바꾼다** | 2026-08-15 | ungkey |
| **U5** | 규제 관할 | **유예. 구조만 만들고 임계값·보존기간은 설정값으로 뺀다** | 2026-08-15 | ungkey |
| **B1** | 이벤트 커미션 존폐 | **계속 운영 — 재구현한다** | 2026-08-15 | ungkey |
| **B2** | 케이지 포인트 | **(b) 분리 — 전용 계정 종류를 만든다** | 2026-08-15 | ungkey |
| **DR-34** | 파트너 조직 내 4-eyes | **도입하지 않는다 — 현행 단일 승인 유지** | 2026-08-15 | ungkey |
| **범위** | 미설계 도메인 포함 범위 | **전부 포함** — 케이지 미설계 4종 · 텔레그램 알림 · 파트너 콘솔 58화면 · 채팅·공지·고객센터 | 2026-08-15 | ungkey |

---

## 2. U1 · 데이터는 데모, 기능은 전부 이식

**결정**: 현재 Firestore / `localStorage` 데이터는 이관하지 않는다. **새 DB에서 시작한다.**

**결정의 정확한 범위** — 이 구분을 놓치면 스펙 전체가 틀어진다.

| | 이관 대상 | 근거 |
|---|---|---|
| 데이터 (계좌 잔액 · 원장 · 게임 이력 · 포인트 잔액 · 정산 이력) | ❌ **아니다** | 데모 데이터 |
| 기능 (화면 · 연산 · 업무 흐름) | ✅ **전부다** | 현행 구현이 도메인 스펙이다 ([README](../architecture/README.md) 전제 1) |
| 스키마 (엔티티 · 필드 · 상태값) | ✅ **전부다** | 위와 같다 |

**소멸하는 수용 기준** — 데이터 이관 전용 항목만 사라진다.

| AC | 원 항목 | 사유 |
|---|---|---|
| `AC-63-1`~`AC-63-4` | 이관 거래 고정 필드값 표 | 이관할 거래가 없다 |
| `AC-29-1`~`AC-29-4` | `archive.scrub_secrets()` 비밀값 스크럽 | 아카이브할 원본이 없다 |
| `AC-70-8` · `AC-70-9` | 해지 계좌 개시 잔액 · 신원 판별 불가 범위 | 개시 잔액을 산출하지 않는다 |
| `AC-84-4` · `AC-85-3` | 과거 오지급 · 중복 정산 역산 조사 | 조사할 실지급 이력이 없다 |

**성격이 바뀌는 수용 기준** — 없어지지 않고 **다른 일이 된다.**

| AC | 원래 | 바뀐 것 |
|---|---|---|
| `AC-21-1`~`AC-21-4` | 단말 순회 계좌 마스터 수집 | **계좌 마스터 스키마 정의** — `localStorage`에만 있던 계좌 신원(여권·사진·요율·통화)을 `ledger.parties` + `member_profiles`로 옮기는 **모델 설계**. 데이터 수집은 없다 |
| `AC-71-1`~`AC-71-4` | `localStorage` 데이터 이관 판정 | **`localStorage` 전용 기능 7종의 서버 이식 목록** — 계좌 마스터 · 포인트 · 정산 이력 · 이벤트 커미션 · 컨시어지 · 차단 · 알림 |
| `AC-77-1`~`AC-77-4` | 필드 변환 규칙 + 왕복 테스트 | **저장 규약** — `shareRate` `0.5`(%) → `50`bp 같은 **표기 단위 규약**. 변환 스크립트는 없지만 **화면 입력값 ↔ 저장값 규약은 남는다** |
| `AC-61-4` | 이관 전후 9개 카운터 대조 | **카운터 정의 대조** — 현행 증가 지점과 목표 뷰 정의의 1:1 대조는 여전히 필요하다 (`AC-61-2`) |

**남는 위험**: 이 결정은 "지금 데이터가 데모다"라는 **선언**이다. `07` §1 판별 절차를 돌린 결과가 아니다. 운영 데이터가 뒤늦게 발견되면 이 결정은 무효가 되고 M5가 되살아난다. **오픈 전 한 번은 `07` §1 절차를 돌려 이 선언을 확인하라** — 비용이 하루다.

---

## 3. U2 · 통화별 계정 정식, 환전 없음

**결정**: 통화 **5종**을 시드하고 통화별로 계정을 분리한다. 환전 연산(`fx_exchange`)은 만들지 않는다.

**결정의 입력 — 현행 다통화는 표기용이다.**

```
계좌 개설:  DB.accounts[id] = { ..., currency:'PHP', ... }        index.html:8566  ← 하드코딩
등록 폼:    통화 입력 필드 없음                                     #view-registration
게임 개설:  <select id="gCurrency"> PHP · USD · HKD · CNY · KRW    index.html:697
바이인:     applyAccountTransaction(account,'OUT',buyin)          index.html:6939  ← 환산 없음
영수증:     {PHP:'페소', USD:'달러', HKD:'홍콩달러', CNY:'위안', KRW:'원'}  index.html:7144
```

`g.cur`는 게임 레코드 · 영수증 · 정산 이력(`DB.settled.cur`)에 흐르지만 **잔액 계산에는 관여하지 않는다.** 통화가 USD인 게임의 바이인이 PHP 계좌에서 그대로 차감된다.

**따라서 이 결정은 현행 유지가 아니라 현행 결함의 교정이다.**

- `ledger.currencies` 시드가 **5행**이다 — PHP · USD · HKD · CNY · KRW. (설계 문서의 3종 시드는 **HKD · CNY가 빠져 있다**. 현행 UI가 권위다.)
- 계정은 통화를 갖고, 하우스 계정은 `currencies × account_kind` 곱집합으로 부트스트랩한다 (`AC-06-4`).
- 계정 개설은 상대 하우스 계정 존재를 강제한다 (`AC-06-5`).
- **게임 통화는 계좌 통화와 같아야 한다** — 현행이 허용하는 혼용을 스키마가 막는다.
- R1이 "거래되는 통화에 상대 계정이 없는 조합"을 잡는다 (`AC-06-8`).
- `fx_exchange` · `ledger.fx_rates` · `fx_position`은 **만들지 않는다.** `ddl/001`의 `tx_kind` 주석에 "환전 업무 없음 — 2026-08-15 결정"을 적는다. `AC-06-6` · `AC-06-7`은 이 결정으로 **범위 밖**이다.

---

## 4. U3 · 관측 롤링 × 요율

**결정**: 롤링 커미션 = **관측 롤링 총액 × 요율**. 요율은 게임 개설 시점 스냅샷(`cage.games.commission_rate_bp`)이 유일한 권위이고, 요율 변경은 **소급하지 않는다.**

**결정의 입력** (`DR-76` 반증 3건 — 셋 다 같은 기준이다):

| 출처 | 계산 | 위치 |
|---|---|---|
| 케이지 수동 지급 | 롤링 × 요율 | `_doSettleGame` (`index.html:7250`) |
| 이벤트 커미션 | `Math.round(rolling*rate/100)` | `payEventCommissionForSettle` (`index.html:8961`) |
| 파트너 표시 계산 | `rolling * 0.015` (1.5% 하드코딩) | `partner-admin/app.js` `userList` 파생 컬럼 |

**범위 제한 — 파트너 쉐어는 이 결정 밖이다.** `share_accrue`에는 현행 구현이 없다(`DR-62`). 쉐어 요율 규칙은 여전히 미확정이고, `AC-62-2`대로 `ddl/001`의 `tx_kind` 블록에 "규칙 미확정 · 실행 경로 없음"으로 기록한다. `op_share_settle`은 입력이 금액이므로 U3와 무관하게 만든다(`AC-07-6`).

`member_profiles.rolling_rate`는 유지한다 — 현행에 `"1.45%"` 형태로 저장돼 있다(`AC-62-3`).

---

## 5. U4 · 지점을 참조 테이블로

**결정**: `ledger.branch_code` ENUM을 **폐기**하고 `ledger.branches` 참조 테이블 + FK로 바꾼다.

**영향 범위가 넓다. 이것이 M0의 첫 스키마 작업이다.**

| 바뀌는 것 | 내용 |
|---|---|
| `ddl/001` | `CREATE TYPE ledger.branch_code AS ENUM` 삭제 → `CREATE TABLE ledger.branches` |
| 전 테이블 `branch` 컬럼 | `ledger.branch_code` → `TEXT REFERENCES ledger.branches(code)` |
| `branch_config` · `chain_heads` | 지점 FK. `branches`에 없는 지점 행은 만들 수 없다 |
| RLS `current_branches()` | 반환형이 ENUM 배열 → TEXT 배열 |
| 검증 SQL | `unnest(enum_range(NULL::ledger.branch_code))` → `SELECT code FROM ledger.branches` (`AC-60` 검증 쿼리 포함) |
| `ledger.provision_branch()` | 그대로 필요하다 — 지점 추가가 INSERT 한 줄이 되어도 **부수 4종**(config · chain_head · 하우스 주체 · 하우스 계정 곱집합)은 여전히 따라와야 한다 (`AC-60-3`) |

시드 3행: `HANN` · `NUSTAR` · `ONLINE`.

> **U2와 곱해진다.** 하우스 계정 부트스트랩이 `branches × currencies × account_kind`가 된다. 지점 하나를 추가하면 통화 5종 × 하우스 계정 종류만큼 계정이 생긴다. `provision_branch()`가 이것을 한 트랜잭션에서 처리하지 않으면 반쪽 지점이 남는다.

---

## 6. U5 · 유예 — 구조만 만든다

**결정**: 규제 관할을 지금 확정하지 않는다. 분할 출금(structuring) 방어 **구조는 M1에 만들고**, 임계값 · 윈도 · 보존 기간은 `ledger.branch_config` 설정값으로 뺀다.

`AC-20-2`가 요구한 **유예의 명시적 기록**이 이 절이다.

- `approval_window INTERVAL` · `approval_cumulative_minor BIGINT`를 만든다 (`AC-15-1`).
- **NULL로 조용히 꺼지지 않는다** — 누적 검사를 끄려면 명시적 센티널을 넣어야 한다 (`DR-39`의 교훈).
- 판정식 · `FOR UPDATE` 잠금 · 동시성 테스트는 관할과 무관하게 지금 만든다 (`AC-15-2`~`AC-15-4`).
- `AC-15-5`(임계값의 근거 기록)는 **관할 확정 시점으로 이월**한다. 그때까지 값은 "잠정"으로 표기한다.
- 감사 로그 보존 기간도 같다 — 컬럼과 배치는 만들고 기간 값은 설정으로 둔다.

**해제 조건**: 오픈 전 관할이 확정되면 값을 넣고 `AC-15-5`를 닫는다. **값을 넣지 않은 채 오픈하면 이 방어는 꺼져 있다.**

---

## 7. B1 · 이벤트 커미션 계속 운영

**결정**: 계속 운영한다. 현행 구현을 그대로 이식하지 않고 **재구현**한다.

**결정의 입력 — 살아 있는 기능이다.**

```
UI:         시작일·종료일·요율 입력 + 활성화/종료 버튼         index.html:1201-1207
활성화 로그:  DB.eventActivationLog                          index.html:9011
지급 이력:   DB.eventHistory {dt,account,rolling,rate,amt,staff}  index.html:8971
자동 트리거:  payEventCommissionForSettle(g.account, g.rolling)   index.html:7259
리포트 집계:  eventComm 합산                                  index.html:8158
```

**재구현하는 이유 — 현행 결함 4건이 전부 자금에 닿는다.**

| # | 현행 | 결과 |
|---|---|---|
| 1 | 요율 권위가 DOM — `document.getElementById('eventRate').value` (`index.html:8960`) | 화면 값과 저장 값이 갈라지면 **지급액은 화면을 따른다** |
| 2 | `if(!txn) return` — 실패가 무기록 (`index.html:8965`) | **미지급이 어디에도 안 남아 사후 보전 불가** |
| 3 | `await` 없이 트리거 (`index.html:7259`) | 정산 완료 토스트가 보너스 성패를 모른다 |
| 4 | 기간 판정이 클라이언트 시계 문자열 비교 (`isEventActiveNow`) | **단말 시계를 바꾸면 종료된 이벤트가 되살아난다** |

**목표**: 서버 시각 기준 기간 판정 · 저장된 요율(bp)이 권위 · **아웃박스 비동기 + 실패 기록**(`AC-67-5`). 정산은 확정하고 보너스만 재시도한다. 상세는 [`06-event-commission.md`](06-event-commission.md).

---

## 8. B2 · 케이지 포인트 분리

**결정**: (b) **전용 계정 종류로 분리한다.** 파트너 측 `player_points`와 합치지 않는다.

**결정의 입력**:

```
저장:   DB.pointsByAccount{accountId:number} · DB.pointsHistory[]   localStorage 전용
대상:   케이지 계좌(SE7419류) — memberLedger 를 거치지 않는다        index.html:8958-8990
UI:     네비 뷰 하나가 통째로 이 시스템                              index.html:595, 1163-1188
재인증:  없다 — PIN 확인 없이 포인트를 발행할 수 있다                  01 §3-1
```

**(a) 흡수를 고르지 않은 이유**: 흡수하려면 "케이지 손님 = 온라인 회원" 매핑 규칙이 선행해야 하는데(`AC-68-2`), 그 규칙은 `DR-75`이고 **A1/A2 보류에 묶여 있다.** 분리하면 보류를 기다리지 않고 지금 만든다.

**(c) 폐기가 불가능한 이유**: 화면 · 잔액 · 이력이 전부 살아 있다.

**따라오는 것**: 포인트 발행에 스텝업 재인증을 붙인다 — 현행에 없는 통제다. 상세는 [`05-cage-points.md`](05-cage-points.md).

---

## 9. DR-34 · 파트너 4-eyes 도입하지 않음

**결정**: 파트너 조직 내 4-eyes를 만들지 않는다. `partner_admin`에 `approval.vote`를 주지 않고, 파트너가 올린 승인 요청은 케이지 매니저가 승인한다. **의도된 통제임을 [`06-security.md`](../architecture/06-security.md)에 기록한다** (`AC-34-1` · `AC-34-2`).

**결정의 입력 — 현행에 파트너 4-eyes가 없다.**

```
approveDeposit(id)    운영자 한 명이 누르면 상태 전이 + memberLedger 기장   partner-admin/app.js:890
processPayment(id,s)  같은 구조                                          partner-admin/app.js:1664
```

파트너 콘솔의 승인은 **요청자(회원)와 승인자(운영자)가 다른 2단계**이지 승인자 2인 구조가 아니다. 4-eyes 도입은 신규 통제이며 이번 범위 밖이다.

`AC-34-3`(역할 분화) · `AC-34-5`(파트너 4-eyes 골든 테스트)는 **범위 밖**이 된다. `AC-34-4`(파트너 운영자의 `staff_branches` 행 확인)는 **남는다** — 승인은 못 해도 지점 검사에 걸리는 연산이 있다.

---

## 10. 설계 선택 11건

전부 권고안대로 확정한다. **각 항목은 `AC-*`가 요구한 "무엇을 골랐는지 기록"을 이 표로 충족한다.**

| 항목 | 결정 | 대체된 선택지 | 근거 |
|---|---|---|---|
| `DR-17` 윈로스 원천 둘 | **`cage.games.win_loss_minor` 컬럼 삭제, 뷰만 남긴다** (`AC-17-A`) | 대사 항목 추가 / INSERT 트리거 | 교대 카운터 9종과 같은 원칙. "파생값을 저장하지 않는다"는 설계 주장을 스스로 어기지 않는 유일한 안 |
| `DR-44` 주체 상태 미검사 | **`post_transaction`에 주체 상태 검사를 나란히 추가** (`AC-44-A`) | 계정 상태로 전파하는 트리거 | 전파는 계정별 상태를 덮어써 복원 불가. 검사는 한 곳에 모은다 |
| `DR-18` 게임번호 충돌 | **서버가 발급한다** — `(branch, business_date)` 카운터 + `FOR UPDATE` (`AC-18-1`) | 클라이언트 제안 유지 + 409 매핑 | 전역 시퀀스는 일자 리셋과 맞지 않는다. 현행 `'YYMMDD'`+3자리 표기 규약은 유지 |
| `DR-33` 계정 개설 재인증 | **스텝업 필수, 4-eyes 아니다** (`AC-33-3`) | 4-eyes 대상 | 개설 자체는 자금 이동이 아니다. 첫 입금에서 임계 검사가 걸린다 |
| `DR-70` 계좌 상태 전이 | **`closed`는 4-eyes, `suspended`는 스텝업만** (`AC-70-2`) | 둘 다 4-eyes / 둘 다 스텝업 | 해지가 비가역 |
| `DR-58` `opened_by` 부재 | **컬럼을 만들지 않고 주석으로 의도를 적는다** (`AC-58-2`) | 컬럼 추가 | `ensure_period_row()`가 첫 거래에 자동 생성한다 — "사람이 없다"가 맞는 답 |
| `DR-75` 온라인 회원 소속 | **주체 · 상태 · 인증은 A8, 게임 참여 이력은 A1** (`AC-75-1`) | 전부 A1 | 정지·블랙리스트·SMS 인증은 파트너 콘솔 운영 기능이고 아바타 개선과 무관 |
| `DR-42` 칩 재고 `reason` | **전용 ENUM을 만든다** (`AC-42-5`) | `ledger.entry_category` 재사용 | 자금 분류와 재고 사유는 다른 축이다 |
| `DR-23` `entry_category.reversal` | **ENUM에서 제거한다** (`AC-23-1`) | 미사용 주석 | M1 착수 전이라 타입 재생성이 싸다 (`AC-23-2`) |
| `DR-81` 뱅커 커미션 | **별도 분개로 뺀다** (`AC-81-4`) | 배수에 접어둔다 | 커미션 수익을 따로 보려면 지금 정해야 한다. 표기 규약(`AC-81-1`)은 A1과 무관하게 지금 못박는다 |
| `DR-67` 이벤트 지급 연쇄 | **아웃박스 비동기 + 실패 기록** (`AC-67-5`) | 같은 트랜잭션 / 수동 연산 | 같은 트랜잭션은 보너스 실패가 정산을 되돌린다. 수동은 현행 UX를 바꾼다 |

---

## 11. 범위 결정 — 미설계 도메인 전부 포함

[`00-system-map.md`](../architecture/00-system-map.md) §6 커버리지 매트릭스에서 목표 설계가 ❌인 도메인을 **전부 스펙 범위에 넣는다.**

| 도메인 | 현행 근거 | 스펙 |
|---|---|---|
| 이벤트 커미션 | `index.html` `payEventCommissionForSettle` | [`06`](06-event-commission.md) |
| 케이지 포인트 | `index.html` `grantPoints`·`usePoints` | [`05`](05-cage-points.md) |
| 컨시어지 (호텔·차량·항공) | `index.html:8792`·`8843`·`8894` | [`07`](07-concierge.md) |
| 계좌 차단 | `index.html` `applyBlock`·`unblock` | [`08`](08-account-lifecycle.md) |
| 텔레그램 알림 | `functions/index.js` 4종 + `sendCageNotification` | [`09`](09-notifications.md) |
| 파트너 콘솔 58화면 | `partner-admin/` · [`reference-screens.md`](../partner-admin/reference-screens.md) | [`10`](10-partner-console.md) |
| 채팅 · 공지 · 고객센터 | `partner-admin/` 고객센터 7화면 + `avatar/` | [`11`](11-chat-notice-support.md) |

---

## 12. 관련 문서

| 문서 | 관계 |
|---|---|
| [`README.md`](README.md) | 마일스톤 인덱스 · 의존 순서 |
| [`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) | 이 결정들이 닫는 `AC-*`의 원본 |
| [`08-adr.md`](../architecture/08-adr.md) | U1~U5 원 항목. **이 문서 확정 후 그쪽 "미확정 사항" 절은 이 문서를 가리키도록 갱신한다** |
