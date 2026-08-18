# 잔액 아키텍처 재설계 (C1 잔여분 / P1 / P2 잔여분 / C4)

> **상태: 설계 검토 대기 중 — 아직 배포되지 않음, 읽기 경로는 아직 하나도 안 바뀜.** 이 브랜치에는
> §3-1의 1단계(듀얼라이트)가 실제 앱 코드(`index.html`/`partner-admin/app.js`/
> `shared/game-engine.js`/`avatar/app.js`)에 반영돼 있다 — 모든 원장성 쓰기가 이제 `balanceTotals`도
> 함께 증분한다. 하지만 **어떤 화면·판단 로직도 아직 그 값을 읽거나 신뢰하지 않는다** — 케이지
> 출금 승인을 포함한 모든 잔액 조회는 여전히 기존 derive-by-sum 경로 그대로다. §2(백필)~§3(섀도우
> 리드·컷오버)는 사용자 검토·승인 후, 그리고 이 브랜치가 실제로 배포되어 며칠간 데이터가 쌓인
> 뒤에만 진행한다. 트랜잭션 프로토타입(출금 디빗, 백필 스크립트, 정합성 감시 잡)도 코드는
> 준비돼 있지만 `functions/index.js`에서 export되지 않았고 실제 판단 경로에 연결되지 않았다 —
> 자세한 목록은 §7 참고.

## 0. 문제 요약

지난 엔지니어링 리뷰에서 4건을 의도적으로 미해결로 남겼고, 넷 다 같은 근본 원인에서 나온다.

**근본 원인**: `ledger`/`mainCageLedger`/`rollingEvents`/`shiftEvents`/`memberLedger` 다섯
컬렉션 모두 "잔액"을 저장하지 않는다. 화면에 보이는 잔액은 항상 해당 키(계좌/회원/지점/게임/시프트
필드)의 전체 이력 문서를 클라이언트가 내려받아 그 자리에서 합산한 값이다 — 일회성 `.get()`이든,
매 변경마다 전체 이력을 다시 합산하는 무제한 `onSnapshot`이든 마찬가지다.

이게 네 가지 다른 증상으로 드러난다:

1. **C1 잔여분**: 케이지 현금 출금 시 잔액 충분 여부(`hasSufficientBalance`/
   `hasSufficientTotalBalance`, index.html:6460-6469)를 로컬에 캐시된, 리스너가 합산해 둔 값으로
   검사한다. 두 단말에서 동시에 같은 계좌를 출금 요청하면 둘 다 이 검사를 통과한 뒤 각자
   `writeLedgerEntry()`를 호출할 수 있다 — 실제 현금이 이중으로 나갈 수 있는 경로. C5(오프라인
   캐시 스테일 방지)는 이 중 "재접속 직후 로컬 캐시가 서버 미확인 상태"인 좁은 케이스만 막았을
   뿐, 두 단말이 모두 라이브 동기화된 상태에서 발생하는 진짜 동시성 레이스는 그대로다.
2. **P1**: 잔액 확인이 있을 때마다 전체 이력을 다운로드한다. 운영 기간이 늘어날수록 매일 더
   비싸진다.
3. **P2 잔여분**: `ledger`/`mainCageLedger`/`rollingEvents`/`shiftEvents`는 `.limit()`으로
   자를 수 없다 — 자르면 합산값 자체가 조용히 틀려진다. `branchTransfers`만 이번 세션에
   `.limit(500)`으로 안전하게 제한했는데, 그건 그 컬렉션이 "아무도 합산하지 않는 순수 감사
   로그"였기 때문이다.
4. **C4**: 같은 개념(금액/구분/시각)에 대해 컬렉션마다 필드명과 의미가 다르다 — `ledger`는
   부호 없는 `inn`/`out` + 방향 플래그 `type:'IN'|'OUT'`, `mainCageLedger`는 부호 없는 `amt` +
   *카테고리* 의미의 `type`(`buyin`/`rollingCC`/`marker`/`redeem`, 같은 필드명 `type`인데 뜻이
   전혀 다름), `rollingEvents`/`memberLedger`/`branchTransfers`는 부호 있는 `amount`인데
   `memberLedger`만 `category`가 있고, `shiftEvents`는 아예 `delta`+`field` 구조. 시각도
   `memberLedger`만 `serverTimestamp`이고 나머지는 클라이언트 포맷 문자열 `dt`뿐이다.

---

## 1. 유지 잔액(maintained balance) 메커니즘

### 1-1. 검토한 방식들

**(a) Cloud Functions `onDocumentCreated` 트리거가 `FieldValue.increment()`를 적용**

각 원장성 컬렉션(`ledger`, `mainCageLedger`, `rollingEvents`, `shiftEvents`, `memberLedger`)에
`onDocumentCreated` 트리거를 달아, 문서가 생성될 때마다 해당 잔액 문서에 `increment()`를 적용한다.

- 장점: 클라이언트가 무엇을 하든(버그가 있든, 새 쓰기 지점을 깜빡하든) 원장 문서가 실제로
  Firestore에 쓰이기만 하면 트리거가 반드시 실행된다 — 정합성이 클라이언트 코드에 의존하지 않는다.
- 단점: **전파 지연.** 2세대(v2) Firestore 트리거는 Eventarc/Pub-Sub를 경유하는 비동기·
  "at-least-once" 전달이라, 원장 문서가 실제로 커밋된 시점과 트리거가 실행되어 잔액 문서를
  증분하는 시점 사이에 수백 ms ~ 수 초(콜드 스타트/재시도 시엔 더 길게)의 간극이 생긴다. 이 간극은
  *상한이 보장되지 않는다.*

**(b) 클라이언트(또는 트랜잭션)가 원장 쓰기와 같은 트랜잭션/배치 안에서 잔액 문서에
`FieldValue.increment()`를 적용**

- 장점: 전파 지연이 없다 — 원장 문서가 커밋되는 바로 그 순간 잔액 문서도 함께 커밋된다.
- 단점: 쓰기 지점이 4개 파일에 25곳 이상 흩어져 있어("매번 잊지 않고 증분해야 한다"), 미래의
  새 쓰기 지점이 이 규칙을 빠뜨릴 위험이 구조적으로 남는다.

**(c) 그 외 검토— 채택안: (b)를 기본으로 하되, 두 가지로 (b)의 약점을 보강**

1. *케이지 출금(차감/디빗) 경로만 하나의 공유 트랜잭션 함수로 집중.* "잔액 확인 → 차감"이
   보안·레이스에 민감한 곳은 사실 출금(디빗)뿐이다 — 입금/보정/보너스 지급 같은 크레딧은
   과다 지급 레이스가 없다(초과 인출 같은 물리적 피해가 없다). 그래서 디빗 경로만 이 저장소의
   기존 관례(`approveDeposit`/`submitRoundCancel`/`playerSignup`이 쓰는 `db.runTransaction()`)를
   그대로 따르는 **단 하나의** 공유 함수(`withdrawFromAccount()`, 아래 1-3 참고)로 만들어, "각
   호출부가 매번 기억해야 하는" 표면적을 최대한 좁힌다. 크레딧 계열도 같은 트랜잭션/배치
   패턴을 쓰되 여러 지점에 남아있는 걸 허용한다 — 초과 인출 위험이 없어 리스크가 다르다.
2. *주기적(스케줄) 정합성 감시 잡을 세이프티넷으로 추가.* 매일 한 번(비피크 시간대), 각
   컬렉션의 진짜 전체 합산값을 다시 계산해 유지 잔액 문서와 비교하고, 어긋나면 시끄럽게
   로그/알림을 낸다(`functions/balance/reconcile.js`, 아래 참고). **이건 (a)의 per-write 트리거가
   아니라 `onSchedule`(Cloud Scheduler) 잡이다** — 게이팅하는 결정이 전혀 없으므로(사후 감사일
   뿐, 아무 트랜잭션도 이걸 기다리지 않는다) (a)의 지연 문제가 애초에 적용되지 않고, Eventarc용
   IAM 권한도 필요 없다(§5 참고). "매 쓰기마다 전체를 재계산"이 아니라 "하루에 한 번 전체를
   재계산"이므로 P1이 없애려던 비용 구조(사용자 액션마다 전체 스캔)로 되돌아가지도 않는다.

### 1-2. 최종 선택: (b) — 원장 쓰기와 같은 트랜잭션 안에서 잔액 문서를 증분

**이유**: 이번에 닫아야 하는 구체적인 레이스는 "출금 승인 순간의 잔액이 정확해야 한다"는
것이지, "결국엔 숫자가 맞아떨어져야 한다"가 아니다. (a)만 단독으로 썼다고 가정하면: 단말 A가
잔액 문서를 읽어 통과 → 원장에 OUT 문서를 쓴다 → [트리거가 아직 안 돎] → 단말 B가 (아직
갱신 안 된) 같은 잔액 문서를 읽어 통과 → 자기도 OUT 문서를 쓴다 → 이후 두 트리거가 각각
실행되어 잔액을 정확히 두 번 차감한다. **최종 숫자는 산술적으로 맞다** — 하지만 케이지는 실제로
감당할 수 없는 두 번의 출금을 이미 승인해서 현금을 내준 뒤다. 이게 정확히 막아야 하는 시나리오다.
(b)는 잔액 문서 읽기·조건 확인·차감·원장 기록이 전부 한 트랜잭션 안에 있으므로, Firestore의
트랜잭션 충돌 감지(낙관적 동시성 제어)가 자동으로 두 번째 시도를 재시도시키고, 재시도 시점에는
이미 첫 번째 트랜잭션이 반영된 잔액을 읽게 되어 두 번째 요청이 정확히 거부된다.

### 1-3. 출금 레이스를 닫는 구체적인 모양

`functions/balance/withdrawTransaction.js`에 프로토타입이 있다(아직 미배포/미연결).

```js
// 모듈식 Firestore 클라이언트 SDK 기준 (index.html의 compat SDK로 옮길 때는
// db.runTransaction(tx=>{...}) / tx.get / tx.set({merge:true}) /
// firebase.firestore.FieldValue.increment()로 기계적으로 치환하면 된다 — 설계 자체는 동일)
async function withdrawFromAccount(db, {accountId, casino, amount, staff, memo}) {
  const balRef = doc(db, 'balanceTotals', 'acct_' + accountId);
  return runTransaction(db, async tx => {
    const balSnap = await tx.get(balRef);                       // ① 단일 문서 읽기 (전체 이력 X)
    const balances = (balSnap.exists() && balSnap.data().balances) || {};
    const plan = planSpill(balances, casino, amount);            // 기존 withdrawAcrossBranches와 동일한 분산 순서
    if (!plan.sufficient) throw new InsufficientBalanceError(plan.remaining);  // ② 부족하면 커밋 자체가 없다
    plan.legs.forEach(leg => {
      tx.set(doc(db, 'ledger', newLedgerId()), {accountId, casino:leg.casino, type:'OUT', out:leg.take, ...});
      balances[leg.casino] = increment(-leg.take);
    });
    tx.set(balRef, {balances}, {merge:true});                    // ③ 원장 기록 + 잔액 차감이 한 커밋
  });
}
```

두 단말이 동시에 이 함수를 호출하면: 둘 다 `balRef`를 읽는다 → 하나가 먼저 커밋에 성공한다 →
Firestore는 나머지 트랜잭션이 읽은 버전이 이제 낡았다는 걸 감지하고 **SDK가 자동으로 재시도**한다
→ 재시도된 트랜잭션은 이번엔 이미 차감된 잔액을 읽으므로 부족하면 정확히 거부된다. 이건
`approveDeposit`이 `depositRequests` 문서의 `status` 필드를 같은 방식으로 지키는 것과 완전히 같은
패턴을, 상태 열거값 대신 숫자 잔액에 적용한 것뿐이다.

**검증**: `test/balance-emulator.test.js`가 실제 Firestore 에뮬레이터에서 동일 계좌에 12개의
동시 출금(합계가 잔액을 초과하도록 일부러 설계)을 던져서 (1) 초과 인출이 절대 없고, (2) 성공한
트랜잭션 수만큼만 원장 문서가 남으며(실패/재시도된 트랜잭션의 잔여물 없음), (3) 최종 유지
잔액이 원장 문서 전체를 처음부터 다시 합산한 값과 정확히 일치함을 증명한다. `npm run
test:balance-emulator`로 재실행 가능 (`npx firebase-tools emulators:exec --only firestore "node
test/balance-emulator.test.js"`) — 이번에 3개 테스트 모두 통과 확인함.

### 1-4. 잔액 문서 스키마 (신규 컬렉션 `balanceTotals`)

기존 `firestore.rules`가 `staff`를 제외한 모든 최상위 컬렉션을 `if collection != 'staff'`로 이미
열어두고 있어서, `balanceTotals`라는 새 컬렉션은 규칙 파일을 건드리지 않아도 바로 읽고 쓸 수
있다 (다만 §6에서 이 컬렉션의 쓰기 권한을 더 좁히는 걸 향후 과제로 남겨둔다).

| 문서 ID | 대체하는 것 | 형태 |
|---|---|---|
| `acct_{accountId}` | `ledger` 전체 합산 | `{ balances: {HANN, NUSTAR, ONLINE} }` — 손님/MAIN 계좌 공통, `accountBalanceFor`/`accountTotalBalance`가 그대로 읽을 수 있는 모양 |
| `maincage_{branch}` | `mainCageLedger` 전체 합산 | `{ total: number }` |
| `shift_{branch}` | `shiftEvents` 전체 합산 | `{ rollingCashShift, nnChipInShift, ... }` (기존 9개 필드) |
| `member_{memberId}` | `memberLedger` 전체 합산 (partner-admin/avatar) | `{ balance: number, points: number }` |

`rollingEvents`만 예외: 새 컬렉션을 만들지 않고, 이미 존재하는 `games/{gameId}` 문서에 `rolling`
필드를 추가해 그 안에서 증분한다 (게임 메타데이터 문서가 이미 있으므로 별도 문서가 필요 없음).

`shareLedger`(파트너 쉐어 누계)는 이번 네 가지 발견 사항에 포함되지 않았지만 같은 패턴이 그대로
적용된다 — `balanceTotals/partner_{partnerCode}`로 후속 확장 가능, 이번 범위에는 넣지 않았다.

---

## 2. 과거 이력 백필(backfill)

기존의 모든 계좌/지점/게임/시프트필드/회원이 새 메커니즘을 신뢰하기 전에 정확한 시작 집계값을
한 번 계산해 둬야 한다. 스크립트: `functions/balance/backfillBalances.js` (Admin SDK, 사람이
로컬에서 한 번 수동 실행 — CI/앱 코드가 자동으로 실행하지 않음).

### 2-1. 순서가 중요한 이유

백필은 "전체 이력을 스캔해서 합산값을 쓰는" 단순 작업처럼 보이지만, (b)의 증분 쓰기가 이미
라이브인 상태에서 스캔과 겹치면 두 가지 경합이 생길 수 있다:

- 백필이 스캔을 시작한 *뒤에* 새로 들어온 원장 문서 — 스캔 결과에 포함될 수도, 안 될 수도 있는
  경계 케이스.
- 그 새 문서의 증분 쓰기가 백필의 최종 `.set()`(덮어쓰기) 커밋 *전이나 후*에 들어오는 경우 —
  타이밍에 따라 그 건의 증분이 백필의 덮어쓰기에 조용히 뭉개질 수 있다.

이걸 타임스탬프 컷오프로 정밀하게 봉합하는 방법도 있지만(백필 시작 시각 이전 문서만 합산), 지금
`ledger`/`mainCageLedger`/`rollingEvents`/`shiftEvents` 네 컬렉션은 `memberLedger`와 달리
**서버 타임스탬프가 없다** (`docs/FIRESTORE_DATA_MODEL.md` 상단 경고 참고 — 클라이언트 포맷
문자열 `dt`뿐). 클라이언트 시계는 컷오프 경계로 쓰기엔 신뢰할 수 없다(시계 오차, 오프라인 큐
재전송 시 원래 생성 시각과 커밋 시각이 다를 수 있음).

**채택한 방법: 정밀한 타임스탬프 경합 해소 대신, 짧은 유지보수 창(maintenance window)을 둔다.**
케이지 운영에서 완전히 조용한 순간은 없겠지만, 몇 분간 "쓰기 일시 정지"는 감당 가능한 비용이고,
락 없는 동시성 설계보다 훨씬 단순하고 검증하기 쉽다. 구체적 순서:

1. **먼저** (b)의 증분 쓰기 코드를 배포한다 — 이 시점에 `balanceTotals` 문서는 아직 없거나
   0부터 시작하는 상태(잘못된 값)이지만, **읽기 쪽(`hasSufficientTotalBalance` 등)은 여전히
   기존 derive-by-sum 경로를 그대로 쓰고 있으므로** 사용자에게 보이는 어떤 숫자도 아직 바뀌지
   않는다. 이 상태가 §3의 섀도우 리드 기간의 시작점이기도 하다.
2. `cageConfig/global`에 이미 있는 설정 문서에 `maintenanceMode: true` 같은 플래그를 잠깐
   세워(별도 화면·별도 배포 필요 없이 기존 문서에 필드 하나 추가) 모든 단말의 새 원장성 쓰기를
   몇 분간 막는다. 사전에 근무 중인 직원에게 공지.
3. 그 조용한 창 안에서 `backfillBalances.js --commit`을 실행 — 이 시점엔 동시 쓰기가 없으므로
   전체 스캔·합산·덮어쓰기가 정확히 한 번에 끝난다.
4. `maintenanceMode`를 해제. 이 순간부터 (b)의 증분 쓰기가 정확한 기준값 위에서 계속 쌓인다.

*(타임스탬프 기반 대안: 유지보수 창을 아예 허용할 수 없는 조직이라면, 위 1단계에 앞서
`ledger`/`mainCageLedger`/`rollingEvents`/`shiftEvents`의 모든 쓰기 지점에 `createdAt:
serverTimestamp()`를 먼저 추가해 배포하고(§4에서 어차피 권장하는 변경), 이후 "`createdAt` <
백필 시작 시각(`Timestamp.now()`, 서버 기준)"으로 필터링한 스캔을 쓰면 무정지로도 안전하게
백필할 수 있다. 이번 설계는 구현 난이도와 검증 난이도가 더 낮은 유지보수 창 방식을 1차로
권장하고, 이 대안은 예비안으로 남긴다.)*

### 2-2. 검증

백필이 쓴 값을 신뢰하기 전에, 기존 derive-by-sum 방식과 **정확히 일치**하는지 확인한다 (통화
단위 정수 금액이므로 "거의 비슷"이 아니라 **불일치 0건**이 기준):

- `backfillBalances.js`는 실행 시 스캔한 문서 수·계산된 키 개수를 출력한다 — 기존 화면에 보이는
  계좌/게임/지점 수와 눈으로 대조.
- `functions/balance/reconcile.js`의 `reconcileAll()`을 백필 직후 한 번 더 실행 — 방금 쓴
  `balanceTotals`/`games.rolling`을 다시 처음부터 스캔한 값과 비교해 불일치 0건인지 확인한다
  (§1-3과 같은 코드 경로를 재사용하되, 백필과 독립적으로 다시 계산하므로 백필 스크립트 자체의
  버그를 잡아낼 수 있다).
- 최소 몇 개 계좌(특히 거래가 많은 MAIN 계좌, 활성 게임)는 Firebase 콘솔에서 육안으로 대조.

`functions/test/backfillBalances.test.js`가 백필 스크립트의 합산 로직 자체를
`subscribeLedgerCloud`/`deriveMainCageForBranch`/`buildGameFromCache`/
`deriveShiftTotalsForBranch`/`getPlayerBalance`의 산식과 나란히 놓고 단위 테스트로 고정해
뒀다 — 실제 프로덕션 데이터 없이도 산식 드리프트(백필 스크립트가 기존 앱과 다른 방식으로
계산하기 시작하는 것)를 잡아낸다.

---

## 3. 컷오버 안전장치 (듀얼라이트 → 섀도우 리드 → 컷오버)

### 3-1. 단계

1. **듀얼라이트 시작** (§2-1의 1단계): 모든 쓰기 지점이 기존 원장 문서 + `balanceTotals` 증분을
   함께 쓴다. 읽기는 전부 기존 경로 그대로.
2. **백필** (§2): 유지보수 창에서 1회 실행, 검증.
3. **섀도우 리드 기간**: 화면에는 여전히 기존 derive-by-sum 값을 보여주되, 매번 같은 키에 대해
   `balanceTotals`도 함께 읽어 두 값을 비교하고, 불일치가 나면 즉시 로그(콘솔 + 필요하면 별도
   드리프트 로그 컬렉션)로 남긴다 — 어떤 승인/거절 판단도 새 값에 걸지 않는다.
4. **컷오버**: 섀도우 기간 동안 **불일치 0건**이 연속 **7일** 유지되면(주간 근무 패턴·월말 정산처럼
   부하가 몰리는 날을 최소 한 번은 포함하도록), `hasSufficientTotalBalance`/케이지 출금 체크·
   차감 로직을 `balanceTotals` 기반 트랜잭션(§1-3)으로 전환한다. 이게 실물 현금이 걸린
   유일한 게이팅 결정이므로 가장 마지막에, 가장 보수적인 기준으로 전환한다. 나머지(잔액 표시,
   `getBalances`/`getPlayerBalance` 등 게이팅 없는 조회)는 같은 시점이나 조금 더 일찍 전환해도
   무방 — 틀려도 화면 숫자가 잠깐 어긋나는 것뿐, 현금이 잘못 나가지 않는다.
5. 불일치가 한 번이라도 나면 **7일 카운터를 리셋**한다: 원인(빠뜨린 증분 쓰기 지점, 로직 버그)을
   고치고, 재백필하고, 섀도우 기간을 처음부터 다시 시작한다.

### 3-2. "안전하게 컷오버할 수 있다"의 구체적 정의

- 섀도우 리드 기간 ≥ 7일, 연속.
- 그 기간 동안 관측된 불일치 = 0건 (모든 계좌·지점·게임·회원 키 통틀어).
- 그 7일 안에 최소 한 번은 여러 단말이 동시에 활발히 쓰는 피크 시간대(예: 주말 야간)를
  포함했다 — 조용한 한 주만 관측하고 넘어가면 레이스가 드물게만 발생하는 경우를 놓친다.
- `reconcile.js`의 스케줄 잡이 최소 하루 한 번 이상 클린 리포트를 냈다.

---

## 4. C4(필드명 통일) — 이번 범위에 넣을지

**결론: 부분적으로 포함, 전면 리네이밍은 범위 밖으로 명시적으로 미룬다.**

**이번에 포함하는 것** — 어차피 모든 쓰기 지점을 건드리는 김에, 순수 추가(additive)이고 기존
읽기 코드를 전혀 바꾸지 않는 것만:

- `ledger`/`mainCageLedger`/`rollingEvents`/`shiftEvents`에 `createdAt: serverTimestamp()` +
  `clientCreatedAt` + `deviceId`를 추가한다(`memberLedger`와 동일한 모양으로). 기존 `dt` 문자열
  필드는 그대로 유지 — 기존 렌더링 코드가 계속 동작한다. 이건 §2-1의 타임스탬프 컷오프 대안을
  나중에 쓸 수 있게 해주는 부수 효과도 있고, C4가 지적한 "시각 필드가 컬렉션마다 다르다" 문제의
  절반을 공짜로 해결한다.
- 새로 만드는 `balanceTotals` 컬렉션은 처음부터 통일된 어휘(`balance`/`balances`, `inn`/`out`
  같은 모호함 없음)로 설계한다 — 새로 만드는 것이니 기존 드리프트를 반복할 이유가 없다.

**이번에 포함하지 않는 것**: `ledger`의 `inn`/`out`→`amount`, `mainCageLedger`의 `type`(카테고리
의미)→`category` 같은 실제 필드 리네이밍. 이유:

- 이건 쓰기 지점뿐 아니라 **모든 읽기 지점**(`renderLedger`, `renderMainCageList`, 정산 요약
  계산, CSV/리포트 내보내기 등)을 함께 바꿔야 하는 훨씬 넓은 변경이다 — 이번 작업(증분 로직
  추가)보다 실질적으로 더 큰 블라스트 레이디어스.
- 이 문서가 다루는 네 가지 결함(C1/P1/P2/C4) 중 실제로 "현금이 위험해지는" 부분(C1)이나
  "비용이 매일 늘어나는" 부분(P1/P2)에 리네이밍은 아무 기여도 하지 않는다 — 순수 가독성
  개선이라 지금 묶으면 리스크만 늘고 얻는 게 없다("wrong migration corrupts real cash records"
  라는 이번 작업의 전제와 정면으로 배치).
- 리네이밍은 컬렉션 단위로, 이번과 동일한 절차(백필 → 검증 → 섀도우 → 컷오버)를 각각 밟는 게
  맞는 별도의, 급하지 않은 후속 작업으로 남긴다.

---

## 5. IAM — 필요한 추가 권한

**이번 설계는 실제 Firestore `onDocumentCreated` 트리거를 어디에도 요구하지 않는다** (§1에서
(a)를 채택하지 않았고, 정합성 감시 잡도 `onSchedule`로 설계했기 때문). 그래서 CI 서비스
계정이 이미 가진 권한(Service Account User, Editor, Cloud Functions Admin)만으로 배포가 될
가능성이 높다 — 다만 이 세션에서는 실제 프로덕션 GCP 프로젝트에 대고 배포를 시도해 검증할 수
없으므로, 아래를 확정이 아니라 "예상"으로 남긴다:

- **`onSchedule` 정합성 감시 잡** (`functions/balance/reconcile.js`를 나중에 `onSchedule`로
  감싸 배포할 때): Cloud Scheduler API 활성화 + 잡 생성 권한이 필요. Editor 역할이 보통 이걸
  포함하지만, 최초 배포 시 실패하면 사람이 `roles/cloudscheduler.admin`을 CI 서비스 계정에
  추가로 부여해야 할 수 있다.
- **만약 나중에 방향을 바꿔 (a)(진짜 `onDocumentCreated` 트리거)를 쓰기로 한다면**: 이건 이번
  설계엔 없지만, 이전 세션에서 다뤘던 것과 같은 종류의 함정이라 미리 적어둔다. 2세대 Firestore
  트리거는 Eventarc를 거치는데, 해당 프로젝트에서 **이런 트리거를 처음 배포**할 때 Firebase
  CLI가 Eventarc/Pub-Sub 서비스 에이전트에 IAM 바인딩을 스스로 부여하려고 시도한다 — 이건
  `resourcemanager.projects.setIamPolicy` 권한이 필요한데, **Editor 역할에는 이 권한이 없다**
  (Owner이거나 명시적으로 `roles/resourcemanager.projectIamAdmin`을 가진 계정만 가능). 그러면
  최초 배포가 권한 오류로 실패한다. 이 경우 GCP 콘솔 접근 권한이 있는 사람이 한 번, 수동으로:
  `service-<PROJECT_NUMBER>@gcp-sa-eventarc.iam.gserviceaccount.com`에 `roles/eventarc.serviceAgent`,
  `service-<PROJECT_NUMBER>@gcp-sa-firestore.iam.gserviceaccount.com`(또는 관련 서비스 에이전트)에
  Pub/Sub 발행자 권한을 부여해야 한다 — 또는 Owner 권한을 가진 사람이 콘솔에서 직접 한 번
  배포해서 자동 프로비저닝을 트리거해도 된다. **지금 설계는 이 경로를 타지 않으므로 당장은
  필요 없다** — 방향 전환 시에만 해당.

---

## 6. 롤백 계획

듀얼라이트를 컷오버 이후에도 일정 기간(권장: 추가 7~14일) 계속 살려두는 게 핵심이다 — 그러면
롤백은 순수 코드/설정 되돌리기일 뿐, 데이터 복구가 필요 없다.

- **컷오버 직후 문제 발견 시**: 출금 체크·차감 로직을 다시 기존 derive-by-sum 경로로 되돌린다
  (코드 되돌리기 한 번, 배포). 듀얼라이트가 여전히 살아있으므로 원장 컬렉션 자체는 끊김 없이
  계속 정확했고, `balanceTotals`는 계속 갱신되고 있었을 뿐 — 잃어버리는 데이터가 없다.
- **`balanceTotals` 자체가 조용히 드리프트했다고 나중에 발견된 경우** (섀도우 기간을 통과했는데도
  버그가 있었던 최악의 경우): 1) 즉시 읽기를 기존 경로로 되돌린다(위와 동일, 항상 즉시 가능).
  2) 원인 조사·수정. 3) 원장 컬렉션(`ledger` 등)은 append-only로 한 번도 변형되지 않았으므로
  여전히 유일한 진실 — `backfillBalances.js --commit`을 다시 실행해 `balanceTotals`를 처음부터
  재구성한다. 4) §3의 7일 섀도우 기간을 처음부터 다시 밟은 뒤에만 재컷오버를 시도한다.
- **최종적으로 옛 derive-by-sum 코드/리스너를 완전히 제거하는 시점**: 컷오버 후 추가 버퍼
  기간(7~14일)이 아무 문제 없이 지난 뒤에만 — 그 전까지는 "죽은 코드처럼 보이지만 즉시 롤백
  경로"로 남겨둔다.

---

## 7. 이 브랜치에 이미 있는 것 / 아직 없는 것

**있음 — §3-1의 1단계(듀얼라이트)까지 실제로 반영됨, 그 이후는 미진행**:

- **듀얼라이트 코드가 실제 앱 파일에 들어가 있다** (§3-1의 1단계): `ledger`/`mainCageLedger`/
  `rollingEvents`/`shiftEvents`를 쓰는 index.html의 `writeLedgerEntry`/`writeMainCageEntry`/
  `writeRollingEvent`/`writeShiftEvent`, 그리고 `memberLedger`를 쓰는 8곳(shared/game-engine.js의
  `playerSignup`/`placeBet`/`settleBet`, avatar/app.js의 `submitTip`, partner-admin/app.js의
  `submitBalanceAdjust`/`approveDeposit`/`submitRoundCancel`(2곳)/`processPayment`) 전부 이제
  기존 컬렉션 쓰기와 같은 배치(batch) 안에서 `balanceTotals`(또는 `games/{id}.rolling`)를
  `FieldValue.increment()`로 함께 갱신한다. `memberLedger` 쪽은 8곳이 각자 인라인으로 쓰던 걸
  `shared/cage-ui.js`의 `writeMemberLedgerEntry()` 공유 함수 하나로 모았다 — §1-1(c)에서 말한
  "출금처럼 위험한 경로만 한 곳으로 모은다"는 원칙을 크레딧 계열에도 적용해, 앞으로 이 컬렉션에
  새 쓰기 지점이 생겨도 증분을 빠뜨리기 훨씬 어렵게 만들었다. `ledger`/`mainCageLedger`/
  `rollingEvents`/`shiftEvents`에는 §4에서 다룬 대로 `createdAt`/`clientCreatedAt`/`deviceId`도
  함께 추가했다 (index.html은 `shared/cage-ui.js`를 로드하지 않으므로 `getDeviceId()`를
  파일 내부에 로컬로 복제).
  - **읽기 쪽은 전혀 건드리지 않았다** — `hasSufficientTotalBalance`/`accountBalanceFor`/
    `getPlayerBalance`/`getBalances`/`renderAllGameViews` 등 모든 조회·판단 로직은 여전히 기존
    derive-by-sum 경로 그대로다. `balanceTotals`는 지금 이 순간부터 조용히 쌓이기 시작할 뿐,
    아직 아무것도 이 값을 읽거나 신뢰하지 않는다.
  - 데모/시드 데이터 생성기(`partner-admin/app.js`의 `seedDemoData`)는 의도적으로 손대지
    않았다 — 실제 금전 흐름이 아니라 데모 프로젝트를 채우는 픽스처 데이터라, 여길 건드려도
    이번 작업의 목적(C1/P1/P2)에 아무 기여가 없고 표면적만 늘어난다.
  - `firebase.json`에 로컬 에뮬레이터 포트 설정 추가 (배포 대상 아님).
- `test/dual-write-compat.test.js` — 실제로 index.html/shared/cage-ui.js가 쓰는 **compat SDK**
  기준으로 같은 배치 패턴(원장 문서 set + 중첩 필드 `FieldValue.increment()`)을 에뮬레이터에
  대고 재현해 검증 (`npm run test:dual-write-compat`) — 동시에 20개의 증분이 들어와도 하나도
  유실되지 않음을 확인했다. (앞서 만든 `functions/balance/withdrawTransaction.js` 쪽 테스트는
  모듈식(v9+) SDK 기준이라 별도로 검증해 둔 것.)
- `functions/balance/spillPlan.js` — 분산 출금 순서 계산 (순수 함수, `functions/test/spillPlan.test.js`)
- `functions/balance/withdrawTransaction.js` — §1-3의 트랜잭션 프로토타입 (모듈식 SDK 기준) — **아직
  실제 출금 승인/거절 판단에는 연결하지 않음** (§3-1의 4단계, 컷오버 시점의 몫)
- `functions/balance/backfillBalances.js` — §2의 1회성 백필 스크립트 (`functions/test/backfillBalances.test.js`)
- `functions/balance/reconcile.js` — §1-1(c)의 정합성 감시 잡 본체 (`functions/test/reconcile.test.js`)
- `test/balance-emulator.test.js` — 실제 Firestore 에뮬레이터로 트랜잭션 방식의 동시성 원자성을
  증명하는 테스트 (`npm run test:balance-emulator`) — **CI에는 연결하지 않음**, 에뮬레이터가
  필요해 기존 `deploy-functions` 잡(`npm test --prefix functions`, 에뮬레이터 없이 plain
  `node --test`)이 깨지지 않도록 저장소 루트의 별도 `test/` 디렉터리에 분리해 뒀다
  (`test:dual-write-compat`도 동일한 이유로 같이 분리).

**없음 (사용자 승인 후 진행)**:
- 케이지 출금 승인/거절 판단(`hasSufficientTotalBalance` 등)이나 그 외 어떤 화면도
  `balanceTotals`를 읽거나 신뢰하도록 바꾸는 것 — §3-1의 3~4단계(백필 → 섀도우 리드 → 컷오버) 전부.
- `functions/index.js`에서 `reconcile.js`를 `onSchedule`로 export.
- 프로덕션 `backfillBalances.js --commit` 실행.
- `firestore.rules`에 `balanceTotals` 쓰기 제한 추가 (지금은 다른 모든 컬렉션과 동일하게 열려
  있음 — 이번 설계로 새로 생기는 리스크는 아니지만, 향후 강화 후보로 남겨둠).
