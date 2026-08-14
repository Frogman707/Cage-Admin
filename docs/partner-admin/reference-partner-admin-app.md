# 레퍼런스 — `partner-admin/app.js`

> **분류**: Reference (정보 지향)
> **대상 파일**: [`partner-admin/app.js`](../../partner-admin/app.js) (1,867줄) · [`partner-admin/index.html`](../../partner-admin/index.html) (132줄)
> **관련 문서**: [앱 구조](explanation-app-structure.md) · [화면 58개](reference-screens.md) · [알려진 격차](explanation-known-gaps.md)

프레임워크·번들러·라우터·빌드 단계가 없는 단일 파일 SPA입니다. `<script src="app.js">` 하나가
로드되고, 모든 함수는 전역 스코프에 놓여 인라인 `onclick` 핸들러에서 직접 호출됩니다.

---

## 부팅 순서

[`partner-admin/index.html:127-130`](../../partner-admin/index.html#L127-L130)의 스크립트 순서가
계약입니다. `cage-ui.js`가 `app.js`보다 먼저 로드되어야 `cageInitFirebase`가 존재합니다.

```html
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<script src="../shared/cage-ui.js"></script>
<script src="app.js"></script>
```

[`DOMContentLoaded`](../../partner-admin/app.js#L149) 핸들러가 하는 일:

| 순서 | 호출 | 효과 |
| --- | --- | --- |
| 1 | `db = cageInitFirebase()` | Firebase 초기화, 오프라인 퍼시스턴스 활성화 |
| 2 | `buildNav()` | 12 그룹 / 58 버튼을 `#navBar`에 렌더 |
| 3 | `setInterval(..., 1000)` | 상단 시계 갱신 |
| 4 | `ensureDefaultStaff()` | `partnerStaff`가 비어 있으면 `admin` / `0000` 생성 |
| 5 | `clearLoginInputs()` | 로그인 입력 비우기 |
| 6 | `setTimeout(clearLoginInputs, 350)` | 브라우저 자동완성이 페인트 후 채우는 값 재제거 |

`pageshow` 이벤트에도 `clearLoginInputs`를 물려, bfcache로 뒤로가기 복원될 때(`DOMContentLoaded`
미발생) 자격증명이 남지 않게 합니다.

---

## 상수

```js
let db = null;                       // Firestore 인스턴스
let CURRENT_STAFF = null;            // 로그인한 직원 문서 {id, pw, name, role}
let CURRENT_VIEW = 'dashboard';      // 현재 화면 id
let CASINO_FILTER = 'ALL';           // 전역 카지노 필터 (UI 노출 없음, 항상 'ALL')
const CASINOS = ['NUSTAR','HANN','ONLINE'];
```

`CASINO_FILTER`를 `'ALL'` 밖으로 바꾸는 UI는 존재하지 않습니다. `mountListView`
([L288](../../partner-admin/app.js#L288))와 `renderAccount`
([L608](../../partner-admin/app.js#L608))가 읽지만, 값이 바뀌는 경로가 없습니다.

| 상수 | 위치 | 내용 |
| --- | --- | --- |
| `ICONS` | [L14](../../partner-admin/app.js#L14) | 인라인 SVG 12종. `ic(name)`이 없는 이름은 `doc`으로 폴백 |
| `NAV_GROUPS` | [L32](../../partner-admin/app.js#L32) | 12개 항목 (`single:true` 5개 + `children` 7개) = 58 리프 |
| `STATS_TABS` | [L965](../../partner-admin/app.js#L965) | 통계 그룹의 9개 탭 라벨 |
| `VIEW_RENDERERS` | [L1695](../../partner-admin/app.js#L1695) | 화면 id → 렌더러 함수 레지스트리 |
| `DEMO_COLLECTIONS` | [L1716](../../partner-admin/app.js#L1716) | 와이프 대상 20개 컬렉션 |
| `CARD_RANKS` | [L1721](../../partner-admin/app.js#L1721) | 시드용 카드 랭크 13종 |

---

## 전역 상태

상태 관리 라이브러리는 없습니다. 모듈 전역 변수와 `window.__acctRows` 한 개를 씁니다.

### 캐시 3종

```js
let MEMBER_CACHE = null, BALANCE_CACHE = null, TABLE_CACHE = null;
```

| 접근자 | 소스 | 무효화 |
| --- | --- | --- |
| `getMembers(force)` [L241](../../partner-admin/app.js#L241) | `members` 전체 | `invalidateCaches()` 또는 `force=true` |
| `getBalances(force)` [L249](../../partner-admin/app.js#L249) | `memberLedger` **전체**를 클라이언트에서 합산 | 동일 |
| `getTables(force)` [L245](../../partner-admin/app.js#L245) | `tables` 전체 | 동일 |

`invalidateCaches()` ([L265](../../partner-admin/app.js#L265))는 셋을 모두 `null`로 되돌립니다.
쓰기 후 호출하는 곳과 하지 않는 곳이 섞여 있습니다 — 아래 "돈을 쓰는 함수" 표의 무효화 열 참고.

### 리스트 화면 상태

```js
let LIST_STATE = {};   // {cfg, rows, filtered, page, pageSize, q, activeFilters}
let LIST_UNSUB = null; // 현재 마운트된 onSnapshot 구독 해제 함수
```

`LIST_UNSUB`은 `switchView()` ([L212](../../partner-admin/app.js#L212))가 다음 화면을 그리기
**전에** 호출해 해제합니다. 이 해제가 없으면 화면을 떠나도 Firestore 리스너가 계속 살아 있습니다.

### 기타

```js
let BALANCE_CTX = null;      // {memberId, mode} — 보유금 모달이 열려 있는 동안만 유효
window.__acctRows = rows;    // 계정관리 화면의 클라이언트 검색용 원본 행
```

---

## `getBalances()` — 파생 잔액 모델

[L249-L264](../../partner-admin/app.js#L249-L264)

잔액은 어디에도 저장되지 않습니다. `memberLedger` 전체를 읽어 회원별로 합산해 만듭니다.

```js
async function getBalances(force){
  if (BALANCE_CACHE && !force) return BALANCE_CACHE;
  const rows = await fetchAll('memberLedger');
  const map = {};
  rows.forEach(r=>{
    const m = map[r.memberId] || (map[r.memberId] = {balance:0, points:0, deposit:0, withdraw:0, bet:0, payout:0});
    if (r.category==='point_earn' || r.category==='point_convert') m.points += Number(r.amount)||0;
    else m.balance += Number(r.amount)||0;
    if (r.category==='deposit')  m.deposit  += Number(r.amount)||0;
    if (r.category==='withdraw') m.withdraw += Number(r.amount)||0;
    if (r.category==='bet')      m.bet      += Number(r.amount)||0;
    if (r.category==='payout')   m.payout   += Number(r.amount)||0;
  });
  BALANCE_CACHE = map;
  return map;
}
```

**반환 구조** — `{[memberId]: {balance, points, deposit, withdraw, bet, payout}}`

| 필드 | 부호 | 의미 |
| --- | --- | --- |
| `balance` | 양수 | 포인트 카테고리를 뺀 모든 원장 금액의 합 |
| `points` | 양수 | `point_earn` + `point_convert`의 합 |
| `deposit` | 양수 | 입금 누계 |
| `withdraw` | **음수** | 출금 원장은 음수로 저장되므로 누계도 음수 |
| `bet` | **음수** | 베팅 원장은 음수 |
| `payout` | 양수 | 페이아웃 누계 |

읽는 쪽이 부호를 뒤집어 씁니다: `fmtNum(-b.withdraw||0)`
([L782](../../partner-admin/app.js#L782)), `rolling = -b.bet`
([L708](../../partner-admin/app.js#L708)).

**엣지 케이스**
- `comp` 키를 만들지 않습니다. 대시보드의 "총 쿱프"는 `b.comp||0`을 합산하므로 항상 0입니다
  ([P-07](explanation-known-gaps.md#p-07--총-쿱프가-항상-0이다)).
- `correction` 카테고리는 개별 필드가 없고 `balance`에만 반영됩니다.
- `memberLedger` 전량 스캔이라 원장이 커질수록 선형으로 느려집니다
  ([P-06](explanation-known-gaps.md#p-06--모든-리스트-화면이-컬렉션-전체를-구독한다)).

---

## `mountListView(cfg)` — 설정 주도 리스트 엔진

[L281-L301](../../partner-admin/app.js#L281-L301)

58개 화면 중 약 40개가 이 함수 하나로 만들어집니다. `cfg` 객체 하나가 화면 전체를 결정합니다.

### `cfg` 필드 계약

| 필드 | 타입 | 기본값 | 효과 |
| --- | --- | --- | --- |
| `coll` | `string` | **필수** | 구독할 Firestore 컬렉션 이름 |
| `title` | `string` | **필수** | 페이지 제목 |
| `sub` | `string` | 없음 | 제목 아래 설명 줄 |
| `columns` | `Array<Column>` | **필수** | 아래 Column 계약 참고 |
| `search` | `boolean` | `true` | `false`면 검색 입력 제거 |
| `searchFields` | `string[]` | `[]` | 검색어를 대조할 행 필드. 비우면 검색이 아무것도 못 찾음 |
| `searchPh` | `string` | `'검색어를 입력하세요'` | 검색 입력 placeholder |
| `filters` | `Array<{key,label,options}>` | `[]` | 셀렉트 필터. 문자열 완전 일치 비교 |
| `extraFilter` | `(doc)=>boolean` | 없음 | 스냅샷 직후 적용되는 클라이언트 필터 |
| `casinoField` | `string` | 없음 | 지정 시 `CASINO_FILTER`로 추가 필터 (현재 항상 `'ALL'`) |
| `mapRow` | `(doc)=>row` | 항등 | 행 변환. 조인·파생 컬럼을 여기서 만듦 |
| `sortKey` | `string` | 없음 | 정렬 기준 필드 |
| `sortDir` | `'asc'\|'desc'` | `'desc'` | `'asc'`가 아니면 내림차순 |
| `stats` | `(rows)=>Array<Stat>` | 없음 | 표 위 요약 카드. **최초 마운트 때 1회만 계산** |
| `onCreate` | `string` | 없음 | "+ 생성" 버튼의 `onclick` 문자열 |
| `rowClick` | `string` | 없음 | 행 클릭 시 호출할 전역 함수 이름. `fn('<row.id>')`로 호출 |
| `rowActions` | `(row)=>string` | 없음 | 마지막 "관리" 열에 넣을 HTML |

### Column 계약

```js
{key: 'amount', label: '금액', type: 'money'}
{key: 'result', label: '결과', render: r => pill(...)}   // render가 있으면 type 무시
```

`renderCell(row, c)` ([L390](../../partner-admin/app.js#L390))의 `type` 분기:

| `type` | 출력 | 이스케이프 |
| --- | --- | --- |
| 없음 | `escapeHtml(v ?? '—')` | ✅ |
| `money` | `fmtNum(v)` + 부호별 `pos`/`neg` 클래스 | ✅ (숫자) |
| `dt` | `fmtDt(v)` → `YYYY-MM-DD HH:mm` | ✅ (포맷) |
| `date` | `fmtDate(v)` → `YYYY-MM-DD` | ✅ (포맷) |
| `pill` | `pill(v, c.pillMap)` — 내부에서 `escapeHtml` | ✅ |
| `phone` | `maskPhone(v)` → `**-****-1234` | ✅ (숫자만) |
| `render` | 콜백 반환값을 **그대로 삽입** | ❌ 콜백 책임 |

`render` 콜백과 `rowActions`가 이스케이프 우회 경로입니다
([P-04](explanation-known-gaps.md#p-04--render-콜백과-rowactions가-이스케이프를-우회한다)).

### 실시간 동작과 그 경계

```js
LIST_UNSUB = db.collection(cfg.coll).onSnapshot(snap=>{ ... }, err=>{ ... });
await firstSnapshot;                  // 첫 스냅샷까지 대기 후 셸 HTML 반환
setTimeout(renderListBody, 0);        // #listBody는 switchView가 DOM에 커밋한 뒤에야 존재
return renderListShell();
```

| 요소 | 실시간 갱신 | 이유 |
| --- | --- | --- |
| 표의 행 데이터 | ✅ | `onSnapshot` 구독 |
| 페이저 | ✅ | `reapplyListFilters()`가 다시 계산 |
| 요약 stat 카드 | ❌ | 셸을 다시 그리면 입력 중인 검색어가 날아감 (코드 주석 명시) |
| `mapRow`가 참조하는 외부 데이터 | ❌ | 마운트 시점의 스냅샷 (예: `renderBetHistory`의 `roundMap`) |

`err` 콜백은 `resolveFirst()`를 호출해 권한 오류·오프라인일 때 화면이 영원히 스피너에
멈추지 않게 합니다.

### 페이지 유지 규칙

- `applyListFilters()` [L345](../../partner-admin/app.js#L345) — 사용자의 검색·필터 조작.
  `page = 1`로 되돌린 뒤 재계산.
- `reapplyListFilters()` [L353](../../partner-admin/app.js#L353) — 스냅샷 수신.
  현재 페이지를 유지하되, 총 페이지 수보다 커졌으면 마지막 페이지로 당김.

`pageSize`는 20 고정입니다. 페이저는 9페이지를 넘으면 현재 페이지 ±3 범위 밖을 `…`로 접습니다
([L383](../../partner-admin/app.js#L383)).

---

## 인증

### `ensureDefaultStaff()` [L168](../../partner-admin/app.js#L168)

`partnerStaff` 컬렉션이 비어 있으면 다음 문서를 만듭니다.

```js
{id:'admin', pw:'0000', name:'Eric', role:'master', createdAt: '<ISO 8601>'}
```

비밀번호는 평문입니다. `try/catch`로 감싸 오프라인 첫 로드 시 조용히 실패합니다.

### `doLogin()` [L177](../../partner-admin/app.js#L177)

```js
const id = document.getElementById('loginId').value.trim() || 'admin';
const pw = document.getElementById('loginPw').value.trim() || '0000';
```

빈 입력이 `admin` / `0000`으로 폴백합니다 —
[P-02](explanation-known-gaps.md#p-02--빈-입력으로-로그인하면-admin이-된다) 참고.

검증 순서:
1. `partnerStaff/{id}` 조회. 실패는 삼킴.
2. 문서가 없고 `id==='admin' && pw==='0000'`이면 `{id:'admin', name:'Eric', role:'master'}` 사용.
3. `String(staff.pw ?? '0000') !== pw`면 오류 표시 후 반환.

성공 시 `CURRENT_STAFF`를 채우고 로그인 게이트를 숨긴 뒤 `switchView('dashboard')`를 호출합니다.

### `doLogout()` [L198](../../partner-admin/app.js#L198)

`CURRENT_STAFF = null`, DOM 표시 전환, 입력 비움. 세션 토큰이 없으므로 Firestore 접근 권한은
로그아웃 후에도 그대로입니다.

---

## 화면 전환

### `switchView(viewId)` [L206](../../partner-admin/app.js#L206)

```js
if (LIST_UNSUB){ LIST_UNSUB(); LIST_UNSUB = null; }   // 이전 구독 해제
CURRENT_VIEW = viewId;
setActiveNav(viewId);
main.innerHTML = '<스피너>';
try {
  const fn = VIEW_RENDERERS[viewId] || renderComingSoon;
  main.innerHTML = await fn(viewId);
} catch(e){
  main.innerHTML = `<오류 카드: ${escapeHtml(e.message)}>`;
}
```

렌더러 계약: **HTML 문자열을 반환하는 async 함수**. DOM 조작이 필요한 렌더러(차트 등)는
`setTimeout(..., 0)`으로 커밋 이후를 노립니다.

미등록 id는 `renderComingSoon()`으로 폴백합니다. `NAV_GROUPS`의 58개 리프는 모두
`VIEW_RENDERERS`에 등록되어 있으므로 실제로는 도달하지 않습니다.

### 통계 그룹의 특수 등록 [L1709-L1711](../../partner-admin/app.js#L1709-L1711)

9개 통계 화면은 `renderStatsTab` 하나를 공유하므로, 레지스트리에 클로저로 다시 덮어씁니다.

```js
Object.keys({marketRatio:1, ..., bettingStatus:1}).forEach(id=>{
  VIEW_RENDERERS[id] = () => renderStatsTab(id);
});
```

---

## 돈을 쓰는 함수

데모 시드를 뺀 다섯 곳은 전부 [`writeMemberLedgerEntry(db, entry)`](../../shared/cage-ui.js#L202)를
경유합니다. 이 함수는 `memberLedger` 문서와 `balanceTotals/member_{memberId}` 증분을
**같은 batch**에 담아 커밋합니다.

```js
// 원장 항목 공통 필드
{
  memberId: 'SEH1001',
  amount: 100000,                       // 음수 = 차감
  category: 'deposit',                  // deposit|withdraw|bet|payout|point_earn|point_convert|correction
  memo: '디파짓 승인',
  staff: 'admin',
  createdAt: FieldValue.serverTimestamp(),
  clientCreatedAt: '2026-08-14T12:34:56.789Z',
  deviceId: '<crypto.randomUUID(), localStorage 보관>',
}
```

`category`가 `point_earn` / `point_convert`면 `balanceTotals`의 `points` 필드가, 아니면
`balance` 필드가 증분됩니다.

| 함수 | 트랜잭션 가드 | 감사 로그 | 캐시 무효화 |
| --- | --- | --- | --- |
| [`submitBalanceAdjust`](../../partner-admin/app.js#L411) | ❌ 불필요 (신규 발생) | `memberActionLogs` | ✅ |
| [`approveDeposit`](../../partner-admin/app.js#L890) | ✅ 상태 `대기`→`승인` 원자적 | ❌ 없음 | ✅ |
| [`rejectDeposit`](../../partner-admin/app.js#L909) | ✅ | ❌ 없음 | ❌ (원장 미변경) |
| [`processPayment`](../../partner-admin/app.js#L1661) | ✅ | ❌ 없음 | ✅ |
| [`submitRoundCancel`](../../partner-admin/app.js#L1280) | ⚠ 부분 — 취소 플래그만 | `adminLogs` | ✅ |
| [`seedDemoData`](../../partner-admin/app.js#L1724) | ❌ | ❌ | ✅ |

### 트랜잭션 가드 패턴

`approveDeposit` / `rejectDeposit` / `processPayment`가 쓰는 형태입니다.

```js
await db.runTransaction(async tx=>{
  const doc = await tx.get(ref);
  if (!doc.exists) throw new Error('NOT_FOUND');
  d = doc.data();
  if (d.status !== '대기') throw new Error('ALREADY_PROCESSED');
  tx.set(ref, {status:'승인'}, {merge:true});
});
```

더블클릭이나 두 직원의 동시 승인이 둘 다 `대기` 검사를 통과해 원장에 두 번 입금하는 경우를
막습니다. 진 쪽은 `ALREADY_PROCESSED`를 받아 토스트만 띄우고 종료합니다.

**같은 가드가 없는 곳**: 아바타 신청 승인/거절/강제종료
([L1215](../../partner-admin/app.js#L1215), [L1229](../../partner-admin/app.js#L1229),
[L1234](../../partner-admin/app.js#L1234)), 라운드 결과 수정
([L1252](../../partner-admin/app.js#L1252)) —
[P-05](explanation-known-gaps.md#p-05--아바타-신청-승인에는-트랜잭션-가드가-없다) 참고.

### `submitRoundCancel(roundId, tableId)` [L1280](../../partner-admin/app.js#L1280)

세 단계로 나뉩니다.

1. **취소 선점** — `rounds/{roundId}`의 `cancelled`를 트랜잭션으로 `false`→`true`. 이미 `true`면
   `ALREADY_CANCELLED`로 중단.
2. **환불 루프** — `memberLedger`에서 `where('relatedRoundId','==',roundId)`로 조회한 뒤,
   `bet`은 절댓값만큼 양수 `correction`, `payout`은 절댓값만큼 음수 `correction`을 씁니다.
   복합 인덱스를 피하려고 단일 등가 필터만 씁니다.
3. **후처리** — 체크 시 `inGameNotices` 등록, `adminLogs` 기록, 캐시 무효화.

```js
// 환불 항목
{category:'correction', amount: +Math.abs(bet.amount), relatedRoundId, relatedTableId, memo:'라운드 취소 환불 (<사유>)'}
// 회수 항목
{category:'correction', amount: -Math.abs(payout.amount), relatedRoundId, relatedTableId, memo:'라운드 취소 페이아웃 회수 (<사유>)'}
```

**엣지 케이스 2건**

- 실플레이로 만들어진 베팅은 `relatedRoundId`가 `rounds` 문서 ID와 다릅니다. 2단계 쿼리가
  0건을 반환해 환불이 일어나지 않은 채 라운드만 취소 표시됩니다
  ([P-03](explanation-known-gaps.md#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다)).
- 환불 루프는 항목마다 별도 batch를 순차 커밋합니다. 중간에 실패하면 일부만 환불된 상태로
  남고, 1단계가 이미 `cancelled=true`를 찍었으므로 재실행도 막힙니다
  ([P-01](explanation-known-gaps.md#p-01--라운드-취소-환불-루프가-원자적이지-않다)).

---

## 전용 렌더러

### `renderDashboard()` [L450](../../partner-admin/app.js#L450)

읽는 컬렉션: `members`, `memberLedger`(2회 — `getBalances` + 직접), `rounds`, `partners`,
`tables`, `adminLogs`.

| 카드 | 계산 |
| --- | --- |
| 총회원 | `members.length`, 오늘 가입 수, 유형별 4종 + 파트너 수 |
| 총 보유금 | `Σ balance` + 오늘 `deposit\|withdraw\|bet\|payout` 델타 |
| 총 포인트 | `Σ points` + 오늘 `point_earn\|point_convert` 델타 |
| 총 쿱프 | `Σ (b.comp \|\| 0)` — `getBalances`가 `comp`를 만들지 않아 **항상 0** |

차트 4종은 `setTimeout(..., 0)` 안에서 `svgBarChart` / `svgLineChart`로 그립니다.

- 가입현황 2개 — 최근 16일, 회원유형별 2계열씩
- 유저활동(날짜별) — 최근 16일, 유니크 유저 / 베팅 건수 / 베팅금액÷1000
- 유저활동(시간별) — 오늘 00~23시, 같은 3계열

### `renderStatsBody(tabId)` [L980](../../partner-admin/app.js#L980)

9개 탭을 `if/else if` 체인으로 분기합니다. 탭과 무관하게 진입 시 `memberLedger`, `members`,
`rounds`를 항상 전량 로드합니다.

| 탭 | 계산 요약 |
| --- | --- |
| 마켓비율 | 5개 스코프 × 3개 결과. 도넛 5개 + 베팅액/건수/수익/환수율 표. 타이 9배, 그 외 1.95배 가정 |
| 입출금내역 | 누적 입금·출금·순입금 3카드 |
| 실적비교 | 카지노 3곳별 베팅액·페이아웃·윈로스 |
| 실시간위험감지 | 절댓값 500,000 이상 베팅 상위 15건 (데모 임계값) |
| 고액베팅 | `amount` 오름차순(= 절댓값 큰 순) 상위 20건 |
| 리더보드 | 파트너별 회원수·입금·베팅·롤링(베팅액 × 1.5%) 각 상위 15 |
| 회원활동 | 최근 14일 일별 유니크 유저 라인차트 |
| 회원가입현황 | 최근 14일 일별 가입 수 바차트 |
| 베팅현황 | `rounds`의 `tableType`별 카운트 2카드 |

마켓비율 탭은 스코프×결과 조합마다 `rMap`(라운드 id 맵)을 다시 만듭니다 — 15회 재구축
([P-11](explanation-known-gaps.md#p-11--마켓비율-탭이-라운드-맵을-15번-다시-만든다)).

### `renderAccount()` / `acctRowHtml()` [L605](../../partner-admin/app.js#L605)

리스트 엔진을 쓰지 않는 전용 표입니다. 검색은 `window.__acctRows`를 대상으로 클라이언트에서
필터하고 `#acctBody`만 교체합니다. 행마다 4개 액션:

| 버튼 | 함수 | 쓰기 |
| --- | --- | --- |
| + 추가 / − 차감 | `openBalanceModal(id, mode)` → `submitBalanceAdjust()` | `memberLedger` + `balanceTotals` + `memberActionLogs` |
| 비밀번호 초기화 | `resetMemberPw(id)` [L643](../../partner-admin/app.js#L643) | `members.pw = '0000'` + `memberActionLogs` |
| 정지 / 정상화 | `toggleMemberStatus(id, status)` [L648](../../partner-admin/app.js#L648) | `members.status` + `memberActionLogs` |

### `renderDetailTab(memberId, tab)` [L763](../../partner-admin/app.js#L763)

회원 상세 모달의 8개 탭. 탭 전환마다 `memberLedger` 전량을 다시 읽습니다.

| 탭 | 소스 | 비고 |
| --- | --- | --- |
| 상세회원정보 | `members` | 전화번호 마스킹 |
| 어카운트정보 | `getBalances()` | 부호 반전 표시 |
| 베팅내역 | `memberLedger` (`bet`\|`payout`) | |
| 입출금 | `memberLedger` (`deposit`\|`withdraw`) | |
| 포인트누적내역 | `memberLedger` (`point_earn`\|`point_convert`) | |
| 활동내역 | `memberActionLogs` | `simpleTable` — 미이스케이프 |
| 접속내역 | 없음 | **하드코딩** — IP를 `memberId.charCodeAt(2)%255`로 생성 |
| 문의내역 | `inquiries` | `simpleTable` — 제목 미이스케이프 |

---

## 데모 데이터

### `seedDemoData()` [L1724](../../partner-admin/app.js#L1724)

`db.batch()`에 400건마다 flush하며 약 900건 이상을 씁니다.

| 컬렉션 | 건수 |
| --- | --- |
| `partners` | 5 (MAIN → SEVIP88 → SEA0904, NUSTARMS, HANNVIP 계층) |
| `shareLedger` | 20 (파트너당 4) |
| `tables` | 6 (아바타 3 + 스피드 3) |
| `rounds` | 150 (테이블당 25) |
| `members` | 40 (`SE{카지노첫글자}{1001~1040}`) |
| `memberLedger` | 약 600 (회원당 입금 1~3, 출금 0~2, 베팅 3~10 + 확률적 페이아웃, 포인트 1~4) |
| `chatMessages` 40 · `notices` 3 · `tickerNotices` 3 · `bannedWords` 4 · `inquiries` 8 | |
| `memberActionLogs` / `adminLogs` | 각 25 |
| `depositRequests` / `paymentRequests` | 각 10 (앞 3~4건이 `대기`) |
| `events` 2 · `avatarMissCorrections` 4 · `csContacts` 4 · `inGameNotices` 2 · `noticeGuide` 1 | |

**flush 경합**: `set()` 헬퍼가 `if (ops>=400) flush();`를 `await` 없이 호출합니다
([L1729](../../partner-admin/app.js#L1729)). 커밋이 끝나기 전에 같은 batch 객체에 계속 쓰게 되어,
400건을 넘기는 순간 문제가 됩니다
([P-09](explanation-known-gaps.md#p-09--시드의-flush가-await되지-않는다)).

### `wipeDemoData()` [L1856](../../partner-admin/app.js#L1856)

`DEMO_COLLECTIONS` 20개를 컬렉션 단위로 전량 삭제합니다. 400건마다 batch 커밋.

**삭제되지 않는 컬렉션**: `balanceTotals`, `avatarRequests`, `partnerStaff`, `cageConfigPartner`.
`balanceTotals`가 남으면 다음 시드 후 이중 쓰기 값이 원장과 어긋납니다
([P-10](explanation-known-gaps.md#p-10--와이프가-balancetotals와-avatarrequests를-남긴다)).

---

## `shared/cage-ui.js` 의존 함수

| 함수 | 위치 | 용도 |
| --- | --- | --- |
| `cageInitFirebase()` | [L19](../../shared/cage-ui.js#L19) | 앱 초기화. `experimentalForceLongPolling` + 탭 동기화 퍼시스턴스 |
| `writeMemberLedgerEntry(db, entry)` | [L202](../../shared/cage-ui.js#L202) | 원장 + `balanceTotals` 이중 쓰기. 문서 id 반환 |
| `uuidv4()` | [L28](../../shared/cage-ui.js#L28) | `crypto.randomUUID()` |
| `getDeviceId()` | [L36](../../shared/cage-ui.js#L36) | `localStorage`의 안정적 브라우저 식별자. 보안 경계 아님 |
| `escapeHtml(s)` | [L186](../../shared/cage-ui.js#L186) | `& < > " '` 치환 |
| `fmtNum` / `fmtSigned` / `fmtDt` / `fmtDate` | [L45](../../shared/cage-ui.js#L45)~ | 숫자·날짜 포맷 |
| `maskPhone(p)` | [L69](../../shared/cage-ui.js#L69) | 뒤 4자리만 노출. 7자리 미만은 원본 반환 |
| `formatNumInput` / `rawNum` | [L75](../../shared/cage-ui.js#L75) | 금액 입력 콤마 처리 |
| `toast(msg, isErr)` | [L81](../../shared/cage-ui.js#L81) | 2.2초 토스트 |
| `openModal` / `closeModal` | [L96](../../shared/cage-ui.js#L96) | `.open` 클래스 토글. 배경 클릭 시 자동 닫힘 |
| `svgDonutChart` / `svgBarChart` / `svgLineChart` | [L103](../../shared/cage-ui.js#L103)~ | 의존성 없는 SVG 차트 |

---

## DOM ID 계약

[`index.html`](../../partner-admin/index.html)이 제공하고 `app.js`가 `getElementById`로 잡는 ID입니다.
이름을 바꾸면 조용히 깨집니다.

| ID | 용도 |
| --- | --- |
| `login-gate` `loginId` `loginPw` `loginErr` `seedHint` | 로그인 게이트 |
| `topbar` `clockTxt` `connDot` `staffNameTxt` | 상단바 |
| `shell` `navBar` `mainArea` | 본체 |
| `modal-detail` `detailTitle` `detailSub` `detailTabs` `detailBody` | 회원 360 모달 |
| `modal-balance` `balanceModalTitle` `balanceModalSub` `balanceAmt` `balanceMemo` | 보유금 모달 |
| `modal-form` `formModalTitle` `formModalBody` `formModalSubmitBtn` | 범용 생성/편집 모달 |
| `modal-confirm` `confirmTitle` `confirmBody` `confirmOkBtn` | 확인 모달 |
| `listBody` `listPager` `listSearch` | 리스트 엔진이 런타임에 만듦 |
| `acctBody` `acctSearch` | 계정관리 전용 |
| `statsBody` | 통계 전용 |

`connDot`는 HTML에 존재하지만 `app.js`가 한 번도 갱신하지 않습니다 — "실시간 연동" 표시등은
항상 같은 상태입니다.

---

## 관련 문서

- [앱 구조와 설계 배경](explanation-app-structure.md) — 왜 이렇게 만들었는지
- [화면 58개 레퍼런스](reference-screens.md) — 화면별 컬렉션·액션 표
- [알려진 격차](explanation-known-gaps.md) — 결함 14건
- [로그인부터 첫 승인까지](tutorial-first-approval.md) — 실행해 보기
