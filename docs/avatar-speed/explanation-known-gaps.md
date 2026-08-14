# 설명 — 알려진 격차 (G-01 ~ G-12)

> **분류**: Explanation (이해 지향)
> **작성 기준일**: 2026-08-12 · 브랜치 `backend`
> **관련 문서**: [처리 흐름](explanation-round-flow.md) · [엔진 레퍼런스](reference-game-engine.md) · [앱 레퍼런스](reference-avatar-app.md)

`avatar/`와 `shared/game-engine.js`를 정독하며 확인한 결함·불일치 목록입니다. **모두 코드 정독으로
확인했으며 실행으로 재현하지는 않았습니다.** 각 항목에 근거가 되는 파일·줄을 명시했습니다.

이 문서는 결함을 고치자는 제안서가 아니라, 이 코드를 다루게 될 사람이 놀라지 않도록 하는
지도입니다. 데모 목적상 의도된 단순화도 마지막에 함께 적었습니다.

## 요약

| ID | 제목 | 영향 | 데모에서 드러나는가 |
| --- | --- | --- | --- |
| [G-01](#g-01--베팅의-relatedroundid가-rounds-문서-id와-일치하지-않는다) | 베팅과 라운드가 조인되지 않음 | 데이터 정합성 | ❌ 조회 화면에서만 |
| [G-02](#g-02--베팅-한도가-어디에서도-강제되지-않는다) | 베팅 한도 미강제 | 자금/규정 | ⚠ 조작 시 |
| [G-03](#g-03--아바타-자동베팅은-잔액을-확인하지-않는다) | 아바타 자동베팅 잔액 미검사 | 자금 | ✅ 장시간 세션 |
| [G-04](#g-04--가입-보너스는-포인트가-아니라-보유금으로-적립된다) | 가입 보너스 안내 문구 불일치 | 표시 | ✅ 가입 직후 |
| [G-05](#g-05--point_convert에-대응하는-보유금-입금-항목이-없다) | 포인트 전환 시 보유금 미증가 | 자금 | ⚠ 전환 기능 구현 시 |
| [G-06](#g-06--tablebetvolume이-timestamp-createdat에서-typeerror를-던진다) | 로비가 실플레이 후 깨질 수 있음 | **런타임 오류** | ✅ 실플레이 후 |
| [G-07](#g-07--게임기록이-메모리에만-존재한다) | 새로고침 시 기록 소실 | 표시 | ✅ 즉시 |
| [G-08](#g-08--카지노-목록이-화면마다-다르다) | 카지노 목록 불일치 | 데이터 | ✅ 가입 시 |
| [G-09](#g-09--아바타-바이인이-보유금에-반영되지-않는다) | 바이인이 기록만 됨 | 자금 | ❌ |
| [G-10](#g-10--avatarservicerequests에-소비자가-없다) | 슈 체인지 요청 미처리 | 기능 미완 | ❌ |
| [G-11](#g-11--채팅-쿼리가-orderby-없이-limit200을-쓴다) | 최신 채팅 누락 가능 | 정확성 | ❌ 200건 초과 시 |
| [G-12](#g-12--베팅완료-버튼이-아무것도-확정하지-않는다) | 버튼이 장식 | UX | ⚠ |

**보안 전반**은 개별 항목으로 나열하지 않았습니다. 인증 없는 Firestore 규칙, 평문 비밀번호,
클라이언트 결과 생성은 데모 아키텍처의 전제이며
[처리 흐름 > 이 앱이 풀려는 문제](explanation-round-flow.md#이-앱이-풀려는-문제)와
[`docs/review-security-data-integrity.md`](../review-security-data-integrity.md)에서 다룹니다.

---

## G-01 — 베팅의 `relatedRoundId`가 `rounds` 문서 ID와 일치하지 않는다

**분류**: 데이터 정합성 · **근거**: [`shared/game-engine.js:120`](../../shared/game-engine.js#L120), [`avatar/app.js:752`](../../avatar/app.js#L752), [`avatar/app.js:1146`](../../avatar/app.js#L1146)

베팅 단계에서 클라이언트가 UUID를 하나 만들고, 그 값을 원장의 `relatedRoundId`로 씁니다.

```js
// avatar/app.js — 베팅 단계 시작
AVATAR.currentRoundId = uuidv4();               // ← UUID #1
// ...
await placeBet(db, { roundId: AVATAR.currentRoundId, ... });   // relatedRoundId = UUID #1
```

그런데 라운드 문서를 쓰는 함수는 **자기 안에서 새 UUID를 만듭니다.**

```js
// shared/game-engine.js
async function writeRoundDoc(db, {...}){
  const id = uuidv4();                          // ← UUID #2 (다른 값)
  await db.collection('rounds').doc(id).set({...});
  return id;                                    // 반환하지만 호출자가 쓰지 않음
}
```

`writeRoundDoc`은 새 ID를 반환하지만, 아바타([`avatar/app.js:828`](../../avatar/app.js#L828))도
스피드([`avatar/app.js:1196`](../../avatar/app.js#L1196))도 반환값을 무시합니다.

### 결과

`memberLedger.relatedRoundId`로 `rounds` 문서를 찾을 수 없습니다. 실제로 영향을 받는 것:

- **파트너 어드민 "게임라운드수정"의 라운드 취소 환불.**
  [`partner-admin/app.js:1304`](../../partner-admin/app.js#L1304)가 `roundId`로 해당 라운드의
  베팅을 찾아 환불 항목을 쓰는데, 게임 플레이로 생성된 라운드에 대해서는 매칭되는 베팅이
  0건입니다. (데모 시드 데이터는 라운드 ID를 베팅에 직접 넣어주므로 시드 데이터에서는
  동작합니다.)
- 회원 베팅내역과 라운드 결과의 조인.
- 라운드별 총 베팅액 집계.

### 고치는 법

`writeRoundDoc`이 라운드 ID를 인자로 받게 하거나, 호출자가 반환된 ID를 쓰도록 순서를 바꾸면
됩니다. 전자가 단순합니다 — 베팅이 정산보다 먼저 일어나므로 ID는 베팅 단계에서 확정되어야
합니다.

```js
// 제안: writeRoundDoc(db, {roundId, ...}) 로 받아 doc(roundId)에 쓰기
await writeRoundDoc(db, { roundId: AVATAR.currentRoundId, ... });
```

---

## G-02 — 베팅 한도가 어디에서도 강제되지 않는다

**분류**: 자금/규정 · **근거**: [`shared/game-engine.js:95`](../../shared/game-engine.js#L95), [`avatar/app.js:988`](../../avatar/app.js#L988), [`avatar/app.js:464`](../../avatar/app.js#L464)

`tables/{id}`에 `betMin`/`betMax`가 있고 `members/{id}`에도 있습니다. 화면에는 표시됩니다
(`{betMin} ~ {betMax}`). 하지만 **검사하는 코드가 하나도 없습니다.**

| 지점 | 검사하는 것 | 검사하지 않는 것 |
| --- | --- | --- |
| `placeSpeedBet` | 베팅 단계 여부, 전 테이블 합계 잔액 | 테이블 한도, 회원 한도 |
| `submitAvatarRequest` | `buyin`과 `betAmount`가 truthy인가 | 테이블 한도, 회원 한도 |
| `placeBet` (엔진) | 없음 | 전부 |
| Firestore 규칙 | 없음 (`staff` 외 전부 허용) | 전부 |

### 결과

스피드에서 100만 칩을 최소 5천 테이블에 원하는 만큼 쌓을 수 있고, 아바타 신청에서 한도를 벗어난
`betAmount`를 넣어도 승인 후 그대로 자동 집행됩니다.

시연 중 우연히 드러날 가능성은 낮지만, 이 코드를 실서비스 기반으로 삼으면 즉시 문제가 됩니다.

### 고치는 법

근본 해결은 서버 측 검증입니다. 클라이언트 방어만 급히 넣는다면 `placeSpeedBet`과
`submitAvatarRequest`에 테이블 한도 비교를 추가하면 됩니다 — 다만 이것은 UX 개선이지
보안 조치가 아닙니다.

---

## G-03 — 아바타 자동베팅은 잔액을 확인하지 않는다

**분류**: 자금 · **근거**: [`avatar/app.js:786-793`](../../avatar/app.js#L786-L793)

```js
async function beginAvatarDealingPhase(){
  AVATAR.phase = 'dealing';
  AVATAR.secondsLeft = AVATAR_DEALING_SECONDS;
  for (const [betType, amount] of Object.entries(AVATAR.bets)){
    if (amount > 0) await placeBet(db, {...});     // ← 잔액 검사 없음
  }
  if (avatarTotalBet() > 0){
    STATE.balance -= avatarTotalBet();             // ← 음수가 될 수 있음
    ...
  }
}
```

스피드 모드는 `placeSpeedBet`에서 `STATE.balance - locked < STATE.selectedChip`을 검사하고,
팁도 `submitTip`에서 `amount > STATE.balance`를 검사합니다. **아바타 자동베팅만 검사가
없습니다.**

### 결과

승인된 아바타 세션을 열어두면 라운드마다(39초) 지시 금액이 무조건 집행됩니다. 보유금이 소진되어도
멈추지 않고 `memberLedger`에 음수 잔액을 만드는 `bet` 항목이 계속 쌓입니다.

10만원 보유금에 라운드당 5만원 지시라면 3라운드째(약 2분)부터 음수로 진입합니다. 시연을 켜둔 채
자리를 비우면 실제로 발생합니다.

### 고치는 법

`beginAvatarDealingPhase` 앞에 잔액 검사를 넣고, 부족하면 라운드를 건너뛰거나 세션을 자동
종료(`status: '종료'`)하면 됩니다. 실제 카지노의 "바이인 소진 시 세션 종료" 동작과 맞물리므로
[G-09](#g-09--아바타-바이인이-보유금에-반영되지-않는다)와 함께 설계하는 것이 자연스럽습니다.

---

## G-04 — 가입 보너스는 "포인트"가 아니라 보유금으로 적립된다

**분류**: 표시 불일치 · **근거**: [`shared/game-engine.js:76-79`](../../shared/game-engine.js#L76-L79), [`shared/i18n.js`](../../shared/i18n.js) (`suSignupDone` 키)

```js
await writeMemberLedgerEntry(db, {
  memberId: id, casino: data.casino, amount: 100000,
  category: 'deposit',              // ← 보유금 카테고리
  memo: '가입 축하 포인트',           // ← "포인트"라고 적힘
  staff: 'system', ...
});
```

`getPlayerBalance()`는 `point_earn`/`point_convert`만 포인트로 집계하므로, `category: 'deposit'`인
이 10만원은 **보유금**에 들어갑니다.

안내 문구도 포인트라고 말합니다:

> 회원가입이 완료되었습니다. 가입 축하 **포인트** 100,000이 지급되었습니다.
> (5개 언어 모두 "포인트 / 积分 / point / ポイント / điểm")

### 결과

가입 직후 회원은 "포인트 100,000을 받았다"고 안내받지만, 헤더의 포인트는 0이고 보유금이
100,000입니다. 시연에서 즉시 눈에 띕니다.

### 고치는 법

둘 중 하나로 맞추면 됩니다.

- **보유금이 맞다면**: `memo`를 `'가입 축하금'`으로, `suSignupDone` 5개 언어를 "보유금"으로 수정.
- **포인트가 맞다면**: `category`를 `'point_earn'`으로 변경. 단 이 경우 신규 회원의 베팅 가능
  금액이 0이 되어 데모 흐름이 끊깁니다.

문구 수정 쪽이 데모 목적에 맞습니다.

---

## G-05 — `point_convert`에 대응하는 보유금 입금 항목이 없다

**분류**: 자금 · **근거**: [`shared/game-engine.js:86-90`](../../shared/game-engine.js#L86-L90), [`partner-admin/app.js:1816`](../../partner-admin/app.js#L1816)

`getPlayerBalance()`의 분기는 배타적입니다:

```js
if (r.category==='point_earn' || r.category==='point_convert') points += Number(r.amount)||0;
else balance += Number(r.amount)||0;
```

`point_convert`는 "포인트 → 보유금 전환"을 뜻하며 음수 `amount`로 기록됩니다
(데모 시드: `amount: -randInt(500,3000)`, `memo: '포인트→보유금 전환'`).

포인트는 줄어드는데 **보유금을 늘리는 짝 항목이 없습니다.** 전환 로직 어디에도
`{category:'deposit', amount:+전환액}`을 함께 쓰는 코드가 없습니다.

### 결과

포인트 전환을 실행하면 포인트만 사라지고 보유금은 그대로입니다. 회원 입장에서는 손실입니다.

다만 **현재 플레이어 앱에는 포인트 전환 UI가 없습니다.** 데모 시드 데이터와 파트너 어드민의
"포인트전환리스트"/"월렛전환리스트" 조회 화면에만 존재하므로 실제로 발생하지는 않습니다.
전환 기능을 구현하는 시점에 반드시 두 항목을 쌍으로 써야 한다는 뜻입니다.

### 고치는 법

전환 1회를 두 개의 원장 항목으로 기록합니다.

```js
// 포인트 차감
{category:'point_convert', amount: -N, ...}
// 보유금 증가
{category:'deposit', amount: +N, memo:'포인트 전환', ...}
```

두 쓰기가 원자적이어야 하므로 하나의 배치로 묶는 편이 안전합니다.

---

## G-06 — `tableBetVolume`이 Timestamp `createdAt`에서 TypeError를 던진다

**분류**: 런타임 오류 · **근거**: [`shared/game-engine.js:237-246`](../../shared/game-engine.js#L237-L246), [`shared/cage-ui.js:207`](../../shared/cage-ui.js#L207), [`partner-admin/app.js:1720`](../../partner-admin/app.js#L1720)

```js
function tableBetVolume(betLedgerRows){
  const todayStr = new Date().toISOString().slice(0,10);
  betLedgerRows.forEach(b=>{
    const amt = Math.abs(Number(b.amount)||0);
    total += amt;
    if ((b.createdAt||'').slice(0,10)===todayStr) today += amt;   // ← 여기
  });
}
```

`createdAt`이 두 가지 타입으로 존재합니다:

| 출처 | `createdAt` 타입 | 예시 |
| --- | --- | --- |
| 데모 시드 (`randDateWithin`) | ISO **문자열** | `'2026-08-12T04:31:00.000Z'` |
| 실제 게임 플레이 (`placeBet` → `writeMemberLedgerEntry`) | `firebase.firestore.Timestamp` **객체** | `Timestamp(seconds=…, nanoseconds=…)` |

`Timestamp` 객체는 truthy이므로 `|| ''` 폴백이 걸리지 않고, `.slice`가 존재하지 않아
`TypeError: b.createdAt.slice is not a function`이 발생합니다.

### 결과 (코드 정독 기준 예상)

`tableBetVolume`은 두 곳에서 호출됩니다:

- `renderAvatarLobbyGrid`([`avatar/app.js:427`](../../avatar/app.js#L427)) — 아바타 로비 카드 렌더링
- `renderSpeedTileStats`([`avatar/app.js:969`](../../avatar/app.js#L969)) — 스피드 타일 통계

두 호출 모두 `try/catch` 없이 `async` 함수 안에 있으므로, 예외는 처리되지 않은 Promise 거부로
빠져나가고 렌더링이 중단됩니다. 로비가 스피너에서 멈추거나 그리드가 비어 보일 것으로 예상됩니다.

발생 조건은 **누군가 앱에서 실제로 베팅을 한 번이라도 한 뒤**입니다. 데모 시드만 있는 상태에서는
전부 문자열이라 드러나지 않습니다. 즉 "시연 준비할 때는 멀쩡하다가 시연 중에 깨지는" 형태입니다.

> 이 항목은 코드 정독으로 도출한 결론이며 브라우저에서 재현하지는 않았습니다. 확인하려면
> 데모 데이터 생성 → 스피드에서 베팅 1회 → 새로고침 → 로비 재진입 순으로 시도하고 콘솔을
> 보면 됩니다.

### 고치는 법

`createdAt`을 타입에 관계없이 날짜 문자열로 정규화합니다. `shared/cage-ui.js`의 `fmtDate()`가
이미 `Timestamp`(`.toDate()`), `Date`, 문자열을 모두 처리합니다.

```js
// 제안
const day = fmtDate(b.createdAt);        // 'YYYY-MM-DD' 또는 '—'
if (day === fmtDate(new Date())) today += amt;
```

`clientCreatedAt`(항상 ISO 문자열)을 우선 사용하는 방법도 있지만, 클라이언트 시각을 신뢰하게
되므로 `fmtDate` 쪽이 낫습니다.

---

## G-07 — 게임기록이 메모리에만 존재한다

**분류**: 표시 · **근거**: [`avatar/app.js:20`](../../avatar/app.js#L20), [`avatar/app.js:113`](../../avatar/app.js#L113), [`avatar/app.js:171`](../../avatar/app.js#L171)

"게임기록" 모달과 "내 베팅내역" 패널이 읽는 것은 `MY_BET_LOG` 배열 하나입니다.

```js
let MY_BET_LOG = [];   // 페이지 로드 시 빈 배열
```

로그아웃 시 `MY_BET_LOG = []`로 비워지고, 새로고침하면 당연히 사라집니다. Firestore의
`memberLedger`에는 모든 베팅과 배당이 남아 있지만 **이 화면들은 그것을 조회하지 않습니다.**

### 결과

회원이 새로고침하면 "게임기록" 탭이 "기록 없음"이 됩니다. 파트너 어드민에서는 같은 회원의
베팅내역이 정상적으로 보이므로, 데이터가 없는 것이 아니라 화면이 안 읽는 것입니다.

날짜별 그룹핑 UI(`renderGameHistory`)가 잘 만들어져 있는데 하루치도 못 채우고 사라진다는 점에서
아쉬운 미완성입니다.

### 고치는 법

`openGameHistory()`에서 `memberLedger where memberId == PLAYER.id`를 조회해
`category: 'bet'`/`'payout'`을 `relatedRoundId`로 짝지어 렌더링하면 됩니다. 단
[G-01](#g-01--베팅의-relatedroundid가-rounds-문서-id와-일치하지-않는다)이 먼저 해결되어야 라운드
정보(테이블명, 라운드 번호)를 붙일 수 있습니다.

---

## G-08 — 카지노 목록이 화면마다 다르다

**분류**: 데이터 일관성 · **근거**: [`avatar/app.js:250`](../../avatar/app.js#L250), [`avatar/index.html:117`](../../avatar/index.html#L117)

| 위치 | 목록 |
| --- | --- |
| 로비 카지노 탭 (`LOBBY_CASINOS`) | `HANN`, `NUSTAR`, `SOLAIRE` |
| 회원가입 카지노 선택 (`#suCasino`) | `NUSTAR`, `HANN`, `ONLINE` |

`SOLAIRE`와 `ONLINE`이 서로의 목록에 없습니다.

### 결과

`ONLINE`으로 가입한 회원의 소속 카지노는 로비 탭에서 필터링할 수 없습니다. 반대로 `SOLAIRE`
테이블은 존재할 수 있지만 그 카지노 소속으로 가입할 수 없습니다.

로비 필터는 회원 소속이 아니라 **테이블의 `casino` 필드**로 동작하므로 치명적이지는 않지만,
데이터 정합성 관점에서 같은 상수를 공유해야 합니다.

### 고치는 법

`shared/cage-ui.js`에 `CAGE_CASINOS` 상수를 하나 두고 양쪽이 참조하게 합니다. 파트너 어드민도
같은 파일을 로드하므로 공유 지점으로 적합합니다.

---

## G-09 — 아바타 바이인이 보유금에 반영되지 않는다

**분류**: 자금 · **근거**: [`avatar/app.js:464-478`](../../avatar/app.js#L464-L478)

아바타 신청 모달은 "바이인 금액"을 필수로 받습니다.

```js
await db.collection('avatarRequests').doc(uuidv4()).set({
  memberId, tableId, casino,
  buyin,                    // ← 저장만 됨
  betSide, betAmount,
  status:'대기', ...
});
```

이 `buyin` 값을 읽어 원장에 반영하는 코드가 없습니다. 저장소 전체에서 `buyin`은
`avatarRequests` 쓰기와 파트너 어드민 목록의 표시 컬럼
([`partner-admin/app.js:1202`](../../partner-admin/app.js#L1202))에만 등장합니다.

### 결과

실제 카지노의 바이인은 "이 세션에 이만큼을 칩으로 바꿔 넣는다"는 자금 이동입니다. 여기서는
숫자만 기록되고 보유금은 그대로이며, 실제 베팅은 보유금 전체를 원천으로 집행됩니다.

바이인 소진 개념이 없으므로 [G-03](#g-03--아바타-자동베팅은-잔액을-확인하지-않는다)의 무한 베팅
문제와 직결됩니다.

### 고치는 법

두 가지 설계가 가능합니다.

1. **바이인을 실제 자금 이동으로 만든다.** 승인 시 `category: 'game_buyin'`으로 보유금에서
   차감하고, 세션 종료 시 잔여분을 환급. 케이지 운영 화면의 `ledger` 모델과 같은 방식입니다.
2. **바이인을 세션 예산 상한으로만 쓴다.** 원장은 건드리지 않고, 누적 베팅액이 `buyin`에 도달하면
   세션을 자동 종료. 구현이 가볍고 [G-03](#g-03--아바타-자동베팅은-잔액을-확인하지-않는다)도 함께
   막힙니다.

데모 목적에는 2번이 맞아 보입니다.

---

## G-10 — `avatarServiceRequests`에 소비자가 없다

**분류**: 기능 미완 · **근거**: [`avatar/app.js:728-734`](../../avatar/app.js#L728-L734)

아바타 세션의 "슈 체인지 요청" 버튼이 문서를 씁니다.

```js
await db.collection('avatarServiceRequests').doc(uuidv4()).set({
  requestId, tableId, memberId, type: 'shoe_change', dt
});
toast(t('shoeChangeSent'));   // "요청이 전달되었습니다"
```

저장소 전체 검색 결과 이 컬렉션을 **읽는 코드는 없습니다.** 파트너 어드민의 좌측 메뉴에도 해당
화면이 없습니다.

### 결과

회원은 "요청이 전달되었습니다" 토스트를 보지만 아무 곳에도 도달하지 않습니다. 문서는 Firestore에
계속 쌓입니다.

슈 자체가 존재하지 않으므로
([룰과 로드맵 > 덱 모델](explanation-rules-roadmaps.md#덱-모델--무한-덱-복원-추출))
설령 처리 화면이 있어도 바꿀 슈가 없습니다. 기능 전체가 미완입니다.

### 고치는 법

파트너 어드민에 목록 화면을 추가하는 것이 최소 조치입니다 (`mountListView`로 몇 줄이면 됩니다).
실제로 슈를 교체하려면 `tables/{id}.shoeNo`를 올리고 라운드 히스토리를 슈 단위로 끊는 작업이
따라옵니다.

---

## G-11 — 채팅 쿼리가 `orderBy` 없이 `limit(200)`을 쓴다

**분류**: 정확성 · **근거**: [`avatar/app.js:845-850`](../../avatar/app.js#L845-L850)

```js
AVATAR.chatUnsub = db.collection('chatMessages')
  .where('tableId','==',tableId).limit(200)      // ← orderBy 없음
  .onSnapshot(snap=>{
    const msgs = snap.docs.map(d=>d.data())
      .sort((a,b)=> new Date(a.dt) - new Date(b.dt))   // 받은 것만 정렬
      .slice(-30);
  });
```

코드 주석에 이유가 적혀 있습니다: `orderBy`를 붙이면 `where` + `orderBy` 복합 인덱스가
필요해집니다 ([처리 흐름 > Firestore 쿼리 전략](explanation-round-flow.md#firestore-쿼리-전략) 참고).

문제는 **`orderBy` 없는 `limit(200)`이 "최신 200개"를 보장하지 않는다**는 점입니다. Firestore는
문서 ID 순(여기서는 UUID이므로 사실상 무작위)으로 200개를 반환합니다. 그 200개를 클라이언트에서
시간순 정렬해 마지막 30개를 취하므로, **뽑힌 200개 안에 최신 메시지가 없으면 표시되지 않습니다.**

### 결과

한 테이블의 채팅이 200건을 넘으면 방금 보낸 메시지가 화면에 안 나타날 수 있습니다. 데모 시드는
테이블당 채팅을 40건 정도만 만들므로 시연에서는 드러나지 않습니다.

### 고치는 법

세 가지 선택지가 있습니다.

1. **복합 인덱스를 배포한다.** `firestore.indexes.json`에 `tableId ASC, dt DESC`를 추가하고
   `.orderBy('dt','desc').limit(30)`으로 바꿉니다. 가장 정확하고, "인덱스 없는 배포"라는 전제를
   깨는 첫 예외가 됩니다.
2. **문서 ID를 시간순으로 만든다.** UUID 대신 `{ISO타임스탬프}_{랜덤}` 형태를 쓰면 ID 순서가
   시간 순서와 일치해 `limit`이 의미를 갖습니다. 인덱스 불필요.
3. **오래된 메시지를 정리한다.** 테이블당 채팅을 일정 수 이하로 유지.

2번이 이 프로젝트의 제약과 가장 잘 맞습니다.

---

## G-12 — "베팅완료" 버튼이 아무것도 확정하지 않는다

**분류**: UX · **근거**: [`avatar/app.js:1103`](../../avatar/app.js#L1103)

```js
function confirmSpeedBetDetail(){ toast(t('betCompleteToast')); }
```

스피드 상세 화면의 "베팅완료" 버튼은 토스트만 띄웁니다. 실제 베팅은 스팟을 클릭하는 순간
`placeSpeedBet`이 이미 `s.bets`에 반영했고, Firestore 쓰기는 딜링 단계에 자동으로 일어납니다.

### 결과

버튼을 누르지 않아도 베팅은 성립합니다. 반대로 눌러도 확정되는 것은 없어서, 회원이 "완료를
눌렀으니 취소할 수 없겠지"라고 생각하면 오해입니다 — 베팅 단계가 끝날 때까지 "취소" 버튼으로
전부 되돌릴 수 있습니다.

실제 카지노 UI의 "베팅 확정" 관례를 흉내 낸 것으로 보이지만 동작이 따라오지 않았습니다.

### 고치는 법

두 방향 중 하나입니다.

- **버튼을 실제로 동작하게**: 확정 전에는 `s.pendingBets`에 두고, "베팅완료"를 눌러야 `s.bets`로
  옮기며 스팟을 잠급니다. 취소는 확정 전까지만 허용.
- **버튼을 없앤다**: 스팟 클릭이 곧 베팅임을 UI로 분명히 하고 "취소"만 남깁니다.

전자가 실제 서비스에 가깝고, 후자가 지금 동작에 정직합니다.

---

## 의도된 단순화 (결함 아님)

혼동을 막기 위해 함께 적습니다. 아래는 데모 아키텍처의 전제이며 고칠 대상이 아닙니다.

| 항목 | 설명 |
| --- | --- |
| 서드카드 룰 없음 | [룰과 로드맵](explanation-rules-roadmaps.md#서드카드-룰이-없다) 참고. 서버 이관 시 함께 구현 |
| 클라이언트 결과 생성 | 서버 0대 제약의 직접적 귀결 |
| 평문 비밀번호 · 인증 없음 | 데모 편의. `README.md`와 `firestore.rules` 주석에 명시됨 |
| SMS 인증번호 화면 표시 | 실제 SMS 발송 없음. i18n 문구가 "실제 SMS는 발송되지 않습니다"로 안내 |
| `hyper` / `dragontiger` 탭 | 로드맵 표시용 플레이스홀더 |
| 즐겨찾기가 저장 안 됨 | 시각 토글만 구현 |
| 음소거 / 화면전환 버튼 | 실제 영상 스트림이 없어 연결 대상 없음 |
| `chipStackHtml` 미사용 | 펠트 칩 비주얼 미구현. 함수만 준비됨 |
| `balanceTotals`를 읽지 않음 | 설계된 단계적 전환의 1단계. [보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md) 참고 |

---

## 확인 방법

이 문서의 항목들은 코드 정독으로 도출했습니다. 실제로 재현하려면:

```bash
# 1. 로컬에서 앱 띄우기
firebase emulators:start --only hosting

# 2. /partner-admin/ 에서 admin / 0000 로그인 → "데모 데이터 생성"
# 3. /avatar/ 에서 데모 회원 ID + 0000 로그인
```

| 항목 | 재현 절차 |
| --- | --- |
| G-04 | 신규 가입 → 완료 문구와 헤더 포인트/보유금 비교 |
| G-06 | 스피드에서 베팅 1회 → 새로고침 → 로비 재진입 → 콘솔 확인 |
| G-07 | 베팅 몇 회 → 게임기록 확인 → 새로고침 → 다시 확인 |
| G-03 | 아바타 승인 후 보유금보다 큰 지시로 세션 방치 |
| G-01 | 게임 플레이 후 파트너 어드민 "게임라운드수정"에서 해당 라운드 취소 시도 |

---

## 관련 문서

- [처리 흐름](explanation-round-flow.md) — 이 결함들이 놓인 구조적 맥락
- [룰과 로드맵](explanation-rules-roadmaps.md) — 게임 규칙 단순화의 배경
- [엔진 레퍼런스](reference-game-engine.md) · [앱 레퍼런스](reference-avatar-app.md) — 함수 단위 계약
- [보안·데이터 정합성 리뷰](../review-security-data-integrity.md) — 저장소 전체 관점의 리뷰
