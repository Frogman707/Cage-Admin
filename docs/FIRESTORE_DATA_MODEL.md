# Firestore 데이터 모델 설계 (다단말 오프라인 안전 구조)

## 왜 이렇게 설계하는가

지금 앱(localStorage)은 잔액을 하나의 숫자로 저장하고 매번 덮어쓴다:
```js
acc.balances[casino] = (acc.balances[casino]||0) + amount;
```
여러 케이지 단말이 오프라인 상태에서 각자 이 방식으로 같은 계좌를 건드리면, 나중에 온라인 복귀 시 "마지막에 저장된 값이 이긴다"는 규칙 때문에 한쪽 거래가 조용히 사라질 수 있다. 실제 현금이 걸린 시스템에서는 절대 허용할 수 없는 결함이다.

**해결 원칙: 잔액/누계는 저장하지 않는다. 오직 계산한다.**

모든 금전 이동은 "거래 하나 = 문서 하나"로 **한 번 쓰이면 절대 수정되지 않는(append-only)** 이벤트로 저장한다. 잔액이 필요하면 그 이벤트들을 합산해서 구한다. 이러면 오프라인 상태의 서로 다른 단말이 각자 다른 거래를 기록해도, 온라인 복귀 시 그냥 둘 다 존재하게 될 뿐 — 충돌도, 유실도 없다.

## 쓰기 규칙 (모든 컬렉션 공통)

1. **문서 ID는 클라이언트가 생성한다** (UUID). 서버가 자동 생성하는 ID(`addDoc`)를 쓰지 않고 `setDoc(doc(db, ..., uuid), data)`를 쓴다.
   - 이유: 오프라인 중 같은 요청이 재시도되어도(네트워크 재연결 후 큐 재전송 등) 같은 ID로 덮어써질 뿐 중복 생성되지 않는다 (멱등성).
2. **기존 문서의 금액 필드는 절대 수정하지 않는다.** 새 이벤트 문서를 추가할 뿐이다.
3. **금액은 부호 있는 숫자(signed number)로 저장한다** (입금 +, 출금 −). 잔액 = 해당 조건의 `amount` 합산 하나로 끝난다.
4. 잔액/누계가 필요한 화면은 Firestore의 **서버 측 집계 쿼리**(`getAggregateFromServer` + `sum()`)로 구한다 — 문서를 전부 내려받지 않고 서버에서 합산해서 숫자 하나만 받는다 (Cloud Functions 불필요, 무료 Spark 요금제에서도 사용 가능).

## 컬렉션 구조

### `ledger` — 모든 계좌 자금 이동의 단일 진실 공급원
```
ledger/{uuid}
  accountId: string       // "SE7419", "MAIN" 등
  casino: string           // "HANN" | "NUSTAR" | "ONLINE"
  amount: number           // 부호 있음: 입금 +, 출금 −
  category: string          // "deposit" | "withdraw" | "transfer" | "game_buyin" |
                             // "game_buyin_refund" | "game_settle" | "mid_settle_deposit" |
                             // "game_end_deposit" | "event_commission" | ...
  relatedGameId: string|null
  relatedAccountId: string|null   // 이체 상대방 / MAIN 미러링 대상
  memo: string
  staff: string
  deviceId: string          // 어느 단말에서 기록됐는지 (감사용)
  clientCreatedAt: string   // 클라이언트 로컬시간 (오프라인 중 생성된 경우 서버 타임스탬프 확정 전 표시용)
  createdAt: serverTimestamp
```
계좌 잔액(카지노별) = `sum(amount) where accountId==X and casino==Y`

### `accounts` — KYC/회원 정보만 (잔액 필드 없음)
```
accounts/{accountId}
  member, phone, rate, telegram, engName, nickname, vip, agentCode, proxy,
  passportNo, passportExp, passportPhoto, sitePhoto, signaturePhoto,
  openedCasino, openedDt, currency, remark, withdrawPw, telegramLinks
```

### `games` — 게임 메타데이터 (롤링 총액은 저장 안 함)
```
games/{gameId}
  dt, account, table, cur, type, startType, startKind,
  buyin, workingChip, staff, status: "ongoing"|"ended",
  endDt, endStaff, cc, nn, winLoss, settled
games/{gameId}/rollingEvents/{uuid}   // 롤링 입력 하나하나 (append-only)
  amount: number (부호 있음, 정정 시 음수)
  dt, staff, memo, deviceId
```
게임 현재 롤링 총액 = `sum(amount)` on `rollingEvents` 서브컬렉션

### `mainCageLedger` — 메인케이지 바인/롤링/마커/리딤 (계좌 원장과 동일한 이유로 append-only)
```
mainCageLedger/{uuid}
  type: "buyin"|"rollingCC"|"marker"|"redeem"
  amount: number (부호 있음)
  staff, dt, deviceId
```
카지노누계롤링 = `sum(signedAmount)` (buyin/rollingCC/marker는 +, redeem은 −)

### append-only 이벤트성 컬렉션 (충돌 위험 낮지만 동일 패턴 적용)
```
shiftLog/{uuid}        { dt, staff, action: "in"|"out" }
avatarRequests/{uuid}  { dt, account, table, buyin, avatarId }
hotels/{uuid}, cars/{uuid}, aero/{uuid}   // 예약 — 상태 변경(취소)만 유일하게 필드 수정 있음
blocks/{uuid}, memos/{uuid}
pointsHistory/{uuid}   { dt, reason, change(부호있음), staff }  // 포인트 잔액도 합산으로 계산
eventHistory/{uuid}
mainCageLog/{uuid}, balancingCheckLog/{uuid}, correctionLog/{uuid}, monthRecordLog/{uuid}
```

### `staff` — 이미 이번 세션에서 다룬 구조 그대로
```
staff/{staffId}   { name, pin, dt }
```

### `cageConfig/global` — 단일 설정 문서 (충돌 가능성 낮은 값들만)
```
cageConfig/global
  eventStart, eventEnd, eventRate
  lastBalancingDt, lastCutoffDt, lastMonthSettleDt
  memberCompanyDiffVal   // ⚠ 이것도 사실 "차액 발생/보정" 이벤트를 append-only로 쌓고 합산하는 게 더 안전 — 2단계에서 재검토
```

## 기존 앱 개념 → 새 구조 매핑

| 기존 (localStorage) | 신규 (Firestore) |
|---|---|
| `acc.balances[casino] += x` | `ledger`에 새 문서 추가, 잔액은 집계 쿼리 |
| `DB.ledger[accountId]` (배열) | `ledger` 컬렉션 (accountId로 필터링) |
| `g.rolling += amount` | `games/{id}/rollingEvents`에 새 문서 추가 |
| `DB.rollingGrandTotal += x` | `mainCageLedger` 집계 합산 |
| `DB.staff` (배열) | `staff` 컬렉션 (이미 존재) |
| `DB.shiftLog.unshift(...)` | `shiftLog` 컬렉션에 새 문서 |

## 1단계 범위에서 제외한 것 (다음 단계에서 다룸)

- Cloud Functions 기반 트리거/캐시 집계 (Spark 무료 요금제 범위 내에서는 클라이언트 집계 쿼리로 충분)
- 실시간 리스너(`onSnapshot`) 활성화 — 지금은 데이터 모델만 확정, 실제 다단말 실시간 반영은 2단계
- Firestore 보안 규칙 정교화 (지금은 테스트 모드) — 직원 인증 연동한 실제 규칙은 별도 단계
- 오프라인 캐시(IndexedDB) 활성화 옵션 켜기

