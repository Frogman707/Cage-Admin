# 레퍼런스 — `avatar/app.js` (Avatar + Speed 통합 앱)

> **분류**: Reference (정보 지향)
> **대상 파일**: [`avatar/app.js`](../../avatar/app.js) (1,202줄) · [`avatar/index.html`](../../avatar/index.html) (241줄)
> **관련 문서**: [처리 흐름](explanation-round-flow.md) · [엔진 레퍼런스](reference-game-engine.md)

하나의 로그인·세션·보유금으로 두 게임 모드를 제공하는 플레이어 사이트입니다.

- **아바타 (AVATAR)** — 대리 베팅. 회원이 테이블별로 아바타를 신청하고, 파트너 어드민에서 담당
  직원이 배정되면 그때부터 매 라운드 저장된 지시대로 자동 베팅됩니다.
- **스피드 (SPEED)** — 셀프 서비스. 여러 테이블이 동시에 돌아가며 라운드 주기가 짧습니다.

`/speed/`는 [`speed/index.html`](../../speed/index.html)이 `../avatar/?mode=speed`로 리다이렉트하는
호환 경로일 뿐, 별도 앱이 아닙니다.

---

## 상수

```js
const AVATAR_BETTING_SECONDS = 30, AVATAR_DEALING_SECONDS = 4, AVATAR_RESULT_SECONDS = 5;  // 총 39초
const SPEED_BETTING_SECONDS  = 15, SPEED_DEALING_SECONDS  = 3, SPEED_RESULT_SECONDS  = 3;  // 총 21초
const LOBBY_CASINOS = ['HANN','NUSTAR','SOLAIRE'];
const GAME_TYPE_TABS = [
  {id:'all', label:'allGameTypes'}, {id:'avatar', label:'gameTypeAvatar'},
  {id:'speed', label:'gameTypeSpeed'}, {id:'hyper', label:'gameTypeHyper'},
  {id:'dragontiger', label:'gameTypeDragonTiger'},
];
```

`hyper`와 `dragontiger` 탭은 클릭하면 "준비 중" 토스트만 띄웁니다 (구현 없음).

> 로비 카지노 탭(`HANN`/`NUSTAR`/`SOLAIRE`)과 회원가입 카지노 선택
> ([`avatar/index.html:117`](../../avatar/index.html#L117): `NUSTAR`/`HANN`/`ONLINE`)의 목록이
> 서로 다릅니다 — [G-08](explanation-known-gaps.md#g-08--카지노-목록이-화면마다-다르다) 참고.

---

## 전역 상태

앱 상태는 모듈 전역에 나뉘어 있습니다. 상태 관리 라이브러리는 없습니다.

### `db` · `MODE`

```js
let db = null;                 // cageInitFirebase() 반환값
let MODE = null;               // 'avatar' | 'speed' | null (게임 선택 화면)
```

### `STATE` — 계정 공통 상태

```js
let STATE = { balance: 0, points: 0, selectedChip: CHIP_VALUES[0] };
```

두 모드가 공유합니다. `balance`/`points`는 `refreshBalance()`가 Firestore에서 다시 계산해 채우고,
그 사이 베팅·정산은 로컬에서 가감산합니다.

### `MY_BET_LOG` — 베팅 로그 (메모리 전용)

```js
let MY_BET_LOG = [];  // 최신순
// 항목: {tableName, roundNo, betType, amount, payout, mode:'avatar'|'speed', dt:ISO문자열}
```

**Firestore에 저장되지 않습니다.** 로그아웃(`onLogout`) 또는 새로고침 시 사라집니다. "게임기록"
모달과 "내 베팅내역" 패널이 이 배열만 읽습니다 —
[G-07](explanation-known-gaps.md#g-07--게임기록이-메모리에만-존재한다) 참고.

### `AVATAR` — 아바타 모드 상태

```js
let AVATAR = {
  table: null,            // {id, name, casino, betMin, betMax, shoeNo, ...}
  phase: 'idle',          // 'betting' | 'dealing' | 'result'
  secondsLeft: 0,
  roundNo: 1,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  history: [],            // 'player'|'banker'|'tie' 배열, 오래된 것부터
  pairFlags: [],          // {playerPair,bankerPair} 배열, history와 같은 인덱스
  currentRoundId: null,   // 이번 라운드 베팅에 붙일 UUID
  timerHandle: null,      // setInterval 핸들
  chatUnsub: null,        // onSnapshot 해제 함수
  lobbyData: null,        // {tables, rounds, bets}
  myRequests: [],         // 내 avatarRequests
  allRequests: [],        // 전체 avatarRequests (혼잡도 계산용)
  request: null,          // 현재 진행중인 내 요청
  tipTotals: {avatar:0, dealer:0},
  previewTableId: null,   // 미리보기 중인 테이블 (동적 추가)
  _sim: null,             // 이번 라운드 simulateRound() 결과 (동적 추가)
};
```

### `SPEED` — 스피드 모드 상태

```js
let SPEED = {
  tables: {},        // tableId → 테이블 문서
  tstate: {},        // tableId → 테이블별 라운드 상태 (아래)
  allBets: [],       // memberLedger category:'bet' 전량 (통계용)
  tick: null,        // 전 테이블 공용 setInterval 핸들
  detailTableId: null,  // 상세 화면으로 열려 있는 테이블
};

// SPEED.tstate[tableId]
{
  phase: 'betting'|'dealing'|'result',
  secondsLeft: number,
  roundNo: number,
  bets: {player:0, banker:0, tie:0, playerPair:0, bankerPair:0},
  lastBets: {...},        // '반복' 버튼용, 직전 라운드에 베팅이 있었을 때만 저장
  currentRoundId: string,
  history: [], pairFlags: [],
  _sim: null,
}
```

### 임시 상태

```js
let SIGNUP_CODE = null;      // 데모 SMS 인증번호 (평문, 화면에 그대로 노출)
let SIGNUP_VERIFIED = false;
let AVATAR_PENDING_TABLE = null;   // 아바타 신청 모달이 대상으로 잡은 테이블
let LOBBY_CASINO_FILTER = 'ALL';
let LOBBY_SEARCH = '';
```

---

## 뷰 구조

`avatar/index.html`에 5개의 뷰 컨테이너가 있고, `showView(name)`이 하나만 `display:block`으로
남깁니다.

| 뷰 ID | 내용 | HTML 출처 |
| --- | --- | --- |
| `viewPicker` | 게임 선택 (아바타 / 스피드 카드 2장) | 정적 HTML |
| `viewAvatarLobby` | 아바타 테이블 목록 | `goAvatarLobby()`가 주입 |
| `viewAvatarTable` | 아바타 테이블 (미리보기 또는 진행중 세션) | `avatarPreviewShellHtml()` / `avatarTableShellHtml()` |
| `viewSpeedLobby` | 스피드 테이블 타일 그리드 | 정적 뼈대 + `loadSpeedTables()`가 그리드 주입 |
| `viewSpeedTable` | 스피드 단일 테이블 상세 | `speedDetailShellHtml()` |

`showView`가 함께 처리하는 헤더 버튼 표시 규칙:

| 요소 | 표시 조건 |
| --- | --- |
| `#changeGameBtn` (게임 변경) | `viewPicker`가 **아닐** 때 |
| `#avatarLobbyBtn` (테이블 목록) | `viewAvatarTable`일 때만 |
| `#chipTray` (하단 고정 칩 트레이) | `viewSpeedLobby`일 때만 |

로그인 게이트(`#login-gate`)와 앱 셸(`#app`)은 `showView` 밖에서 직접 토글됩니다.

---

## 부팅과 인증

### `DOMContentLoaded` 핸들러 ([`avatar/app.js:25`](../../avatar/app.js#L25))

1. `db = cageInitFirebase()` — Firebase 초기화, 롱폴링 강제, IndexedDB 영속성 활성화
2. 비밀번호 입력창에 Enter 키 핸들러 바인딩
3. 언어 선택기 렌더링
4. `clearLoginFields()` 즉시 1회 + **350ms 후 1회 더**

브라우저 자동완성은 페인트 이후 비동기로 값을 채우므로 로드 시 한 번 지우는 것으로는 부족합니다.
`pageshow` 이벤트에도 같은 함수를 걸어, bfcache 복원(뒤로가기)으로 `DOMContentLoaded` 없이
자동완성이 다시 적용되는 경우까지 막습니다.

### `onLogin()`

ID/PW를 읽어 `playerLogin()`을 호출하고, 실패 사유별 i18n 메시지를 표시합니다.

| `reason` | i18n 키 |
| --- | --- |
| `notfound` | `loginErrNotfound` |
| `blocked` | `loginErrBlocked` |
| `badpw` (기타) | `loginErrBadPw` |

성공하면 `enterApp()`.

### 회원가입 함수들

| 함수 | 동작 |
| --- | --- |
| `genSignupId()` | ID = `'SE' + 6자리 난수`, PW = `Math.random().toString(36).slice(2,8).toUpperCase()` |
| `sendSignupCode()` | 6자리 난수를 `SIGNUP_CODE`에 저장하고 **화면과 토스트에 그대로 표시**. 실제 SMS 발송 없음 |
| `verifySignupCode()` | 입력값과 `SIGNUP_CODE` 비교 → `SIGNUP_VERIFIED` |
| `onSignup()` | 검증 후 `playerSignup()` 호출 |

`genSignupId`의 PW는 base36 문자열을 자르므로 **6자보다 짧을 수 있습니다** (소수부가 짧게 나오는
경우).

`onSignup()`의 검증 순서:

1. `id`와 `pw`가 있는가 → 없으면 `suErrGenId` ("ID를 먼저 생성해 주세요")
2. `SIGNUP_VERIFIED`인가 → 아니면 `suErrVerify`
3. `nickname`과 `telegram`이 있는가 → 없으면 `suErrRequired`
4. `playerSignup()` 결과가 `{ok:false}`면 `suErrDup`

`phone`은 인증번호 발송에는 필요하지만 최종 제출 시 별도로 검사하지 않습니다.

### `enterApp()`

```
로그인 게이트 숨김 → 앱 표시 → 언어 선택기 · 닉네임 헤더 → 입력 필드 정리
→ await refreshBalance()
→ URLSearchParams(location.search).get('mode')
     'speed'  → chooseSpeed()
     'avatar' → chooseAvatar()
     그 외    → showPicker()
```

`?mode=` 쿼리 파라미터가 `/speed/` 리다이렉트의 진입점입니다.

### `onLogout()`

`stopAllLoops()` → `PLAYER = null`, `MODE = null`, `MY_BET_LOG = []` → 게이트 복귀 →
`clearLoginFields()`. Firestore 세션이 없으므로 서버 측 정리는 없습니다.

### `refreshBalance()` / `refreshPointsQuiet()`

| 함수 | 갱신 대상 | 호출 시점 |
| --- | --- | --- |
| `refreshBalance()` | `STATE.balance`, `STATE.points` + 헤더 양쪽 | `enterApp()`에서 1회 |
| `refreshPointsQuiet()` | `STATE.points`와 포인트 헤더만 | 아바타 결과 단계마다 |

두 함수 모두 `getPlayerBalance()`를 호출하므로 회원의 원장 전량을 다시 내려받습니다.
`refreshPointsQuiet`는 아바타 라운드마다(39초 주기) 실행되지만 **스피드 모드에서는 호출되지
않습니다** — 스피드 플레이 중에는 포인트 표시가 갱신되지 않습니다.

**보유금은 라운드 중 Firestore를 다시 읽지 않고 로컬에서 가감산합니다.** 원장이 진실의 원천이지만
화면 숫자는 세션 내내 로컬 산술로 유지됩니다.

---

## 공용 네비게이션

### `stopAllLoops()`

모드를 바꾸기 전 반드시 호출됩니다.

```js
stopAvatarRoundLoop();                          // AVATAR.timerHandle clearInterval
if (SPEED.tick){ clearInterval(SPEED.tick); }   // 스피드 공용 틱
SPEED.detailTableId = null;
if (AVATAR.chatUnsub){ AVATAR.chatUnsub(); }    // onSnapshot 구독 해제
document.getElementById('viewAvatarTable').innerHTML = '';
document.getElementById('viewSpeedTable').innerHTML = '';
```

마지막 두 줄이 중요합니다. `viewAvatarTable`이 만들어내는 `#myBetHistory`·칩 트레이는
`viewSpeedLobby`의 정적 요소와 **같은 id**를 씁니다. 둘이 동시에 DOM에 있으면
`document.getElementById`가 잘못된 쪽을 잡습니다.

### `chooseAvatar()` / `chooseSpeed()` / `showPicker()`

| 함수 | 동작 |
| --- | --- |
| `showPicker()` | `stopAllLoops()` → `MODE = null` → `viewPicker` |
| `chooseAvatar()` | `stopAllLoops()` → 필터 초기화 → `viewAvatarLobby` → `goAvatarLobby()` |
| `chooseSpeed()` | `stopAllLoops()` → 필터 초기화 → `viewSpeedLobby` → 칩 트레이 → `loadSpeedTables()` → `setInterval(tickAllSpeedTables, 1000)` |

### 로비 필터 (두 모드 공용)

| 함수 | 동작 |
| --- | --- |
| `casinoTabsHtml()` | `ALL` + `LOBBY_CASINOS` 탭 |
| `gameTypeTabsHtml(activeType)` | 5종 게임 타입 탭 |
| `setGameTypeFilter(id)` | `avatar`/`speed`면 모드 전환, `hyper`/`dragontiger`면 준비 중 토스트 |
| `lobbySearchHtml()` | 테이블명 검색 입력 |
| `setLobbyCasinoFilter(c)` / `setLobbySearch(v)` | 전역 갱신 후 `applyLobbyTileFilter()` |
| `applyLobbyTileFilter()` | `.lobby-card[data-casino]` · `.speed-tile[data-casino]`의 `style.display` 토글 |

필터는 **클라이언트 측 표시 토글**입니다. Firestore 재조회 없이 이미 렌더링된 카드만 숨깁니다.

### `onLangChange()`

`shared/i18n.js`의 `setLang()`이 호출하는 훅입니다. 현재 보이는 화면만 골라 다시 그립니다 —
JS로 생성된 텍스트는 `applyI18n()`의 `data-i18n` 스캔으로 갱신되지 않기 때문입니다.

---

## 아바타 모드

### `goAvatarLobby()`

로비 뼈대를 주입한 뒤 **5개 쿼리를 병렬로** 실행합니다
([`avatar/app.js:367-373`](../../avatar/app.js#L367-L373)):

```js
db.collection('tables').where('type','==','avatar').get()
db.collection('rounds').where('tableType','==','avatar').get()
db.collection('memberLedger').where('category','==','bet').get()   // 전 회원의 모든 베팅
db.collection('avatarRequests').where('memberId','==',PLAYER.id).get()
db.collection('avatarRequests').get()                              // 전체
```

모든 쿼리가 **단일 등가 필터**만 씁니다. `orderBy`나 두 번째 `where`를 붙이면 Firestore 복합
인덱스가 필요해지므로, 정렬과 추가 필터링은 전부 클라이언트에서 합니다.

세 번째 쿼리는 `category=='bet'`인 원장 문서를 **전 회원분 모두** 내려받습니다. 테이블별 베팅
총액 통계 하나를 만들기 위한 것이며 데이터가 쌓일수록 비용이 선형 증가합니다.

`tables`는 `status === 'open'`인 것만 클라이언트에서 걸러 씁니다.

### 신청 상태 판정

#### `avatarRequestStateForTable(tableId) → {state, req}`

**내** 요청만 보고 판정합니다 (최신 `requestedAt` 우선):

| `state` | 조건 |
| --- | --- |
| `'active'` | `status === '진행중'`인 요청이 있음 |
| `'pending'` | `status === '대기'`인 요청이 있음 |
| `'full'` | `status === '종료'`이면서 `requestedAt`이 **오늘**인 요청이 있음 |
| `'none'` | 그 외 |

`'full'`은 "오늘 이 테이블에서 이미 한 번 세션을 썼다"는 뜻으로, 같은 날 재신청을 막습니다.

#### `avatarTableOccupancy(tableId) → {activeOther, todayCount}`

**전체** 요청을 보고 테이블 혼잡도를 계산합니다.

| 필드 | 계산 |
| --- | --- |
| `activeOther` | 나 아닌 회원의 `진행중` 요청이 있는가 |
| `todayCount` | 오늘 `requestedAt`이면서 `진행중` 또는 `종료`인 요청 수 |

#### `avatarThumbOverlayHtml(tableId)` — 카드 썸네일 오버레이

우선순위 순서대로 판정합니다:

| 조건 | 오버레이 |
| --- | --- |
| 내 상태 `active` | ↩ 재입장 |
| 내 상태 `pending` | ⏳ 승인 대기 |
| `todayCount >= 3` | ✏️ 금일 예약 완료 (하단 바) |
| `activeOther` | 🎥 관전 |
| 그 외 | 🎭 아바타 신청 |

> "관전" 오버레이가 떠도 클릭하면 실제로는 **읽기 전용 미리보기**로 갑니다. 다른 회원의 진행중
> 세션을 실시간으로 보는 기능은 없습니다.

#### `handleAvatarCardClick(tableId)`

`state === 'active'` → `enterAvatarSession(tableId)`, 그 외 →
`openAvatarTablePreview(tableId, state)`. 카드 클릭이 항상 테이블을 열며, 신청 액션은 테이블 안에
있습니다.

### `renderAvatarLobbyGrid(sortMode)`

테이블마다 결과·승수·연속·베팅액을 계산해 카드를 렌더링합니다.

| `sortMode` | 정렬 키 |
| --- | --- |
| `'popular'` (기본) | `volume.total` 내림차순 |
| `'today'` | `volume.today` 내림차순 |
| `'hot'` | `streak.len` 내림차순 |
| `'name'` | `t.name` 로케일 오름차순 |

카드 구성: 썸네일(배지·즐겨찾기·펠트·오버레이·핫배지) → 이름/카지노/한도 → 미니 빅로드
(최근 40개, 4행) → P/B/T 승수 + 오늘 베팅액.

핫 배지는 `streak.len >= 3`일 때 표시됩니다.

### 아바타 신청

| 함수 | 동작 |
| --- | --- |
| `openAvatarRequestModal(tableId)` | 폼 초기화, `reqSide` 기본값 `'banker'` |
| `submitAvatarRequest()` | `avatarRequests` 문서 생성 → 모달 닫기 → 로비 재로드 |

생성되는 `avatarRequests/{uuid}`:

```js
{
  memberId, tableId, casino,      // casino는 테이블 것, 없으면 회원 소속
  buyin, betSide, betAmount,
  status: '대기', avatarStaffId: null,
  requestedAt: '2026-08-12T04:31:00.000Z', approvedAt: null, endedAt: null
}
```

`buyin`(바이인)은 **기록만 되고 보유금에서 차감되지 않습니다.** 어떤 코드도 이 값을 원장에
반영하지 않습니다 —
[G-09](explanation-known-gaps.md#g-09--아바타-바이인이-보유금에-반영되지-않는다) 참고.

`buyin`과 `betAmount`가 모두 truthy여야 제출됩니다. 테이블 한도(`betMin`/`betMax`)와 대조하지
않습니다.

### `openAvatarTablePreview(tableId, state)` — 읽기 전용 미리보기

승인 전에도 테이블 내부를 볼 수 있게 하는 화면입니다.

1. `AVATAR.request = null`, `AVATAR.previewTableId = tableId`
2. `tables/{tableId}` 문서 로드
3. `rounds where tableId == tableId` 로드 → `startedAt` 오름차순 정렬 → `history`/`pairFlags` 구성
4. `avatarPreviewShellHtml(state)` 렌더 → 로드맵·집계 렌더

라운드 루프를 시작하지 않고 채팅도 붙이지 않습니다. 우측 패널은 상태에 따라 다릅니다:

| `state` | 우측 패널 |
| --- | --- |
| `'pending'` | 비활성 "승인 대기" 버튼 |
| `'full'` | 비활성 "금일 예약 완료" 버튼 |
| 그 외 | 활성 "아바타 신청" 버튼 → `openAvatarRequestModal` |

> 3번 쿼리는 `tableType`을 조건에 넣지 않으므로 같은 `tableId`를 가진 스피드 라운드가 있다면 함께
> 섞입니다. 실무상 테이블 ID는 타입별로 유일하므로 문제되지 않습니다.

### `enterAvatarSession(tableId)` — 승인된 세션 진입

```
avatarRequestStateForTable()로 req 확보 (없으면 토스트 후 중단)
→ AVATAR.request = req
→ 로딩 스피너 표시
→ tables/{tableId} 로드
→ rounds where tableId 로드 → history / pairFlags / roundNo = max(roundNo)+1
→ refreshTipTotals()
→ avatarTableShellHtml() 렌더
→ 로드맵 · 집계 · 베팅내역 · 상태 패널 렌더
→ mountAvatarChat(tableId)
→ startAvatarRoundLoop()
```

### `refreshTipTotals()`

```js
const snap = await db.collection('memberLedger').where('memberId','==',PLAYER.id).get();
// relatedRequestId === AVATAR.request.id 인 것만 클라이언트에서 필터
// category 'avatar_tip' → tipTotals.avatar, 'dealer_tip' → tipTotals.dealer (절댓값 합)
```

여기서도 단일 등가 필터만 쓰고 나머지는 클라이언트 필터입니다.

### `updateAvatarStatusPanel()`

`#avatarStatusGrid`에 4행을 그립니다: 담당 아바타(`avatarStaffId` 또는 "미배정"), 내 지시
(`betSide` + `betAmount`), 아바타 팁 합계, 딜러 팁 합계.

### 팁 · 슈 체인지 · 세션 종료

#### `submitTip()`

```js
if (amount > STATE.balance){ toast(insufficientBalance, true); return; }
await writeMemberLedgerEntry(db, {
  memberId, casino, amount: -amount,
  category: target==='avatar' ? 'avatar_tip' : 'dealer_tip',
  relatedRequestId: AVATAR.request.id, relatedTableId: AVATAR.table.id,
  staff: 'member', createdAt: serverTimestamp(), clientCreatedAt, deviceId
});
STATE.balance -= amount;  // 로컬 반영
```

`avatar_tip`/`dealer_tip` 모두 `getPlayerBalance`의 포인트 카테고리가 아니므로 **보유금에서
차감**됩니다. 잔액 검사가 있는 유일한 아바타 모드 자금 이동입니다.

#### `requestShoeChange()`

```js
await db.collection('avatarServiceRequests').doc(uuidv4()).set({
  requestId, tableId, memberId, type: 'shoe_change', dt: '2026-08-12T04:31:00.000Z'
});
```

> **이 컬렉션을 읽는 코드가 저장소 어디에도 없습니다.** 파트너 어드민에 화면이 없어 요청이
> 운영자에게 전달되지 않습니다 —
> [G-10](explanation-known-gaps.md#g-10--avatarservicerequests에-소비자가-없다) 참고.

#### `endAvatarSession()`

`avatarRequests/{id}`에 `{status:'종료', endedAt}`을 `merge`로 기록하고 로비로 돌아갑니다.

### 라운드 루프

```
startAvatarRoundLoop()
  → beginAvatarBettingPhase()
  → setInterval(avatarTick, 1000)
```

`avatarTick()`은 매초 `secondsLeft`를 1 줄이고 단계별로 분기합니다:

| 현재 단계 | 매초 동작 | 전이 조건 |
| --- | --- | --- |
| `betting` | 타이머 링 갱신 | `secondsLeft <= 0` → `beginAvatarDealingPhase()` |
| `dealing` | (링 갱신 없음) | `secondsLeft <= 0` → `beginAvatarResultPhase()` |
| `result` | 타이머 링 갱신 | `secondsLeft <= 0` → `beginAvatarBettingPhase()` |

#### `beginAvatarBettingPhase()` — 30초

```js
AVATAR.phase = 'betting';
AVATAR.secondsLeft = 30;
AVATAR.currentRoundId = uuidv4();                        // 이번 라운드 베팅 ID
AVATAR.bets = {player:0, banker:0, tie:0, playerPair:0, bankerPair:0};
AVATAR.bets[AVATAR.request.betSide] = AVATAR.request.betAmount;   // ← 자동 베팅 확정
// 배너 갱신, 카드/점수 영역 비움
```

베팅 단계 **시작 시점에** 저장된 지시가 그대로 베팅 슬롯에 채워집니다. 회원이 이 화면에서 금액이나
방향을 바꿀 수단은 없습니다.

#### `beginAvatarDealingPhase()` — 4초

```js
AVATAR.phase = 'dealing'; AVATAR.secondsLeft = 4;
for (const [betType, amount] of Object.entries(AVATAR.bets)){
  if (amount > 0) await placeBet(db, {..., staff:'avatar'});     // Firestore 쓰기
}
if (avatarTotalBet() > 0){
  STATE.balance -= avatarTotalBet();   // 로컬 차감 — 잔액 검사 없음
  // 헤더 갱신 + "아바타가 베팅했습니다" 토스트
}
AVATAR._sim = simulateRound();
await revealAvatarCards(AVATAR._sim);  // 260ms × 4 = 약 1.04초
```

`staff: 'avatar'`가 이 베팅이 대리 실행되었음을 원장에 남기는 유일한 표시입니다.

**잔액 검사가 없습니다.** 보유금이 지시 금액보다 적어도 그대로 베팅되며 `STATE.balance`가 음수로
갈 수 있습니다 —
[G-03](explanation-known-gaps.md#g-03--아바타-자동베팅은-잔액을-확인하지-않는다) 참고.

#### `revealAvatarCards(sim)`

P1 → B1 → P2 → B2 순서로 260ms 간격으로 카드 DOM을 추가한 뒤 점수를 표시합니다.
`cardHtml(card)`는 `♥`/`♦`이면 `red`, 아니면 `black` 클래스를 붙이고 `data-rank`에 `랭크+무늬`를
넣습니다 (랭크 글자는 CSS가 `data-rank`로 그립니다).

#### `beginAvatarResultPhase()` — 5초

```js
AVATAR.phase = 'result'; AVATAR.secondsLeft = 5;
// 배너: 플레이어 승 / 뱅커 승 / 타이

for (const [betType, amount] of Object.entries(AVATAR.bets)){
  if (amount <= 0) continue;
  const payout = await settleBet(db, {...});               // Firestore 쓰기 (payout>0일 때만)
  totalPayout += payout;
  MY_BET_LOG.unshift({tableName, roundNo, betType, amount, payout, mode:'avatar', dt});
}
if (totalPayout > 0){ STATE.balance += totalPayout; /* 당첨 토스트 */ }
// 헤더 갱신
refreshPointsQuiet();                                       // await 없음 (fire-and-forget)

await writeRoundDoc(db, {                                   // Firestore 쓰기
  tableId, tableType:'avatar', roundNo, shoeNo,
  sim, startedAt: new Date(Date.now() - (30+4)*1000).toISOString()
});
AVATAR.history.push(sim.result);
AVATAR.pairFlags.push({playerPair, bankerPair});
AVATAR.roundNo++;
// 로드맵 · 집계 · 베팅내역 재렌더
```

라운드 1회당 Firestore 쓰기: 베팅 1건(배치 2문서) + 배당 최대 1건(배치 2문서) + 라운드 1문서.

### 채팅

#### `mountAvatarChat(tableId)`

```js
AVATAR.chatUnsub = db.collection('chatMessages')
  .where('tableId','==',tableId).limit(200)
  .onSnapshot(snap => {
    const msgs = snap.docs.map(d=>d.data())
      .sort((a,b)=> new Date(a.dt) - new Date(b.dt))   // 클라이언트 정렬
      .slice(-30);
    // 렌더 + 스크롤 하단 고정
  }, err => { /* "대화 없음" 표시 */ });
```

`orderBy` 없이 `limit(200)`을 쓰므로 **최신 200개가 아니라 임의의 200개**가 옵니다. 메시지가
200개를 넘는 테이블에서는 최신 메시지가 누락될 수 있습니다 —
[G-11](explanation-known-gaps.md#g-11--채팅-쿼리가-orderby-없이-limit200을-쓴다) 참고.

`sendAvatarChat()`은 `{tableId, memberId, nickname, text, dt}` 문서를 씁니다. 금지어 필터
(`bannedWords` 컬렉션)는 적용되지 않습니다. 렌더링 시 `escapeHtml()`로 닉네임과 본문을
이스케이프합니다.

---

## 스피드 모드

### `loadSpeedTables()`

3개 쿼리를 병렬 실행합니다 (아바타 로비와 같은 단일 등가 필터 원칙):

```js
db.collection('tables').where('type','==','speed').get()
db.collection('rounds').where('tableType','==','speed').get()
db.collection('memberLedger').where('category','==','bet').get()
```

테이블마다 `SPEED.tstate[id]`를 초기화합니다. 시작 타이머가 **어긋나게** 설정됩니다:

```js
secondsLeft: SPEED_BETTING_SECONDS - (Object.keys(SPEED.tstate).length * 3) % SPEED_BETTING_SECONDS
```

| 테이블 순서 | 초기 `secondsLeft` |
| --- | --- |
| 0번째 | 15 |
| 1번째 | 12 |
| 2번째 | 9 |
| 3번째 | 6 |
| 4번째 | 3 |
| 5번째 | 15 (주기 반복) |

모든 테이블이 동시에 결과를 뱉지 않게 3초씩 밀어 실제 카지노 플로어처럼 보이게 하는 장치입니다.

`roundNo`는 기존 라운드 최댓값 + 1, `history`/`pairFlags`는 `startedAt` 오름차순 정렬로 구성합니다.

### 타일 (`speedTileHtml`)

| 영역 | 내용 |
| --- | --- |
| `head` | 테이블명 · `SHOE #{n} · {카지노}` |
| `#hotbadge-{id}` | 🔥 연속 배지 (3연속 이상) |
| `.speed-mini-stage` | 단계 텍스트 + 우상단 타이머 + (결과 시) `P{n} : B{n}` |
| 열기 버튼 | `openSpeedTableDetail(tableId)` |
| `.speed-bets` | P(1:1) · T(8:1) · B(.95:1) 3개 스팟 — **페어는 타일에 없음** |
| `.speed-mini-road` | 최근 40개, 4행 빅로드 |
| `.speed-tile-stats` | P/B/T 승수 + 오늘 베팅액 |

타일 전체가 클릭 가능하며(상세 열기), 베팅 스팟은 `event.stopPropagation()`으로 버블링을 막습니다.

### `placeSpeedBet(tableId, type)`

```js
if (!s || s.phase !== 'betting'){ toast(notBettingTime, true); return; }
let locked = 0;
Object.values(SPEED.tstate).forEach(x => locked += Object.values(x.bets).reduce((a,b)=>a+b,0));
if (STATE.balance - locked < STATE.selectedChip){ toast(insufficientBalance, true); return; }
s.bets[type] += STATE.selectedChip;
// 스팟에 selected 클래스 → 금액 표시 갱신 → projectSpeedBalance()
```

- 베팅 단계에서만 받습니다.
- `locked`는 **전 테이블의 미확정 베팅 합계**입니다. 3개 테이블에 동시에 걸어도 총액이 보유금을
  넘지 않습니다.
- **테이블 한도(`betMin`/`betMax`)는 검사하지 않습니다.**
- 이 시점에는 Firestore에 아무것도 쓰지 않습니다. 실제 쓰기는 딜링 단계에 일어납니다.

### 상세 화면 (`speedDetailShellHtml`)

타일보다 넓은 5개 베팅 스팟을 제공합니다:

| 행 | 스팟 |
| --- | --- |
| 상단 | 플레이어 페어 (11:1) · 타이 (8:1) · 뱅커 페어 (11:1) |
| 하단 | 플레이어 (1:1) · 뱅커 (0.95:1) |

칩 트레이 버튼:

| 버튼 | 함수 | 동작 |
| --- | --- | --- |
| 취소 | `clearSpeedDetailBets(tableId)` | 베팅 단계에서만 모든 스팟 0으로 |
| 칩 6종 | `selectChip(v)` | `STATE.selectedChip` 변경 |
| 베팅완료 | `confirmSpeedBetDetail()` | **토스트만 띄웁니다.** 베팅은 스팟 클릭 시 이미 반영됨 |
| 반복 | `repeatLastSpeedBetDetail(tableId)` | `s.lastBets`를 현재 베팅에 더함 |

> "베팅완료" 버튼은 확정 동작이 없는 장식입니다 —
> [G-12](explanation-known-gaps.md#g-12--베팅완료-버튼이-아무것도-확정하지-않는다) 참고.

`repeatLastSpeedBetDetail`은 직전 라운드에 베팅이 있었을 때만 동작하며(`beginSpeedBetting`이
`lastBets`를 저장), 전 테이블 `locked` 기준 잔액 검사를 통과해야 합니다.

`openSpeedTableDetail(tableId, preserveScroll)`은 상세를 열면서 현재 단계에 맞춰 스팟의
`selected`/`locked` 클래스를 복원하고, 결과 단계면 `revealSpeedDetailCards(s._sim, true)`로 카드를
즉시(애니메이션 없이) 표시합니다.

### `projectSpeedBalance()`

```js
document.getElementById('hdrBalance').textContent = fmtNum(STATE.balance - locked);
```

헤더에 "미확정 베팅을 뺀 사용 가능 금액"을 보여줍니다. 단 한 테이블이 딜링/결과 단계로 넘어가
`STATE.balance`에서 이미 차감된 뒤에도 그 테이블의 `s.bets`는 다음 베팅 단계까지 0이 되지 않으므로,
그 사이 다른 테이블에서 베팅하면 같은 금액이 두 번 빠진 값이 표시됩니다 (표시만, 실제 원장은 정상).

### 전 테이블 틱 (`tickAllSpeedTables`)

`chooseSpeed()`가 건 **하나의 1초 인터벌**이 모든 테이블 상태를 순회합니다. 테이블마다 타이머를
따로 두지 않습니다.

```js
for (const tableId of Object.keys(SPEED.tstate)){
  const s = SPEED.tstate[tableId];
  s.secondsLeft--;
  if (s.phase==='betting'){ /* 타이머 갱신 */ if (s.secondsLeft<=0) await beginSpeedDealing(tableId); }
  else if (s.phase==='dealing'){ if (s.secondsLeft<=0) await beginSpeedResult(tableId); }
  else if (s.phase==='result'){ /* 타이머 갱신 */ if (s.secondsLeft<=0) beginSpeedBetting(tableId); }
}
```

루프 본문이 `await`를 포함하므로, 한 테이블의 Firestore 쓰기가 느리면 **뒤 테이블들의 카운트다운이
함께 밀립니다.** 콜백이 1초 안에 끝나지 않으면 다음 틱과 겹칠 수도 있습니다.

#### `beginSpeedBetting(tableId)` — 15초

직전 라운드에 베팅이 있었으면 `s.lastBets = {...s.bets}`로 보관한 뒤 초기화합니다. 스팟의
`selected`/`locked` 클래스를 제거하고, 미니 스테이지의 점수 텍스트와 상세 화면 카드를 지웁니다.

#### `beginSpeedDealing(tableId)` — 3초

스팟 잠금 → `placeBet(staff:'system')` 반복 → `STATE.balance -= totalBet` →
`simulateRound()` → 상세 화면이 열려 있으면 카드 애니메이션.

아바타 모드와 달리 `staff`가 `'system'`입니다 (대리 베팅이 아니므로).

#### `beginSpeedResult(tableId)` — 3초

```js
setSpeedTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : ... );  // ← 하드코딩 영문
// 미니 스테이지에 "P{n} : B{n}" 추가
// 베팅별 settleBet() → MY_BET_LOG.unshift → SPEED.allBets.push (로컬 통계 즉시 반영)
// 당첨 토스트 (테이블명 접두)
// writeRoundDoc(startedAt = now - (15+3)초)
// history/pairFlags push, roundNo++
// 타일 로드맵 · 통계 재렌더
```

단계 배너 문자열 `'PLAYER WIN'`/`'BANKER WIN'`/`'TIE'`는 i18n을 거치지 않고 하드코딩되어 있습니다
(아바타 모드는 `t('phasePlayerWin')` 등을 사용).

`refreshPointsQuiet()`를 호출하지 않으므로 스피드 플레이 중 포인트 표시는 갱신되지 않습니다.

---

## 게임기록 · 베팅내역

| 함수 | 대상 | 동작 |
| --- | --- | --- |
| `renderMyBetHistory()` | `#myBetHistory` | `MY_BET_LOG` 최신 20건. 손익 = `payout - amount`, 0이면 "푸시" |
| `openGameHistory()` | `#modal-history` | 활성 탭 기준으로 렌더 후 모달 열기 |
| `renderGameHistory(btn, mode)` | `#historyBody` | `MY_BET_LOG`를 `mode`로 거른 뒤 **날짜별 그룹**. 그룹 헤더에 일별 베팅액 합계와 손익 합계 |

두 함수 모두 `MY_BET_LOG`(메모리)만 읽습니다. Firestore의 `memberLedger`를 조회하지 않으므로
새로고침하면 비어 있습니다.

---

## DOM ID 계약

`avatarScoreboardHtml(idSuffix)`가 아바타 화면과 스피드 상세 화면 양쪽의 스코어보드를 생성합니다.
`idSuffix`는 `'avatar'` 또는 `'detail'`이며, 두 뷰가 동시에 마운트되지 않는다는 전제로 id 충돌을
피합니다.

| ID 패턴 | 내용 |
| --- | --- |
| `tallycount-{suffix}` | 현재 라운드 번호 (`#12`) |
| `tallylist-{suffix}` | P/B/T 승수 + 플레이어/뱅커 페어 횟수 5행 |
| `beadroad-{suffix}` | 비드 플레이트 |
| `road-{suffix}` | 빅로드 |
| `bigeye-{suffix}` | 대안목 |
| `smallroad-{suffix}` | 소로 |
| `cockroach-{suffix}` | 갑충로 |

스피드 타일/상세의 동적 ID:

| 패턴 | 내용 |
| --- | --- |
| `tile-{tableId}` · `stage-{tableId}` | 타일 컨테이너 · 미니 스테이지 |
| `phase-{tableId}` · `timer-{tableId}` | 단계 텍스트 · 타이머 |
| `spot-{tableId}-{betType}` · `mybet-{tableId}-{betType}` | 타일 베팅 스팟 · 금액 |
| `spot-detail-{betType}` · `mybet-detail-{betType}` | 상세 화면 스팟 · 금액 |
| `road-{tableId}` · `stats-{tableId}` · `hotbadge-{tableId}` | 미니 로드 · 통계 · 핫 배지 |

> `road-{tableId}`와 `road-avatar`/`road-detail`은 같은 접두사를 씁니다. `tableId`가 `'avatar'`나
> `'detail'`인 테이블을 만들면 충돌합니다.

### 로드맵 렌더링 창(window) 크기

| 화면 | 빅로드 입력 | 행 수 | 비드 플레이트 |
| --- | --- | --- | --- |
| 로비 카드 | 최근 40개 | 4 | 없음 |
| 스피드 타일 | 최근 40개 | 4 | 없음 |
| 아바타 테이블 / 스피드 상세 | 최근 90개 | 6 | **전체** (슬라이스 없음) |

비드 플레이트만 전체를 그리고 가로 스크롤을 끝으로 보냅니다. 뒷부분만 잘라내면 새 라운드마다 모든
비드가 한 칸씩 밀려 보이기 때문입니다.

---

## 부수 UI 함수

| 함수 | 동작 |
| --- | --- |
| `chipLabel(v)` | `>= 1000000` → `{n}M`, `>= 10000` → `{n}만`, 그 외 `{n}천` |
| `selectChip(v)` | `STATE.selectedChip` 갱신 + 모든 `.chip`의 `selected` 토글 |
| `toggleHeaderFavorite()` / `toggleCardFavorite(btn)` | CSS 클래스만 토글. **저장되지 않음** |
| `toggleStageFullscreen(btn)` | `.sd-stage`에 Fullscreen API 적용 |
| `betLabel(type)` | `t(type)` — i18n 키가 베팅 타입과 1:1로 일치 |
| `avatarTotalBet()` | `AVATAR.bets` 값 합계 |
| `cardHtml(card)` | 무늬로 red/black 판정, `data-rank`에 랭크+무늬 |

음소거·화면 전환 아이콘 버튼은 `this.classList.toggle(...)`만 수행하는 시각 토글입니다 (실제 영상
스트림이 없으므로 연결 대상이 없습니다).

---

## 관련 문서

- [처리 흐름 설명](explanation-round-flow.md) — 이 함수들의 실행 순서와 설계 배경
- [엔진 레퍼런스](reference-game-engine.md) — `placeBet` / `settleBet` / 로드 빌더 계약
- [아바타 세션 운영 방법](howto-avatar-session.md) — 신청부터 종료까지 실행 절차
- [알려진 격차](explanation-known-gaps.md) — G-01 ~ G-12
