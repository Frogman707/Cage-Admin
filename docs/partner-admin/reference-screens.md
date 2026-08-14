# 레퍼런스 — 화면 58개

> **분류**: Reference (정보 지향)
> **대상 파일**: [`partner-admin/app.js`](../../partner-admin/app.js)
> **관련 문서**: [앱 레퍼런스](reference-partner-admin-app.md) · [앱 구조](explanation-app-structure.md)

[`NAV_GROUPS`](../../partner-admin/app.js#L32) 12개 항목 아래 58개 화면 전체입니다. 화면 id는
`switchView(id)`의 인자이자 [`VIEW_RENDERERS`](../../partner-admin/app.js#L1695)의 키입니다.

**엔진 열 읽는 법**
- `리스트` — [`mountListView(cfg)`](reference-partner-admin-app.md#mountlistviewcfg--설정-주도-리스트-엔진)로 만든 화면. 실시간 구독·검색·페이징이 자동으로 붙습니다.
- `전용` — 자체 HTML을 반환하는 렌더러. 실시간 갱신 없음.

---

## 단독 화면 (5)

| id | 이름 | 엔진 | 렌더러 | 읽는 컬렉션 | 쓰기 |
| --- | --- | --- | --- | --- | --- |
| `dashboard` | 대시보드 | 전용 | [`renderDashboard`](../../partner-admin/app.js#L450) | `members` `memberLedger` `rounds` `partners` `tables` `adminLogs` | 없음 |
| `myinfo` | 내정보관리 | 전용 | [`renderMyInfo`](../../partner-admin/app.js#L540) | `CURRENT_STAFF` (메모리) | `partnerStaff` (이름·비밀번호) |
| `realtime` | 실시간접속자 | 전용 | [`renderRealtime`](../../partner-admin/app.js#L580) | `members` | 없음 |
| `account` | 계정관리 | 전용 | [`renderAccount`](../../partner-admin/app.js#L605) | `members` `memberLedger` | `memberLedger` `balanceTotals` `members` `memberActionLogs` |
| `settlementReport` | 파트너정산리포트 | 리스트 | [`renderSettlementReport`](../../partner-admin/app.js#L659) | `partners` `shareLedger` | 없음 |

**`realtime` 판정 기준** — `lastLoginAt`이 현재 시각 기준 6시간 이내인 회원.
`Date.now() - new Date(m.lastLoginAt) < 1000*60*60*6` ([L583](../../partner-admin/app.js#L583)).

**`settlementReport` 조인** — `shareLedger`를 `partnerCode`로 합산해 `accum` 컬럼을 만듭니다.
합산은 마운트 시점 1회이므로, `partners` 스냅샷이 갱신돼도 정산 누계는 그대로입니다.

---

## 회원관리 (10)

| id | 이름 | 엔진 | 컬렉션 | 필터 / `extraFilter` | 행 액션 |
| --- | --- | --- | --- | --- | --- |
| `userList` | 유저리스트 | 리스트 | `members` | 에이전트·회원유형·로그인상태 | 행 클릭 → 회원 360 모달 |
| `betHistory` | 베팅내역 | 리스트 | `memberLedger` | `category==='bet'` | 없음 |
| `payoutHistory` | 지급내역 | 리스트 | `memberLedger` | `category==='payout'` | 없음 |
| `pointAccum` | 포인트누적내역 | 리스트 | `memberLedger` | `category==='point_earn'` | 없음 |
| `pointConversion` | 포인트전환리스트 | 리스트 | `memberLedger` | `category==='point_convert'` | 없음 |
| `shareMgmt` | 쉐어관리 | 리스트 | `partners` | 없음 | 쉐어율 편집, + 생성 |
| `depositMgmt` | 디파짓관리 | 리스트 | `depositRequests` | 상태 | **승인 / 거절** |
| `shareAccumList` | 쉐어누적리스트 | 리스트 | `shareLedger` | 없음 | 없음 |
| `shareSettingLog` | 쉐어설정로그 | 리스트 | `adminLogs` | `action`에 `'쉐어'` 포함 | 없음 |
| `dailyReport` | 데일리리포트 | 전용 | `memberLedger` | 최근 14일 | 없음 |

### `userList` 파생 컬럼

[`mapRow`](../../partner-admin/app.js#L706)가 `getBalances()` 결과로 7개 컬럼을 만듭니다.

| 컬럼 | 계산식 |
| --- | --- |
| 보유금 | `b.balance` |
| 보유포인트 | `b.points` |
| 롤링 | `-b.bet` (베팅 원장은 음수) |
| 롤링커미션 | `rolling * 0.015` (1.5% 하드코딩) |
| 윈로스 | `b.payout + b.bet` |
| 내 수익금 | `-winLoss` |
| 입금 PHP / 출금 PHP | `b.deposit` / `-b.withdraw` |

`balances`는 마운트 시점의 스냅샷입니다. 다른 터미널에서 입금이 발생해도 `members` 스냅샷만
갱신되고 금액 컬럼은 그대로입니다.

### `depositMgmt` 승인 흐름

[`approveDeposit(id)`](../../partner-admin/app.js#L890) — 트랜잭션으로 `대기`→`승인`을 선점한 뒤
`writeMemberLedgerEntry`로 `deposit` 원장을 씁니다. 진 쪽은 "이미 처리된 요청입니다".
[`rejectDeposit(id)`](../../partner-admin/app.js#L909) — 상태만 `거절`로. 원장 쓰기 없음.

### `dailyReport` 집계

최근 14일치를 `memberLedger`에서 일별로 집계합니다. `dailySettlement`(결제 관리 그룹)가
같은 함수를 재사용합니다.

| 열 | 계산 |
| --- | --- |
| 순유저 | 그날 원장에 등장한 `memberId` 고유 수 |
| 입금 / 출금 | `Σ deposit` / `−Σ withdraw` |
| 베팅액 / 페이아웃 | `−Σ bet` / `Σ payout` |
| 윈로스 | 베팅액 − 페이아웃 |

---

## 통계 (9)

9개 모두 [`renderStatsTab(tabId)`](../../partner-admin/app.js#L966) →
[`renderStatsBody(tabId)`](../../partner-admin/app.js#L980) 한 쌍이 처리합니다. 어느 탭이든
진입 시 `memberLedger` · `members` · `rounds`를 전량 로드합니다.

| id | 탭 이름 | 추가로 읽는 것 | 출력 |
| --- | --- | --- | --- |
| `marketRatio` | 마켓비율 | `tables` | 도넛 5 + 스코프×결과 표 |
| `depositWithdrawStats` | 입출금내역 | — | 카드 3 |
| `performanceCompare` | 실적비교 | — | 카지노 3행 표 |
| `realtimeRisk` | 실시간위험감지 | — | 500,000 이상 베팅 15건 |
| `highBet` | 고액베팅 | — | 상위 20건 |
| `leaderboard` | 리더보드 | — | 패널 4개 (모집·입금·베팅·롤링) |
| `memberActivity` | 회원활동 | — | 14일 라인차트 |
| `signupStatus` | 회원가입현황 | — | 14일 바차트 |
| `bettingStatus` | 베팅현황 | — | 카드 2 |

**마켓비율 스코프** — `all` / `speed` / `avatar` / `live` / `highpay` 5종. `live`와 `highpay`는
`tables.type`에 대응하는 값이 없으므로 항상 0건입니다 (`tableType[r.tableId]==='live'`가
참이 되는 문서 없음).

**환수율 계산** — 타이 적중은 9배, 그 외는 `round(베팅액 × 1.95)`로 총 반환을 추정합니다
([L1015](../../partner-admin/app.js#L1015)). 실제 지급된 `payout` 원장을 쓰지 않고 재계산합니다.

---

## 테이블관리 (10)

| id | 이름 | 엔진 | 컬렉션 | 행 액션 |
| --- | --- | --- | --- | --- |
| `tableList` | 테이블 관리 | 리스트 | `tables` | 테이블설정, + 생성 |
| `tableBetHistory` | 테이블 배팅 총 금액(24H) | 리스트 | `memberLedger` (`bet`) | 없음 |
| `avatarGameList` | 아바타 게임 관리 | 전용 | `tables` (`type==='avatar'`) | 게임설정·상세설정 모달 |
| `avatarRequests` | 아바타대리베팅신청 | 리스트 | `avatarRequests` | **승인 / 거절 / 강제 종료** |
| `roundEdit` | 게임라운드수정 | 리스트 | `rounds` | **결과 수정 / 라운드 취소** |
| `chatLog` | 채팅 로그 | 리스트 | `chatMessages` | 없음 |
| `bankerCutBets` | 뱅커 절사 배팅내역 | 리스트 | `memberLedger` (`bet` + `betType==='banker'`) | 없음 |
| `avatarMissFix` | 아바타 미스 수정 | 리스트 | `avatarMissCorrections` | 없음 |
| `tableVideo` | 게임 테이블 영상 | 전용 | `tables` | 없음 (플레이스홀더 타일) |
| `roundEditSettle` | 게임라운드수정 정산 | 리스트 | `rounds` (`editedBy` 존재) | 없음 |

### `avatarRequests` 문서 스키마

플레이어 사이트가 만들고 파트너 어드민이 갱신합니다.

```js
{
  memberId: 'SEH1001',
  tableId: 'HN-A01',
  casino: 'HANN',
  buyin: 1000000,
  betSide: 'banker',            // player | banker | tie
  betAmount: 50000,
  status: '대기',                // 대기 | 진행중 | 종료
  requestedAt: '2026-08-14T09:00:00.000Z',
  avatarStaffId: 'admin',       // 승인 시 기록
  approvedAt: '2026-08-14T09:05:00.000Z',
  endedAt: '2026-08-14T10:30:00.000Z',
}
```

| 액션 | 함수 | 쓰기 |
| --- | --- | --- |
| 승인 | [`openApproveAvatarRequestModal`](../../partner-admin/app.js#L1215) | `status:'진행중'`, `avatarStaffId`, `approvedAt` + `adminLogs` |
| 거절 | [`rejectAvatarRequest`](../../partner-admin/app.js#L1229) | `status:'종료'`, `endedAt` + `adminLogs` |
| 강제 종료 | [`endAvatarRequestByAdmin`](../../partner-admin/app.js#L1234) | 거절과 동일한 쓰기 + 다른 로그 문구 |

거절과 강제 종료가 같은 최종 상태(`종료`)를 씁니다. 구분은 `adminLogs`의 `action` 문구로만
남습니다.

### `avatarGameList` 설정 모달

- **아바타게임설정** [`openAvatarGameSettings`](../../partner-admin/app.js#L1168) —
  `cageConfigPartner/avatarGame`에 `{timer, maxTable, commission}`을 씁니다. 이 문서를 읽는
  코드는 저장소에 없습니다.
- **아바타설정** [`openAvatarDetailSettings`](../../partner-admin/app.js#L1180) —
  스킨·테마 셀렉트를 보여주지만 저장 버튼이 토스트만 띄웁니다. 아무것도 쓰지 않습니다.

### `roundEdit` 액션

| 액션 | 함수 | 효과 |
| --- | --- | --- |
| 결과 수정 | [`openRoundEditModal`](../../partner-admin/app.js#L1252) | `rounds.result` `editedBy` `editedReason` + `adminLogs`. **정산 재계산 없음** |
| 라운드 취소 | [`openRoundCancelModal`](../../partner-admin/app.js#L1265) → [`submitRoundCancel`](../../partner-admin/app.js#L1280) | 취소 플래그 + 환불/회수 `correction` + 선택적 인게임공지 |

결과 수정은 원장을 건드리지 않습니다. `roundEditSettle` 화면은 "재정산 내역"이라는 이름이지만
수정된 라운드 목록만 보여줄 뿐 재정산 로직이 없습니다.

취소 사유 4종: 딜링 오류(카드 뒤집힘/오배당) · 엔젤아이 인식 오류 · 장비 이상으로 인한 재셔플 · 기타.

---

## 월렛관리 (3)

| id | 이름 | 컬렉션 | `extraFilter` |
| --- | --- | --- | --- |
| `depositWithdrawList` | 입출금리스트 | `memberLedger` | `category` 가 `deposit` 또는 `withdraw` |
| `walletTransferList` | 월렛이체리스트 | `memberLedger` | `category==='transfer'` |
| `walletConversionList` | 월렛전환리스트 | `memberLedger` | `category==='point_convert'` |

`transfer` 카테고리를 쓰는 코드는 저장소 어디에도 없습니다. 월렛이체리스트는 항상 비어 있습니다.
`walletConversionList`와 `pointConversion`(회원관리)은 같은 데이터를 다른 컬럼으로 보여줍니다.

---

## 고객센터 (7)

| id | 이름 | 엔진 | 컬렉션 | 행 액션 |
| --- | --- | --- | --- | --- |
| `tickerNotice` | 한줄공지 | 리스트 | `tickerNotices` | 노출/숨기기 토글, + 생성 |
| `notice` | 공지사항 | 리스트 | `notices` | 행 클릭 → 편집, + 생성 |
| `guide` | 이용안내 | 전용 | `noticeGuide/single` | 본문 저장 |
| `bannedWords` | 금지어설정 | 리스트 | `bannedWords` | 삭제, + 생성 |
| `inquiry1on1` | 일대일문의 | 리스트 | `inquiries` | 행 클릭 → 답변, + 생성 |
| `inGameNotice` | 인게임공지 | 리스트 | `inGameNotices` | + 생성 |
| `csContact` | 고객센터연락처관리 | 리스트 | `csContacts` | 삭제, + 생성 |

**`inGameNotice` 적용 대상** — `all` / `avatar` / `speed`. 라운드 취소 시
[`submitRoundCancel`](../../partner-admin/app.js#L1312)이 `tableType:'all'`로 자동 등록합니다.

**`deleteDoc(coll, id)`** [L1462](../../partner-admin/app.js#L1462) — 확인 모달 후 하드 삭제.
감사 로그를 남기지 않습니다. `bannedWords`와 `csContacts`가 사용합니다.

---

## 관리자 관리 (10)

| id | 이름 | 컬렉션 | `extraFilter` | 행 액션 |
| --- | --- | --- | --- | --- |
| `moveAffiliation` | 소속이동 | `members` | 없음 | 상위 에이전트 변경 |
| `fullMemberConversion` | 정회원전환리스트 | `members` | `memberType==='준회원'` | 정회원 전환 |
| `signupSmsVerify` | 가입인증문자확인 | `members` | 없음 | 인증처리 |
| `blacklist` | 블랙리스트 | `members` | `status==='블랙리스트'` | 해제 (→ `정상`) |
| `memberActionLog` | 회원액션로그 | `memberActionLogs` | 없음 | 없음 |
| `adminLog` | 관리자로그 | `adminLogs` | 없음 | 없음 |
| `sharePartnerMgmt` | 쉐어파트너관리 | `partners` | 없음 | 쉐어율 편집 |
| `subJunketMgmt` | 서브정켓관리 | `partners` | `level > 1` | 없음 |
| `eventMgmt` | 이벤트관리 | `events` | 없음 | + 생성 |
| `fieldSignupList` | 현장가입리스트 | `members` | `source==='field'` | 없음 |

`sharePartnerMgmt`와 회원관리의 `shareMgmt`는 컬럼만 다르고 같은 컬렉션·같은 편집 함수
([`editShareRate`](../../partner-admin/app.js#L869))를 씁니다.

`convertToFullMember` ([L1568](../../partner-admin/app.js#L1568))와 `verifySms`
([L1579](../../partner-admin/app.js#L1579))는 감사 로그를 남기지 않습니다. `moveAffiliation`만
`memberActionLogs`를 씁니다.

---

## 결제 관리 (4)

| id | 이름 | 엔진 | 컬렉션 | 행 액션 |
| --- | --- | --- | --- | --- |
| `cageTransferHistory` | 케이지이체내역 | 리스트 | `memberLedger` (`deposit`\|`withdraw`) | 없음 |
| `dailySettlement` | 일자별정산 | 전용 | `memberLedger` | 없음 — `renderDailyReport` 재사용 |
| `paymentProcessList` | 결제처리리스트 | 리스트 | `paymentRequests` (`status==='대기'`) | **승인 / 거절** |
| `paymentMgmt` | 결제관리 | 리스트 | `paymentRequests` | 없음 (상태 필터만) |

`cageTransferHistory`와 월렛관리의 `depositWithdrawList`는 같은 필터·같은 컬렉션이며 컬럼만
다릅니다.

### `processPayment(id, status)` [L1661](../../partner-admin/app.js#L1661)

트랜잭션으로 `대기`→`승인`/`거절`을 선점합니다. `승인`이면 요청의 `type`에 따라 부호를 정합니다.

| `paymentRequests.type` | 원장 `category` | 부호 |
| --- | --- | --- |
| `입금` | `deposit` | + |
| `출금` | `withdraw` | − |

---

## 화면이 쓰는 Firestore 컬렉션 24종

| 컬렉션 | 읽는 화면 | 쓰는 화면 | 와이프 대상 |
| --- | --- | --- | --- |
| `members` | 12곳 | 계정관리·유저리스트·소속이동·정회원전환·가입인증·블랙리스트 | ✅ |
| `memberLedger` | 16곳 | 계정관리·디파짓·결제처리·라운드취소 | ✅ |
| `balanceTotals` | 없음 | `writeMemberLedgerEntry` 경유 5곳 | ❌ |
| `partners` | 4곳 | 쉐어관리 | ✅ |
| `shareLedger` | 2곳 | 없음 (시드만) | ✅ |
| `tables` | 5곳 | 테이블관리 | ✅ |
| `rounds` | 5곳 | 게임라운드수정 | ✅ |
| `avatarRequests` | 아바타대리베팅신청 | 동일 | ❌ |
| `depositRequests` | 디파짓관리 | 동일 | ✅ |
| `paymentRequests` | 결제처리·결제관리 | 결제처리 | ✅ |
| `notices` `tickerNotices` `noticeGuide` `bannedWords` `inquiries` `inGameNotices` `csContacts` | 고객센터 7화면 | 동일 | ✅ |
| `memberActionLogs` | 회원액션로그·회원상세 | 계정관리·소속이동 | ✅ |
| `adminLogs` | 관리자로그·쉐어설정로그·대시보드 | 아바타승인·라운드수정·라운드취소 | ✅ |
| `chatMessages` | 채팅 로그 | 없음 (플레이어 사이트가 씀) | ✅ |
| `events` | 이벤트관리 | 동일 | ✅ |
| `avatarMissCorrections` | 아바타 미스 수정 | 없음 (시드만) | ✅ |
| `partnerStaff` | 로그인·내정보관리 | 동일 | ❌ |
| `cageConfigPartner` | 없음 | 아바타게임설정 | ❌ |

`balanceTotals`를 읽는 화면은 하나도 없습니다. 설계상 의도된 상태입니다 —
[보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md)의 이중 쓰기 단계이며, 컷오버 전까지
파생 합계(`getBalances`)가 진실의 원천입니다.

---

## 관련 문서

- [앱 레퍼런스](reference-partner-admin-app.md) — 함수·상태·계약 상세
- [앱 구조와 설계 배경](explanation-app-structure.md) — 왜 이 구조인지
- [알려진 격차](explanation-known-gaps.md) — 이 표에서 "없음"으로 표시된 것들이 문제가 되는 지점
