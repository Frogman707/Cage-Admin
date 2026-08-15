# 01. 현행 시스템 분석 — 코드에서 추출한 도메인 스펙

이 문서가 **사실 기준선**이다. 모든 항목에 코드 위치를 명시한다. 기존 산문 문서(`docs/cage-guide/`, `docs/cage-spec/`, `docs/FIRESTORE_DATA_MODEL.md`)와 충돌하면 **이 문서와 코드가 옳다.**

> **2026-08-14 갱신.** 초판(2026-08-10) 이후 현행 시스템에 Track A 하드닝이 적용됐다([README](README.md) "두 개의 트랙"). 바뀐 사실을 반영했으며 각 항목에 `[Track A]` 표시를 남겼다. **하드닝은 이전 필요성을 없애지 않는다** — 17절 요약표에 무엇이 닫혔고 무엇이 남았는지 정리했다.
>
> **2026-08-15 갱신 — 기준선 정정.** [설계 검토 6차](design-review-6.md)가 **이 문서가 서술하지 않은 케이지 도메인 다섯 개**를 코드에서 찾아냈다(`DR-66`~`DR-70`). 그중 둘은 실제 자금 이동이다. 이번 개정이 그 다섯을 채운다 — 롤링 커미션 정산(§7-0) · 이벤트 커미션(§7-4) · 케이지 포인트(§3-1) · 컨시어지(§3-2) · 계좌 차단(§3-3). 동시에 `DR-72`가 지적한 라인 참조 어긋남을 §7·§9에서 재고정했다.
>
> **기존 절 번호(§1~§17)는 하나도 바꾸지 않았다.** 인바운드 참조(`00 §A7` · `04 §16` · 검토 문서들이 가리키는 `01 §4-4` · `§9` · `§13-2`)를 깨지 않기 위해 **하위 절 삽입만** 했다. 그 대신 §3·§7 아래의 줄 번호는 밀렸다(581줄 → 771줄). 기존 인바운드 줄 참조의 새 위치: `01:90` → **`01:96`**(§3 `rate`, 5차 `DR-62`) · `01:425` → **`01:612`**(§13-1 `shareLedger`) · `01:457` → **`01:644`**(§13-2 데모 시드, 5차 `DR-65`). 절 참조(`01 §4-4` · `§9` · `§13-2`)는 전부 유효하다.
>
> **왜 서술 누락이 위험한지가 이번 개정의 교훈이다.** 6차 결론: *"서술이 없으면 대조 자체가 일어나지 않는다."* 실제로 5차 검토는 §3 `rate` 항목의 옛 문장("커미션 계산 코드를 찾지 못했다")만 읽고 **롤링 커미션 지급이 아예 없다고 판정했다.** 매 정산마다 실제 돈이 나가고 있었다.
>
> **라인 번호 규약:** 이 문서의 `index.html:NNNN` 참조는 `backend` 브랜치 2026-08-15 스냅샷(HEAD `cdad312`, 9,422줄) 기준이다. `index.html`은 계속 자란다. **함수명이 권위 있는 참조이고 라인 번호는 보조다** — 어긋나면 함수명으로 찾아라.

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

> **`accounts`는 Firestore 컬렉션이 아니다.** 각 운영자 브라우저의 `localStorage`에만 존재한다.
> `db.collection('accounts')` 호출이 저장소 전체에 **0건**이고, 실시간 구독 8채널(15절)에도 없다.
> 생성 위치는 `seedDB()` (`index.html:5706-5720`)이며 이후 `localStorage`로만 영속된다.
>
> 이 절이 서술하는 구조는 **메모리·로컬 구조**이지 클라우드 스키마가 아니다. 원장(`ledger`)은
> Firestore에 있는데 그 항목이 가리키는 계좌의 신원 정보는 브라우저에만 있다는 뜻이며,
> **단말마다 계좌 목록이 다를 수 있다.** 이관 시 결정적 문제다 —
> [07-migration.md](07-migration.md) M11.

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

- `rate` — 롤링 요율. 문자열 `"1.45%"` 형태로 저장 (`index.html:5712`). **읽힌다** — `applyAccountRateToGameType()` (`:6770`)가 바이인 화면에서 이 값을 게임 종류 select의 옵션 라벨로 주입한다.
  > **초판 서술 정정 (`DR-66` · 5차 `DR-62` 정정).** 초판은 여기에 "커미션 계산 코드를 저장소에서 찾지 못했다 — 미구현으로 보인다"라고 적었고, [5차 검토](design-review-5.md)가 이 문장을 근거로 **롤링 커미션 지급 자체가 없다**고 판정했다. **둘 다 틀렸다. 자동 계산이 있고, 매 정산마다 손님 계좌로 실제 돈이 들어간다.**
  >
  > 초판이 못 찾은 이유가 이 결함의 핵심이다 — **정산 코드는 `rate`를 직접 읽지 않는다.** 값이 `accounts.rate` → select 옵션 문자열 → `games.type` → 정규식 파싱을 거쳐 전달되므로 `rate`를 grep해도 정산 지점에 닿지 않는다. 전체 사슬은 §7-0에 있다.
- `passportPhoto` · `sitePhoto` · `signaturePhoto` — KYC 이미지. base64 문자열로 계좌 객체 안에 직접 들어간다. **`localStorage`에만 남으므로 브라우저 용량 한도(보통 5~10MB)의 영향을 받는다** — 실제로 몇 건이 저장돼 있는지가 단말마다 다르다.
- `currency` — 전 계좌 `"PHP"` 고정. 필드는 존재하나 다통화 사용처 없음.

### 3-1. 케이지 포인트 (`DB.pointsByAccount`) — 파트너 포인트와 별개 시스템

> **`DR-68`으로 등록된 누락.** 7개 네비 뷰 중 하나(`points`)가 통째로 이 시스템인데 초판에 절이 없었다.

케이지 계좌(`SE7419`류)에 붙는 **포인트 잔액**이다. `memberLedger`의 `point_earn` · `point_convert`(§13-3)와 **주체도 저장소도 완전히 다르다** — 저쪽은 파트너·플레이어 측 회원의 것이고 Firestore에 있으며, 이쪽은 케이지 손님의 것이고 `localStorage`에만 있다.

```js
// index.html:8976-8986  grantPoints() — 적립
const balAfter = (DB.pointsByAccount[pointsTargetAcc]||0) + amt;
DB.pointsByAccount[pointsTargetAcc] = balAfter;
DB.pointsHistory.unshift({dt:now, account:pointsTargetAcc, reason: reason||'—', change:amt, balance:balAfter});
```

| 항목 | 사실 |
|---|---|
| 저장소 | `DB.pointsByAccount{accountId: number}` · `DB.pointsHistory[]` — **`localStorage` 전용** |
| 적립 | `grantPoints()` (`index.html:8976`) — 금액·사유 수동 입력, 상한 없음 |
| 사용 | `usePoints()` (`:8958`) — 잔액 하한 검사 있음 (`amt>balBefore` → 거부, `:8965`) |
| 이력 | `{dt, account, reason, change, balance}` — **잔액 스냅샷을 행마다 저장한다** (`:8970`·`:8986`) |
| 재인증 | **없다.** PIN 확인 없이 포인트를 발행할 수 있다 |
| 원장 연계 | **없다.** `ledger`에도 `memberLedger`에도 기록되지 않는다 |

- 이력 행이 `balance`를 직접 들고 있으므로 **잔액과 이력이 독립적으로 틀어질 수 있다.** §9 교대 카운터와 같은 종류의 문제다.
- 조회는 계좌 검색으로 대상을 고른 뒤 표시하며(`pickPointsAcc` `:8948`), 목록은 지점 가시성으로 거른다(`accountVisibleInBranch` `:8995`).

### 3-2. 컨시어지 — 호텔 · 차량 · 항공

> **`DR-69`로 등록된 누락.** 초판은 §전체에서 프록시 CORS 한 줄로만 언급했다. 자금과 무관하지만 **손님 응대 기록**이므로 이관 판정이 필요하다.

세 도메인이 동일한 형태를 갖는다 — 계좌 ID를 키로 붙고, `localStorage`에만 있고, 취소가 상태 변경(삭제 아님)이고, 영수증 모달과 알림을 낸다.

| 도메인 | 생성 | ID 형식 | 문서 |
|---|---|---|---|
| 호텔 | `bookHotel()` (`index.html:8781`) | `'HTL-'+Math.floor(1000+Math.random()*9000)` | `{id, account, guest, roomType, bedType, checkin, checkout, remark, status}` |
| 차량 | `reserveCar()` (`:8830`) | `'CAR-'+...` | `{id, account, guest, dt, pickup, dropoff, carType, pax, remark, status}` |
| 항공 | `requestAero()` (`:8883`) | `'AER-'+...` | `{id, account, guest, direction, flight, airline, airport, pax, dt, status}` |

- `status` ∈ `'confirmed'` · `'cancelled'`. 취소는 상태만 바꾼다 (`cancelHotelBooking` `:8806`) — **§3-3 계좌 차단과 달리 이력이 보존된다.**
- 목록은 계좌 기준 지점 가시성으로 거른다 (`recordVisibleInBranch(b.account)` `:8823`).
- **ID가 `Math.random()` 4자리다.** 계좌 원장이 `crypto.randomUUID()`로 옮겨간 뒤에도(§4) 이쪽은 그대로다. 1만 분의 1 충돌 공간이며 중복 검사가 없다.
- 자금 원장과 무관하므로 목표 설계에서 `cage` 스키마 밖에 두는 것이 자연스럽다.

### 3-3. 계좌 차단 (`DB.blocks`)

> **`DR-70`으로 등록된 누락.** 목표 측 `ledger.account_status`에 `'suspended'` 값은 이미 있는데(`ddl/001:69`) 상태를 바꿀 경로가 설계에 없다 — 현행에 조작이 있다는 사실이 서술되지 않았기 때문이다.

```js
// index.html:8608-8619
function applyBlock(){
 ...
 DB.blocks.unshift({account, type:"Full", reason, staff:staffName, dt:phNow().toISOString().slice(0,10)});
 saveDB(); renderBlocks();
 pushNotification('notifBlock', account);
}
function unblock(idx){ DB.blocks.splice(idx,1); saveDB(); renderBlocks(); }
```

| 항목 | 사실 |
|---|---|
| 저장소 | `DB.blocks[]` — **`localStorage` 전용** |
| 필드 | `{account, type, reason, staff, dt}` · `type`은 **`"Full"` 하드코딩** — 부분 차단이 없다 |
| 재인증 | **없다.** PIN 없이 실행된다 |
| 해제 | `unblock(idx)` — **배열 인덱스로 `splice` 삭제.** 해제 이력이 소멸한다 |
| 강제력 | **없다.** 차단 목록은 표시만 되고, 입출금·게임 경로 어디에서도 이 목록을 조회하지 않는다 |

- 해제가 삭제인 것이 핵심 결함이다 — "누가 언제 왜 풀었는가"가 남지 않는다. 감사 대상 조작인데 감사 흔적이 없다.
- 인덱스 기반 삭제라 목록이 재정렬되는 동안 조작하면 다른 행을 지울 수 있다.

### 3-4. 계좌 해지가 부속 데이터를 연쇄 삭제한다

위 세 절과 §7-4 이벤트 이력이 "계좌에 붙은 부속 데이터"라는 사실의 코드 증거가 계좌 해지 경로에 있다.

```js
// index.html:6231-6248  _doWithdrawAccount(id)
delete DB.accounts[id];
if(fbDb){
 const snap = await fbDb.collection('ledger').where('accountId','==',id).get();
 const batch = fbDb.batch();
 snap.forEach(d=>batch.delete(d.ref));      // ← 원장 문서 전량 삭제
 await batch.commit();
}
delete DB.pointsByAccount[id];
DB.pointsHistory = (DB.pointsHistory||[]).filter(h=>h.account!==id);
DB.eventHistory  = (DB.eventHistory ||[]).filter(h=>h.account!==id);
DB.hotels = (DB.hotels||[]).filter(b=>b.account!==id);
DB.cars   = (DB.cars  ||[]).filter(c=>c.account!==id);
DB.aero   = (DB.aero  ||[]).filter(a=>a.account!==id);
```

> **여기서 두 가지를 읽어야 한다.**
>
> 1. **계좌 해지가 Firestore 원장을 물리 삭제한다** (`:6234-6237`). append-only 원장에 대한 `batch.delete()`이며 **감사 추적이 소멸한다.** §17 10번(게임 취소가 문서 삭제)과 같은 부류이지만 대상이 자금 원장 그 자체다. 게다가 이 삭제는 상대 계정(`MAIN-{branch}`, §4-1)의 미러 행을 지우지 않으므로 **해지 후 복식부기 균형이 깨진 채로 남는다.**
> 2. **`DB.blocks`만 이 연쇄에서 빠져 있다.** 해지된 계좌의 차단 기록은 남는다. §3-3의 `splice` 해제와 합치면, 차단 도메인은 **살아 있는 계좌의 이력은 지우고 죽은 계좌의 이력은 남긴다.**

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

또한 `applyAccountTransaction()`의 MAIN 미러링(`index.html:6591`)은 반환값을 확인하지 않는다 (`await` 없음). **미러 쪽 실패는 감지조차 되지 않는다.**

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

`index.html:6553`. `MAIN` 계좌 전용 경로다. 지정 지점부터 시작해 `HANN → NUSTAR → ONLINE` 고정 순서로 잔액을 훑으며 부족분을 이월 차감한다. 원장 한 행이 하나의 `casino` 태그만 가질 수 있어 지점별로 별도 write가 발생한다.

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

**롤링 총액은 저장하지 않는다.** `rollingEvents` 합산으로 파생한다 (`index.html:4572` `buildGameFromCache`). 문서 write 시 파생 필드를 명시적으로 제거한다:

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
| `'rolling'` | `confirmRollingInput` `index.html:7043` | **O** |
| `'buy-in'` | `seedRollingFromBuyin` `index.html:6858` | X |
| `'working-chip'` | `seedRollingFromBuyin` `index.html:6859` | X |
| `'mid-settle'` | `_doConfirmMidSettle` `index.html:7348` | X |
| `'game-end'` | `_doConfirmGameEnd` `index.html:7566` | X |
| `'month-settle-reset'` | 월정산 `index.html:8280` | X |

```js
// index.html:4553 — 지점 롤링 누계 판정
(fbRollingEventsByGame[gameId]||[]).forEach(e=>{ if(!e.memo || e.memo==='rolling') total += e.amount; });
```

**빈 문자열과 명시적 `'rolling'`을 같은 것으로 취급한다.** 구버전 데이터 호환을 위한 처리이며, 마이그레이션에서 이 모호성을 제거해야 한다.

---

## 7. 정산 — 롤링 커미션 · 중간정산 · 게임종료

**정산 연산은 세 개다.** 초판은 이 절을 "중간정산과 게임종료"로 열었고, 그 결과 세 번째인 **롤링 커미션 정산의 존재 자체가 문서에서 사라졌다**(`DR-66`, 차단). 실행 순서는 7-1 → 7-2 → 7-0이지만 아래에서 7-0을 먼저 두는 이유는 하나다 — **손님 계좌로 돈이 나가는 연산은 7-0뿐이고, 그것이 빠졌던 항목이기 때문이다.**

중간정산(7-1)과 게임종료(7-2)는 동일한 입력 구조를 공유한다.

```
cc { deposit, cashout, marker, dealerTips, houseTips }    CC칩(현금성 칩)
nn { deposit, cashout, marker, working }                  NN칩(논네고 칩)
```

### 7-0. 롤링 커미션 정산 `_doSettleGame` (`index.html:7224`)

> **`DR-66`(차단)으로 등록된 누락.** 초판 `01`·`04`·`05`·`ddl/` 전부에 이 흐름이 없었다. 최초 커밋(`9a1c559`, 2026-08-01)부터 존재하는 기능이다.

**손님 계좌로 실제 돈이 나가는 연산이다.** 진입은 `settleGame()` (`:7218`) → `requestPinAuth(_doSettleGame)` — PIN 재인증 필수(§12-3).

| 입력 | 출처 | 성격 |
|---|---|---|
| `commission` | `#settleRolling` (`:7229`) | **자동 계산으로 프리필된 뒤 운영자가 덮어쓸 수 있다** — 계산은 `loadSettleGame()` (`:7127-7130`) |
| `fb` | `#settleFb` F&B 차감액 (`:7230`) | 수동 입력 |
| `result` | `#settleResult` 최종 지급액 (`:7228`) | 화면에 표시된 값을 **텍스트로 되읽는다** (`textContent`에서 콤마 제거) |

#### 요율 전달 사슬 — 숫자가 UI 위젯 라벨을 통과한다

```
accounts.rate  "1.45%"                          계좌 등록 · 정보 수정에서 입력
  ↓  applyAccountRateToGameType()   :6770       바이인 화면에서 계좌 조회 시
#gType <option> "Rolling 1.45%"                 select 옵션 라벨로 주입 (프리셋에 없으면 동적 생성)
  ↓  :6916 · :6923                              바이인 확정
games.type  "Rolling 1.45%"                     게임 문서에 문자열로 복사 (§5)
  ↓  loadSettleGame()  :7127-7130               정산 화면 로드
rate = Number(/([\d.]+)%/ 첫 매치)/100
comm = Math.round((g.rolling||0) * rate)        #settleRolling 프리필
  ↓  recalcSettle()  :7137-7139
result = Math.max(0, comm - fb)                 #settleResult 텍스트
  ↓  :7228
지급액                                           textContent를 되읽어 계좌 입금
```

**다섯 홉이고, 그중 셋이 문자열이다.** §6의 `memo` 의미론 캐리어와 같은 부류인데 이쪽은 **UI 위젯의 옵션 라벨**을 경유한다. 중간에 사람이 개입할 수 있는 것은 설계 의도이기도 하다 — `:6767-6769` 주석이 "Staff can still override the selection manually afterward (e.g. for a Share-based deal)"라고 밝힌다.

> **`Share 40%` 프리셋에서 사슬이 깨진다.** `#gType` 프리셋은 3종이다 (`index.html:703`):
>
> | 프리셋 | 정규식 첫 매치 | 프리필 커미션 |
> |---|---|---|
> | `Rolling 1.5%` | `1.5` | 롤링 × 1.5% ✅ |
> | `Rolling 1% + Share 10%` | `1` | 롤링 × 1% ✅ *(롤링이 앞이라 우연히 맞는다)* |
> | **`Share 40%`** | **`40`** | **롤링 × 40%** ❌ |
>
> 셰어 딜의 배분율이 **롤링 커미션 요율로 읽힌다.** 자릿수 단위로 틀린 기본값이며, 운영자가 매번 덮어쓰는 것이 유일한 방어다.

`result`를 DOM 텍스트에서 되읽는 것도 기록해 둔다 — 지급액의 권위가 **화면 렌더 결과**에 있다. 목표 설계에서는 서버가 산출해야 한다.

지급:

```js
// index.html:7240-7244
if(result > 0){
 settleTxn = await applyAccountTransaction(g.account, 'IN', result, `${t('memoRollingSettle')} (${g.gameId})`);
 if(!settleTxn){ toast(t('toastStaffSyncFailed')); return; }
 renderMemberCard(); renderLedger();
}
```

**입금을 먼저 하고 정산 레코드를 나중에 쓴다.** 주석(`:7236-7238`)이 의도를 명시한다 — 입금이 실패하면 게임을 손대지 않고 빠져나가 재정산 가능한 상태로 남긴다. §4-2의 반쪽 거래 패턴과 방향이 반대이며 **이쪽이 더 안전한 순서다.**

정산 레코드는 `DB.settled`에 push된다 (`:7249-7250`) — **`localStorage` 전용**:

```
{gameId, account, cur, branch, dt, buyin, cashout, winLoss, rolling, commission, fb, result, staff}
```

- **종료된 게임뿐 아니라 진행 중 게임도 정산 대상이다.** `isEnded`(`:7231`)로 분기한다. 종료 게임이면 `g.settled = true`를 세우고 게임 문서를 되쓰며(`:7245-7248`), 진행 중이면 `cashout`·`winLoss`가 `null`로 기록된다.
- 텔레그램 통지: 종료 게임 2건(정산 영수증 + R/C), 진행 중 1건 (`:7254-7258`).
- 마지막에 **이벤트 커미션을 자동 트리거한다** (`:7259`) — §7-4.

파생 지점: `reportCommissionPaid()` (`:8142`), `computePeriodMetrics()`의 `rollingCommPaid`, 월정산 개시일 판정(`:8254`). 조회는 `renderSettleList()` (`:7273`), 영수증 재출력은 `printSettledRow()` (`:7208`).

> **재정산을 막는 장치가 종료 게임에만 있다.** `g.settled` 플래그로 종료 게임은 정산 드롭다운에서 빠진다(`:7246`, `:7260-7263` 주석). **진행 중 게임에는 이 플래그를 세우지 않으며**, `DB.settled`는 push-only라 같은 `gameId`의 중복 정산을 막는 검사를 `_doSettleGame` 안에서 찾지 못했다.

### 7-1. 중간정산 `_doConfirmMidSettle` (`index.html:7348`)

```js
// index.html:7366 — 롤링 차감액
const added = -nn.deposit - nn.cashout - nn.marker - nn.working;

// index.html:7405 — 계좌 입금
const depositSum = cc.deposit + nn.deposit;
if(depositSum > 0){
  const txn = await applyAccountTransaction(g.account, 'IN', depositSum, ...);
}
```

`g.checkpoints`에 `{dt, added, cc, nn, staff}`를 **`unshift`로** 누적한다 (`index.html:7369-7370`) — 최신이 배열 앞이다.

### 7-2. 게임종료 `_doConfirmGameEnd` (`index.html:7566`)

중간정산과 동일한 처리에 **두 가지 사전 검증**이 추가된다.

```js
// index.html:7578-7581
const returnedWorking = workingChipReturnedTotal(g) + nn.working;
if(Math.abs(returnedWorking - (g.workingChip||0)) > 0.001){ toast(t('toastWorkingChipNotReturned')); return; }
const netNN = -nn.deposit - nn.cashout - nn.marker - nn.working;
const totalRolling = (g.rolling||0) + netNN;
if(totalRolling < 0){ toast(t('toastRollingNegative')); return; }
```

1. **워킹칩 전액 반환** — 전 중간정산의 `nn.working` 합계 + 이번 `nn.working` == `g.workingChip`
2. **롤링 음수 금지** — 최종 롤링 총합 ≥ 0

`Math.abs(...) > 0.001` 비교는 금액이 부동소수점이기 때문에 필요한 허용 오차다. 정수 최소 단위로 바꾸면 이 허용치 자체가 불필요해진다.

### 7-3. 윈로스 계산 (`index.html:7586-7592`)

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

### 7-4. 이벤트 커미션 — 계산식이 있는 자동 지급

> **`DR-67`로 등록된 누락.** §7-0과 달리 **계산식이 있고 자동으로 실행된다.** 이것이 §3 `rate` 항목의 옛 서술("커미션 계산 코드를 찾지 못했다")에 대한 직접 반례다. 자동화 커밋 `c749806`(2026-08-02).

기간 이벤트가 활성인 동안, **롤링 커미션 정산(§7-0)이 끝날 때마다 보너스 커미션을 자동으로 추가 지급한다.**

```js
// index.html:7259 — §7-0 말미의 트리거 (await 없음)
payEventCommissionForSettle(g.account, g.rolling||0);

// index.html:9062-9067
async function payEventCommissionForSettle(account, rolling){
 if(!isEventActiveNow() || !rolling) return;
 const rate = Number(document.getElementById('eventRate').value||0);
 const amt = Math.round(rolling*rate/100);
 if(amt<=0) return;
 const txn = await applyAccountTransaction(account, 'IN', amt, t('memoEventCommission'));
```

| 항목 | 사실 |
|---|---|
| 기간 설정 | `activateEvent()` (`:9001`) — 시작은 **현재 시각으로 강제**, 종료·요율은 입력. 과거 종료일 거부 |
| 상태 | `DB.eventStart` · `DB.eventEnd` · `DB.eventRate` — **`localStorage` 전용** |
| 활성 판정 | `isEventActiveNow()` (`:9028`) — `'YYYY-MM-DDTHH:mm'` **문자열 비교** |
| 조기 종료 | `endEventNow()` (`:9051`) — `eventEnd`를 1분 전으로 되돌린다 (`:9056`) |
| 활성화 감사 | `DB.eventActivationLog[]` `{dt, start, end, rate, staff}` (`:9011-9012`) — **설정 이력은 남는다** |
| 지급 이력 | `DB.eventHistory[]` `{dt, account, rolling, rate, amt, staff}` (`:9074-9075`) |
| 재인증 | **없다.** §7-0의 PIN을 통과한 뒤 배경에서 실행된다 |

**세 가지를 기록해 둔다.**

1. **요율의 권위가 DOM 입력 필드에 있다.** `payEventCommissionForSettle`은 `DB.eventRate`가 아니라 `document.getElementById('eventRate').value`를 읽는다 (`:9064`). 화면 값과 저장 값이 갈라지면 **지급액은 화면 쪽을 따른다.**
2. **`await` 없이 트리거된다** (`:7259`). §7-0은 이벤트 커미션의 성공 여부를 모른 채 완료 토스트를 낸다.
3. **실패가 조용하다.** `if(!txn) return` (`:9071`) — 주석이 의도를 밝힌다: 계좌에 닿지 못한 보너스를 "지급됨"으로 기록하는 것보다 무음이 낫다는 판단이다. 결과적으로 **지급 실패가 어디에도 남지 않는다.**

리포트의 `eventComm` 항목(`:8158`)이 `DB.eventHistory`에서 파생된다.

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

`type` ∈ `buyin` · `rollingCC` · `marker` · `redeem` · `reset`. `redeem`만 부호가 음수다. `reset`은 월정산이 누계를 0으로 되돌릴 때 사용한다 (`index.html:8413`).

---

## 9. 교대 카운터 (`shiftEvents`) — 9개 필드

```js
// index.html:4935
const SHIFT_FIELDS = ['rollingCashShift','nnChipInShift','buyinRollingShift','workingChipRollingShift',
                      'nnCashoutShift','nnMarkerShift','cashBuyinShift','ccChipInShift','ccMarkerShift'];
```

```
shiftEvents/{id}   { id, field, delta, dt, staff, branch }
```

지점별·필드별 델타 합산으로 현재값을 구한다 (`index.html:4945`).

증가 지점은 전부 `applyShift(field, delta, staff)` 호출이다. **정산 계열 6개 필드는 중간정산(§7-1)과 게임종료(§7-2)에서 각각 한 번씩, 총 두 곳에서 증가한다** — 아래 표의 두 번째 줄번호가 게임종료 쪽이다.

| 필드 | 증가 지점 | 의미 |
|---|---|---|
| `cashBuyinShift` | 현금 바이인 `index.html:6894` · `:6937` / 취소 `:6986`(음수) | 현금 바이인 누계 |
| `buyinRollingShift` | 바이인 `:6887` · `:6931` / 취소 `:6967`(음수) | 바이인으로 발행한 칩 |
| `workingChipRollingShift` | 발행 `:6888` · `:6932` / 반환 `:7385` · `:7609`(음수) / 취소 `:6969` | 워킹칩 순발행 |
| `nnChipInShift` | 정산 NN 입금 `:7382` · `:7606` | NN칩 금고 유입 |
| `nnCashoutShift` | 정산 NN 캐시아웃 `:7396` · `:7619` | NN칩 현금 환전 |
| `nnMarkerShift` | 정산 NN 마커 `:7400` · `:7622` | NN 마커 리딤 |
| `ccChipInShift` | 정산 CC 입금 `:7388` · `:7612` | CC칩 금고 유입 |
| `ccMarkerShift` | 정산 CC 마커 `:7403` · `:7625` | CC 마커 리딤 |
| `rollingCashShift` | 롤링 입력 `:7053` / 취소 `:6982`(음수) | 관측 롤링 누계 |

> **`DR-72` 정정.** 초판 표의 줄번호는 정산 블록(§7-0, `7218-7341`) 삽입 전 값이었다. 어긋난 폭이 필드마다 달라(`+85` ~ `+129`) 일괄 오프셋으로는 복구되지 않는다 — 위 값은 HEAD `cdad312`에서 `applyShift` 호출을 전수 재조사한 결과다. **게임 취소(`cancelGame()` `:6953`) 경로의 음수 증가 4곳은 초판 표에 아예 없었다** — 카운터를 되돌리는 유일한 경로인데 빠져 있었다.

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

이 절이 케이지 어드민 전체(§1~§12)와 같은 분량이 되지는 않는다. 이쪽 서브시스템의 상세는 전용 문서 세트 두 벌에 있다 — [`docs/partner-admin/`](../partner-admin/README.md) 8건과 [`docs/avatar-speed/`](../avatar-speed/README.md) 8건. **여기서는 목표 설계가 필요로 하는 것만 확정한다**: 컬렉션 전수, 자금 쓰기 지점 전수, 원장 카테고리 전수.

### 13-1. 컬렉션 전수 — 24종

저장소 전체에서 `db.collection('...')`과 데모 시드 헬퍼 `set('...')`을 전수 조사한 결과 컬렉션은 **33종**이다. 그중 케이지 측 8종(`staff` · `ledger` · `games` · `rollingEvents` · `mainCageLedger` · `shiftEvents` · `cageConfig` · `branchTransfers`)과 양측 공유 1종(`balanceTotals`)을 빼면 **24종이 파트너·플레이어 측**이다.

| 컬렉션 | 쓰는 곳 | 성격 |
|---|---|---|
| `members` | 파트너 · 플레이어 | 회원 KYC · 상태 · **평문 비밀번호** |
| `memberLedger` | 파트너 · 플레이어 | **회원 자금 원장.** append-only, 부호 있는 `amount` |
| `partners` | 파트너 | 에이전트 계층 · 쉐어 요율 |
| `partnerStaff` | 파트너 | 콘솔 운영자 계정. **평문 비밀번호** ([06](06-security.md) §1) |
| `shareLedger` | 파트너 | 파트너 쉐어 누계. **데모 시드에서만 쓰이고 실제 적립 코드가 없다** |
| `rounds` | 플레이어 | 라운드(핸드) 결과 |
| `tables` | 파트너 · 플레이어 | 테이블 메타데이터 |
| `avatarRequests` | 파트너 · 플레이어 | 아바타 대리베팅 신청 · 승인 |
| `avatarServiceRequests` | 플레이어 | 슈체인지 등. **소비자가 없다** |
| `avatarMissCorrections` | 파트너 | 아바타 미스 수정 이력 |
| `chatMessages` | 파트너 · 플레이어 | 테이블 채팅 |
| `depositRequests` | 파트너 | 디파짓 신청 · 승인 |
| `paymentRequests` | 파트너 | 결제처리 신청 · 승인 |
| `memberActionLogs` · `adminLogs` | 파트너 | 감사 로그 2종 |
| `notices` · `tickerNotices` · `inGameNotices` · `noticeGuide` · `events` | 파트너 | 공지 계열 5종 |
| `inquiries` · `csContacts` · `bannedWords` | 파트너 | 고객센터 3종 |
| `cageConfigPartner` | 파트너 | 파트너 콘솔 설정 |

화면별로 어느 컬렉션을 읽는지는 [`docs/partner-admin/reference-screens.md`](../partner-admin/reference-screens.md)에 58개 화면 전수 표가 있다.

### 13-2. 자금 쓰기 지점 — 9곳

`memberLedger`에 쓰는 지점 전부. 전수 조사 기준은 `writeMemberLedgerEntry(` 호출이다.

| 앱 | 함수 | 위치 | `category` |
|---|---|---|---|
| 파트너 | `submitBalanceAdjust` | `partner-admin/app.js:416` | `deposit` / `withdraw` |
| 파트너 | `approveDeposit` | `:906` | `deposit` |
| 파트너 | `processPayment` | `:1681` | `deposit` / `withdraw` |
| 파트너 | `submitRoundCancel` — 베팅 환불 | `:1304` | `correction` |
| 파트너 | `submitRoundCancel` — 페이아웃 회수 | `:1307` | `correction` |
| 플레이어 | `playerSignup` 가입 보너스 | `shared/game-engine.js:82` | `deposit` |
| 플레이어 | `placeBet` | `:96` | `bet` |
| 플레이어 | `settleBet` | `:111` | `payout` |
| 플레이어 | 팁 | `avatar/app.js:706` | `avatar_tip` / `dealer_tip` |

**데모 시드(`seedDemoData`, `partner-admin/app.js:1724`)만 이 함수를 거치지 않고** `batch.set()`으로 직접 쓴다 — 시드 데이터는 `balanceTotals`에 반영되지 않는다.

### 13-3. `category` 전수 — 10종

```
bet   payout   deposit   withdraw   correction
point_earn   point_convert   share_accum   avatar_tip   dealer_tip
```

`share_accum`은 `memberLedger`가 아니라 `shareLedger`에 쓰인다. 나머지 9종이 `memberLedger`에 섞여 들어가고, 보유금·포인트는 그중 일부만 골라 합산한 값이다 (`partner-admin/app.js:255`).

목표 설계의 대응 관계는 [04-posting-rules.md](04-posting-rules.md) §16에 있다. `point_earn` · `point_convert` · `share_accum`은 §13-2·§13-3으로 확정됐고, `avatar_tip` · `dealer_tip`과 가입 보너스는 아바타 도메인 확정 후로 미뤄져 있다.

### 13-4. 케이지와의 관계

`memberLedger`는 케이지 `ledger`와 **필드 구조도 다르고 계정 체계도 분리**되어 있다. 부호 있는 단일 `amount` + `category`를 쓴다(케이지 원장보다 정규화되어 있다).

**현재 케이지 계좌 ↔ 회원 보유금 간 자금 이동은 불가능하다.** 두 원장이 연결되어 있지 않다.

파트너 콘솔과 플레이어 사이트는 **Cloud Function을 한 번도 호출하지 않는다.** `functions/`의 7개 함수는 전부 케이지 어드민(`index.html`) 전용이며, 이쪽은 브라우저에서 Firestore를 직접 읽고 쓴다.

### 13-5. [Track A] 이 측에서 바뀐 것

- **신규 컬렉션 `balanceTotals`** — 유지 잔액 문서. `acct_{accountId}` · `maincage_{branch}` · `shift_{branch}` · `member_{memberId}` 4종. **케이지와 파트너·플레이어 양측이 공유하는 유일한 컬렉션**이며, 위 24종 표에는 넣지 않았다. **파생값이며 진실의 원천이 아니다** — 원장 컬렉션이 여전히 유일한 진실이다. 현재 쓰기만 되고 읽히지 않는다.
- **5개 흐름이 Firestore 트랜잭션으로 원자화됐다** — `approveDeposit` · `rejectDeposit` · `processPayment`(`partner-admin/app.js:890`·`:912`·`:1289`·`:1668`) · `submitRoundCancel` · `playerSignup`(`shared/game-engine.js:82`). 이전에는 "상태 확인 후 갱신"이 두 개의 분리된 쓰기라 동시 승인이 통과했다.
  - **이 트랜잭션들이 지키는 것은 요청 문서의 `status` 필드이지 잔액이 아니다.** 케이지 측 원장 쓰기 경로(`writeLedgerEntry` · `applyAccountTransaction`)는 여전히 트랜잭션이 아니다.
- **`memberLedger` 쓰기가 한 함수로 모였다** — `shared/cage-ui.js`의 `writeMemberLedgerEntry()`. 새 쓰기 지점이 잔액 증분을 빠뜨리기 어렵게 만드는 조치다. **호출 지점은 9곳이다**(13-2절 표). 데모 시드만 예외로 남았다.

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
| `subscribeStaffCloud` | `index.html:4338` | `staff` |
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

`fbDb`가 없으면 모든 write 함수가 `localStorage`에 쓰는 분기를 탄다. `seedDB()`가 데모 계좌 8개와 직원 6명을 생성한다 (`index.html:5777-5790`).

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
| 12 | *(초판 미기재)* | **2026-08-15 신규 기록.** 자금 이력 두 종(롤링 커미션 정산 `DB.settled` §7-0 · 이벤트 커미션 `DB.eventHistory` §7-4)과 잔액 한 종(케이지 포인트 §3-1)이 **`localStorage` 전용** | 실자금 이력이 단말에만 존재 — 정본 판별 불가 |
| 13 | *(초판 미기재)* | **2026-08-15 신규 기록.** 계좌 해지가 해당 계좌의 Firestore `ledger` 문서를 **전량 물리 삭제**하고 상대 계정 미러는 남긴다 (§3-4) | append-only 원장에 삭제 경로 + 복식부기 파손 |
| 14 | *(초판 미기재)* | **2026-08-15 신규 기록.** 계좌 차단 해제가 `splice` 삭제 (§3-3), 포인트 발행·차단 조작에 재인증 없음 (§3-1·§3-3) | 감사 대상 조작에 감사 흔적 없음 |

1~7은 **Firestore의 엔진 제약**이라 애플리케이션 수정으로 해결되지 않는다. 8~11은 설계 문제이며 이전과 함께 해소한다. **12~14는 6차 검토가 찾아낸 것으로, 초판이 서술하지 않아 이전 계획에 잡히지 않았던 항목이다** — 12는 [07-migration.md](07-migration.md)의 이관 대상 목록(`DR-71`), 13·14는 목표 설계의 조작 경로 정의를 요구한다.

> **Track A가 바꾼 것을 정확히 읽어라.** 완전히 닫힌 항목은 **하나도 없다.** 5번이 가장 가깝지만 멱등성 문제의 절반(재시도 중복)은 남았고, 3·6·9·11번은 "가장 값싼 실패 모드만 막고 근본 원인은 그대로"인 상태다.
>
> 이것은 Track A의 실패가 아니라 **설계된 범위**다. 애플리케이션 계층에서 닫을 수 있는 것에는 한계가 있고, 그 한계선이 정확히 이 표다. **1~7번을 실제로 닫는 유일한 방법은 여전히 이전이다.**

---

**다음:** [02. 목표 아키텍처](02-target-architecture.md)
