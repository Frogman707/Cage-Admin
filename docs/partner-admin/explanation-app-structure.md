# 설명 — 앱 구조와 설계 배경

> **분류**: Explanation (이해 지향)
> **작성 기준일**: 2026-08-14 · 브랜치 `backend`
> **관련 문서**: [앱 레퍼런스](reference-partner-admin-app.md) · [화면 58개](reference-screens.md) · [알려진 격차](explanation-known-gaps.md)

이 문서는 "무엇을 하는가"가 아니라 "왜 이렇게 생겼는가"를 다룹니다. API 목록은
[앱 레퍼런스](reference-partner-admin-app.md)에 있습니다.

---

## 이 앱이 풀려는 문제

파트너 어드민은 카지노 운영자용 백오피스입니다. 회원 관리, 보유금 지급, 정산, 테이블 설정,
아바타 대리베팅 승인, 라운드 취소, 공지, 고객문의 — 실제 운영에 필요한 화면 58개를 갖춰야
합니다.

제약은 두 가지였습니다.

1. **서버가 없다.** 백엔드 API도, 빌드 파이프라인도, 프레임워크도 없습니다. 브라우저가
   Firestore를 직접 읽고 씁니다.
2. **화면이 58개다.** 하나씩 손으로 만들면 파일 하나가 수만 줄이 되거나, 파일 58개로 쪼개져
   똑같은 표·검색·페이징 코드가 58번 복사됩니다.

이 두 제약이 아래 네 가지 설계를 낳았습니다.

---

## 설계 1 — 설정 하나가 화면 하나

58개 화면 중 약 40개는 "Firestore 컬렉션 하나를 표로 보여주고, 검색하고, 필터하고,
페이징한다"는 같은 모양입니다. 다른 것은 컬렉션 이름, 컬럼 목록, 행 액션뿐입니다.

그래서 화면을 **함수가 아니라 데이터로** 표현합니다.

```js
async function renderChatLog(){
  return mountListView({
    title:'채팅내역', coll:'chatMessages',
    search:true, searchFields:['nickname','text'], searchPh:'닉네임/내용 검색',
    columns:[
      {key:'dt', label:'시간', type:'dt'}, {key:'tableId', label:'테이블'},
      {key:'nickname', label:'닉네임'}, {key:'text', label:'내용'},
    ],
    sortKey:'dt', sortDir:'desc',
  });
}
```

화면 하나가 8줄입니다. 실시간 구독, 즉시 필터, 페이저 접기, 빈 상태 메시지, 오류 폴백은 전부
엔진이 제공합니다.

**대가**: 이 모양을 벗어나는 화면은 엔진을 쓸 수 없습니다. 대시보드, 통계 9탭, 계정관리,
데일리리포트, 아바타게임관리, 테이블영상, 이용안내 — 18개 화면이 자체 HTML을 만듭니다.
그리고 그 18개는 실시간 갱신을 받지 못합니다.

### 엔진이 실시간인 범위

리스트 엔진은 `onSnapshot`을 씁니다. 다른 터미널의 승인, 새 입금 요청, 상태 변경이 새로고침
없이 표에 나타납니다. 그런데 **요약 stat 카드는 실시간이 아닙니다.**

이건 버그가 아니라 선택입니다. stat 카드는 셸 HTML의 일부이고, 셸을 다시 그리면 검색 입력이
DOM에서 교체됩니다. 스냅샷이 들어올 때마다 직원이 입력 중이던 검색어가 사라지는 쪽이
"합계 숫자가 몇 분 낡은" 쪽보다 나쁩니다. 코드 주석
([L276-L280](../../partner-admin/app.js#L276-L280))이 이 판단을 명시합니다.

같은 이유로 페이지 번호도 지킵니다. `reapplyListFilters()`는 스냅샷을 받아도 3페이지를 보던
직원을 1페이지로 끌고 오지 않습니다. 반면 직원이 직접 검색어를 바꾸면
`applyListFilters()`가 1페이지로 되돌립니다. 사용자가 한 행동에는 리셋, 시스템이 한 행동에는
유지 — 이게 규칙입니다.

### 구독 누수를 막는 곳

`onSnapshot`은 화면을 떠나도 스스로 멈추지 않습니다. `switchView()`가 다음 화면을 그리기
**전에** `LIST_UNSUB()`를 호출합니다 ([L212](../../partner-admin/app.js#L212)).

이 한 줄이 없으면 직원이 화면 20개를 돌아다닌 뒤 리스너 20개가 백그라운드에서 살아 있게
됩니다. 렌더링은 `#listBody`가 없어 무해하지만, Firestore 읽기 과금과 네트워크는 계속됩니다.

---

## 설계 2 — 잔액을 저장하지 않는다

회원 보유금은 `members` 문서에 없습니다. `memberLedger` 전체를 읽어 합산해서 만듭니다.

```
memberLedger (append-only)
  {memberId:'SEH1001', amount:+500000, category:'deposit'}
  {memberId:'SEH1001', amount:-50000,  category:'bet'}
  {memberId:'SEH1001', amount:+97500,  category:'payout'}
        │
        ▼  getBalances()  — 클라이언트 전량 합산
  {SEH1001: {balance:547500, deposit:500000, bet:-50000, payout:97500, ...}}
```

**왜 이렇게 했나.** 서버가 없으면 잔액 필드를 원자적으로 갱신할 방법이 마땅치 않습니다.
두 화면이 동시에 `members.balance`를 읽고 각자 계산해 쓰면 하나가 사라집니다. 반면 원장은
append-only라 동시 쓰기가 서로를 덮지 않습니다. 잔액은 언제든 원장에서 다시 만들 수 있습니다.

이건 회계의 기본 원칙이기도 합니다 — 잔액은 사실이 아니라 사실들의 요약입니다.
[Firestore 데이터 모델](../FIRESTORE_DATA_MODEL.md)이 이 원칙을 저장소 전체에 걸어 두었습니다.

**대가는 읽기 비용입니다.** 대시보드 한 번 열면 `memberLedger` 전체가 두 번 내려옵니다
(`getBalances` 1회 + 직접 `fetchAll` 1회). 통계 탭도 마찬가지입니다. 원장이 10만 건이 되면
대시보드 한 번에 20만 건 읽기입니다.

`MEMBER_CACHE` / `BALANCE_CACHE` / `TABLE_CACHE` 세 캐시가 같은 화면 안의 반복 호출을 막지만,
`force=true`로 우회하는 곳이 많고 쓰기 후에는 `invalidateCaches()`로 통째로 버립니다.

### `balanceTotals` — 아직 아무도 읽지 않는 숫자

[`writeMemberLedgerEntry()`](../../shared/cage-ui.js#L202)는 원장 문서와
`balanceTotals/member_{memberId}`의 `FieldValue.increment()`를 **같은 batch**에 담습니다.

```js
const batch = db.batch();
batch.set(ledgerRef, entry);
batch.set(balRef, {[field]: FieldValue.increment(amount)}, {merge:true});
await batch.commit();
```

같은 batch라 부분 실패가 없습니다. 둘 다 쓰이거나 둘 다 안 쓰입니다.

그런데 파트너 어드민의 어떤 화면도 `balanceTotals`를 읽지 않습니다. 의도된 상태입니다 —
[보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md)가 정의한 이중 쓰기 단계입니다.
파생 합계가 여전히 진실의 원천이고, `balanceTotals`는 섀도 리드 기간 동안 검증을 거친 뒤
컷오버할 후보입니다.

**함수 하나로 중앙화한 이유**도 설계 문서에 있습니다. 호출 지점마다 인라인 `.set()`을 쓰면
새 쓰기 지점이 증분을 빼먹기 쉽습니다. 한 함수를 지나가게 만들면 그 실수가 구조적으로
불가능해집니다.

이 규율에서 벗어난 곳이 하나 있습니다. `seedDemoData()`는 성능 때문에 `batch.set()`으로
직접 씁니다 — 그래서 시드 데이터는 `balanceTotals`에 반영되지 않습니다
([P-08](explanation-known-gaps.md#p-08--데모-시드가-balancetotals를-갱신하지-않는다)).

---

## 설계 3 — 트랜잭션은 "두 번 지급"이 가능한 곳에만

서버가 없으면 "이 요청은 이미 처리됐는가"를 물어볼 곳이 클라이언트뿐입니다. 두 직원이 같은
디파짓 요청을 동시에 승인하면 둘 다 상태가 `대기`인 걸 보고 둘 다 입금 원장을 씁니다.
회원이 두 번 받습니다.

Firestore 트랜잭션이 이걸 막습니다.

```js
await db.runTransaction(async tx=>{
  const doc = await tx.get(ref);
  if (doc.data().status !== '대기') throw new Error('ALREADY_PROCESSED');
  tx.set(ref, {status:'승인'}, {merge:true});
});
// 여기 도달한 호출은 단 하나. 이제 원장을 쓴다.
```

상태 플립을 먼저 원자적으로 선점하고, 이긴 쪽만 돈을 씁니다. 진 쪽은 토스트만 띄웁니다.

**가드가 걸린 곳** — 디파짓 승인/거절, 결제처리 승인/거절, 라운드 취소 플래그.
공통점: 통과하면 돈이 움직입니다.

**가드가 없는 곳** — 아바타 신청 승인/거절/강제종료, 라운드 결과 수정, 회원 상태 변경,
쉐어율 편집. 공통점: 마지막 쓰기가 이깁니다. 두 직원이 동시에 눌러도 최종 상태는 하나이고,
중복 실행이 돈을 두 배로 만들지 않습니다.

경계가 완전히 안전한 것은 아닙니다. 아바타 승인은 종료된 신청을 다시 `진행중`으로 되돌릴 수
있고, 그러면 플레이어 클라이언트가 자동 베팅을 재개합니다
([P-05](explanation-known-gaps.md#p-05--아바타-신청-승인에는-트랜잭션-가드가-없다)).

### 라운드 취소 — 가드가 절반만 있는 경우

취소는 두 부분입니다. 플래그를 세우는 것과, 걸린 베팅을 전부 환불하는 것.

```
1) 트랜잭션: cancelled false → true       ← 원자적. 한 번만 통과
2) for (걸린 원장 행) { 별도 batch 커밋 }   ← 원자성 없음
3) 인게임공지 + adminLogs
```

1단계가 2단계를 보호하지 못합니다. 20건 중 5건째에서 네트워크가 끊기면 5명만 환불받고,
라운드는 이미 `cancelled=true`라 다시 실행할 수도 없습니다
([P-01](explanation-known-gaps.md#p-01--라운드-취소-환불-루프가-원자적이지-않다)).

2단계를 batch 하나로 묶지 않은 이유는 코드에 없습니다. Firestore batch는 500개 쓰기 제한이
있고 환불 1건이 원장 + `balanceTotals` 2개 쓰기라 250건이 상한이지만, 그 이하에서도 나누고
있습니다. `writeMemberLedgerEntry()`가 batch를 자기 안에서 만들어 커밋하는 구조라, 바깥에서
하나로 묶으려면 이 함수의 시그니처를 바꿔야 합니다 — 중앙화가 만든 경직성입니다.

---

## 설계 4 — 인증은 화면 가리개일 뿐

로그인은 `partnerStaff` 컬렉션에서 문서를 읽어 평문 비밀번호를 문자열 비교합니다. 성공하면
`login-gate` div를 숨깁니다.

```js
if (!staff || String(staff.pw ?? '0000') !== pw){ /* 오류 표시 */ return; }
CURRENT_STAFF = staff;
document.getElementById('login-gate').style.display='none';
```

Firestore 세션은 만들지 않습니다. 만들 필요가 없습니다 —
[`firestore.rules`](../../firestore.rules)가 `staff`를 제외한 모든 컬렉션에 무제한 접근을
허용하기 때문입니다.

```
match /{collection}/{docId} {
  allow read, write: if collection != 'staff';
}
```

즉 로그인은 **권한 경계가 아니라 UI 상태**입니다. 브라우저 콘솔에서
`document.getElementById('login-gate').style.display='none'`만 쳐도 같은 화면이 나오고,
Firestore 접근은 처음부터 열려 있었습니다.

**왜 이렇게 두었나.** 저장소 전체가 같은 상태입니다. 규칙 파일의 주석이 이유를 적어 두었습니다 —
`staff`만 Cloud Function(`staffLogin` + TOTP) 뒤로 옮겼고, 나머지는 그 작업을 아직 하지 않았을
뿐이라고. 규칙 파일이 생기기 전에는 Firestore 기본 테스트 모드 규칙이 적용되고 있었으므로,
현재 상태는 기존 동작을 그대로 명문화한 것입니다.

**그래서 실제 위험이 무엇인가.** `partnerStaff`가 `staff`가 아니라는 점입니다. 파트너 어드민
직원 계정은 이름·역할·**평문 비밀번호**가 인증 없이 읽힙니다
([P-12](explanation-known-gaps.md#p-12--partnerstaff가-평문-비밀번호를-공개-노출한다)).
회원 비밀번호(`members.pw`)도 같습니다.

---

## 전체 흐름

```
직원 브라우저
   │
   │ 1. index.html 로드 → cage-ui.js → app.js
   ▼
DOMContentLoaded
   │ cageInitFirebase()      Firestore + 오프라인 퍼시스턴스
   │ buildNav()              12 그룹 / 58 버튼
   │ ensureDefaultStaff()    partnerStaff 비면 admin/0000 생성
   ▼
로그인 게이트
   │ doLogin()  ← partnerStaff/{id} 평문 비교
   ▼
switchView('dashboard')
   │
   ├── LIST_UNSUB() 호출 (이전 구독 해제)
   ├── mainArea = 스피너
   ├── VIEW_RENDERERS[id](id) 실행
   │      │
   │      ├─ 리스트 화면 (약 40)
   │      │    mountListView(cfg)
   │      │      └ onSnapshot(cfg.coll) ──► 실시간 행 갱신
   │      │        첫 스냅샷 대기 후 셸 HTML 반환
   │      │
   │      └─ 전용 화면 (18)
   │           fetchAll(...) 여러 번 → HTML 문자열
   │           setTimeout(0)으로 차트 그리기
   │
   └── mainArea = 반환된 HTML
          │
          │ 직원이 액션 버튼 클릭
          ▼
      쓰기 경로
          ├─ 돈 → writeMemberLedgerEntry() ──► memberLedger + balanceTotals (같은 batch)
          ├─ 상태 → db.collection(...).set({merge:true})
          └─ 감사 → adminLogs / memberActionLogs
          │
          └─ invalidateCaches() → switchView(CURRENT_VIEW)  전체 재렌더
```

마지막 줄이 중요합니다. 쓰기 후 부분 갱신이 없습니다. 화면 전체를 다시 그립니다. 단순하고,
어떤 상태도 어긋나지 않으며, 리스트 화면이라면 `onSnapshot`을 다시 붙이는 비용을 냅니다.

---

## 트레이드오프 정리

| 선택 | 얻은 것 | 잃은 것 |
| --- | --- | --- |
| 서버 없이 Firestore 직결 | 배포 대상이 정적 파일뿐. 인프라 0 | 권한 경계 없음. 비밀번호 평문 노출 |
| 단일 파일 SPA (1,867줄) | 빌드 없음. 파일 하나만 보면 됨 | 800줄 권장선의 2배 이상. 탐색은 그룹 주석에 의존 |
| 설정 주도 리스트 엔진 | 화면 하나가 8줄. 40개 화면이 같은 동작 보장 | 엔진 모양을 벗어난 18개는 실시간 갱신 없음 |
| 컬렉션 전체 `onSnapshot` | 인덱스 불필요. 필터·정렬을 클라이언트에서 자유롭게 | 컬렉션 크기에 비례하는 읽기·메모리 |
| 파생 잔액 (`getBalances`) | 동시 쓰기 안전. 언제든 재계산 가능 | 화면 진입마다 원장 전량 스캔 |
| `balanceTotals` 이중 쓰기 | 컷오버 준비된 숫자를 미리 유지 | 아직 아무도 읽지 않음. 시드·와이프가 어긋나게 만듦 |
| 트랜잭션을 돈 경로에만 | 중복 지급 차단. 나머지는 코드가 단순 | 아바타 신청 등에서 상태가 되돌려질 수 있음 |
| 쓰기 후 전체 재렌더 | 부분 갱신 버그가 원천적으로 없음 | 화면 하나 재구축 비용을 매번 지불 |
| 인라인 `onclick` 문자열 | 이벤트 위임 코드 불필요 | 문자열 보간이 이스케이프 우회 경로가 됨 |

---

## 의도된 단순화

다음 항목들은 결함이 아니라 데모 범위의 전제입니다.
[알려진 격차](explanation-known-gaps.md)에 넣지 않았습니다.

- **게임테이블영상** — 실제 스트림 대신 `table-live.jpg` 배경에 CSS 애니메이션 점.
- **접속내역 탭** — IP를 `memberId.charCodeAt(2)%255`로 만들어 한 줄만 보여줌.
- **실시간위험감지 임계값** — 500,000 하드코딩. 화면에 "데모 임계값"이라 표시됨.
- **롤링 커미션 1.5%** — 파트너별 요율이 아니라 전역 상수.
- **아바타상세설정 모달** — 스킨·테마 셀렉트가 아무것도 저장하지 않음.
- **`connDot` 표시등** — HTML에만 존재하고 갱신되지 않음.
- **`CASINO_FILTER`** — 코드가 읽지만 값을 바꾸는 UI가 없음.

---

## 관련 문서

- [앱 레퍼런스](reference-partner-admin-app.md) — 함수·상태·계약
- [화면 58개](reference-screens.md) — 화면별 컬렉션·액션
- [알려진 격차](explanation-known-gaps.md) — 결함 14건
- [보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md) — 이중 쓰기와 컷오버 계획
- [보안·데이터 정합성 리뷰](../review-security-data-integrity.md) — 프로젝트 전반 리뷰
