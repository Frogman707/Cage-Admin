# 설명 — 처리 흐름과 설계 배경

> **분류**: Explanation (이해 지향)
> **작성 기준일**: 2026-08-15 · 브랜치 `backend`
> **관련 문서**: [엔진 레퍼런스](reference-game-engine.md) · [앱 레퍼런스](reference-avatar-app.md) · [룰과 로드맵](explanation-rules-roadmaps.md) · [알려진 격차](explanation-known-gaps.md)

이 문서는 "이 코드가 왜 이렇게 생겼는가"를 다룹니다. 함수 시그니처는 레퍼런스에, 실행 절차는
하우투에 있습니다.

---

## 이 앱이 풀려는 문제

영업 시연용 카지노 플레이어 사이트입니다. 목표는 두 가지이고, 둘은 서로 당깁니다.

1. **실제 서비스처럼 보여야 한다.** 로비, 로드맵, 칩 트레이, 라운드 타이머, 대리 베팅, 팁, 채팅.
   시연 자리에서 "이건 목업이네요"라는 말이 나오면 안 됩니다.
2. **백엔드 서버가 없어야 한다.** Firebase Hosting에 정적 파일을 올리는 것만으로 동작해야 하고,
   Spark(무료) 요금제 안에서 굴러가야 합니다.

이 두 제약의 교차점이 지금 구조입니다: **딜러도 RNG도 없는 클라이언트 주도 라운드 루프가 돌지만,
그 결과로 발생하는 베팅·배당·라운드는 전부 진짜 Firestore 문서로 남습니다.**

시연 중에 파트너 어드민을 열어 "방금 건 베팅이 여기 원장에 이렇게 쌓입니다"를 보여줄 수 있다는
뜻입니다. 화면만 그럴듯한 목업과 다른 지점이 여기입니다.

대가도 분명합니다. 게임 결과를 만드는 코드가 브라우저에 있으므로 **결과를 신뢰할 수 없습니다.**
개발자 도구에서 `simulateRound`를 덮어쓰면 원하는 결과를 만들 수 있고, `placeBet` 없이
`settleBet`만 호출해 배당을 받을 수도 있습니다.
[`firestore.rules:24-26`](../../firestore.rules#L24-L26)이 `staff`를 제외한 모든 컬렉션을 인증 없이
쓰기 허용하므로 원장에 임의 문서를 직접 넣는 것도 막히지 않습니다.
**실금이 걸리는 환경에 이 구조를 그대로 쓸 수 없습니다.**

---

## 전체 흐름 한 장

```
[브라우저 로드]
   │  index.html이 5개 스크립트를 순서대로 로드
   │  (firebase → cage-ui → i18n → game-engine → app)
   ▼
[DOMContentLoaded]
   cageInitFirebase()  ── 롱폴링 강제 + IndexedDB 영속성
   clearLoginFields()  ── 즉시 + 350ms 후 (자동완성 방어)
   ▼
[로그인 게이트]
   onLogin() ──▶ playerLogin(db, id, pw)
   │              members/{ID} 조회 → 평문 PW 비교 → status 확인
   │              전역 PLAYER 설정 + lastLoginAt 기록
   ▼
[enterApp]
   refreshBalance() ──▶ getPlayerBalance()
   │                     memberLedger where memberId==X 전량 다운로드 → 합산
   │
   ├─ ?mode=speed  ──▶ chooseSpeed()
   ├─ ?mode=avatar ──▶ chooseAvatar()
   └─ 없음         ──▶ showPicker()
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
   [아바타 로비]                        [스피드 로비]
   쿼리 5개 병렬                        쿼리 3개 병렬
        │                                   │
   카드 클릭                            카드 클릭 (목록에 베팅 없음)
        │                                   │
   ┌────┴────┐                              │
   ▼         ▼                              ▼
[미리보기]  [세션]                    [상세 화면 = 유일한 베팅 지점]
 루프 없음   30/4/5초 루프              15/3/3초 루프 × N테이블
             자동 베팅                   수동 베팅 · 단일 틱 1초
```

> **주의**: 상세 화면을 닫아도 스피드 라운드 루프는 전 테이블에서 계속 돕니다. 화면이 없어도
> `SPEED.tstate[id].bets`에 남은 베팅은 딜링 단계에 그대로 집행되므로, 여러 테이블에 걸친
> 베팅 자체는 여전히 가능합니다. 달라진 것은 **베팅 조작 UI가 열린 테이블 안에만 있다**는
> 점입니다.

---

## 라운드 상태 기계

두 모드가 **같은 3단계 기계**를 씁니다. 다른 것은 각 단계의 길이와, 베팅이 어디서 오느냐뿐입니다.

```
    ┌──────────────────────────────────────────────┐
    │                                              │
    ▼                                              │
┌─────────┐  타이머 만료   ┌─────────┐  타이머 만료  ┌────────┐
│ betting │ ────────────▶ │ dealing │ ───────────▶ │ result │
└─────────┘               └─────────┘              └────────┘
  베팅 접수                  베팅 확정               정산 · 기록
  (또는 자동 주입)            결과 생성               로드맵 갱신
```

| | 아바타 | 스피드 |
| --- | --- | --- |
| `betting` | **30초** — 지시가 자동 주입됨 | **15초** — 회원이 상세 화면에서 칩을 놓음 |
| `dealing` | **4초** — `placeBet` × N, 카드 공개 | **3초** — `placeBet` × N, 상세가 열려 있을 때만 카드 공개 |
| `result` | **5초** — `settleBet` × N, `writeRoundDoc` | **3초** — 동일 |
| 총 주기 | 39초 | 21초 |
| 타이머 | `AVATAR.timerHandle` (테이블 1개) | `SPEED.tick` **하나가 전 테이블 순회** |
| 시작 위상 | 즉시 | 테이블 순서마다 3초씩 어긋남 |
| 카드 공개 | `dealSequence` 순서로 260ms × 4~6장 | 동일 (상세 화면에서만) |

**딜링 단계의 여유가 서로 다릅니다.** 서드카드까지 나오면 공개에 1.56초가 걸리는데, 아바타는
4초 예산에서 여유가 크지만 스피드는 3초여서 마진이 좁습니다. 상세 화면이 닫혀 있으면 스피드는
공개를 `await`하지 않으므로 이 문제가 발생하지 않습니다.

### 왜 단계마다 길이가 다른가

아바타는 "전담 아바타가 내 지시대로 대신 걸어주는" 서비스입니다. 회원은 화면을 지켜보되 조작하지
않으므로, 결과를 음미할 시간(5초)과 다음 라운드까지의 호흡(30초)이 길어야 자연스럽습니다.

스피드는 반대로 회전율이 상품입니다. 15초 안에 여러 테이블을 훑으며 칩을 놓는 게 요점이라
전 구간을 압축했습니다.

### 왜 스피드는 타이머를 하나만 쓰는가

`chooseSpeed()`가 `setInterval(tickAllSpeedTables, 1000)` **하나**를 걸고, 그 콜백이 모든 테이블의
`secondsLeft`를 줄입니다. 테이블마다 인터벌을 걸면 N개 타이머가 서로 드리프트해 화면 카운트다운이
어긋나 보입니다.

대신 이 구조는 **한 테이블의 Firestore 쓰기가 느리면 뒤 테이블 카운트다운이 함께 밀립니다.**
콜백 본문이 `await placeBet(...)`을 순차 실행하기 때문입니다. 시연 규모(테이블 3~6개)에서는
드러나지 않지만, 테이블 수가 늘거나 네트워크가 느려지면 타이머가 눈에 띄게 끊깁니다.

### 왜 시작 시각을 어긋나게 하는가

```js
secondsLeft: SPEED_BETTING_SECONDS - (테이블_인덱스 * 3) % SPEED_BETTING_SECONDS
```

모든 테이블이 같은 초에 결과를 뱉으면 화면 전체가 한꺼번에 깜빡여 "하나의 시뮬레이션"처럼 보입니다.
3초씩 밀면 실제 카지노 플로어처럼 여기저기서 결과가 흩어져 나옵니다. 5개 주기로 값이 반복되므로
(15, 12, 9, 6, 3, 15, …) 테이블이 6개를 넘으면 위상이 겹치기 시작합니다.

---

## 아바타 대리 베팅의 수명 주기

이 앱에서 가장 많은 참여자가 얽히는 흐름입니다. **회원 → 파트너 어드민 직원 → 클라이언트 자동
실행**의 3단 구조입니다.

```
회원                        Firestore                    파트너 어드민 직원
 │                              │                              │
 │ submitAvatarRequest()        │                              │
 ├─────────────────────────────▶│ avatarRequests/{uuid}        │
 │                              │  status: '대기'               │
 │                              │  betSide, betAmount, buyin   │
 │                              │◀─────────────────────────────┤ 목록 조회
 │                              │                              │
 │                              │        openApproveAvatarRequestModal()
 │                              │◀─────────────────────────────┤ 담당 아바타 ID 입력
 │                              │ status: '진행중'              │
 │                              │ avatarStaffId: 'STAFF01'     │  + adminLogs 기록
 │                              │ approvedAt                   │
 │  (수동 새로고침 필요)          │                              │
 │◀─────────────────────────────┤                              │
 │ handleAvatarCardClick →      │                              │
 │ enterAvatarSession()         │                              │
 │  ↻ 매 라운드 자동 베팅         │                              │
 │  ├──▶ placeBet(staff:'avatar')│ memberLedger (bet)          │
 │  └──▶ settleBet()            │ memberLedger (payout)        │
 │                              │ rounds/{uuid}                │
 │                              │                              │
 │ endAvatarSession()           │                              │
 ├─────────────────────────────▶│ status: '종료', endedAt      │
 │                              │◀─────────────────────────────┤ 또는 강제 종료
```

### 승인이 실시간으로 전달되지 않는다

회원 화면은 `avatarRequests`를 `onSnapshot`으로 구독하지 않습니다. `goAvatarLobby()`가 실행될 때
`get()`으로 한 번 읽을 뿐입니다. 승인 직후 회원 화면은 여전히 "⏳ 승인 대기"를 표시하며, 회원이
로비를 다시 열거나 새로고침해야 "↩ 재입장"으로 바뀝니다.

실시간 구독을 붙이면 해결되지만, 그러면 `avatarRequests` 전체에 대한 상시 리스너가 회원 수만큼
열립니다. 채팅에는 `onSnapshot`을 쓰고 여기에는 쓰지 않은 것은 그 비용 판단으로 보입니다.

### 지시는 세션 중 바꿀 수 없다

`beginAvatarBettingPhase()`가 매 라운드 시작 시 `AVATAR.request.betSide`/`betAmount`를 그대로
베팅 슬롯에 채웁니다. 진행중 세션 화면에는 지시를 수정하는 UI가 없습니다. 바꾸려면 세션을 종료하고
새로 신청해야 하는데, 종료된 요청은 `avatarRequestStateForTable`에서 그날 `'full'` 상태를 만들어
같은 테이블 재신청을 막습니다.

의도된 제약(하루 1세션)일 수도 있고 부작용일 수도 있는데, 코드만으로는 판단할 수 없습니다.

### 대리 실행의 흔적은 `staff` 필드 하나뿐

아바타가 대신 건 베팅은 `memberLedger`에 `staff: 'avatar'`로 남습니다. 스피드 자가 베팅은
`staff: 'system'`입니다. 그런데 **정산(`settleBet`)은 두 모드 모두 `staff: 'system'`으로 고정**되어
있어, 배당 항목만 보면 대리 베팅 여부를 알 수 없습니다.

또한 `staff: 'avatar'`는 리터럴 문자열이라 **어느 직원이 담당이었는지 원장에 남지 않습니다.**
그 정보는 `avatarRequests.avatarStaffId`에만 있고, 베팅 원장에 `relatedRequestId`가 없어
조인할 수도 없습니다 (팁 항목에는 `relatedRequestId`가 있습니다).

---

## 돈이 움직이는 경로

### append-only 원장 하나가 진실의 원천

이 프로젝트의 핵심 원칙입니다. [`docs/FIRESTORE_DATA_MODEL.md`](../FIRESTORE_DATA_MODEL.md)에
자세히 있지만 요약하면:

> **잔액은 저장하지 않는다. 오직 계산한다.**

`memberLedger`는 부호 있는 금액을 가진 이벤트 문서의 나열이고, 보유금은 그 합입니다. 여러 단말이
오프라인에서 각자 기록해도 나중에 둘 다 존재하게 될 뿐 — "마지막 저장이 이긴다"로 한쪽 거래가
사라지는 일이 없습니다.

한 라운드에서 실제로 쌓이는 문서:

| 시점 | `category` | `amount` | 쓰는 함수 |
| --- | --- | --- | --- |
| 딜링 시작 | `bet` | `-베팅액` | `placeBet` |
| 결과 확정 (당첨 시만) | `payout` | `+배당액` | `settleBet` |

패배한 베팅은 `bet` 한 줄만 남습니다 (`payout === 0`이면 문서를 쓰지 않음). 타이로 인한 푸시는
`-N`과 `+N` 두 줄이 남습니다 — 이 편이 "환불했다"는 사실을 원장이 스스로 증언한다는 점에서
더 낫습니다.

### 화면 숫자는 원장을 다시 읽지 않는다

```
enterApp()  ──▶ getPlayerBalance()  ──▶ STATE.balance = 진짜 값
   │
   ├─ 베팅   ──▶ STATE.balance -= 베팅액     (로컬 산술)
   ├─ 배당   ──▶ STATE.balance += 배당액     (로컬 산술)
   ├─ 팁     ──▶ STATE.balance -= 팁액       (로컬 산술)
   │
   └─ (세션 내내 Firestore 재조회 없음)
```

라운드마다 `getPlayerBalance()`를 부르면 원장 전량을 39초(또는 21초)마다 다시 내려받게 되므로
쓰지 않은 것입니다. 대신 화면 숫자와 원장이 어긋날 수 있습니다:

- 다른 탭이나 파트너 어드민에서 같은 회원의 잔액을 조정하면 이 탭에는 반영되지 않습니다.
- `placeBet`이 실패해도 `STATE.balance`는 이미 차감되어 있습니다 (`await` 이후 무조건 실행).
- 재접속하면 원장 기준으로 다시 계산되므로 **영구적 오차는 아닙니다.** 세션 내 표시 오차입니다.

### `balanceTotals` 이중 쓰기 — 아직 아무도 읽지 않는 숫자

`writeMemberLedgerEntry()`([`shared/cage-ui.js:202`](../../shared/cage-ui.js#L202))는 원장 문서
하나를 쓸 때마다 **같은 배치 안에서** `balanceTotals/member_{memberId}`에
`FieldValue.increment()`를 적용합니다.

```js
const batch = db.batch();
batch.set(ledgerRef, entry);
batch.set(balRef, {[field]: FieldValue.increment(Number(entry.amount)||0)}, {merge:true});
await batch.commit();
```

같은 배치라는 점이 핵심입니다. 부분 실패 시 둘 다 안 쓰이지, 하나만 쓰이는 상태가 되지 않습니다.

지금은 **아무도 이 값을 읽지 않습니다.** `getPlayerBalance()`도 파트너 어드민도 여전히 원장을
전량 합산합니다. 이 이중 쓰기는 "나중에 컷오버할 때 이미 유지되고 있는 숫자를 쓰기 위한" 준비
단계이며, 그 전에 파생 합계와 대조하는 섀도 리드 기간을 두도록 설계되어 있습니다 —
[`docs/BALANCE_ARCHITECTURE_DESIGN.md`](../BALANCE_ARCHITECTURE_DESIGN.md) 참고.

한 함수에 몰아둔 것도 의도적입니다. 호출부마다 인라인 `.set()`을 쓰면 새 쓰기 지점이 증분을
빠뜨릴 수 있습니다.

---

## Firestore 쿼리 전략

앱의 **모든 컬렉션 쿼리가 단일 등가 필터**만 씁니다. 예외가 없습니다.

```js
db.collection('rounds').where('tableType','==','avatar').get()
db.collection('memberLedger').where('category','==','bet').get()
db.collection('chatMessages').where('tableId','==',tableId).limit(200)
```

`where` 두 개나 `where` + `orderBy` 조합은 Firestore 복합 인덱스를 요구합니다. 인덱스를 배포하려면
`firestore.indexes.json`을 관리하고 `firebase deploy --only firestore:indexes`를 돌려야 하는데,
"정적 파일만 올리면 되는 데모"라는 전제와 충돌합니다. 인덱스가 없으면 쿼리는 런타임에 실패하고,
시연 도중 빈 화면이 뜹니다.

그래서 **정렬·필터·조인을 전부 클라이언트로 옮겼습니다.**

| 필요한 것 | 서버에서 했다면 | 실제 구현 |
| --- | --- | --- |
| 라운드 시간순 | `.orderBy('startedAt')` | `rounds.sort((a,b)=>new Date(a.startedAt)-new Date(b.startedAt))` |
| 내 팁만 | `.where('memberId','==',X).where('category','==','avatar_tip')` | 회원 원장 전량 받고 `relatedRequestId`로 필터 |
| 채팅 최신순 | `.orderBy('dt','desc').limit(30)` | `limit(200)` 후 클라이언트 정렬 → `slice(-30)` |
| 테이블별 베팅액 | 집계 쿼리 | `category=='bet'` **전량** 받고 `relatedTableId`로 필터 |

비용은 데이터 크기에 선형입니다. 라운드 100건·회원 20명 규모에서는 무해하지만, 로비를 열 때마다
전 회원의 모든 베팅 원장을 내려받는 구조는 확장되지 않습니다. 채팅의 `limit(200)`은 이미 정확성
문제를 만들고 있습니다 ([G-11](explanation-known-gaps.md#g-11--채팅-쿼리가-orderby-없이-limit200을-쓴다)).

---

## 렌더링 모델 — `innerHTML` 문자열 조립

가상 DOM도 템플릿 엔진도 없습니다. 화면은 템플릿 리터럴로 HTML 문자열을 만들어 `innerHTML`에
넣는 방식으로 만들어집니다.

```js
view.innerHTML = avatarTableShellHtml();
renderAvatarRoad();
renderAvatarTally();
```

이 선택이 만들어낸 세 가지 규칙이 코드 곳곳에 박혀 있습니다.

**1. 사용자 입력은 반드시 `escapeHtml()`을 거친다.** 테이블명, 닉네임, 채팅 본문이 대상입니다.
안 하면 XSS가 됩니다. 채팅 렌더링([`avatar/app.js:837`](../../avatar/app.js#L837)), 아바타 로비 카드
([`avatar/app.js:436`](../../avatar/app.js#L436)), 스피드 타일
([`avatar/app.js:893`](../../avatar/app.js#L893))이 이를 지킵니다.

**2. 뷰를 떠날 때 컨테이너를 비운다.** `stopAllLoops()`가 `viewAvatarTable.innerHTML = ''`을
실행하는 이유입니다. 아바타 테이블이 만드는 `#myBetHistory`와 칩 트레이는 스피드 로비의 정적
요소와 **같은 id**를 씁니다. 둘이 동시에 DOM에 있으면 `getElementById`가 먼저 만난 쪽을 반환해
엉뚱한 곳에 렌더링됩니다.

**3. 언어를 바꾸면 화면을 다시 그린다.** `applyI18n()`은 `data-i18n` 속성이 붙은 정적 요소만
갱신합니다. JS 템플릿 안에서 `${t('key')}`로 이미 문자열이 된 텍스트는 손대지 못합니다. 그래서
`onLangChange()`가 현재 보이는 화면을 통째로 다시 그립니다.

### 스코어보드를 두 화면이 공유하는 방법

`avatarScoreboardHtml(idSuffix)` 하나가 아바타 테이블과 스피드 상세 양쪽의 스코어보드를 만듭니다.
`idSuffix`가 `'avatar'`냐 `'detail'`이냐에 따라 `road-avatar` / `road-detail`처럼 id가 갈립니다.

id 충돌을 막는 것은 **"두 뷰가 동시에 마운트되지 않는다"는 규칙뿐**입니다. 타입 시스템도
스코핑도 없습니다. 그 규칙을 지키는 것이 `stopAllLoops()`의 컨테이너 비우기입니다.

---

## 다국어 (i18n)

[`shared/i18n.js`](../../shared/i18n.js)가 ko/zh/en/ja/vi 5개 언어를 하나의 사전 객체로 관리합니다.

```js
function t(key, vars){
  const entry = I18N_DICT[key];
  let s = entry ? (entry[I18N_LANG] || entry.ko || key) : key;
  if (vars) Object.entries(vars).forEach(([k,v])=>{ s = s.replace('{'+k+'}', v); });
  return s;
}
```

폴백이 3단입니다: 선택 언어 → 한국어 → **키 문자열 그대로**. 번역이 빠져도 화면이 깨지지 않고
영문 키가 노출될 뿐입니다.

베팅 타입 키가 i18n 키와 **1:1로 일치**하도록 설계된 점이 깔끔합니다:

```js
function betLabel(type){ return t(type); }  // 'player' → t('player') → '플레이어'
```

`player`/`banker`/`tie`/`playerPair`/`bankerPair` 다섯 개가 사전에 그대로 있어 매핑 테이블이
필요 없습니다.

다만 스피드 결과 배너만 i18n을 빠져나갑니다:

```js
setSpeedTilePhaseText(tableId, sim.result==='player' ? 'PLAYER WIN' : ...);  // 하드코딩
```

아바타 모드는 `t('phasePlayerWin')`을 쓰므로, 같은 사건이 모드에 따라 다른 언어로 표시됩니다.
이 문자열은 스피드 **상세 화면이 열려 있을 때만** 나타납니다 — 목록 카드에는 단계 캡션이
없기 때문입니다.

`speedLobbySub`(스피드 로비 부제)도 개편에 맞춰 바뀌었습니다: "여러 테이블을 동시에 베팅할 수
있습니다" → **"테이블을 선택해 입장하세요"** (5개 언어 전부). `avatar/index.html`의 인라인
한국어 폴백 텍스트는 예전 문구 그대로지만, `applyI18n()`이 로드 직후 덮어씁니다.

파트너 어드민(`/partner-admin/`)은 내부 직원 도구라 한국어 전용이며 i18n을 쓰지 않습니다.

---

## 트레이드오프 정리

| 선택 | 얻은 것 | 잃은 것 |
| --- | --- | --- |
| 클라이언트 주도 라운드 루프 | 서버 0대. 정적 호스팅만으로 완결 | 결과를 신뢰할 수 없음. 실금 운영 불가 |
| 실제 Firestore 문서 영속화 | 시연 중 어드민에서 데이터 흐름을 증명 가능 | 데모 데이터와 실데이터가 같은 컬렉션에 섞임 |
| 단일 등가 필터만 사용 | 복합 인덱스 배포 불필요 | 전량 다운로드. 확장 불가. 채팅 최신성 결함 |
| 로컬 잔액 산술 | 라운드마다 원장 재조회 없음 | 세션 내 표시 오차. 다중 탭 비동기화 |
| `innerHTML` 문자열 조립 | 빌드 단계 없음. 파일 열면 바로 실행 | XSS 방어를 사람이 기억해야 함. id 충돌 위험 |
| `balanceTotals` 이중 쓰기 (읽지 않음) | 컷오버 시점에 검증된 숫자 확보 | 지금은 쓰기 비용만 발생 |
| append-only 원장 | 오프라인 다단말 안전. 감사 가능 | 잔액 조회가 O(거래 수) |
| 아바타 승인을 폴링으로 확인 | 상시 리스너 비용 없음 | 승인이 즉시 전달되지 않음 |
| 스피드 단일 타이머 | 카운트다운 드리프트 없음 | 느린 쓰기가 전체 타이머를 지연시킴 |

---

## 대안으로 고려할 만한 것

코드 주석과 [`docs/architecture/`](../architecture/)에서 읽어낼 수 있는 방향입니다.

**결과 생성을 서버로 옮기기.** `simulateRound()`를 Cloud Function 또는 별도 게임 서버로 옮기고,
클라이언트는 결과를 구독만 하게 만듭니다. 이렇게 하면 결과 신뢰 문제와 다중 클라이언트 동기화가
동시에 풀립니다 (지금은 두 사람이 같은 테이블에 들어가면 서로 다른 카드를 봅니다). 대신 서버가
필요해지고 Spark 요금제를 벗어납니다.

**정산을 서버로 옮기기.** `placeBet`과 `settleBet`을 하나의 서버 트랜잭션으로 묶으면 잔액 검사와
한도 검증을 강제할 수 있고, 클라이언트가 `settleBet`만 호출하는 공격이 막힙니다.

**`balanceTotals` 컷오버.** 이미 이중 쓰기가 돌고 있으므로 섀도 리드로 검증한 뒤 읽기를 전환하면
`getPlayerBalance()`의 O(거래 수) 비용이 O(1)이 됩니다. 설계 문서에 절차가 정리되어 있습니다.

**PostgreSQL 원장으로 이관.** [`docs/architecture/`](../architecture/)에 목표 아키텍처와 DDL이
준비되어 있습니다. Firestore의 단일 등가 필터 제약과 집계 비용이 근본적으로 사라지는 대신
운영 부담이 생깁니다.

---

## 관련 문서

- [룰과 로드맵](explanation-rules-roadmaps.md) — 게임 규칙 자체의 구현과 실제 바카라와의 차이
- [알려진 격차](explanation-known-gaps.md) — 이 문서에서 언급한 결함의 재현 조건과 영향
- [앱 레퍼런스](reference-avatar-app.md) — 함수 단위 계약
- [엔진 레퍼런스](reference-game-engine.md) — 엔진 API
- [Firestore 데이터 모델](../FIRESTORE_DATA_MODEL.md) · [보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md)
