# Firestore 데이터 모델 설계 (다단말 오프라인 안전 구조)

> **⚠ 이 문서는 목표 설계이며, 현재 구현과 다른 부분이 있습니다.** 아래는 2026-08-10 기준
> 확인된 구체적인 차이입니다 (엔지니어링 리뷰 D1 항목 기준):
> - `members.pw`/`withdrawPw`: 이 문서는 해시 저장을 전제하지만, 실제로는 **평문**으로 저장·비교됩니다.
> - "서버 측 집계 쿼리(`getAggregateFromServer`+`sum()`)"(15줄): 실제로는 `getPlayerBalance()`가
>   해당 회원의 `memberLedger` 문서를 **전량 다운로드한 뒤 클라이언트에서 합산**합니다.
> - `createdAt: serverTimestamp` + `clientCreatedAt` + `deviceId`: **`memberLedger` 쓰기는
>   2026-08-10부로 실제 구현되었습니다** (shared/game-engine.js, avatar/app.js, partner-admin/app.js).
>   다만 케이지 운영 화면(`index.html`)의 `ledger`/`rollingEvents`/`mainCageLedger` 등은 아직
>   클라이언트 시각(`phNow()`) 문자열만 사용하며, `deviceId`도 기록되지 않습니다 — 별도 후속 작업입니다.
> - "1단계 범위에서 제외한 것"(108줄) 중 "오프라인 캐시(IndexedDB) 활성화 옵션 켜기"는 이미
>   `shared/cage-ui.js`와 `index.html` 양쪽에서 `enablePersistence({synchronizeTabs:true})`로
>   **켜져 있습니다.**
> - 재시도(멱등성): 문서 ID를 매 호출마다 새로 생성하는 구조(`uuidv4()`를 호출 시점에 생성)라서,
>   앱 레벨 재시도(버튼 재클릭 등)는 실제로는 **중복 문서를 생성**합니다. Firestore SDK 자체의
>   오프라인 큐 재전송만 멱등합니다.
> - Firestore 보안 규칙: `staff` 컬렉션은 2026-08-10부로 인증(`request.auth != null`) 필수로
>   전환되었습니다 (`/firestore.rules`). 그 외 컬렉션은 여전히 테스트 모드(`if true`)입니다.
>
> 컬렉션별 구조 자체(아래 스키마)는 대체로 실제 구현과 일치하지만, 위 동작 관련 서술은
> "목표"와 "현재"를 구분해서 읽어주세요.

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

---

## 파트너 어드민 / 아바타 / 스피드 사이트 확장 (CAGE ADMIN 5.0)

같은 Firebase 프로젝트(`cage-admin-25bbf`)를 공유하되, 케이지 운영 데이터(`accounts`,`ledger`,`games`)와 완전히 분리된 새 최상위 컬렉션을 쓴다. 회원(플레이어) 자금도 위와 동일한 append-only 원장 원칙을 따른다 — **잔액은 저장하지 않고 항상 합산으로 구한다.**

### `members` — 회원(플레이어) KYC/상태
```
members/{memberId}            // memberId = 클라이언트 생성 회원 ID (예: "SEC6937")
  loginId, pw(해시), nickname, phone, telegram, casino, agentCode,
  parentAgent, memberType: "정회원"|"준회원"|"관리회원"|"멀티회원",
  status: "정상"|"정지"|"블랙리스트", vip, betMax, betMin,
  withdrawPw, createdAt, lastLoginAt
```

### `memberLedger` — 회원 자금 이동 단일 진실 공급원 (append-only, 부호 있는 amount)
```
memberLedger/{uuid}
  memberId, casino, amount,               // 입금 +, 출금/베팅 −, 페이아웃/포인트전환 +
  category: "deposit"|"withdraw"|"bet"|"payout"|"point_earn"|"point_convert"|
            "share_commission"|"rolling_commission"|"correction"
  relatedRoundId, relatedTableId, memo, staff, deviceId, clientCreatedAt, createdAt
```
회원 보유금 = `sum(amount) where memberId==X`　·　보유포인트도 동일 패턴(`category` 필터)으로 합산.

### `partners` — 에이전트/쉐어 파트너 계층
```
partners/{partnerCode}   { name, parentCode, shareRate, level, status, casino, createdAt }
shareLedger/{uuid}       { partnerCode, amount(부호), category:"share_accum"|"share_settle", memo, dt }  // append-only
```

### `tables` — 아바타/스피드 테이블 메타데이터
```
tables/{tableId}   { name, type:"avatar"|"speed", casino, status:"open"|"closed", betMin, betMax, shoeNo }
```

### `rounds` — 라운드(핸드) 결과 이력 — 아바타/스피드 로드맵·정산의 단일 소스
```
rounds/{uuid}
  tableId, tableType:"avatar"|"speed", roundNo, shoeNo,
  phase: "betting"|"dealing"|"result",
  playerCards, bankerCards, playerScore, bankerScore,
  result: "player"|"banker"|"tie", playerPair, bankerPair,
  startedAt, resultAt, editedBy, editedReason,   // 게임라운드수정 화면에서 사후 수정 시 기록
  cancelled, cancelReason, cancelledBy, cancelledAt   // 라운드 취소 시 기록 (베팅은 memberLedger에 category:"correction"으로 환불/회수 - 아래 참조)
```

### `bettingLimits` / 뱅커절삭베팅내역 등은 `memberLedger`(category:"bet") + `rounds`를 조인해서 파생 — 별도 저장 없음.

### 그 외 append-only 이벤트/설정 컬렉션
```
notices/{uuid}           { title, body, pinned, dt, staff }        // 공지사항
tickerNotices/{uuid}      { text, active, dt }                      // 한줄공지
noticeGuide/{single}       { body }                                  // 이용안내
bannedWords/{uuid}         { word, dt }                              // 금지어설정
inquiries/{uuid}           { memberId, title, body, reply, status:"대기"|"답변완료", dt }  // 일대일문의
inGameNotices/{uuid}       { text, tableType, active, dt }           // 인게임공지
csContacts/{uuid}          { channel:"telegram"|"kakao"|"whatsapp", label, value, active }
memberActionLogs/{uuid}    { memberId, action, staff, dt, before, after }
adminLogs/{uuid}           { staff, action, target, dt }
chatMessages/{uuid}        { tableId, memberId, nickname, text, dt }
depositRequests/{uuid}     { memberId, amount, method, status:"대기"|"승인"|"거절", dt, staff }   // 디파짓관리
paymentRequests/{uuid}     { memberId, amount, type:"입금"|"출금", status, dt, staff }             // 결제처리리스트
events/{uuid}              { title, body, startDt, endDt, active }
avatarMissCorrections/{uuid} { roundId, before, after, staff, dt, reason }  // 아바타미스수정
avatarRequests/{uuid}      { memberId, tableId, casino, buyin, betSide, betAmount,
                              status:"대기"|"진행중"|"종료", avatarStaffId,
                              requestedAt, approvedAt, endedAt }
                              // 아바타(대리베팅) 신청 — 회원이 신청하면 파트너 어드민에서
                              // 승인(담당 아바타 배정 → 진행중)하고, 승인된 동안은 매 라운드
                              // 클라이언트가 betSide/betAmount로 자동 베팅한다. 팁은 memberLedger에
                              // category:"avatar_tip"|"dealer_tip" + relatedRequestId로 기록.
avatarServiceRequests/{uuid} { requestId, tableId, memberId, type:"shoe_change", dt }
                              // 아바타 세션 중 슈체인지 등 서비스 요청 로그
```

### 잔액·집계 파생값 (저장하지 않고 항상 계산)
| 화면 | 계산 방법 |
|---|---|
| 회원 보유금 | `sum(memberLedger.amount) where memberId==X` |
| 회원 보유포인트 | `sum(memberLedger.amount) where memberId==X and category in (point_earn,point_convert)` |
| 파트너 쉐어 누계 | `sum(shareLedger.amount) where partnerCode==X` |
| 일자별정산/데일리리포트 | `memberLedger`를 `dt` 범위 + `category`로 집계 쿼리 |
| 회원 베팅내역 | `memberLedger where category=="bet"` ⋈ `rounds` (roundId) |
