# 보안 · 데이터 일관성 리뷰 (2026-08-10)

리뷰 대상: `docs/` 문서 4종 + 실제 구현 대조
브랜치: `claude/cage-admin-5-features-75k9ac`
목표 상태: **실서비스** (실제 돈이 오가는 시스템으로 전제)

이 문서는 발견된 문제와 개선 방향만 담습니다. 어떤 설계로 갈지는 별도 결정 단계에서 정합니다.

---

## 0. 한 줄 요약

원장(ledger) 설계는 옳은 방향이지만, **그 원장에 쓸 자격을 검사하는 주체가 시스템 어디에도 없습니다.** append-only는 "거래 분실"을 막고, "허가되지 않은 거래"는 막지 않습니다. 문서는 전자를 해결했다고 선언하면서 후자가 미해결이라는 사실을 언급하지 않습니다.

| # | 등급 | 문제 | 확신 |
|---|---|---|---|
| S1 | P0 | Firestore 보안 규칙 파일이 저장소에 없음 | 10/10 |
| S2 | P0 | `APP_API_SECRET`이 공개 번들에 하드코딩·Git 커밋됨 | 10/10 |
| S3 | P0 | 베팅·라운드 결과·페이아웃이 전부 클라이언트 권한 | 10/10 |
| S4 | P0 | Telegram 계좌 연동에 소유권 증명 없음 (계좌 탈취 경로) | 9/10 |
| S5 | P1 | 비밀번호 평문 저장 + 클라이언트 비교 | 10/10 |
| S6 | P1 | 회원가입 무인증 + 즉시 100,000 보유금 지급 | 9/10 |
| S7 | P1 | 파트너 콘솔 저장형 XSS (회원 닉네임·ID) | 9/10 |
| C1 | P1 | 금전 쓰기에 트랜잭션 0건 → 오버드래프트·이중지불 | 10/10 |
| C2 | P1 | 타임스탬프가 클라이언트 벽시계 → 정산일 조작 가능 | 9/10 |
| C3 | P1 | 멱등성 주장이 실제로 성립하지 않음 | 8/10 |
| C4 | P2 | 원장 스키마가 컬렉션마다 달라 집계가 조용히 0 반환 | 9/10 |
| C5 | P2 | 오프라인 캐시 활성 상태에서 잔액 검사가 stale | 9/10 |
| Q1 | P2 | 테스트 0건 (프레임워크·CI 검증 단계 자체가 없음) | 10/10 |
| Q2 | P2 | `FIREBASE_CONFIG` 2벌 중복, 빈 catch 다수 | 9/10 |
| P1x | P2 | 잔액 조회가 원장 전량 다운로드 → 라운드마다 O(누적 베팅수) | 10/10 |
| D1 | P1 | 문서가 사실과 다른 보안 주장을 8건 단언 | 10/10 |

---

## 1. 신뢰 경계 — 현재 상태

```text
┌───────────────── 브라우저 (모든 권한 보유) ─────────────────┐
│                                                              │
│  회원 인증    members/{id}.pw 를 받아와 JS 에서 문자열 비교  │
│               game-engine.js:47                              │
│  잔액 계산    memberLedger 전량 다운로드 후 JS 합산          │
│               game-engine.js:70                              │
│  잔액 검사    STATE.balance (메모리 변수, 팁 경로만 검사)    │
│               avatar/app.js:713 / 786 에는 검사 없음         │
│  라운드 결과  Math.random()                                  │
│               game-engine.js:26                              │
│  페이아웃     mult × amount 를 클라이언트가 계산             │
│               game-engine.js:88-104                          │
│  원장 기록    set() 직접 쓰기 · 트랜잭션 0건                 │
│  앱 비밀값    index.html:6088 에 평문                        │
│                                                              │
└──────────────────────────┬───────────────────────────────────┘
                           │
                    ⚠ 검증 계층 없음
                           │
                           ▼
┌──────────── Firestore (보안 규칙 파일 없음 / 테스트 모드) ──┐
│  members        loginId · pw(평문) · withdrawPw(평문)        │
│  accounts       passportNo · passportPhoto · signaturePhoto  │
│  memberLedger   실제 보유금의 단일 진실 공급원               │
│  partnerStaff   운영자 계정 (pw 평문)                        │
└──────────────────────────────────────────────────────────────┘
                           ▲
                           │  ← Functions 는 telegramLinks 4개 함수만 방어
                           │     (그 방어도 S2 로 무력화됨)
```

**서버 측 검증 지점 = 0개.** 브라우저를 신뢰하지 않으면 성립하는 기능이 하나도 없습니다.

---

## 2. 보안 문제

### S1 · [P0] Firestore 보안 규칙 파일 부재

저장소 전체에 `*.rules` 파일이 없고, `firebase.json`에 `firestore` 섹션이 없습니다. 즉 규칙은 **배포 파이프라인에 존재하지 않습니다.**

`docs/FIRESTORE_DATA_MODEL.md:112`:
> Firestore 보안 규칙 정교화 (지금은 테스트 모드) — 직원 인증 연동한 실제 규칙은 별도 단계

테스트 모드 규칙의 결말은 둘 중 하나입니다.

```text
   테스트 모드 규칙
        │
        ├── 만료일 도달 ────► allow: if false  ──► 앱 전면 무음 정지
        │                                          (에러 핸들러가 catch(e){} 라
        │                                           사용자에게 아무 표시도 안 됨)
        │
        └── 만료 전 ───────► allow: if true   ──► DB 전면 공개
                                                   ↓
                        projectId 는 클라이언트 번들에 있음 (cage-ui.js:11)
                                                   ↓
                        누구나 Firestore SDK 로 직접 접속 가능
```

공개 상태일 때 가능한 것:

- `members` 전량 읽기 → 전 회원 **평문 비밀번호 + 출금 비밀번호** 획득
- `accounts` 전량 읽기 → `passportNo` · `passportPhoto` · `sitePhoto` · `signaturePhoto` 획득 (`FIRESTORE_DATA_MODEL.md:47-49`). KYC 원본 유출
- `memberLedger`에 `{memberId:'...', amount: 999999999, category:'deposit'}` 직접 삽입
- `partnerStaff` 읽기 → 운영자 계정 탈취

`.github/workflows/firebase-hosting-deploy.yml`이 푸시마다 `channelId: live`로 배포하는데 감시 경로에 규칙이 없어, 규칙을 나중에 만들어도 자동 배포되지 않습니다.

**개선 방향**

1. `firestore.rules` + `firestore.indexes.json`을 저장소에 추가하고 `firebase.json`에 `firestore` 섹션 연결
2. 기본 자세를 `allow read, write: if false`로 두고 필요한 경로만 여는 화이트리스트 방식
3. 돈 컬렉션(`memberLedger` · `ledger` · `mainCageLedger` · `shareLedger`)은 **클라이언트 쓰기 전면 거부**. 서버 권한 주체만 쓰기
4. `accounts`의 여권/서명 이미지는 Firestore가 아니라 Storage로 옮기고 서명 URL로만 접근
5. CI에 규칙 배포와 `@firebase/rules-unit-testing` 기반 규칙 테스트를 추가. 규칙은 코드이므로 테스트 없이 배포하면 안 됨

---

### S2 · [P0] `APP_API_SECRET` 공개 번들 하드코딩

`index.html:6088`:
```js
const TG_APP_API_SECRET = '19293b491727ee62611dbcec7056662c73023281d7702da0';
```

`docs/how-to-deploy.md:38`은 정반대를 지시합니다.
> 값을 따옴표와 함께 소스 코드나 Git에 저장하지 마세요.

브라우저 `view-source`로 즉시 획득 가능하므로 Functions 3종의 인증이 사실상 없는 것과 같습니다.

| 함수 | 비밀값 유출 시 가능한 행위 |
|---|---|
| `getTelegramLinks` | 계좌ID별 Telegram 사용자명·chatId 열거 (PII 수집) |
| `sendTelegramMessage` | 실제 고객에게 임의 문구 발송. `index.html:6262`가 쓰는 "출금 인증 요청" 형식을 그대로 흉내내면 완성형 피싱 |
| `deleteTelegramLink` | 임의 계정의 연동 해제 (서비스 방해) |

**CORS는 방어가 아닙니다.** `functions/index.js:19-28`의 `applyCors`는 `Access-Control-Allow-Origin`을 *설정*만 하고 `req.get('origin')`을 *읽지 않습니다*. CORS는 브라우저 정책이라 `curl`은 무시합니다.

따라서 `docs/reference-cloud-functions.md:15`의 다음 문장은 사실이 아닙니다.
> 앱용 엔드포인트는 Origin, 메서드, `X-App-Secret`을 확인합니다.

**개선 방향**

1. **비밀값 회전이 먼저.** 이미 Git 히스토리에 남아 있으므로 코드에서 지우는 것만으로는 무효화되지 않음
2. 공유 비밀값 모델 자체를 폐기. 브라우저에 두고 안전한 비밀값은 존재하지 않음. Firebase Auth ID 토큰 검증(`onCall` 또는 `verifyIdToken`)으로 대체
3. Origin을 실제로 검증하려면 `req.get('origin')`을 읽고 화이트리스트와 비교. 단 이것도 보조 수단이지 인증이 아님
4. 문서의 "Origin을 확인합니다" 문장을 구현과 일치시키거나 구현을 문장에 맞춤

---

### S3 · [P0] 베팅 · 결과 · 페이아웃이 전부 클라이언트 권한

`shared/game-engine.js:81-104`:
```js
async function placeBet(db, {memberId, casino, tableId, roundId, betType, amount, staff}){
  await db.collection('memberLedger').doc(uuidv4()).set({
    memberId, casino, amount: -Math.abs(amount), category:'bet', ...
```
잔액 검사가 함수 안에 없습니다. 호출부 `avatar/app.js:786`에도 없습니다. 팁 경로(`avatar/app.js:713`)만 `STATE.balance`를 검사하는데, 이는 메모리 변수라 콘솔에서 바꾸면 그만입니다.

```js
// game-engine.js:88-104 — 클라이언트가 만든 sim 을 근거로
// 클라이언트가 배수를 계산하고, 클라이언트가 + 금액을 원장에 씀
const payout = Math.round(amount * mult);
if (payout > 0){ await db.collection('memberLedger').doc(uuidv4()).set({ amount: payout, category:'payout', ... }); }
```

결과 생성(`Math.random()`) · 배수 결정 · 상금 기록이 모두 같은 신뢰 영역에 있습니다. `docs/explanation-architecture.md:62`가 RNG 문제를 인정하고 있으나, **더 큰 문제는 RNG가 아니라 페이아웃 기록 권한**입니다. 공인 RNG를 붙여도 클라이언트가 상금을 쓰는 구조면 소용이 없습니다.

**개선 방향**

1. `placeBet` / `settleBet` / `writeRoundDoc`를 클라이언트에서 제거하고 서버 권한 주체로 이동
2. 라운드 결과는 서버가 생성하고 모든 참가 단말이 같은 라운드 문서를 구독하는 구조로 전환. 현재는 단말마다 `setInterval`로 각자 라운드를 돌리므로 "같은 테이블"이라는 개념 자체가 성립하지 않음
3. 서버는 한 트랜잭션 안에서 (a) 잔액 집계 (b) 베팅 한도 검사 (c) 원장 쓰기를 수행
4. 클라이언트는 "베팅 의도"만 제출하고 결과를 구독

---

### S4 · [P0] Telegram 연동에 소유권 증명 없음

`functions/index.js:63-78` — `/start SE7419`를 보낸 사람이 누구든 그 계좌에 자기 chat이 연결됩니다.

```text
공격자                Telegram Bot            telegramLinks
  │  /start SE7419         │                       │
  ├───────────────────────►│                       │
  │                        ├──► set(SE7419_<myChat>)
  │                        │                       │
  │  이후 SE7419 의 출금 인증 메시지를 수신        │
  ◄────────────────────────┤                       │
```

계좌 ID는 짧고 규칙적이어서(`SE7419`, `SEC6937`) 열거가 쉽습니다. `index.html:6262`가 이 채널로 출금 인증 링크를 보내므로 계좌 탈취 경로가 됩니다.

부수 문제: 사용자 입력 `accountId`가 검증 없이 문서 ID(`${accountId.toUpperCase()}_${chatId}`)에 들어갑니다. `/`가 포함되면 Firestore 경로 파싱이 깨집니다.

**개선 방향**

1. 앱에서 발급한 **1회용·단기 만료 연동 토큰**을 `/start <token>` 페이로드로 사용. 계좌 ID를 직접 받지 않음
2. 토큰은 로그인 세션에서만 발급되고 사용 즉시 소멸
3. `accountId` 형식 검증(`^[A-Z0-9]{4,16}$`)을 문서 ID 조립 전에 수행
4. webhook에 chatId 단위 rate limit 추가

---

### S5 · [P1] 비밀번호 평문 저장 + 클라이언트 비교

`docs/FIRESTORE_DATA_MODEL.md:124`는 `pw(해시)`라고 명세합니다. 구현은 평문입니다.

```js
// partner-admin/app.js:701
pw:'0000', withdrawPw:'0000', createdAt: new Date().toISOString(), ...

// shared/game-engine.js:47
if (String(m.pw ?? '0000') !== pw) return {ok:false, reason:'badpw'};

// partner-admin/app.js:186
if (!staff || String(staff.pw ?? '0000') !== pw){
```

두 겹의 문제입니다. (a) 평문 저장 (b) 검증을 클라이언트가 수행 — 즉 로그인하려면 **먼저 그 계정의 비밀번호를 다운로드해야 합니다.** 규칙이 없으면 로그인 없이도 전체 조회가 됩니다.

`partner-admin/app.js:170-172`는 `partnerStaff`가 비어 있을 때 `admin` / `0000` 마스터 계정을 자동 생성하고, `docs/tutorial-run-demo.md:27-28`이 그 자격증명을 문서에 공개합니다.

`index.html:6307`의 마스터 비밀번호는 SHA-256 다이제스트로 바뀌었으나, 솔트 없는 단일 SHA-256이라 레인보우 테이블 대상이고 상수 자체가 공개 번들에 있습니다.

**개선 방향**

1. Firebase Authentication으로 이전. 비밀번호를 애플리케이션이 보관하지 않는 것이 목표
2. 역할은 custom claims(`member` / `partnerStaff` / `cage`)로 표현하고 규칙과 서버가 그 claim을 신뢰
3. 출금 비밀번호처럼 별도 유지가 필요한 값은 서버에서 salt + Argon2id/scrypt로 해시하고 비교도 서버에서 수행
4. 자동 생성 마스터 계정 제거. 최초 운영자는 배포 스크립트나 콘솔에서 1회 수동 생성
5. `tutorial-run-demo.md`의 고정 자격증명은 에뮬레이터 시드 전용임을 명시하고, 프로덕션 경로와 분리

---

### S6 · [P1] 회원가입 무인증 + 즉시 100,000 지급

`shared/game-engine.js:53-68`:
```js
const existing = await db.collection('members').doc(id).get();
if (existing.exists) return {ok:false, reason:'dup'};
...
await db.collection('memberLedger').doc(uuidv4()).set({
  memberId:id, casino:data.casino, amount:100000, category:'deposit', memo:'가입 축하 포인트', ...
});
```

두 가지 결함이 겹칩니다.

- **TOCTOU**: 존재 확인과 쓰기가 분리되어 있어 동시 가입 시 기존 회원 문서를 덮어씁니다. 덮어쓴 쪽이 그 ID의 원장 전부를 상속합니다
- **카테고리 오류**: 메모는 "포인트"인데 `category:'deposit'`입니다. `game-engine.js:74`의 분기가 `point_earn` / `point_convert`만 포인트로 취급하므로, 이 100,000은 포인트가 아니라 **현금성 보유금**입니다

인증 없는 가입과 결합하면 계정 수 × 100,000의 무한 발행입니다.

**개선 방향**

1. 가입을 서버 권한 주체로 이전하고 문서 생성은 `create` 의미론(존재 시 실패)으로 수행
2. 가입 보너스 지급 여부와 카테고리를 명시적으로 결정. 포인트라면 `point_earn`
3. 보너스는 SMS/이메일 인증 완료 후 지급하도록 분리 (현재 `smsVerified`는 클라이언트가 `true`로 넘기는 값)

---

### S7 · [P1] 파트너 콘솔 저장형 XSS

`partner-admin/app.js:585-595`:
```js
return `<tr id="acctrow-${m.id}">
  <td>${m.id}</td><td>${m.nickname||'—'}</td>
  ...
  <td><button ... onclick="openBalanceModal('${m.id}','deposit','보유금 추가')">+ 추가</button>
```

`nickname`과 `id`는 회원이 가입 폼에서 직접 입력하는 값입니다(`avatar/app.js:91-102`). 형식 검증이 없습니다. `escapeHtml`은 119KB 파일 전체에서 8회만 쓰입니다.

```text
회원 가입 폼          Firestore              파트너 콘솔 회원목록
 nickname:            members/{id}            innerHTML 로 그대로 삽입
 <img src=x           .nickname               → 운영자 세션에서 스크립트 실행
  onerror=...>   ──►   저장          ──►      → 그 세션은 DB 전권을 가짐
```

`id`는 `onclick="...('${m.id}')"` 안에 들어가므로 작은따옴표 탈출로 임의 JS 실행이 가능합니다.

플레이어 화면(`avatar/app.js`)의 채팅·베팅 이력은 `escapeHtml`을 제대로 씁니다(`:847`, `:148`). 파트너 콘솔만 누락되어 있습니다.

**개선 방향**

1. 회원 입력이 렌더링되는 모든 지점에 `escapeHtml` 적용. 특히 `partner-admin/app.js`의 테이블 렌더러 전수 점검
2. `onclick` 속성에 데이터를 문자열로 끼워넣는 패턴을 `data-*` 속성 + 이벤트 위임으로 교체 (근본 해결)
3. `id`·`nickname`에 입력 형식 제약(`^[A-Z0-9]{4,16}$`, 닉네임 길이·문자 제한)을 가입 시점과 규칙 양쪽에서 강제
4. Hosting에 CSP 헤더 추가 (`firebase.json`의 `headers`에 지금은 캐시 헤더만 있음)

---

## 3. 데이터 일관성 문제

### C1 · [P1] 금전 쓰기에 트랜잭션 0건

저장소 전체에서 `runTransaction` 검색 결과 **0건**입니다.

`docs/FIRESTORE_DATA_MODEL.md:13`의 핵심 주장:
> 오프라인 상태의 서로 다른 단말이 각자 다른 거래를 기록해도, 온라인 복귀 시 그냥 둘 다 존재하게 될 뿐 — 충돌도, 유실도 없다.

이 문장은 **분실 갱신(lost update)에 대해서는 참**입니다. 그러나 **불변식(잔액 ≥ 0)에 대해서는 거짓**입니다. 두 단말이 각자 잔액 100,000을 읽고 각자 -100,000을 append하면, 둘 다 살아남아 잔액이 -100,000이 됩니다. 충돌도 유실도 없이 돈이 샙니다.

```text
   단말 A                     단말 B
     │ read balance = 100,000   │ read balance = 100,000
     │                          │
     │ append -100,000 ────────►│
     │                          ├──► append -100,000
     ▼                          ▼
        최종 잔액 = -100,000
        append-only 는 이 상황을 "정상"으로 처리함
```

**개선 방향**

1. 읽기-검사-쓰기를 하나의 트랜잭션으로 묶음. Firestore 트랜잭션은 컬렉션 합산을 직접 못 하므로, 회원당 **잔액 스냅샷 문서**(`memberBalances/{memberId}`)를 트랜잭션 대상으로 두고 원장은 그대로 감사 기록으로 유지하는 하이브리드가 현실적
2. 스냅샷과 원장 합계가 어긋나는지 주기적으로 검증하는 정합성 배치를 함께 설계 (스냅샷 도입은 "잔액을 저장하지 않는다" 원칙의 의도적 예외이므로, 그 예외를 검증으로 보완)
3. `FIRESTORE_DATA_MODEL.md`에 "append-only가 보장하는 것 / 보장하지 않는 것"을 명시적으로 분리 기술

---

### C2 · [P1] 타임스탬프가 클라이언트 벽시계

명세 (`FIRESTORE_DATA_MODEL.md:38-40`):
```
deviceId: string          // 어느 단말에서 기록됐는지 (감사용)
clientCreatedAt: string   // 클라이언트 로컬시간
createdAt: serverTimestamp
```

구현 (`game-engine.js:85`, `avatar/app.js:718`, `partner-admin/app.js:701`):
```js
createdAt: new Date().toISOString(),
```

`clientCreatedAt`도 `deviceId`도 어느 쓰기 경로에도 존재하지 않습니다. `createdAt` 하나가 클라이언트 시계입니다.

영향 범위가 넓습니다. `FIRESTORE_DATA_MODEL.md:197`에 따르면 일자별정산 · 데일리리포트가 이 필드 기준이고, `cageConfig/global`의 `lastCutoffDt` · `lastMonthSettleDt`도 같은 축입니다. 단말 시계를 바꾸면 베팅을 다른 정산일로 옮길 수 있고, 다단말 간 순서 보장도 없습니다. `deviceId` 부재로 사후 추적도 불가능합니다.

**개선 방향**

1. 모든 금전 문서에 `createdAt: FieldValue.serverTimestamp()` 강제. 규칙에서 `request.time`과 일치하는지 검사
2. 클라이언트 시각은 `clientCreatedAt`으로 분리 저장 (오프라인 UI 표시용, 정산 근거로는 사용 안 함)
3. `deviceId`를 브라우저별 안정 식별자로 생성해 모든 쓰기에 포함
4. 정산·리포트 쿼리를 `createdAt`(서버) 기준으로 통일

---

### C3 · [P1] 멱등성 주장이 성립하지 않음

`FIRESTORE_DATA_MODEL.md:18`:
> 오프라인 중 같은 요청이 재시도되어도(네트워크 재연결 후 큐 재전송 등) 같은 ID로 덮어써질 뿐 중복 생성되지 않는다 (멱등성).

`placeBet` 호출마다 `uuidv4()`를 **새로** 생성합니다(`game-engine.js:82`). 따라서:

- SDK 내부 오프라인 큐 재생 → 멱등 (같은 ID 재전송)
- 앱 레벨 재시도(버튼 재클릭, 실패 후 재호출) → **중복 원장 생성**

실제 운영에서 흔한 쪽은 후자입니다. 추가로 `uuidv4()`가 `Math.random()` 기반입니다(`shared/cage-ui.js:28-33`). 금전 원장 키 생성기로 `crypto.randomUUID()`를 안 쓸 이유가 없습니다.

**개선 방향**

1. 멱등 키를 **호출 시점이 아니라 의도 시점**에 생성. 예: `{memberId}_{roundId}_{betType}`처럼 자연 키를 문서 ID로 사용하면 재시도가 진짜로 멱등해짐
2. `uuidv4()`를 `crypto.randomUUID()`로 교체
3. 문서에서 멱등성이 성립하는 범위를 정확히 기술 (SDK 큐 재생 한정 vs 앱 재시도 포함)

---

### C4 · [P2] 원장 스키마가 컬렉션마다 다름 — 집계가 조용히 0 반환

| 컬렉션 | 문서 명세 | 실제 구현 |
|---|---|---|
| `ledger` | `amount` (부호 있는 단일 필드) | `inn` / `out` 2필드 — `index.html:4302` |
| `mainCageLedger` | `amount` | `amt` — `index.html:4660` |
| `rollingEvents` | `games/{id}/rollingEvents` 서브컬렉션 | 전역 컬렉션 — `index.html:4399` |
| `memberLedger` | `amount` | `amount` ✓ |

`explanation-architecture.md:34`가 이 격차를 이미 인정하고 있습니다. 문제는 **실패 방식**입니다.

```js
// shared/cage-ui.js:172
snap.forEach(d=> sum += Number(d.data()[field])||0);
```

`sumWhere(db, 'mainCageLedger', [...], 'amount')`를 호출하면 필드가 없으므로 `undefined` → `Number(undefined)||0` → **예외 없이 0**을 반환합니다. 회계 화면에 0이 그대로 표시되고, 아무도 오류를 보지 못합니다. 조용한 실패가 돈 숫자에 붙는 최악의 조합입니다.

**개선 방향**

1. 세 원장의 스키마를 `memberLedger` 형태(부호 있는 `amount`)로 통일하고 마이그레이션 작성
2. 통일 전까지 `sumWhere`에 필드 부재 감지를 추가 — 전 문서에서 해당 필드가 없으면 0이 아니라 예외
3. `FIRESTORE_DATA_MODEL.md`에 "현행 스키마"와 "목표 스키마" 컬럼을 나란히 두어 어느 쪽이 사실인지 문서만 읽고 알 수 있게 함

---

### C5 · [P2] 오프라인 캐시 활성 + 잔액 검사 stale

`FIRESTORE_DATA_MODEL.md:113`은 오프라인 캐시를 1단계 범위에서 제외한다고 씁니다. 실제로는 켜져 있습니다.

```js
// shared/cage-ui.js:24
cageDb.enablePersistence({synchronizeTabs:true}).catch(()=>{});
```

`synchronizeTabs:true`이므로 탭 여러 개가 같은 캐시를 공유하고, 오프라인 쓰기는 큐에 쌓입니다. 잔액 조회(`getPlayerBalance`)가 캐시를 읽으면 큐에 대기 중인 다른 탭의 베팅이 반영되지 않은 값을 봅니다. C1과 결합해 이중지불 창을 넓힙니다. `catch(()=>{})`라 실패해도 아무도 모릅니다.

**개선 방향**

1. 서버 권한 도입 전까지는 금전 화면에서 오프라인 지속성을 끄거나, 최소한 활성 여부를 UI에 표시
2. 잔액 조회를 `{source:'server'}`로 강제
3. `catch(()=>{})`를 로깅으로 교체
4. 문서의 "1단계 제외" 항목을 현행에 맞게 갱신

---

## 4. 코드 품질

### Q1 · [P2] 테스트 0건

루트에 `package.json`이 없고, `functions/package.json`에 `test` 스크립트가 없으며, 테스트 파일·디렉터리·프레임워크가 없습니다. CI는 Hosting 배포만 수행합니다.

```text
코드 경로                                            현재 커버리지
[+] functions/index.js
  ├── telegramWebhook()
  │   ├── secret 불일치 → 401                          [GAP] [→단위]
  │   ├── /start + accountId → 링크 생성                [GAP] [→단위]
  │   ├── /start 페이로드 없음 → 안내 응답               [GAP] [→단위]
  │   └── accountId 에 '/' 포함 → 경로 예외              [GAP] 처리 자체가 없음
  ├── getTelegramLinks()   401 / 400 / 정상             [GAP] [→단위]
  ├── sendTelegramMessage() 401 / 403 / 405 / 400 / 500 [GAP] [→단위]
  └── deleteTelegramLink()  401 / 405 / 400 / 정상      [GAP] [→단위]

[+] shared/game-engine.js
  ├── playerLogin()   notfound / badpw / blocked / 정상 [GAP] [→단위]
  ├── playerSignup()  중복 / 정상 / 동시가입 경합        [GAP] [→E2E]
  ├── getPlayerBalance()  포인트·잔액 분리 합산          [GAP] [→단위]
  ├── placeBet()      잔액 부족 / 한도 초과              [GAP] 분기 자체가 없음
  ├── settleBet()     5개 betType × 3개 result 조합      [GAP] [→단위]
  └── buildBigRoad()  타이 선행 / 드래곤테일 / 빈 배열   [GAP] [→단위]

[+] firestore.rules
  └── 규칙 파일이 없으므로 테스트할 대상이 없음          [CRITICAL]

사용자 흐름
  ├── 가입 → 로그인 → 베팅 → 정산 → 이력 확인            [GAP] [→E2E]
  ├── Avatar 신청 → 파트너 승인 → 자동 베팅              [GAP] [→E2E]
  ├── 탭 2개 동시 베팅 (이중지불)                        [GAP] [→E2E] 핵심
  └── 오프라인 → 복귀 후 큐 재전송                       [GAP] [→E2E] 핵심

커버리지: 0/24 (0%)   |   품질: ★★★:0 ★★:0 ★:0   |   GAP: 24
```

**개선 방향**

1. `firestore.rules` 도입과 동시에 `@firebase/rules-unit-testing` + Firestore 에뮬레이터로 **규칙 테스트부터** 시작. 규칙은 코드이고, 이 시스템에서 가장 하중이 큰 코드
2. Functions는 `firebase-functions-test`로 4개 함수 × 오류 분기 전수
3. `game-engine.js`의 순수 함수(`buildBigRoad` · `deriveRoad` · `decomposeChipStack` · `settleBet` 배수 계산)는 의존성이 없어 단위 테스트 비용이 거의 0
4. E2E는 이중지불과 오프라인 복귀 두 시나리오를 최우선. 이 둘이 문서가 해결했다고 주장하는 바로 그 시나리오
5. CI에 테스트 단계를 넣고 실패 시 배포 차단. 현재는 검증 단계 없이 live로 직행

---

### Q2 · [P2] 중복과 무음 실패

- `FIREBASE_CONFIG`가 `index.html:4158`과 `shared/cage-ui.js:8`에 2벌. 프로젝트 전환 시 한쪽만 바꾸면 조용히 갈라짐
- `index.html` 507KB 단일 파일, `partner-admin/app.js` 119KB. 케이지 화면과 파트너 콘솔이 `shared/`를 거의 공유하지 않고 각자 구현
- 케이지 화면은 `firebase.firestore()`를 직접 초기화, 나머지는 `cageInitFirebase()` 사용 — 오프라인 지속성 설정이 화면마다 다름
- `catch(e){}` / `catch(()=>{})` 패턴이 Firestore 경로 전반에 분포. 동기화 실패가 사용자에게도 로그에도 남지 않음

**개선 방향**

1. `FIREBASE_CONFIG`를 `shared/`로 단일화하고 `index.html`이 그것을 로드
2. 빈 catch를 최소한 `console.error` + 사용자 표시로 교체. 돈 화면의 무음 실패는 버그보다 위험
3. 파일 분할은 서버 권한 이전 작업과 겹치므로 그 시점에 함께 정리 (지금 쪼개면 곧 지울 코드를 정돈하는 셈)

---

## 5. 성능

### P1x · [P2] 잔액 조회가 원장 전량 다운로드

```js
// shared/game-engine.js:69-78
async function getPlayerBalance(db, memberId){
  const snap = await db.collection('memberLedger').where('memberId','==',memberId).get();
  let balance = 0, points = 0;
  snap.forEach(d=> { ... });
```

`FIRESTORE_DATA_MODEL.md:21`의 명세는 다릅니다.
> 서버 측 집계 쿼리(`getAggregateFromServer` + `sum()`)로 구한다 — 문서를 전부 내려받지 않고 서버에서 합산해서 숫자 하나만 받는다

`shared/cage-ui.js:166`의 주석도 클라이언트 합산임을 인정합니다.
> client-side sum, Spark-plan friendly for small collections; swap for getAggregateFromServer when a collection grows past a few thousand docs

호출 빈도가 문제입니다. `refreshPointsQuiet()`가 **매 라운드 종료마다** 호출됩니다(`avatar/app.js:825`). 스피드 테이블은 라운드가 21초입니다.

```text
누적 베팅 1,000건 회원 · 스피드 4시간 플레이
  라운드 수        ≈ 685
  라운드당 읽기     = 누적 원장 문서 수 (계속 증가)
  총 문서 읽기      ≈ 685 × 평균 1,300 ≈ 890,000 회
  Spark 무료 한도   = 50,000 회/일
```

하루치 한도를 한 명이 30분 만에 소진합니다. 그리고 원장은 append-only라 **영원히 커집니다.** 오래된 회원일수록 느려지고 비싸집니다.

**개선 방향**

1. C1의 잔액 스냅샷 문서를 도입하면 조회가 문서 1건 읽기로 끝남 — 정합성 문제와 성능 문제가 같은 해법을 공유
2. 스냅샷 전까지는 `getAggregateFromServer` + `sum()`으로 전환 (읽기 과금 단위가 크게 줄어듦)
3. 라운드마다 전체 재조회 대신 로컬 델타 적용 + 주기적 서버 대조
4. `firestore.indexes.json`이 없으므로 복합 인덱스를 코드로 관리하지 않는 상태. 쿼리 추가 시 콘솔 수동 작업에 의존하게 됨 — 인덱스 파일도 저장소에 편입

부수 관찰: `avatar/app.js:844`의 채팅 구독이 `limit(200)`을 걸지만 `orderBy`가 없어 **어떤 200건인지 정의되지 않습니다.** 클라이언트에서 정렬 후 30건만 씁니다. 메시지가 200건을 넘으면 최신 메시지가 누락될 수 있습니다.

---

## 6. 문서 정합성

문서가 사실과 다른 보안·일관성 주장을 단언하고 있습니다. 이 문서를 읽고 작업하는 사람은 이미 방어가 있다고 믿게 됩니다.

| # | 문서 | 주장 | 실제 |
|---|---|---|---|
| D1a | `FIRESTORE_DATA_MODEL.md:124` | `pw(해시)` | 평문 |
| D1b | `reference-cloud-functions.md:15` | Origin을 확인 | 설정만 하고 검증 안 함 |
| D1c | `how-to-deploy.md:38` | 비밀값을 소스·Git에 두지 말 것 | `index.html:6088`에 커밋됨 |
| D1d | `FIRESTORE_DATA_MODEL.md:21` | 서버 측 집계 쿼리 | 전량 다운로드 후 JS 합산 |
| D1e | `FIRESTORE_DATA_MODEL.md:39-40` | `serverTimestamp` + `clientCreatedAt` | 클라이언트 시각 1개 |
| D1f | `FIRESTORE_DATA_MODEL.md:38` | `deviceId` 감사 필드 | 어느 쓰기에도 없음 |
| D1g | `FIRESTORE_DATA_MODEL.md:113` | 오프라인 캐시 1단계 제외 | 이미 활성 |
| D1h | `FIRESTORE_DATA_MODEL.md:18` | 재시도 멱등 | 앱 레벨 재시도는 중복 생성 |

`explanation-architecture.md:34`, `:60`, `:62`는 반대로 **정직합니다** — 보안 규칙 부재, 데모 인증, `Math.random()` RNG를 모두 명시합니다. 문제는 같은 저장소의 `FIRESTORE_DATA_MODEL.md`가 목표 모델을 현재형으로 서술해 두 문서가 상충한다는 점입니다.

**개선 방향**

1. `FIRESTORE_DATA_MODEL.md` 상단에 "이 문서는 **목표 설계**이며 현행 구현과 다르다"는 경고를 배치 (`explanation-architecture.md:36`이 이미 그런 취지를 쓰고 있으나 데이터 모델 문서 자체에는 없음)
2. 각 컬렉션에 "현행 / 목표" 상태 표기
3. D1a~D1h를 즉시 정정. 특히 D1b·D1c는 **잘못된 안전 신호**를 주므로 최우선
4. `how-to-deploy.md`의 배포 확인 절차에 "Firestore 규칙이 배포되었는지" 항목 추가 (현재 4단계 어디에도 규칙 확인이 없음)

---

## 7. 개선 방향 정리 (제안 · 결정 아님)

우선순위는 "지금 실제로 새고 있는가"를 기준으로 매겼습니다.

```text
0단계 · 출혈 차단 (구조 변경 없음)
  ├── APP_API_SECRET 회전                              S2
  ├── firestore.rules 최소본 작성·배포 (기본 deny)      S1
  ├── Telegram 연동에 1회용 토큰 도입                   S4
  └── partner-admin 렌더링 escapeHtml 적용             S7

1단계 · 인증 기반 교체
  ├── Firebase Auth 도입 + custom claims                S5
  ├── 규칙을 claim 기반으로 재작성                      S1
  ├── 자동 생성 마스터 계정 제거                        S5
  └── 규칙 단위 테스트 + CI 편입                        Q1

2단계 · 자금 권한 서버 이전
  ├── placeBet / settleBet / 가입 보너스 서버 이전      S3 S6
  ├── 잔액 스냅샷 + 트랜잭션 도입                       C1 P1x
  ├── serverTimestamp · deviceId 강제                   C2
  └── 멱등 키를 자연 키로 전환                          C3

3단계 · 게임 권위 이전
  ├── 라운드 생성·결과를 서버로 (다단말 동기화)         S3
  └── 공인 RNG 검토                        explanation-architecture.md:62

4단계 · 스키마 정리
  ├── ledger / mainCageLedger 스키마 통일 + 마이그레이션 C4
  └── 문서와 구현 정합성 확보                           D1
```

각 단계는 앞 단계 없이 성립하지 않습니다. 특히 2단계는 1단계의 인증 없이는 "누가 이 요청을 보냈는가"를 서버가 알 수 없어 구현이 불가능합니다.

---

## 8. 이번 리뷰에서 다루지 않은 것

- **게임 로직 정확성** — 바카라 3번째 카드 규칙 미구현(`dealHand()`가 2장만 배분), 로드맵 파생 규칙이 근사치(`game-engine.js:238`이 인정). 자금 무결성과 독립된 별도 범위
- **다국어·UI 품질** — `shared/i18n.js` 25KB. 이번 리뷰 범위 밖
- **파일 분할 리팩터링** — 2단계에서 상당 부분이 제거될 코드라 지금 정돈하면 낭비
- **비용 모델·요금제 전환** — Blaze 전환은 2단계 결정에 종속
- **감사·규제 요건(라이선스, KYC 절차, 자금세탁 방지)** — 기술 리뷰 범위를 벗어남. 실서비스 목표라면 별도 검토 필요

---

## 9. 이미 존재하는 것 (재사용 가능)

| 자산 | 상태 | 판단 |
|---|---|---|
| append-only 원장 개념 | `memberLedger`에서 정상 동작 | **유지.** 방향이 옳음. 쓰기 주체만 바꾸면 됨 |
| 부호 있는 `amount` + `category` | `memberLedger` 한정 | **유지.** 나머지 원장을 여기에 맞춤 |
| Cloud Functions 배포 파이프라인 | 동작 중 | **재사용.** 자금 API를 여기에 얹으면 새 인프라 불필요 |
| Firebase Secrets | 3개 등록·사용 중 | **재사용.** 서버 측 비밀값 관리는 이미 정상 |
| `shared/cage-ui.js` 유틸 | `escapeHtml`·포맷터·차트 | **재사용.** 파트너 콘솔이 안 쓰고 있을 뿐 |
| `explanation-architecture.md` | 한계를 정직하게 서술 | **모범.** 다른 문서의 기준으로 삼을 것 |
| GitHub Actions 배포 | Hosting만 감시 | **확장.** 규칙·인덱스·테스트 단계 추가 필요 |

---

## 부록: 확신도 표기

| 등급 | 의미 |
|---|---|
| 10/10 | 해당 코드 라인을 직접 읽고 확인. 재현 경로가 구체적 |
| 9/10 | 코드로 확인했으나 실제 배포된 Firestore 규칙 상태는 저장소에서 알 수 없음 |
| 8/10 | 패턴 일치 확신. 운영 환경 값에 따라 영향 범위가 달라질 수 있음 |

`S1`의 실제 심각도는 **현재 배포된 Firestore 규칙의 내용에 따라 갈립니다.** 저장소에는 규칙이 없으므로 Firebase 콘솔에서 직접 확인해야 합니다. 이것이 이 리뷰에서 가장 먼저 확인할 항목입니다.
