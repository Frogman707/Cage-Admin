# 레퍼런스 — `shared/game-engine.js`

> **분류**: Reference (정보 지향)
> **대상 파일**: [`shared/game-engine.js`](../../shared/game-engine.js) (346줄)
> **작성 기준일**: 2026-08-15 · 브랜치 `backend`
> **관련 문서**: [처리 흐름](explanation-round-flow.md) · [룰과 로드맵](explanation-rules-roadmaps.md) · [`avatar/app.js` 레퍼런스](reference-avatar-app.md)

플레이어 측 공용 게임 엔진입니다. `/avatar`(및 `/avatar/?mode=speed`)가 로드하며, 회원 인증(라이트),
보유금·포인트 집계, 베팅 기록과 정산, 라운드 문서 기록, 로드맵 렌더링을 담당합니다.

번들러·프레임워크·모듈 시스템을 쓰지 않습니다. 파일 전체가 전역 스코프에 함수와 상수를 선언하며,
`<script src>` 로드 순서가 곧 의존성 순서입니다.

---

## 로드 순서와 외부 의존성

이 파일은 아래 전역이 **먼저** 정의되어 있어야 동작합니다.
[`avatar/index.html:206-211`](../../avatar/index.html#L206-L211)이 그 순서를 강제합니다.

```html
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js"></script>
<script src="../shared/cage-ui.js"></script>   <!-- writeMemberLedgerEntry, uuidv4, getDeviceId -->
<script src="../shared/i18n.js"></script>
<script src="../shared/game-engine.js"></script>
<script src="app.js"></script>
```

| 필요한 전역 | 제공처 | 사용 위치 |
| --- | --- | --- |
| `firebase.firestore.FieldValue.serverTimestamp` | Firebase compat SDK | `playerSignup`, `placeBet`, `settleBet` |
| `writeMemberLedgerEntry(db, entry)` | [`shared/cage-ui.js:202`](../../shared/cage-ui.js#L202) | 모든 원장 쓰기 |
| `uuidv4()` | [`shared/cage-ui.js:28`](../../shared/cage-ui.js#L28) | `writeRoundDoc` |
| `getDeviceId()` | [`shared/cage-ui.js:36`](../../shared/cage-ui.js#L36) | 모든 원장 쓰기 |

CSS 클래스 계약(`br-cell`, `bd-cell`, `dr-cell`, `br-pair`, `cs-chip`)은
[`shared/game-ui.css`](../../shared/game-ui.css)에 정의되어 있습니다. 엔진은 HTML 문자열만 만들고
스타일에는 관여하지 않습니다.

---

## 상수

### `CHIP_VALUES`

```js
const CHIP_VALUES = [5000, 10000, 50000, 100000, 500000, 1000000];
```

칩 트레이에 표시되는 6종 액면가입니다. 각 값은 CSS 클래스 `.chip.c{값}` / `.cs-chip.c{값}`과 1:1로
대응합니다 (예: `1000000` → `.chip.c1000000`). 값을 추가하려면
[`shared/game-ui.css:213-250`](../../shared/game-ui.css#L213-L250)에 대응 클래스를 함께 추가해야
칩이 스타일 없이 렌더링되지 않습니다. 50만·100만 칩은 원형이 아니라 직사각형 플라크로
스타일링되어 있습니다 ([`shared/game-ui.css:245-250`](../../shared/game-ui.css#L245-L250)).

`avatar/app.js`는 `STATE.selectedChip`의 초기값으로 `CHIP_VALUES[0]`(5,000)을 씁니다.

### `CARD_RANKS` / `CARD_SUITS`

```js
const CARD_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];  // 13종
const CARD_SUITS = ['♠','♥','♦','♣'];                                       // 4종
```

52장 덱을 표현하지만 **슈(shoe)를 구성하지 않습니다.** `randCard()`가 매번 독립적으로 균등 추출하므로
같은 라운드에서 같은 카드가 중복 등장할 수 있습니다. 서드카드까지 포함해 한 라운드에 최대 6장이
뽑히며, 모두 같은 복원 추출입니다. 자세한 내용은
[룰과 로드맵 > 덱 모델](explanation-rules-roadmaps.md#덱-모델--무한-덱-복원-추출)을 보세요.

### `PAYOUT`

```js
const PAYOUT = { player: 2.0, banker: 1.95, tie: 9.0, playerPair: 12.0, bankerPair: 12.0 };
```

**총 반환 배수(gross)입니다. 순배당(net odds)이 아닙니다.** 원금이 포함된 값입니다.

| 베팅 종류 | `PAYOUT` 값 | 순배당 | UI 표기 |
| --- | --- | --- | --- |
| `player` | `2.0` | 1 : 1 | `1:1` |
| `banker` | `1.95` | 0.95 : 1 (5% 커미션) | `0.95:1` / `.95:1` |
| `tie` | `9.0` | 8 : 1 | `8:1` |
| `playerPair` | `12.0` | 11 : 1 | `11:1` |
| `bankerPair` | `12.0` | 11 : 1 | `11:1` |

이 값을 수정해도 UI 표기는 **자동으로 따라오지 않습니다.** 배당 문자열은
`avatar/app.js`의 `speedDetailShellHtml`([`avatar/app.js:1001-1041`](../../avatar/app.js#L1001-L1041))에
`<div class="odds">`로 하드코딩되어 있으므로 함께 고쳐야 합니다. 베팅 스팟이 스피드 상세 화면
한 곳에만 남아 있어(타일에서는 제거됨) 수정 지점은 하나입니다.

표기와 실제 배수가 이미 어긋난 곳이 하나 있습니다: **타이 스팟은 `8:1`로 표시되지만 `PAYOUT.tie`는
`9.0`(총 반환)이므로 순배당이 정확히 8:1로 맞습니다.** 반면 페어 스팟은 `11:1`로 표시되고
`PAYOUT.playerPair`가 `12.0`이므로 이 역시 일치합니다. 두 표기 모두 순배당 기준입니다.

### 로드맵 상수

```js
const BEAD_ROWS = 6;                                       // 비드 플레이트 열 높이
const BEAD_WINDOW = 40;                                    // 비드 플레이트가 유지하는 최근 결과 수
const RESULT_LETTER = {player:'P', banker:'B', tie:'T'};    // 비드에 찍히는 글자
const DERIVED_ROAD_ROWS = 3;                               // 파생 로드 열 높이
```

빅로드의 열 높이는 상수가 아니라 `renderBigRoad(cols, maxRows)`의 인자로 전달됩니다
(로비 카드·스피드 타일 4행, 상세 화면 6행).

`BEAD_WINDOW`는 엔진이 아니라 **호출자가 적용합니다.** `renderBeadRoad`는 넘겨받은 배열을 전부
그리며, `avatar/app.js`가 `history.slice(-BEAD_WINDOW)`로 잘라서 넘깁니다
([`avatar/app.js:572`](../../avatar/app.js#L572), [`avatar/app.js:928`](../../avatar/app.js#L928)).
값 그룹핑 때문에 슈 전체를 그리면 패널보다 훨씬 넓어지기 때문입니다.

---

## 카드와 라운드 시뮬레이션

### `cardValue(rank) → number`

바카라 카드값을 반환합니다.

| 입력 | 반환 |
| --- | --- |
| `'A'` | `1` |
| `'2'` ~ `'9'` | `2` ~ `9` |
| `'10'`, `'J'`, `'Q'`, `'K'` | `0` |

`rank`는 `CARD_RANKS`에 있는 문자열이어야 합니다. 알 수 없는 값이면 `Number(rank)`가 `NaN`을
반환하며 방어 코드는 없습니다.

### `randCard() → {rank, suit}`

`CARD_RANKS`와 `CARD_SUITS`에서 각각 `Math.random()`으로 균등 추출합니다.
`Math.random()`은 암호학적으로 안전하지 않고 감사 대상 RNG가 아닙니다 — 데모 전용입니다.

```js
randCard()  // → {rank: 'Q', suit: '♥'}
```

### `handTotal(cards) → number`

카드 배열의 바카라 점수(0~9)를 반환합니다. 장수 제한이 없어 2장 핸드와 3장 핸드에 모두 쓰입니다.

```js
function handTotal(cards){
  return cards.reduce((sum,c)=>sum+cardValue(c.rank), 0) % 10;
}
```

### `simulateRound() → RoundResult`

한 라운드 전체를 시뮬레이션합니다. 이 프로젝트에서 게임 결과가 만들어지는 **유일한 지점**입니다.
**푼토 반코 타블로(서드카드 룰)를 그대로 구현합니다.**

```js
function simulateRound(){
  const player = {cards:[randCard(), randCard()]};
  const banker = {cards:[randCard(), randCard()]};
  // 페어 사이드벳은 서드카드 이전, 처음 두 장으로 판정
  const playerPair = player.cards[0].rank === player.cards[1].rank;
  const bankerPair = banker.cards[0].rank === banker.cards[1].rank;

  let pt = handTotal(player.cards), bt = handTotal(banker.cards);
  if (pt < 8 && bt < 8){                      // 어느 쪽이든 내추럴(8·9)이면 양쪽 스탠드
    let p3 = null;
    if (pt <= 5){ p3 = randCard(); player.cards.push(p3); pt = handTotal(player.cards); }
    const v = p3 ? cardValue(p3.rank) : null;
    const bankerDraws =
      p3 === null ? bt <= 5 :                 // 플레이어가 안 받으면 뱅커도 같은 규칙
      bt <= 2     ? true :
      bt === 3    ? v !== 8 :
      bt === 4    ? v >= 2 && v <= 7 :
      bt === 5    ? v >= 4 && v <= 7 :
      bt === 6    ? v === 6 || v === 7 :
                    false;                    // 7은 스탠드
    if (bankerDraws){ banker.cards.push(randCard()); bt = handTotal(banker.cards); }
  }
  player.score = pt; banker.score = bt;
  const result = pt > bt ? 'player' : bt > pt ? 'banker' : 'tie';
  return {player, banker, result, playerPair, bankerPair};
}
```

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `player` | `{cards, score}` | 플레이어 핸드. `cards`는 **2장 또는 3장** |
| `banker` | `{cards, score}` | 뱅커 핸드. `cards`는 **2장 또는 3장** |
| `result` | `'player'` \| `'banker'` \| `'tie'` | 최종 점수 비교 결과 |
| `playerPair` | `boolean` | 플레이어 **처음 두 장**의 랭크가 같은가 (무늬는 무시) |
| `bankerPair` | `boolean` | 뱅커 처음 두 장의 랭크가 같은가 |

드로우 규칙 요약:

| 단계 | 조건 | 동작 |
| --- | --- | --- |
| 내추럴 | `pt >= 8` 또는 `bt >= 8` | 양쪽 모두 스탠드. 서드카드 없음 |
| 플레이어 | `pt <= 5` | 서드카드 1장 |
| 플레이어 | `pt` 6~7 | 스탠드 |
| 뱅커 (플레이어 스탠드) | `bt <= 5` | 서드카드 1장 |
| 뱅커 (플레이어 드로우, `v` = 플레이어 서드카드값) | `bt <= 2` | 무조건 드로우 |
| | `bt === 3` | `v !== 8`일 때 드로우 |
| | `bt === 4` | `v ∈ [2,7]`일 때 드로우 |
| | `bt === 5` | `v ∈ [4,7]`일 때 드로우 |
| | `bt === 6` | `v ∈ {6,7}`일 때 드로우 |
| | `bt === 7` | 스탠드 |

**페어 판정은 서드카드보다 먼저 확정됩니다.** 3장 핸드에서 첫 두 장이 같은 랭크면 페어이고,
세 번째 카드가 같은 랭크여도 페어로 치지 않습니다 — 실제 바카라와 동일합니다.

### `dealSequence(sim) → [side, index][]`

카드가 펠트에 놓이는 순서를 반환합니다. 서드카드 유무에 따라 길이가 4~6으로 달라지므로,
공개 애니메이션이 "무조건 4장"을 가정하지 않도록 이 함수가 순서를 결정합니다.

```js
function dealSequence(sim){
  const seq = [['player',0],['banker',0],['player',1],['banker',1]];
  if (sim.player.cards[2]) seq.push(['player',2]);
  if (sim.banker.cards[2]) seq.push(['banker',2]);
  return seq;
}
```

P1 → B1 → P2 → B2 → (플레이어 서드) → (뱅커 서드) 순입니다. `avatar/app.js`의
`revealAvatarCards`([`avatar/app.js:791`](../../avatar/app.js#L791))와
`revealSpeedDetailCards`([`avatar/app.js:1060`](../../avatar/app.js#L1060))가 이 배열을 순회하며
260ms 간격으로 카드 DOM을 추가합니다 — 한 라운드 공개 시간은 약 1.04초(4장) ~ 1.56초(6장)입니다.

---

## 회원 세션 (라이트 인증)

### `PLAYER` (모듈 전역, 가변)

```js
let PLAYER = null;
```

로그인/가입 성공 시 `members` 문서 본문이 그대로 대입됩니다. `avatar/app.js`가 이 전역을 직접 읽고
(`PLAYER.id`, `PLAYER.nickname`, `PLAYER.casino`) 로그아웃 시 직접 `null`로 되돌립니다
([`avatar/app.js:111`](../../avatar/app.js#L111)).

### `playerLogin(db, id, pw) → Promise<LoginResult>`

`members` 컬렉션에 대한 평문 ID/비밀번호 조회입니다.

| 인자 | 타입 | 설명 |
| --- | --- | --- |
| `db` | `firebase.firestore.Firestore` | `cageInitFirebase()` 반환값 |
| `id` | `string` | 회원 ID. **내부에서 `toUpperCase()` 처리**되어 문서 ID로 사용 |
| `pw` | `string` | 평문 비밀번호 |

반환값:

| 결과 | 조건 |
| --- | --- |
| `{ok:true, member}` | 문서 존재 + 비밀번호 일치 + `status === '정상'` |
| `{ok:false, reason:'notfound'}` | `members/{ID}` 문서 없음 |
| `{ok:false, reason:'badpw'}` | `String(m.pw ?? '0000') !== pw` |
| `{ok:false, reason:'blocked'}` | `status`가 `'정상'`이 아님 (정지·블랙리스트 등) |

동작 세부:

- 비밀번호는 **평문 비교**입니다. `pw` 필드가 없는 회원은 기본값 `'0000'`으로 취급됩니다 —
  파트너 어드민이 생성한 데모 회원이 `0000`으로 로그인되는 이유입니다.
- 성공 시 `members/{ID}`에 `lastLoginAt`(ISO 문자열)을 `merge:true`로 기록합니다.
- 성공 시 전역 `PLAYER`를 설정합니다.
- 세션 토큰이 없습니다. Firebase Authentication을 쓰지 않으며,
  [`firestore.rules:24-26`](../../firestore.rules#L24-L26)에 따라 `staff` 외 모든 컬렉션은
  인증 없이 읽고 쓸 수 있습니다.

### `playerSignup(db, data) → Promise<SignupResult>`

신규 회원을 생성하고 가입 보너스를 지급합니다.

`data` 필드:

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `id` | ✅ | `toUpperCase()` 후 문서 ID가 됨 |
| `pw` | ✅ | 평문 저장. `withdrawPw`에도 같은 값이 복사됨 |
| `nickname` | ✅ | |
| `phone` | ✅ | |
| `telegram` | | 없으면 `null` |
| `casino` | ✅ | |
| `agentCode` | | 없으면 `'DIRECT'`. `parentAgent`에도 같은 값 |
| `smsVerified` | | `!!` 변환되어 저장 |

생성되는 `members/{ID}` 문서의 고정 필드:

```js
{
  id, loginId: id, pw, nickname, phone, telegram, casino,
  agentCode, parentAgent,
  memberType: '준회원',
  status:     '정상',
  vip:        false,
  betMax:     1000000,
  betMin:     5000,
  withdrawPw: pw,       // 비밀번호와 동일
  smsVerified,
  source:     'online',
  createdAt, lastLoginAt   // 둘 다 클라이언트 ISO 문자열
}
```

반환값:

| 결과 | 조건 |
| --- | --- |
| `{ok:true, member}` | 생성 성공 |
| `{ok:false, reason:'dup'}` | 트랜잭션 내부에서 문서가 이미 존재함 |

**ID 선점은 트랜잭션으로 보호됩니다** ([`shared/game-engine.js:94-104`](../../shared/game-engine.js#L94-L104)).
`get()` 후 `set()`으로 나누면 같은 ID로 동시 가입한 두 요청이 모두 존재 검사를 통과해 가입 보너스가
두 번 적립될 수 있기 때문입니다.

가입 보너스는 트랜잭션 **바깥**에서 별도로 기록됩니다:

```js
await writeMemberLedgerEntry(db, {
  memberId: id, casino: data.casino, amount: 100000,
  category: 'deposit', memo: '가입 축하 포인트', staff: 'system', ...
});
```

`category`가 `'deposit'`이므로 이 10만은 **포인트가 아니라 보유금**으로 집계됩니다. `memo`와
가입 완료 안내 문구(i18n 키 `suSignupDone`)는 "포인트"라고 말하지만 실제 반영은 보유금입니다 —
[G-04](explanation-known-gaps.md#g-04--가입-보너스는-포인트가-아니라-보유금으로-적립된다) 참고.

또한 회원 문서 생성과 보너스 원장 기록이 **하나의 원자 단위가 아닙니다.** 트랜잭션 커밋 직후
`writeMemberLedgerEntry`가 실패하면 보너스 없는 회원이 남습니다.

### `getPlayerBalance(db, memberId) → Promise<{balance, points}>`

회원의 `memberLedger` 문서를 **전량 다운로드해서 클라이언트에서 합산**합니다.

```js
const snap = await db.collection('memberLedger').where('memberId','==',memberId).get();
let balance = 0, points = 0;
snap.forEach(d=>{
  const r = d.data();
  if (r.category==='point_earn' || r.category==='point_convert') points += Number(r.amount)||0;
  else balance += Number(r.amount)||0;
});
```

| 반환 필드 | 계산식 |
| --- | --- |
| `points` | `category ∈ {point_earn, point_convert}`인 항목의 `amount` 합 |
| `balance` | **그 외 모든** `category`의 `amount` 합 |

분기가 배타적이라는 점이 중요합니다. `point_convert`(포인트 → 보유금 전환) 항목은 음수 `amount`로
포인트를 깎지만, 같은 함수 안에서 보유금에는 아무것도 더하지 않습니다 —
[G-05](explanation-known-gaps.md#g-05--point_convert에-대응하는-보유금-입금-항목이-없다) 참고.

동일한 집계 규칙이 세 곳에 중복 구현되어 있습니다:
[`shared/game-engine.js:117`](../../shared/game-engine.js#L117),
[`partner-admin/app.js:255`](../../partner-admin/app.js#L255),
[`functions/balance/backfillBalances.js:98`](../../functions/balance/backfillBalances.js#L98).

**비용 특성**: 조회할 때마다 해당 회원의 전체 거래 이력을 내려받습니다. 문서 수에 비례해
읽기 비용과 지연이 선형 증가합니다. 이를 대체하기 위한 `balanceTotals` 이중 쓰기가 이미 동작 중이지만
아직 아무도 읽지 않습니다 — [`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md) 참고.

---

## 베팅과 정산

### `placeBet(db, opts) → Promise<void>`

베팅 1건을 `memberLedger`에 **음수** 금액으로 기록합니다.

| `opts` 필드 | 타입 | 설명 |
| --- | --- | --- |
| `memberId` | `string` | |
| `casino` | `string` | |
| `tableId` | `string` | `relatedTableId`로 저장 |
| `roundId` | `string` | `relatedRoundId`로 저장 |
| `betType` | `'player'` \| `'banker'` \| `'tie'` \| `'playerPair'` \| `'bankerPair'` | |
| `amount` | `number` | 부호 무관 — `-Math.abs(amount)`로 정규화됨 |
| `staff` | `string` | 없으면 `'system'`. 아바타 모드는 `'avatar'`를 전달 |

기록되는 문서:

```js
{
  memberId, casino,
  amount: -Math.abs(amount),
  category: 'bet',
  betType,
  relatedTableId: tableId,
  relatedRoundId: roundId,
  staff,
  createdAt:       serverTimestamp(),        // 서버 시각 (Timestamp 객체로 읽힘)
  clientCreatedAt: new Date().toISOString(), // 클라이언트 시각 (문자열)
  deviceId:        getDeviceId()
}
```

**한도 검증이 없습니다.** 테이블의 `betMin`/`betMax`도, 회원의 `betMin`/`betMax`도 확인하지 않으며
잔액 검사도 하지 않습니다 —
[G-02](explanation-known-gaps.md#g-02--베팅-한도가-어디에서도-강제되지-않는다) ·
[G-03](explanation-known-gaps.md#g-03--아바타-자동베팅은-잔액을-확인하지-않는다) 참고.

### `settleBet(db, opts) → Promise<number>`

한 베팅의 배당을 계산하고, 배당금이 있으면 `memberLedger`에 **양수** 항목을 기록합니다.

| `opts` 필드 | 설명 |
| --- | --- |
| `memberId`, `casino`, `tableId`, `roundId`, `betType`, `amount` | `placeBet`과 동일 |
| `resultInfo` | `simulateRound()` 반환값 (`result`, `playerPair`, `bankerPair`만 사용) |

배수 결정 규칙:

| `betType` | 반환 배수 |
| --- | --- |
| `player` | `result==='player'` → `2.0` · `result==='tie'` → `1` (원금 반환) · 그 외 `0` |
| `banker` | `result==='banker'` → `1.95` · `result==='tie'` → `1` (원금 반환) · 그 외 `0` |
| `tie` | `result==='tie'` → `9.0` · 그 외 `0` |
| `playerPair` | `resultInfo.playerPair` → `12.0` · 그 외 `0` |
| `bankerPair` | `resultInfo.bankerPair` → `12.0` · 그 외 `0` |

```js
const payout = Math.round(amount * mult);
if (payout > 0){ /* memberLedger에 category:'payout' 기록 */ }
return payout;
```

- **타이는 P/B 베팅에 대해 푸시(무승부)입니다.** 배수 `1`로 원금이 그대로 돌아옵니다.
  베팅 시 이미 차감되었으므로 원장에는 `-N`(bet)과 `+N`(payout) 두 줄이 남습니다.
- `payout === 0`이면 **아무 문서도 쓰지 않습니다.** 패배한 베팅은 `bet` 항목 하나만 남습니다.
- 반올림은 `Math.round`입니다. 뱅커 배당(×1.95)에서 원 단위 반올림이 발생할 수 있습니다.
  예: `10001 × 1.95 = 19501.95` → `19502`.
- `staff`는 항상 `'system'`으로 고정 기록됩니다 (아바타가 대신 건 베팅의 정산도 동일).

### `writeRoundDoc(db, opts) → Promise<string>`

라운드 결과를 `rounds` 컬렉션에 기록하고 **새로 생성한 문서 ID**를 반환합니다.

| `opts` 필드 | 설명 |
| --- | --- |
| `tableId` | |
| `tableType` | `'avatar'` \| `'speed'` |
| `roundNo` | 테이블 내 라운드 번호 |
| `shoeNo` | 슈 번호 (테이블 문서의 `shoeNo`, 없으면 `1`) |
| `sim` | `simulateRound()` 반환값 |
| `startedAt` | ISO 문자열. 호출자가 역산해서 넘김 |

기록되는 문서:

```js
{
  tableId, tableType, roundNo, shoeNo,
  phase: 'result',
  playerCards: ['Q♥','7♠'],        // rank + suit 문자열. 서드카드가 있으면 3개
  bankerCards: ['3♦','K♣','5♥'],   // 두 배열의 길이는 서로 다를 수 있음
  playerScore, bankerScore,
  result, playerPair, bankerPair,
  startedAt,                              // 호출자가 넘긴 ISO 문자열
  resultAt: new Date().toISOString(),     // 클라이언트 시각
  editedBy: null, editedReason: null      // 파트너 어드민 사후 수정용 자리
}
```

> **주의 — 라운드 ID가 베팅과 연결되지 않습니다.**
> 이 함수는 `const id = uuidv4()`로 **새 ID를 자체 생성**합니다. 반면 같은 라운드의 베팅은
> 호출자가 만든 별도의 `currentRoundId`를 `relatedRoundId`로 기록합니다. 두 값은 서로 다른 UUID이며,
> 따라서 `memberLedger.relatedRoundId`로 `rounds` 문서를 조인할 수 없습니다. 상세:
> [G-01](explanation-known-gaps.md#g-01--베팅의-relatedroundid가-rounds-문서-id와-일치하지-않는다).

`startedAt`은 실측이 아니라 역산입니다. 호출자가
`new Date(Date.now() - (베팅초 + 딜링초) * 1000)`으로 계산해서 넘깁니다
([`avatar/app.js:817`](../../avatar/app.js#L817), [`avatar/app.js:1169`](../../avatar/app.js#L1169)).
딜링 애니메이션(1.04~1.56초)과 `await` 지연은 반영되지 않으므로 실제 시작 시각보다 늦게 기록됩니다.

---

## 로드맵 (로드) 빌더

알고리즘의 배경과 실제 카지노 보드와의 차이는 [룰과 로드맵](explanation-rules-roadmaps.md)에서
다룹니다. 여기서는 함수 계약만 기술합니다.

### `buildBigRoad(results, pairFlags) → Column[]`

결과 배열을 빅로드 열(column) 구조로 변환합니다.

| 인자 | 타입 | 설명 |
| --- | --- | --- |
| `results` | `('player'\|'banker'\|'tie')[]` | **오래된 것부터** 정렬 |
| `pairFlags` | `({playerPair,bankerPair}\|undefined)[]` | 선택. `results`와 같은 인덱스로 대응 |

반환 `Column`:

```js
{
  side:  'player' | 'banker' | null,   // null = 첫 결과가 타이여서 생긴 선행 타이 열
  items: ('player'|'banker')[],        // 이 열에 쌓인 연속 결과
  pairs: ({playerPair,bankerPair}|undefined)[],  // items와 같은 인덱스
  ties:  number                        // 이 열에 붙은 타이 횟수
}
```

규칙:

1. `'tie'`는 **새 열을 만들지 않습니다.** 직전 열의 `ties`를 1 증가시킵니다.
2. 아직 열이 하나도 없는 상태에서 타이가 나오면 `{side:null, items:[], pairs:[], ties:1}` 열이
   하나 생깁니다.
3. 직전 열의 `side`와 같으면 그 열에 이어 쌓고, 다르면 새 열을 시작합니다.

```js
buildBigRoad(['banker','banker','tie','player'])
// → [ {side:'banker', items:['banker','banker'], pairs:[undefined,undefined], ties:1},
//     {side:'player', items:['player'],          pairs:[undefined],           ties:0} ]
```

타이가 `'banker'` 열에 붙었다는 점에 주의하세요. 타이는 **직후에 오는 결과가 아니라 직전 열**에
귀속됩니다.

### `renderBigRoad(cols, maxRows) → string`

`buildBigRoad` 결과를 HTML 문자열로 렌더링합니다. `maxRows` 기본값은 `6`.

- `side`가 `null`인 열은 `<div class="br-cell tie-only">{ties}</div>` 하나로 렌더링됩니다.
- 한 열의 `items`가 `maxRows`를 넘으면 다음 `.br-col`로 이어 그립니다 (드래곤 테일 줄바꿈).
  잘라내거나 카운터로 요약하지 않습니다.
- 타이 배지는 열 전체에서 **첫 번째 셀(`idx===0`)에만** 표시됩니다. 여러 `.br-col`로 나뉘어도
  첫 조각의 첫 셀에만 붙습니다.
- 타이 배지는 `<span class="br-tie">`이며, CSS가 `::before`로 사선을 긋습니다. 같은 열에 타이가
  **2회 이상**일 때만 안쪽에 `<span>{횟수}</span>` 숫자가 추가됩니다 — 1회면 사선만 그어집니다.
  미니 로드(`.lobby-card .mini-road`)는 이 안쪽 `<span>`을 `display:none`으로 숨깁니다
  ([`shared/game-ui.css:101`](../../shared/game-ui.css#L101)).
- 페어 표시는 셀 안의 코너 점입니다: `<i class="br-pair player">`(좌상단, 파랑),
  `<i class="br-pair banker">`(우하단, 빨강). 두 페어가 동시에 나면 점 두 개가 함께 찍힙니다.

```html
<!-- 뱅커 2연속 + 타이 1회 (사선만) -->
<div class="br-col">
  <div class="br-cell banker"><span class="br-tie"></span></div>
  <div class="br-cell banker"></div>
</div>

<!-- 같은 열에 타이 3회 (사선 + 숫자 배지) -->
<div class="br-cell banker"><span class="br-tie"><span>3</span></span></div>
```

### `renderBeadRoad(results, pairFlags) → string`

비드 플레이트(진주로, 육매)를 렌더링합니다.

> **2026-08 변경**: 예전에는 "6개씩 무조건 세로로 채우는 엄격한 시간순"이었지만, 지금은
> **빅로드와 같은 열 규칙**을 씁니다. 이 프로젝트가 참고한 실물 보드가 그렇게 그리기 때문입니다.

- 연속된 같은 값이 한 열에 쌓이고, **값이 바뀌면 새 열**이 시작됩니다. 따라서 한 열에는
  P/B/T 중 한 종류만 들어갑니다.
- 한 열이 6개(`BEAD_ROWS`)를 넘으면 다음 `.br-col`로 이어 그립니다 (빅로드와 같은 드래곤 테일).
- 타이도 자기 열을 가집니다. 빅로드처럼 직전 열에 흡수되지 않습니다.
- 각 비드는 결과 글자(`P`/`B`/`T`)와 페어 코너 점을 함께 가집니다.
- 셀 클래스는 `bd-cell player|banker|tie`.

```js
renderBeadRoad(['banker','banker','tie','player'])
// 1열: B B  /  2열: T  /  3열: P
```

```html
<div class="br-col">
  <div class="bd-cell banker">B</div>
  <div class="bd-cell banker">B<i class="br-pair banker"></i></div>
</div>
<div class="br-col"><div class="bd-cell tie">T</div></div>
```

호출자는 `BEAD_WINDOW`(40)로 잘라서 넘깁니다. 열 그룹핑 때문에 슈 전체를 그리면 패널 너비를
크게 넘어서기 때문입니다.

### `groupIntoRoadColumns(values) → {value, items}[]`

연속된 동일 값을 한 열로 묶습니다. 파생 로드 렌더링에 쓰이는 범용 헬퍼입니다.
`renderBeadRoad`도 같은 규칙을 쓰지만 페어 플래그를 함께 실어야 해서 이 함수를 호출하지 않고
자체 루프로 구현되어 있습니다 ([`shared/game-engine.js:220-225`](../../shared/game-engine.js#L220-L225)).

```js
groupIntoRoadColumns(['red','red','blue','red'])
// → [{value:'red', items:['red','red']}, {value:'blue', items:['blue']}, {value:'red', items:['red']}]
```

### `renderRoadColumns(cols, cellHtmlFn, maxRows) → string`

`groupIntoRoadColumns` 결과를 HTML로 렌더링합니다. `maxRows` 기본값 `6`, 드래곤 테일 줄바꿈은
`renderBigRoad`와 동일합니다. `cellHtmlFn(value)`가 셀 하나의 HTML을 반환해야 합니다.

### `deriveRoad(cols, offset) → ('red'|'blue')[]`

빅로드 열 배열에서 파생 로드의 마크 시퀀스를 만듭니다.

```js
for (let i = offset; i < cols.length; i++){
  if (!cols[i].side) continue;                       // 선행 타이 열 건너뜀
  for (let j = 0; j < cols[i].items.length; j++){
    if (j === 0){
      if (i < offset + 1) continue;
      mark = cols[i-offset].items.length === cols[i-offset-1].items.length ? 'red' : 'blue';
    } else {
      mark = cols[i-offset].items.length === j ? 'blue' : 'red';
    }
  }
}
```

| 위치 | 비교 대상 | red 조건 |
| --- | --- | --- |
| 열의 첫 셀 (`j===0`, 진행 방향 전환) | `offset`칸 뒤 **두 열의 길이** | 두 열 길이가 같음 |
| 열의 이어지는 셀 (`j>0`) | `offset`칸 뒤 열의 행 `j`와 행 `j-1` | 두 칸이 **둘 다 차 있거나 둘 다 비어 있음** |

> **2026-08 수정**: `j>0` 규칙이 `items.length > j ? red : blue`에서
> `items.length === j ? blue : red`로 바뀌었습니다 (커밋 `9eec17d`).
> 표준 규칙은 "대상 열의 행 `j`와 행 `j-1` 두 칸을 비교해 둘 다 차 있거나 둘 다 비었으면 red,
> 정확히 하나만 차 있으면 blue"입니다. 대상 열 길이를 `L`이라 하면 한 칸만 차 있는 경우는
> `L === j`뿐이므로 새 식이 표준과 정확히 일치합니다. 예전 식은 `L < j`(두 칸 모두 비어 있음)까지
> blue로 잘못 찍었습니다.

`offset`이 클수록 더 먼 과거와 비교합니다:

| 함수 | `offset` | 로드 이름 | 렌더 스타일 |
| --- | --- | --- | --- |
| `deriveBigEyeBoy(cols)` | `1` | 대안목 (Big Eye Boy) | 빈 링 (기본) |
| `deriveSmallRoad(cols)` | `2` | 소로 (Small Road) | 채워진 점 (`'filled'`) |
| `deriveCockroachRoad(cols)` | `3` | 갑충로 (Cockroach Road) | 대각선 (`'diagonal'`) |

시작 시점은 표준 규칙과 일치합니다. 대안목(`offset=1`)은 빅로드 2열의 2번째 셀 또는 3열의 1번째
셀부터 그려집니다.

> **엣지 케이스**: `cols[0]`이 선행 타이 열(`side:null`, `items.length === 0`)이면 오프셋 계산이
> 한 칸 밀리고 길이 0인 열과 비교하게 되어 마크가 왜곡됩니다. 슈의 첫 결과가 타이인 경우에만
> 발생합니다.

### `renderDerivedRoad(marks, style) → string`

`deriveRoad` 결과를 3행(`DERIVED_ROAD_ROWS`) 열로 렌더링합니다.

```js
renderDerivedRoad(deriveBigEyeBoy(cols));              // <div class="dr-cell red">
renderDerivedRoad(deriveSmallRoad(cols), 'filled');    // <div class="dr-cell blue filled">
renderDerivedRoad(deriveCockroachRoad(cols), 'diagonal');
```

세 로드는 **위치가 아니라 마크 모양으로** 구분됩니다. 빅로드 아래 한 패널에 3단으로 쌓이므로
빅로드의 6행이 아니라 3행 깊이입니다.

---

## 테이블 목록 통계

### `tableWinCounts(results) → {player, banker, tie}`

결과 배열의 종류별 횟수입니다. 항상 세 키가 모두 존재하며 초기값은 0입니다.

### `trailingStreak(results) → {side, len}`

마지막 연속 승수를 셉니다.

- **타이는 연속을 끊지도, 늘리지도 않습니다.** 먼저 `results.filter(r => r !== 'tie')`로 제거한 뒤
  계산합니다.
- 비타이 결과가 하나도 없으면 `{side: null, len: 0}`을 반환합니다.

```js
trailingStreak(['player','banker','tie','banker'])  // → {side:'banker', len:2}
```

`avatar/app.js`는 `len >= 3`일 때 🔥 배지를 붙이고, 로비 정렬 옵션 "좋은 흐름순"의 정렬 키로 씁니다.

### `tableBetVolume(betLedgerRows) → {total, today}`

베팅 원장 행들의 금액 합계입니다.

| 반환 필드 | 계산식 |
| --- | --- |
| `total` | 모든 행의 `Math.abs(amount)` 합 |
| `today` | `createdAt`의 앞 10자가 오늘 날짜(`YYYY-MM-DD`)인 행들의 합 |

```js
if ((b.createdAt||'').slice(0,10) === todayStr) today += amt;
```

> **주의 — `createdAt`이 문자열일 때만 동작합니다.**
> 실제 게임 플레이로 생성된 `memberLedger` 문서의 `createdAt`은
> `firebase.firestore.FieldValue.serverTimestamp()`로 쓰이며 읽을 때는 `Timestamp` **객체**입니다.
> 객체는 truthy이므로 `|| ''` 폴백이 걸리지 않고, `.slice`가 없어 `TypeError`가 발생합니다.
> 파트너 어드민의 데모 시드는 ISO 문자열로 기록하므로 데모에서는 드러나지 않습니다. 상세:
> [G-06](explanation-known-gaps.md#g-06--tablebetvolume이-timestamp-createdat에서-typeerror를-던진다).

---

## 칩 스택 시각화

### `decomposeChipStack(amount, maxDiscs) → number[]`

금액을 큰 액면가부터 탐욕적으로 분해합니다. `maxDiscs` 기본값 `4`.

```js
decomposeChipStack(1150000)  // → [1000000, 100000, 50000]
decomposeChipStack(3000)     // → [5000]   ← 아래 설명 참고
decomposeChipStack(0)        // → []
```

- `maxDiscs`에 도달하면 남은 금액이 있어도 중단합니다. **시각화 전용이며 금액을 정확히 표현하지
  않습니다.**
- 어떤 액면가로도 나눌 수 없지만 `amount > 0`이면 최소 액면가(`CHIP_VALUES[0]` = 5,000) 한 개를
  넣습니다.

### `chipStackHtml(amount) → string`

`decomposeChipStack` 결과를 `<div class="cs-chip c{액면}">` 목록으로 변환합니다. `amount`가
falsy면 빈 문자열입니다.

> **현재 호출자가 없습니다.** 베팅 스팟에 칩이 쌓이는 펠트 비주얼을 위해 준비되었으나
> `avatar/app.js`는 이 함수를 쓰지 않고 금액 텍스트만 표시합니다.

---

## 함수 요약표

| 함수 | 순수 함수 | Firestore 접근 | 반환 |
| --- | --- | --- | --- |
| `cardValue` | ✅ | — | `number` |
| `handTotal` | ✅ | — | `number` (0~9) |
| `randCard` | ❌ (`Math.random`) | — | `{rank,suit}` |
| `simulateRound` | ❌ | — | `RoundResult` |
| `dealSequence` | ✅ | — | `[side,index][]` |
| `playerLogin` | ❌ | 읽기 + 쓰기 | `LoginResult` |
| `playerSignup` | ❌ | 트랜잭션 + 배치 쓰기 | `SignupResult` |
| `getPlayerBalance` | ❌ | 읽기 (전량) | `{balance,points}` |
| `placeBet` | ❌ | 배치 쓰기 | `void` |
| `settleBet` | ❌ | 조건부 배치 쓰기 | `number` |
| `writeRoundDoc` | ❌ | 쓰기 | `string` (새 문서 ID) |
| `buildBigRoad` | ✅ | — | `Column[]` |
| `renderBigRoad` | ✅ | — | HTML `string` |
| `renderBeadRoad` | ✅ | — | HTML `string` |
| `groupIntoRoadColumns` | ✅ | — | `{value,items}[]` |
| `renderRoadColumns` | ✅ | — | HTML `string` |
| `deriveRoad` / `deriveBigEyeBoy` / `deriveSmallRoad` / `deriveCockroachRoad` | ✅ | — | `('red'\|'blue')[]` |
| `renderDerivedRoad` | ✅ | — | HTML `string` |
| `tableWinCounts` | ✅ | — | `{player,banker,tie}` |
| `trailingStreak` | ✅ | — | `{side,len}` |
| `tableBetVolume` | ⚠ (`new Date()` 의존) | — | `{total,today}` |
| `decomposeChipStack` | ✅ | — | `number[]` |
| `chipStackHtml` | ✅ | — | HTML `string` |

전체 26개 함수 중 순수 함수가 17개입니다 (`tableBetVolume`은 현재 날짜에 의존해 별도 표기).
이들은 Firebase도 DOM도 필요 없어 단위 테스트 비용이 사실상 0입니다 — `buildBigRoad`,
`deriveRoad`, `renderBeadRoad`, `decomposeChipStack`, `settleBet`의 배수 계산 로직이 테스트를
시작하기 좋은 지점입니다.

**서드카드 룰(`simulateRound`)이 테스트 우선순위 1위입니다.** 타블로 분기가 6갈래인데
`Math.random()`에 직접 의존해 그대로는 테스트할 수 없습니다. 드로우 판정을 순수 함수
(`bankerShouldDraw(bankerTotal, playerThirdValue)` 같은 형태)로 떼어내면 표 전체를 케이스로
덮을 수 있습니다.

---

## 관련 문서

- [처리 흐름 설명](explanation-round-flow.md) — 이 함수들이 라운드 루프에서 호출되는 순서
- [룰과 로드맵 설명](explanation-rules-roadmaps.md) — 왜 이런 배당·로드 규칙인가
- [`avatar/app.js` 레퍼런스](reference-avatar-app.md) — 호출자 쪽 계약
- [알려진 격차](explanation-known-gaps.md) — 이 문서에서 참조한 G-01 ~ G-13
- [Firestore 데이터 모델](../FIRESTORE_DATA_MODEL.md) — 컬렉션 스키마
