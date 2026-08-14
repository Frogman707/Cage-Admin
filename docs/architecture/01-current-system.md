# 01. 현행 시스템 분석 — 코드에서 추출한 도메인 스펙

이 문서가 **사실 기준선**이다. 모든 항목에 코드 위치를 명시한다. 기존 산문 문서(`docs/cage-guide/`, `docs/cage-spec/`, `docs/FIRESTORE_DATA_MODEL.md`)와 충돌하면 **이 문서와 코드가 옳다.**

> **2026-08-14 갱신.** 초판(2026-08-10) 이후 현행 시스템에 Track A 하드닝이 적용됐다([README](README.md) "두 개의 트랙"). 바뀐 사실을 반영했으며 각 항목에 `[Track A]` 표시를 남겼다. **하드닝은 이전 필요성을 없애지 않는다** — 17절 요약표에 무엇이 닫혔고 무엇이 남았는지 정리했다.
>
> **라인 번호 규약:** 이 문서의 `index.html:NNNN` 참조는 `backend` 브랜치 2026-08-14 스냅샷 기준이다. `index.html`은 9,211줄에서 9,422줄로 자랐고 앞으로도 자란다. **함수명이 권위 있는 참조이고 라인 번호는 보조다** — 어긋나면 함수명으로 찾아라.

---

## 1. 배포 구조

```
Firebase Hosting (저장소 루트를 그대로 배포)
  /                 index.html          9,422줄 / 518 KB  케이지 운영 화면
  /partner-admin/   app.js              1,867줄            파트너 운영 콘솔
  /avatar/          app.js              1,202줄            플레이어 화면 (Avatar·Speed)
  /speed/           index.html          Avatar 화면의 Speed 모드로 리다이렉트
  /shared/          cage-ui.js · game-engine.js · i18n.js · theme.js · *.css

Cloud Functions (functions/index.js, 365줄)
  telegramWebhook · getTelegramLinks · sendTelegramMessage · deleteTelegramLink
  listStaffNames · staffLogin · masterSessionToken            ← [Track A] 인증 경로
  functions/balance/*.js                                       ← [Track A] 미배포·미연결
```

- 프런트엔드 빌드 없음. 모든 스크립트가 `<script>` 직접 로드. **[Track A]** 루트 `package.json`은 생겼으나 **개발 도구 전용**(`eslint`/`prettier`/에뮬레이터 테스트)이며 배포 산출물에 관여하지 않는다.
- Firestore compat SDK 10.14.1을 CDN에서 로드 (`index.html:1846-1847`).
- **[Track A]** 테스트 존재: `functions/test/` 4개(TOTP·spillPlan·backfill·reconcile, plain `node --test`) + 저장소 루트 `test/` 2개(Firestore 에뮬레이터 필요, **CI 미연결**). CI는 `npm run lint` + `npm test --prefix functions` 게이트를 돌린다.
- **[Track A]** Firestore 보안 규칙 파일 존재([`firestore.rules`](../../firestore.rules), 배포 완료). 다만 **`staff` 컬렉션만 인증을 요구**하고 나머지 최상위 컬렉션은 여전히 무제한이다.
- Cloud Functions는 이제 **인증 경로에 관여한다**(`staffLogin`이 PIN+TOTP를 서버에서 검증하고 custom token을 발급). **자금 경로에는 여전히 전혀 관여하지 않는다** — 모든 원장 쓰기는 브라우저가 Firestore에 직접 한다.

**결론: Firestore가 여전히 유일한 데이터베이스이며 동시에 자금 API 계층 역할까지 겸한다.** 서버 검증 지점이 0개에서 인증 3개로 늘었을 뿐, 자금 경로의 서버 검증은 여전히 0개다.

---

## 2. 지점 (Branch)

`HANN` · `NUSTAR` · `ONLINE` 3개 고정. 코드 전반에 하드코딩되어 있다.

```js
// index.html:4563
function currentBranch(){ return DB.currentCasino || 'HANN'; }
// index.html:6430
const order = [casino, ...['HANN','NUSTAR','ONLINE'].filter(c=>c!==casino)];
```

대부분의 운영 데이터가 지점 스코프를 가진다: `mainCageLedger.branch`, `shiftEvents.branch`, `games.branch`, `cageConfig/{branch}`.

---

## 3. 계좌 (`accounts`)

두 종류가 서로 다른 잔액 형태를 가진다. `index.html:4589-4604`가 이 구분을 한 곳에 모아 놓았다.

| 종류 | 판별 | 잔액 형태 | 지점 가시성 |
|---|---|---|---|
| 손님 계좌 | `isMain === false` | `balance` — **단일 통합 잔액** | 전 지점 공유 |
| 지점 하우스 | `isMain === true`, ID = `MAIN-{branch}` | `balances{HANN,NUSTAR,ONLINE}` — 지점별 격리 | 해당 지점에서만 표시 |

```js
// index.html:4593-4598
function accountBalanceFor(accountId, casino){
  const acc = DB.accounts[accountId];
  if(!acc) return 0;
  if(isMainAccount(accountId)) return (acc.balances && acc.balances[casino]) || 0;
  return acc.balance || 0;
}
```

> **이력 주의:** 손님 계좌는 과거 지점별 3분할 잔액이었고, `migrateDB()`가 합산해 단일 `balance`로 이전했다 (`index.html:5712-5718`). 따라서 손님 계좌에 남아 있는 `balances` 필드는 마이그레이션 잔재이며 읽지 않는다.

### 필드

```
member, phone, rate, telegram, engName, nickname, vip, agentCode, proxy,
passportNo, passportExp, passportPhoto, sitePhoto, signaturePhoto,
openedCasino, openedDt, currency, remark, withdrawPw, telegramLinks[], isMain
```

- `rate` — 롤링 요율. 문자열 `"1.45%"` 형태로 저장 (`index.html:5597`). **커미션 계산 코드를 저장소에서 찾지 못했다.** 미구현으로 보인다.
- `passportPhoto` · `sitePhoto` · `signaturePhoto` — KYC 이미지. Firestore 문서 필드에 직접 저장.
- `currency` — 전 계좌 `"PHP"` 고정. 필드는 존재하나 다통화 사용처 없음.

---

## 4. 계좌 원장 (`ledger`)

```
ledger/{id}
  id              crypto.randomUUID()          ← [Track A] 이전에는 'ldg_'+Date.now()+Math.random()
  accountId       string
  casino          'HANN' | 'NUSTAR' | 'ONLINE'
  dt              'YYYY-MM-DD HH:mm'   ← phNow() = UTC+8 로컬 문자열. 여전히 권위 시간축
  type            'IN' | 'OUT'
  inn             number   type==='IN'  ? amount : 0
  out             number   type==='OUT' ? amount : 0
  staff           string   근무자 이름 콤마 결합
  memo            string
  createdAt       serverTimestamp   ← [Track A] 신규. 정렬·필터는 아직 이 필드를 쓰지 않는다
  clientCreatedAt ISO 문자열         ← [Track A] 신규
  deviceId        string            ← [Track A] 신규. 감사 추적용
```

`writeLedgerEntry()` (`index.html:4469`). 잔액은 저장하지 않고 구독 시 합산으로 파생한다.

> **[Track A] 듀얼라이트.** 같은 배치 안에서 `balanceTotals/acct_{accountId}`의 해당 지점 필드를 `FieldValue.increment()`로 함께 갱신한다. **읽기 경로는 아직 이 값을 쓰지 않는다** — 화면에 보이는 잔액은 전부 여전히 원장 전량 합산이다. 배경과 컷오버 절차는 [`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md).
>
> 신규 필드 3종(`createdAt`/`clientCreatedAt`/`deviceId`)은 `mainCageLedger` · `rollingEvents` · `shiftEvents`에도 동일하게 추가됐다. 즉 **듀얼라이트 배포 시점을 경계로 원장 데이터의 성질이 다르다** — 이전 문서에는 서버 시각이 없고 이후 문서에는 있다. 이 경계는 [07-migration.md](07-migration.md) 2절의 이관 난점에 직접 영향을 준다.

> **스키마 드리프트:** `docs/FIRESTORE_DATA_MODEL.md`는 부호 있는 단일 `amount` 필드를 명세하지만, 구현은 `inn`/`out` 2필드다. `mainCageLedger`는 `amt`를 쓴다. 세 원장의 금액 필드명이 전부 다르다.

### 4-1. 이미 복식부기다 — 가장 중요한 발견

```js
// index.html:4585-4586 (주석 원문)
// Each branch has its own internal "house" account used as the double-entry mirror for every
// guest deposit/withdraw in that casino - MAIN-HANN, MAIN-NUSTAR, MAIN-ONLINE.

// index.html:6463-6467
const mainId = mainAccountIdForCasino(casino);
if(!isMainAccount(accountId) && DB.accounts[mainId]){
  const mainType = type==='IN' ? 'OUT' : 'IN';
  writeLedgerEntry({accountId:mainId, casino, type:mainType, amount, staff:staffName, memo:`${memo} — ${accountId}`});
}
```

손님 계좌에 기록할 때마다 `MAIN-{branch}`에 **반대 방향 동일 금액**을 함께 기록한다. 계좌 간 이체(`index.html:6559-6561`)와 지점 간 이체(`index.html:4799-4801`)도 OUT/IN 쌍이다.

**회계 모델이 정답이다. 강제 수단만 없다.**

### 4-2. 강제 수단이 없어서 생긴 실패 모드

두 write가 순차 실행되고, 두 번째가 실패하면 반쪽 거래가 남는다. 코드가 이를 인지하고 **토스트로 대응**한다.

```js
// index.html:6562-6566  (계좌 간 이체)
if(!okIn){
  // The debit from the source account already landed - flag this loudly rather than silently
  // leaving the transfer half-done, since the credit to the destination never made it.
  toast(t('toastTransferHalfFailed'));
  return;
}
```

```js
// index.html:4802-4807  (지점 간 이체) — 동일 패턴
```

또한 `applyAccountTransaction()`의 MAIN 미러링(`index.html:6466`)은 반환값을 확인하지 않는다 (`await` 없음). **미러 쪽 실패는 감지조차 되지 않는다.**

### 4-3. 잔액 하한 검사

메모리 상태를 읽어 검사하고, 검사와 쓰기 사이에 PIN 확인 모달이 들어간다.

```js
// hasSufficientTotalBalance() — index.html:6547
// Re-check with the freshest known balance right before writing (narrows, though cannot fully
// close, the race window between the initial check and PIN confirmation on another terminal).
if(DB.ioType==='withdraw' && !hasSufficientTotalBalance(DB.currentAccount, amt)){
```

주석이 경쟁 구간을 명시적으로 인정한다. 트랜잭션이 없으므로 두 단말이 동시에 검사를 통과하면 둘 다 성공한다.

> **[Track A] 좁혀진 것과 남은 것을 구분하라.** `ledgerServerConfirmed` 플래그가 추가돼(`index.html:4402` 정의, `:4439` 세팅, `:6521`·`:6602` 게이트), **리스너가 서버와 한 번도 동기화되지 않은 상태**(오프라인 캐시만 있는 상태)에서는 출금 승인이 차단된다.
>
> 이것이 닫은 것은 "재접속 직후 로컬 캐시가 낡았는데 그 값을 믿고 현금을 내주는" 경로다. **닫지 못한 것은 원래의 레이스다** — 두 단말이 **모두 정상 동기화된 상태**에서 동시에 같은 계좌를 출금하면 여전히 둘 다 검사를 통과한다. 잔액 검사와 원장 쓰기가 한 트랜잭션 안에 없다는 사실 자체는 그대로이며, 이것이 이전의 핵심 동기 중 하나다.

### 4-4. 지점 분산 출금 (`withdrawAcrossBranches`)

`index.html:6428-6443`. `MAIN` 계좌 전용 경로다. 지정 지점부터 시작해 `HANN → NUSTAR → ONLINE` 고정 순서로 잔액을 훑으며 부족분을 이월 차감한다. 원장 한 행이 하나의 `casino` 태그만 가질 수 있어 지점별로 별도 write가 발생한다.

---

## 5. 게임 (`games`)

```
games/{gameId}
  gameId       'YYMMDD' + 3자리 시퀀스   예: '260810001'   (index.html:6791-6792)
  dt           'YYYY-MM-DD HH:mm'
  branch       지점
  account      손님 계좌 ID
  table        테이블 코드
  cur          통화
  type         베팅 종류
  startType    'cash' | 'account' | 'marker'
  startKind    'live' | 'avatar' | 'speed'
  buyin        number
  workingChip  number
  staff        string
  checkpoints  [] 중간정산 이력 (아래 7절)
  status       'ongoing' | 'ended'
  endDt, endStaff, cc{}, nn{}, winLoss     종료 시 추가
```

**롤링 총액은 저장하지 않는다.** `rollingEvents` 합산으로 파생한다 (`index.html:4488-4497` `buildGameFromCache`). 문서 write 시 파생 필드를 명시적으로 제거한다:

```js
const {rolling, rollingLog, lastGrandTotal, lastAdded, ...meta} = g;
```

> **[Track A] 예외 하나.** 듀얼라이트가 `rollingEvents` 쓰기와 같은 배치에서 `games/{gameId}.rolling`을 `increment()`한다 — `rollingEvents`만 별도 `balanceTotals` 문서를 만들지 않고 기존 게임 메타 문서 안에서 누계를 유지하기 때문이다. 따라서 **`games.rolling` 필드는 지금 존재하지만 아무도 읽지 않는다.** 읽기는 여전히 `buildGameFromCache`의 이벤트 합산이다.

---

## 6. 롤링 (`rollingEvents`)

```
rollingEvents/{id}
  id, gameId, amount (부호 있음), dt, staff, memo
```

`memo` 문자열이 **의미론 캐리어**다. 이것이 현행 스키마의 가장 취약한 지점이다.

| `memo` | 발생 지점 | 지점 롤링 누계 산입 |
|---|---|---|
| `''` (구버전 데이터) | — | **O** |
| `'rolling'` | `confirmRollingInput` `index.html:6926` | **O** |
| `'buy-in'` | `seedRollingFromBuyin` `index.html:6729` | X |
| `'working-chip'` | `seedRollingFromBuyin` `index.html:6730` | X |
| `'mid-settle'` | `_doConfirmMidSettle` `index.html:7243` | X |
| `'game-end'` | `_doConfirmGameEnd` `index.html:7467` | X |
| `'month-settle-reset'` | 월정산 `index.html:8280` | X |

```js
// index.html:4553 — 지점 롤링 누계 판정
(fbRollingEventsByGame[gameId]||[]).forEach(e=>{ if(!e.memo || e.memo==='rolling') total += e.amount; });
```

**빈 문자열과 명시적 `'rolling'`을 같은 것으로 취급한다.** 구버전 데이터 호환을 위한 처리이며, 마이그레이션에서 이 모호성을 제거해야 한다.

---

## 7. 정산 — 중간정산과 게임종료

두 연산이 동일한 입력 구조를 공유한다.

```
cc { deposit, cashout, marker, dealerTips, houseTips }    CC칩(현금성 칩)
nn { deposit, cashout, marker, working }                  NN칩(논네고 칩)
```

### 7-1. 중간정산 `_doConfirmMidSettle` (`index.html:7219-7298`)

```js
// index.html:7237 — 롤링 차감액
const added = -nn.deposit - nn.cashout - nn.marker - nn.working;

// index.html:7276-7279 — 계좌 입금
const depositSum = cc.deposit + nn.deposit;
if(depositSum > 0){
  const txn = await applyAccountTransaction(g.account, 'IN', depositSum, ...);
}
```

`g.checkpoints`에 `{dt, added, cc, nn, staff}`를 누적한다 (`index.html:7241`).

### 7-2. 게임종료 `_doConfirmGameEnd` (`index.html:7437-7515`)

중간정산과 동일한 처리에 **두 가지 사전 검증**이 추가된다.

```js
// index.html:7449-7453
const returnedWorking = workingChipReturnedTotal(g) + nn.working;
if(Math.abs(returnedWorking - (g.workingChip||0)) > 0.001){ toast(t('toastWorkingChipNotReturned')); return; }
const netNN = -nn.deposit - nn.cashout - nn.marker - nn.working;
const totalRolling = (g.rolling||0) + netNN;
if(totalRolling < 0){ toast(t('toastRollingNegative')); return; }
```

1. **워킹칩 전액 반환** — 전 중간정산의 `nn.working` 합계 + 이번 `nn.working` == `g.workingChip`
2. **롤링 음수 금지** — 최종 롤링 총합 ≥ 0

`Math.abs(...) > 0.001` 비교는 금액이 부동소수점이기 때문에 필요한 허용 오차다. 정수 최소 단위로 바꾸면 이 허용치 자체가 불필요해진다.

### 7-3. 윈로스 계산 (`index.html:7457-7463`)

```js
let historicalSum = 0;
(g.checkpoints||[]).forEach(cp=>{
  const c = cp.cc||{}, n = cp.nn||{};
  historicalSum += (c.deposit||0)+(c.cashout||0)+(c.marker||0)+(c.dealerTips||0)+(c.houseTips||0);
  historicalSum += (n.deposit||0)+(n.cashout||0)+(n.marker||0);   // ← nn.working 제외
});
const winLoss = (historicalSum + ccSum + nn.deposit + nn.cashout + nn.marker) - (g.buyin||0);
```

**의미: 회수된 칩 총액 − 바이인.** 워킹칩은 회수 항목에서 제외된다(공짜로 준 칩이므로 손님 성과가 아니다).

---

## 8. 메인 케이지 (`mainCageLedger`)

```
mainCageLedger/{id}
  id, type, amt, dt, staff, branch
```

```js
// index.html:4695-4697
function mainCageSignedEffect(type, amt){
  return type==='redeem' ? -amt : amt;
}
```

`type` ∈ `buyin` · `rollingCC` · `marker` · `redeem` · `reset`. `redeem`만 부호가 음수다. `reset`은 월정산이 누계를 0으로 되돌릴 때 사용한다 (`index.html:8274`).

---

## 9. 교대 카운터 (`shiftEvents`) — 9개 필드

```js
// index.html:4828
const SHIFT_FIELDS = ['rollingCashShift','nnChipInShift','buyinRollingShift','workingChipRollingShift',
                      'nnCashoutShift','nnMarkerShift','cashBuyinShift','ccChipInShift','ccMarkerShift'];
```

```
shiftEvents/{id}   { id, field, delta, dt, staff, branch }
```

지점별·필드별 델타 합산으로 현재값을 구한다 (`index.html:4852-4858`).

| 필드 | 증가 지점 | 의미 |
|---|---|---|
| `cashBuyinShift` | 현금 바이인 `index.html:6808` | 현금 바이인 누계 |
| `buyinRollingShift` | 바이인 `index.html:6802` | 바이인으로 발행한 칩 |
| `workingChipRollingShift` | 워킹칩 발행 `:6803` / 반환 `:7256`(음수) | 워킹칩 순발행 |
| `nnChipInShift` | 정산 NN 입금 `:7253` | NN칩 금고 유입 |
| `nnCashoutShift` | 정산 NN 캐시아웃 `:7267` | NN칩 현금 환전 |
| `nnMarkerShift` | 정산 NN 마커 `:7271` | NN 마커 리딤 |
| `ccChipInShift` | 정산 CC 입금 `:7259` | CC칩 금고 유입 |
| `ccMarkerShift` | 정산 CC 마커 `:7274` | CC 마커 리딤 |
| `rollingCashShift` | 롤링 입력 `:6924` | 관측 롤링 누계 |

**설계 관찰:** 이 9개 카운터는 서로 독립적으로 누적되며, **상호 정합성을 검증할 수단이 없다.** 하나가 어긋나도 조용히 어긋난다. [03-ledger-model.md](03-ledger-model.md)에서 이 카운터들을 원장 계정과 재고 원장으로 승격해 회계 항등식이 자동 검증하도록 재설계한다.

---

## 10. 지점 설정 (`cageConfig/{branch}`)

```js
// index.html:4886
const CAGE_CONFIG_FIELDS = ['lastBalancingDt','lastCutoffDt','lastMonthSettleDt',
  'settleGameOutBaseline','settleEndedRollingBaseline','settleLedgerNetBaseline',
  'rollingDailyTotalBaseline','cashCarryBaseline','rollingCarryBaseline',
  'cutoffs','monthRecordLog','dailyReportLog'];
```

추가로 실사 카운트 `{cash,nn,cc}BreakdownCounts` (권종별 매수).

**`*Baseline` 6종이 회계 기간의 대용물이다.** 정산 시점의 누계를 스칼라로 박아 두고 이후 값에서 빼는 방식이다. 기간 엔티티로 대체하면 "월정산 리셋"이 데이터 조작이 아니라 기간 마감이 된다.

---

## 11. 지점 간 이체 (`branchTransfers`)

```
branchTransfers/{id}   { id, dt, fromBranch, toBranch, amount, staff, memo }
```

실제 자금 이동은 일반 원장(`MAIN-from` OUT + `MAIN-to` IN)이 담당하고, 이 컬렉션은 **전용 감사 로그**다 (`index.html:4755-4759` 주석).

---

## 12. 직원 · 인증

```
staff/{id}   { id, name, pin, dt, totpSecret }
```

**[Track A] 이 절은 초판 이후 가장 크게 바뀐 부분이다.** 로그인 검증이 브라우저에서 서버로 옮겨졌다. 다만 **저장 방식은 하나도 바뀌지 않았다.**

### 12-1. 무엇이 바뀌었나

- **`staff` 컬렉션 직접 접근이 차단됐다.** [`firestore.rules`](../../firestore.rules)가 `request.auth != null`을 요구한다. 이전에는 프로젝트 ID(공개 번들에 있음)만 알면 누구나 전 직원의 PIN과 TOTP 시크릿을 읽을 수 있었다.
- **로그인이 3단계 서버 경로가 됐다:**
  1. `listStaffNames` — 공개. 이름만 반환, 비밀 필드 없음 (`functions/index.js:115`)
  2. `staffLogin` — PIN + TOTP를 Admin SDK로 서버 검증 후 Firebase custom token 발급 (`:130`)
  3. `signInWithCustomToken()` — 이후 세션이 나머지 Firestore에 도달 (`index.html:9178`)
- **`masterSessionToken`** — 마스터 로그인도 서버에서 비밀번호 해시를 재검증한 뒤 토큰을 발급한다 (`functions/index.js:180`). 클라이언트가 `pwOk=true`를 위조해도 인증이 필요한 컬렉션에 닿지 못한다.
- **서버 측 TOTP 구현이 생겼다** — `base32Decode`/`hotp`/`verifyTotp` (`functions/index.js:66-105`). RFC 6238 (SHA-1, 6자리, 30초, ±1 스텝)이며 클라이언트 구현과 동일 동작이 `functions/test/totp.test.js`로 고정돼 있다. [06-security.md](06-security.md) 3-2절이 "서버로 이전"이라 적은 작업은 **이미 끝났다.**

### 12-2. 무엇이 바뀌지 않았나 — 이전 필요성은 그대로다

```
staff/{id}   { id, name, pin, dt, totpSecret }     ← 스키마 동일
```

- **PIN은 여전히 평문으로 저장된다.** 기본값 `'1234'` (`index.html:5778-5783`). 비교 위치가 브라우저에서 서버로 옮겨졌을 뿐, DB 침해 시 전 직원 PIN이 그대로 나온다. Argon2id 전환은 이전 과제로 남아 있다.
- **`totpSecret`은 여전히 클라이언트가 생성해 되쓴다** (`index.html:4352-4353`, `:9296`, `genTotpSecret()` `:5652`). **비밀키가 브라우저를 통과하는 사실이 그대로다.**
- **마스터 비밀번호는 여전히 솔트 없는 단일 SHA-256이다** (`index.html:6487`). Track A에서 평문 주석 삭제 + 비밀번호 회전은 이뤄졌으나 **방식은 동일**하고, 오히려 **상수가 두 곳으로 늘었다** — `index.html:6487`과 `functions/index.js:172`. 회전 시 두 파일을 함께 고쳐야 하며(배포 파이프라인이 분리돼 있어 공유 설정이 없다) 한쪽만 고치면 로그인이 조용히 깨진다.

> **⚠ 문서화되지 않았던 인증 우회.** `ERIC` 계정은 TOTP 검증을 건너뛰고 **고정 코드 `'123456'`** 을 받는다. 클라이언트(`index.html:9138`)와 서버(`functions/index.js:154`) **양쪽에** 있다. 사용자 요청에 의한 임시 조치지만, 실질적으로 **PIN `'1234'` + 알려진 6자리 = 계정 하나가 2FA 없이 열려 있다**는 뜻이다. 신규 시스템 설계에 이 예외를 이식해서는 안 되며, 현행에서도 제거 대상이다 ([06-security.md](06-security.md) 11절 체크리스트).

### 12-3. 유지 대상

조작마다 재인증하는 흐름: `requestPinAuth()` (롤링 입력·중간정산·게임종료·지점이체), `requestWithdrawAuth()` (출금·이체·계좌 바이인). **UX 설계로서 우수하며 유지 대상이다.** Track A는 여기에 하나를 더했다 — 입금 처리도 스태프 PIN 재인증을 요구한다.

---

## 13. 플레이어 · 파트너 측 (케이지와 완전 분리)

`partner-admin/app.js` · `avatar/app.js` · `shared/game-engine.js`가 사용하는 컬렉션:

```
members · memberLedger · rounds · tables · avatarRequests · avatarServiceRequests · chatMessages
partners · partnerStaff · depositRequests · paymentRequests
adminLogs · memberActionLogs · notices · tickerNotices · noticeGuide · inquiries
inGameNotices · csContacts · bannedWords · events · cageConfigPartner
```

`memberLedger`는 케이지 `ledger`와 **필드 구조도 다르고 계정 체계도 분리**되어 있다. 부호 있는 단일 `amount` + `category`를 쓴다(케이지 원장보다 정규화되어 있다).

**현재 케이지 계좌 ↔ 회원 보유금 간 자금 이동은 불가능하다.** 두 원장이 연결되어 있지 않다.

### 13-1. [Track A] 이 측에서 바뀐 것

- **신규 컬렉션 `balanceTotals`** — 유지 잔액 문서. `acct_{accountId}` · `maincage_{branch}` · `shift_{branch}` · `member_{memberId}` 4종. 위 컬렉션 목록에 추가된다. **파생값이며 진실의 원천이 아니다** — 원장 컬렉션이 여전히 유일한 진실이다. 현재 쓰기만 되고 읽히지 않는다.
- **5개 흐름이 Firestore 트랜잭션으로 원자화됐다** — `approveDeposit` · `rejectDeposit` · `processPayment`(`partner-admin/app.js:894`·`:912`·`:1289`·`:1668`) · `submitRoundCancel` · `playerSignup`(`shared/game-engine.js:67`). 이전에는 "상태 확인 후 갱신"이 두 개의 분리된 쓰기라 동시 승인이 통과했다.
  - **이 트랜잭션들이 지키는 것은 요청 문서의 `status` 필드이지 잔액이 아니다.** 케이지 측 원장 쓰기 경로(`writeLedgerEntry` · `applyAccountTransaction`)는 여전히 트랜잭션이 아니다.
- **`memberLedger` 쓰기 8곳이 한 함수로 모였다** — `shared/cage-ui.js`의 `writeMemberLedgerEntry()`. 새 쓰기 지점이 잔액 증분을 빠뜨리기 어렵게 만드는 조치다.

> **경계는 그대로다.** 이 정리는 파트너·플레이어 측 컬렉션 안에서만 일어났다. 케이지 원장과 회원 보유금은 여전히 별개 체계이며, 둘을 하나의 원장으로 합치는 것은 [08-adr.md](08-adr.md) ADR-011의 몫이다.

---

## 14. 시각 처리

```js
// index.html:4153
function phNow(){ return new Date(Date.now() + 8*3600000); }
```

UTC에 8시간을 더한 뒤 `toISOString().slice(0,16).replace('T',' ')`로 `'YYYY-MM-DD HH:mm'` 문자열을 만든다. 이 문자열이 원장·게임·정산의 시간축 전부다.

영향:
- 정렬과 기간 필터가 문자열 비교에 의존한다 (`orderBy('dt')`).
- 클라이언트 시계를 바꾸면 거래를 다른 정산일로 옮길 수 있다.
- 필리핀 시간대를 고정 오프셋 +8로 처리한다. 필리핀은 서머타임을 쓰지 않으므로 현재 결과는 맞지만, 타임존 규칙이 아니라 상수 산술이다.

> **[Track A] 서버 타임스탬프가 생겼다. 권위는 아직 옮겨가지 않았다.**
>
> `memberLedger`(파트너·플레이어 측)에 이어 케이지 측 `ledger` · `mainCageLedger` · `rollingEvents` · `shiftEvents` 쓰기에도 `createdAt: serverTimestamp()` + `clientCreatedAt` + `deviceId`가 추가됐다. 따라서 **"서버 타임스탬프도 `deviceId`도 어느 쓰기 경로에도 없다"는 초판 서술은 더 이상 사실이 아니다.**
>
> 다만 **바뀐 것은 기록이지 권위가 아니다.** 정렬·기간 필터·정산일 판정은 전부 여전히 `dt` 문자열을 읽는다. 즉 정산일 조작 가능성은 그대로이고, `createdAt`은 사후 감사에서 "이 문서가 실제로 언제 커밋됐는지"를 대조할 수 있게 해 줄 뿐이다.
>
> 이관 관점에서는 이게 유용하다 — **듀얼라이트 배포 이후 문서는 신뢰 가능한 서버 시각을 갖는다.** [07-migration.md](07-migration.md) 2절 M3 참조.

---

## 15. 실시간 구독 8채널

| 함수 | 위치 | 대상 |
|---|---|---|
| `subscribeStaffCloud` | `index.html:4287` | `staff` |
| `subscribeLedgerCloud` | `:4347` | `ledger` |
| `subscribeGamesCloud` | `:4456` | `games` |
| `subscribeRollingEventsCloud` | `:4471` | `rollingEvents` |
| `subscribeMainCageLedgerCloud` | `:4729` | `mainCageLedger` |
| `subscribeShiftEventsCloud` | `:4859` | `shiftEvents` |
| `subscribeCageConfigCloud` | `:4889` | `cageConfig/{branch}` |
| `subscribeBranchTransfersCloud` | `:4761` | `branchTransfers` |

전부 `onSnapshot` 구독이며, 하나를 빼면 전량 구독이다. 지점 필터나 페이지네이션이 없어 컬렉션 전체를 클라이언트로 내린다.

> **[Track A] `branchTransfers`만 `.limit(500)`이 걸렸다** (`subscribeBranchTransfersCloud` `index.html:4868`). 이 컬렉션만 자를 수 있었던 이유는 **아무도 이 값을 합산하지 않기 때문**이다 — 실제 자금 이동은 일반 원장이 담당하고 이 컬렉션은 순수 감사 로그다(11절).
>
> 나머지 4개(`ledger` · `mainCageLedger` · `rollingEvents` · `shiftEvents`)는 **자르면 합산 잔액이 조용히 틀려지므로 제한할 수 없다.** 이 구조적 제약이 유지 잔액 설계([`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md))와, 궁극적으로는 이 이전의 동기다.

Firestore 특유의 대응 코드가 상당량 존재하며, 이전 시 전부 소멸한다:

```js
// index.html:4272 — 호텔/리조트 프록시 대응
fbDb.settings({experimentalForceLongPolling: true});
// index.html:4273 — 오프라인 지속성 (에러 무시)
fbDb.enablePersistence({synchronizeTabs:true}).catch(()=>{});
// index.html:4190-4195 — 리스너 사망 시 백오프 재구독
function scheduleFirestoreResubscribe(key, resubscribeFn){ ... }
```

---

## 16. 로컬 폴백 모드

`fbDb`가 없으면 모든 write 함수가 `localStorage`에 쓰는 분기를 탄다. `seedDB()`가 데모 계좌 8개와 직원 6명을 생성한다 (`index.html:5758-5790`).

**이 이중 경로가 마이그레이션 시 위험 요소다.** 어떤 데이터가 클라우드에 있고 어떤 것이 로컬에만 있는지 판별해야 한다.

> **[Track A] 폴백이 인증 경로까지 확장됐다.** `staffLogin` Cloud Function에 도달할 수 없을 때(SDK 미로드, 네트워크 실패, 함수 다운) 클라이언트가 **로컬 PIN/TOTP 검증으로 되돌아간다** (`index.html:9128-9138`). 정상 동작 시에는 `staff` 컬렉션이 잠겨 있어 `DB.staff`에 `pin`/`totpSecret`이 실려 오지 않으므로 이 경로는 사실상 실패한다. 하지만 **로컬 시드 데이터가 살아 있는 단말에서는 서버 검증을 우회한 로그인이 성립한다.**
>
> 가용성(함수 장애 시 케이지가 멈추지 않음)과 인증 무결성을 맞바꾼 의도적 선택이며, 신규 시스템에는 이식하지 않는다 — [06-security.md](06-security.md) 2절의 "브라우저는 어떤 권한도 갖지 않는다" 원칙과 정면으로 충돌한다.

---

## 17. 요약 — 이전이 반드시 필요한 이유

| # | 초판(2026-08-10) 사실 | 2026-08-14 상태 | 결과 |
|---|---|---|---|
| 1 | 자금 이동이 순차 write, 원자성 없음 | **케이지 원장 미해결.** 파트너 측 5개 흐름만 트랜잭션화(13-1절) | 반쪽 거래를 토스트로 대응 |
| 2 | MAIN 미러링 결과를 확인하지 않음 | **그대로** (`applyAccountTransaction`) | 미러 실패가 무음 |
| 3 | 잔액 검사와 쓰기 사이에 경쟁 구간 | **부분.** 오프라인 캐시 케이스만 차단, 라이브 단말 간 레이스는 그대로(4-3절) | 동시 출금 이중 지불 |
| 4 | 금액이 IEEE 754 배정밀도 | **그대로** | `Math.abs(x-y) > 0.001` 비교 필요 |
| 5 | 문서 ID가 호출 시점 `Math.random()` | **완화.** `crypto.randomUUID()`로 교체 — 충돌·예측은 해소, **호출 시점 생성이라 앱 레벨 재시도 중복은 그대로** | 재시도 시 중복 원장 |
| 6 | 시각이 클라이언트 벽시계 문자열 | **부분.** `createdAt` 서버 시각이 기록되나 **권위는 여전히 `dt` 문자열**(14절) | 정산일 조작 가능 |
| 7 | 3개 원장의 금액 필드명이 전부 다름 | **그대로.** 리네이밍은 명시적으로 범위 밖 | 집계가 예외 없이 0 반환 |
| 8 | 9개 교대 카운터 간 정합성 검증 없음 | **그대로** | 조용한 불일치 |
| 9 | 비밀번호 평문, 검증이 클라이언트 | **부분.** 검증은 서버로 이동, **저장은 여전히 평문/무솔트**. `ERIC` TOTP 우회 신설(12절) | DB 침해 시 전 직원 PIN 노출 |
| 10 | 게임 취소가 문서 삭제 | **그대로** | 감사 추적 소멸 |
| 11 | 보안 규칙 파일 부재 | **부분 해소.** 파일 존재·배포됨. **`staff` 외 전 컬렉션은 여전히 무제한** | 자금 컬렉션에 권한 검증 주체 없음 |

1~7은 **Firestore의 엔진 제약**이라 애플리케이션 수정으로 해결되지 않는다. 8~11은 설계 문제이며 이전과 함께 해소한다.

> **Track A가 바꾼 것을 정확히 읽어라.** 완전히 닫힌 항목은 **하나도 없다.** 5번이 가장 가깝지만 멱등성 문제의 절반(재시도 중복)은 남았고, 3·6·9·11번은 "가장 값싼 실패 모드만 막고 근본 원인은 그대로"인 상태다.
>
> 이것은 Track A의 실패가 아니라 **설계된 범위**다. 애플리케이션 계층에서 닫을 수 있는 것에는 한계가 있고, 그 한계선이 정확히 이 표다. **1~7번을 실제로 닫는 유일한 방법은 여전히 이전이다.**

---

**다음:** [02. 목표 아키텍처](02-target-architecture.md)
