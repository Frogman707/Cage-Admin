# 설명 — 알려진 격차 (P-01 ~ P-14)

> **분류**: Explanation (이해 지향)
> **작성 기준일**: 2026-08-14 · 브랜치 `backend`
> **관련 문서**: [앱 구조](explanation-app-structure.md) · [앱 레퍼런스](reference-partner-admin-app.md) · [화면 58개](reference-screens.md)

[`partner-admin/`](../../partner-admin/)을 정독하며 확인한 결함·불일치 목록입니다. **모두 코드
정독으로 확인했으며 실행으로 재현하지는 않았습니다.** 각 항목에 근거가 되는 파일·줄을
명시했습니다.

이 문서는 결함을 고치자는 제안서가 아니라, 이 코드를 다루게 될 사람이 놀라지 않도록 하는
지도입니다. 데모 목적상 의도된 단순화는
[앱 구조 > 의도된 단순화](explanation-app-structure.md#의도된-단순화)에 따로 적었습니다.

## 요약

| ID | 제목 | 영향 | 데모에서 드러나는가 |
| --- | --- | --- | --- |
| [P-01](#p-01--라운드-취소-환불-루프가-원자적이지-않다) | 라운드 취소 환불이 중간에 멈출 수 있음 | **자금** | ⚠ 네트워크 불안정 시 |
| [P-02](#p-02--빈-입력으로-로그인하면-admin이-된다) | 빈 입력 로그인이 마스터 계정 | **보안** | ✅ 즉시 |
| [P-03](#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다) | 실플레이 베팅이 환불되지 않음 | **자금** | ❌ 시드 데이터에서는 정상 |
| [P-04](#p-04--render-콜백과-rowactions가-이스케이프를-우회한다) | 저장형 XSS 경로 | **보안** | ⚠ 조작 시 |
| [P-05](#p-05--아바타-신청-승인에는-트랜잭션-가드가-없다) | 종료된 신청을 되살릴 수 있음 | 자금/운영 | ⚠ 동시 조작 시 |
| [P-06](#p-06--모든-리스트-화면이-컬렉션-전체를-구독한다) | 컬렉션 크기에 비례하는 읽기 | 성능/비용 | ❌ 데이터 커진 뒤 |
| [P-07](#p-07--총-쿱프가-항상-0이다) | 대시보드 지표 하나가 항상 0 | 표시 | ✅ 즉시 |
| [P-08](#p-08--데모-시드가-balancetotals를-갱신하지-않는다) | 이중 쓰기 값이 원장과 어긋남 | 데이터 정합성 | ❌ 컷오버 전까지 무해 |
| [P-09](#p-09--시드의-flush가-await되지-않는다) | 시드가 400건 이후 실패 가능 | **런타임 오류** | ✅ 데모 데이터 생성 시 |
| [P-10](#p-10--와이프가-balancetotals와-avatarrequests를-남긴다) | 초기화 후 잔여 데이터 | 데이터 정합성 | ✅ 초기화 직후 |
| [P-11](#p-11--마켓비율-탭이-라운드-맵을-15번-다시-만든다) | 통계 탭 렌더 지연 | 성능 | ❌ 라운드 수천 건부터 |
| [P-12](#p-12--partnerstaff가-평문-비밀번호를-공개-노출한다) | 인증 없이 관리자 비밀번호 조회 | **보안** | ⚠ 콘솔 조작 시 |
| [P-13](#p-13--베팅내역의-결과-열이-실플레이에서-항상-다) | 조회 화면에서 결과 미표시 | 표시 | ❌ 실플레이 후 |
| [P-14](#p-14--라운드-결과-수정이-정산을-재계산하지-않는다) | 결과만 바뀌고 돈은 그대로 | 자금 | ⚠ 수정 사용 시 |

**보안 전반**은 개별 항목으로 나열하지 않았습니다. 인증 없는 Firestore 규칙과 클라이언트
권한 검사는 이 저장소 전체의 전제이며
[앱 구조 > 설계 4](explanation-app-structure.md#설계-4--인증은-화면-가리개일-뿐)와
[`docs/review-security-data-integrity.md`](../review-security-data-integrity.md)에서 다룹니다.
아래에는 파트너 어드민에 고유한 두 건(P-02, P-12)만 넣었습니다.

---

## P-01 — 라운드 취소 환불 루프가 원자적이지 않다

**분류**: 자금 · **근거**: [`partner-admin/app.js:1288-1310`](../../partner-admin/app.js#L1288-L1310)

취소는 두 단계입니다. 1단계는 트랜잭션으로 보호되지만 2단계는 아닙니다.

```js
// 1단계 — 원자적. 한 번만 통과
await db.runTransaction(async tx=>{
  const doc = await tx.get(roundRef);
  if (doc.exists && doc.data().cancelled) throw new Error('ALREADY_CANCELLED');
  tx.set(roundRef, {cancelled:true, ...}, {merge:true});
});

// 2단계 — 원자성 없음. 항목마다 별도 batch 커밋
for (const d of snap.docs){
  if (r.category==='bet')         await writeMemberLedgerEntry(db, {...});  // 환불
  else if (r.category==='payout') await writeMemberLedgerEntry(db, {...});  // 회수
}
```

**무슨 일이 벌어지나.** 20건 중 5건째에서 네트워크가 끊기거나 브라우저 탭이 닫히면 5명만
환불받습니다. 나머지 15명은 베팅금을 잃은 채입니다. 그리고 1단계가 이미 `cancelled=true`를
찍었으므로, 다시 취소를 눌러도 `ALREADY_CANCELLED`로 즉시 중단됩니다. **재실행 경로가
없습니다.**

부분 환불 여부를 알아내려면 `memberLedger`에서 해당 `relatedRoundId`의 `bet` 건수와
`correction` 건수를 직접 세어 비교해야 합니다.

**고치는 법.** 환불을 하나의 batch로 묶고, 250건(원장+`balanceTotals` 2쓰기 × 250 = 500 제한)마다
끊습니다. `writeMemberLedgerEntry()`가 batch를 자기 안에서 만들므로, 외부 batch를 받는
오버로드가 필요합니다.

```js
// 예: 선택적 batch 주입
async function writeMemberLedgerEntry(db, entry, externalBatch){
  const batch = externalBatch || db.batch();
  ...
  if (!externalBatch) await batch.commit();
  return ledgerRef.id;
}
```

또는 1단계에 `refundCompleted:false`를 함께 쓰고, 2단계 완료 시 `true`로 올린 뒤
`ALREADY_CANCELLED` 검사를 `cancelled && refundCompleted`로 바꿔 재실행을 허용합니다.

**재현 절차** (미실행): 라운드 하나에 베팅 20건을 만든 뒤 취소를 누르고, 5번째 쓰기 시점에
네트워크를 끊습니다. `memberLedger`에서 `correction` 건수가 20 미만인지 확인합니다.

---

## P-02 — 빈 입력으로 로그인하면 `admin`이 된다

**분류**: 보안 · **근거**: [`partner-admin/app.js:178-189`](../../partner-admin/app.js#L178-L189)

```js
const id = document.getElementById('loginId').value.trim() || 'admin';
const pw = document.getElementById('loginPw').value.trim() || '0000';
```

아이디와 비밀번호를 **둘 다 비운 채** 로그인 버튼을 누르면 `admin` / `0000`으로 치환됩니다.
`ensureDefaultStaff()`가 만든 `partnerStaff/admin` 문서의 비밀번호가 `0000`이므로 검사를
통과하고, `role:'master'`로 로그인됩니다.

로그인 화면에 데모 계정이 표시되어 있으므로 데모 환경에서는 정보 노출이 아닙니다. 문제는
이 폴백이 **비밀번호를 바꾼 뒤에도 남는다**는 점입니다. 아이디 필드를 비우고 비밀번호만
새 값으로 입력하면 `id`가 `admin`으로 폴백되어 정상 로그인됩니다 — 아이디를 모르는 사람도
비밀번호만 알면 들어옵니다.

**고치는 법.** 폴백을 제거하고 빈 입력을 오류로 처리합니다.

```js
const id = document.getElementById('loginId').value.trim();
const pw = document.getElementById('loginPw').value.trim();
if (!id || !pw){ document.getElementById('loginErr').style.display='block'; return; }
```

데모 편의를 유지하려면 placeholder에만 남기고 값 폴백은 없앱니다.

---

## P-03 — 라운드 취소가 실플레이 베팅을 환불하지 못한다

**분류**: 자금 · **근거**: [`partner-admin/app.js:1299`](../../partner-admin/app.js#L1299), [`avatar/app.js:752`](../../avatar/app.js#L752), [`avatar/app.js:828`](../../avatar/app.js#L828), [`shared/game-engine.js:119`](../../shared/game-engine.js#L119)

취소는 이 쿼리로 환불 대상을 찾습니다.

```js
const snap = await db.collection('memberLedger').where('relatedRoundId','==',roundId).get();
```

`roundId`는 `rounds` 컬렉션의 **문서 ID**입니다. 그런데 플레이어 사이트는 베팅과 라운드 문서에
서로 다른 UUID를 씁니다.

```js
// avatar/app.js — 베팅 단계 시작
AVATAR.currentRoundId = uuidv4();                            // ← UUID #1
await placeBet(db, {roundId: AVATAR.currentRoundId, ...});   // relatedRoundId = UUID #1

// avatar/app.js — 결과 확정 후
await writeRoundDoc(db, {tableId, tableType, roundNo, ...}); // roundId를 넘기지 않음
```

`writeRoundDoc()`는 자기 안에서 새 UUID를 만들어 문서 ID로 씁니다. 즉 원장의
`relatedRoundId`(UUID #1)와 `rounds` 문서 ID(UUID #2)가 다릅니다.

**결과.** 게임라운드수정 화면에서 실플레이 라운드를 취소하면, 쿼리가 0건을 반환해 환불도
회수도 일어나지 않습니다. 라운드에는 `cancelled:true`가 찍히고, 관리자 로그에는
"라운드 취소 (환불 0, 회수 0)"이 남으며, 토스트는 "라운드가 취소되고 베팅이 환불되었습니다"를
띄웁니다. **실패했는데 성공 메시지가 나옵니다.**

**데모 시드에서는 정상 동작합니다.** [`seedDemoData`](../../partner-admin/app.js#L1808)가
`relatedRoundId:rid`로 라운드 문서 ID를 그대로 쓰기 때문입니다. 그래서 시드 데이터로만
테스트하면 이 결함이 보이지 않습니다.

**판별법.** 취소 후 `adminLogs`의 최신 항목에서 "환불 0, 회수 0"이면 이 경우입니다.

**고치는 법.** 이건 플레이어 사이트 쪽 결함입니다
([avatar-speed G-01](../avatar-speed/explanation-known-gaps.md#g-01--베팅의-relatedroundid가-rounds-문서-id와-일치하지-않는다)).
`writeRoundDoc(db, {..., roundId})`가 인자로 받은 ID를 문서 ID로 쓰게 하고, 호출자가
`currentRoundId`를 넘기면 양쪽이 일치합니다. 파트너 어드민 쪽에서는 쿼리 결과가 0건일 때
성공 토스트 대신 경고를 띄우는 방어를 추가할 수 있습니다.

---

## P-04 — `render` 콜백과 `rowActions`가 이스케이프를 우회한다

**분류**: 보안 · **근거**: [`partner-admin/app.js:391`](../../partner-admin/app.js#L391), [`partner-admin/app.js:375`](../../partner-admin/app.js#L375), [`partner-admin/app.js:1548`](../../partner-admin/app.js#L1548), [`partner-admin/app.js:1553`](../../partner-admin/app.js#L1553), [`partner-admin/app.js:805`](../../partner-admin/app.js#L805)

`renderCell()`의 기본 경로는 안전합니다.

```js
return escapeHtml(v ?? '—');
```

하지만 세 개의 우회로가 있습니다.

### 1. `render` 콜백

```js
if (c.render) return c.render(row);   // 반환값을 그대로 innerHTML에 삽입
```

예: 아바타 신청 화면의 테이블 컬럼 ([L1200](../../partner-admin/app.js#L1200)).

```js
{key:'tableId', label:'테이블', render:r=>tableMap[r.tableId]?.name || r.tableId}
```

`tables.name`은 테이블 생성 폼([L1118](../../partner-admin/app.js#L1118))에서 직원이 자유롭게
입력합니다. `<img src=x onerror=...>` 형태를 넣으면 그대로 실행됩니다.

### 2. `rowActions`의 onclick 문자열 보간

```js
rowActions: r => `<button onclick="openMoveAffiliationModal('${r.id}','${r.parentAgent||''}')">소속이동</button>`
```

`parentAgent`는 소속이동 모달([L1553](../../partner-admin/app.js#L1553))에서 자유 입력으로
저장됩니다. 작은따옴표가 들어가면 핸들러 문자열이 깨지고, 뒤에 임의 구문을 이어 붙이면
실행됩니다.

같은 모달이 다시 그 값을 속성에 보간합니다.

```js
`<input id="maAgent" value="${cur}">`   // 큰따옴표로 속성 탈출 가능
```

테이블 ID도 같습니다 — `editTableSettings('${r.id}')`([L1112](../../partner-admin/app.js#L1112))의
`r.id`는 생성 폼이 대문자로 바꾼 직원 입력값이며 검증이 없습니다.

### 3. `simpleTable()`

```js
function simpleTable(headers, rows){
  return `...${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`)}...`;
}
```

셀을 그대로 넣습니다. 호출자가 이스케이프해야 하는데, 다음 세 곳이 하지 않습니다.

| 호출 | 미이스케이프 값 | 위치 |
| --- | --- | --- |
| 회원상세 > 활동내역 | `r.action`, `r.staff` | [L796](../../partner-admin/app.js#L796) |
| 회원상세 > 문의내역 | `r.title` | [L801](../../partner-admin/app.js#L801) |
| 통계 > 리더보드 | 파트너 코드 `a` | [L1076](../../partner-admin/app.js#L1076) |

**영향 범위.** 파트너 어드민은 직원만 접근하므로 외부인이 직접 심을 수는 없습니다. 다만
`members.parentAgent`·`tables.name` 같은 값은 Firestore 규칙이 무제한이라 누구나 쓸 수 있고
([P-12](#p-12--partnerstaff가-평문-비밀번호를-공개-노출한다)), 그 페이로드가 직원 브라우저에서
실행됩니다.

**고치는 법.**
- `render` 콜백 안의 원본 문자열을 전부 `escapeHtml()`로 감쌉니다.
- `onclick` 문자열 보간을 없애고 `data-*` 속성 + 이벤트 위임으로 바꿉니다. 최소 조치로는
  보간 지점마다 따옴표 이스케이프를 넣습니다.
- `simpleTable()`이 셀을 기본 이스케이프하고, HTML이 필요한 셀만 `{html: '...'}` 래퍼로
  받도록 시그니처를 바꿉니다.

---

## P-05 — 아바타 신청 승인에는 트랜잭션 가드가 없다

**분류**: 자금/운영 · **근거**: [`partner-admin/app.js:1221-1226`](../../partner-admin/app.js#L1221-L1226), [`partner-admin/app.js:1229`](../../partner-admin/app.js#L1229), [`partner-admin/app.js:1234`](../../partner-admin/app.js#L1234)

디파짓·결제처리는 상태를 트랜잭션으로 선점합니다. 아바타 신청은 그냥 씁니다.

```js
await db.collection('avatarRequests').doc(id).set({status:'진행중', avatarStaffId:staffId, approvedAt:...}, {merge:true});
```

현재 상태를 읽지 않습니다. **`종료` 상태의 신청에도 그대로 `진행중`을 씁니다.**

**무슨 일이 벌어지나.** 강제 종료한 신청의 승인 버튼은 목록에서 사라지지만, 목록이 실시간
갱신되기 전에 다른 직원이 승인을 누르면 종료된 세션이 되살아납니다. 플레이어 사이트는
`avatarRequests`의 `status==='진행중'`을 보고 매 라운드 자동 베팅을 집행하므로,
**멈춘 줄 알았던 대리베팅이 다시 돈을 씁니다.**

거절과 강제 종료가 같은 최종 상태(`종료`)를 쓰는 것도 문제를 키웁니다. "이 신청은 거절된
것인가 운영 중 종료된 것인가"를 `avatarRequests`만 봐서는 알 수 없고, `adminLogs`의 문구를
찾아야 합니다.

**고치는 법.** 디파짓과 같은 패턴을 적용합니다.

```js
await db.runTransaction(async tx=>{
  const doc = await tx.get(ref);
  if (!doc.exists) throw new Error('NOT_FOUND');
  if (doc.data().status !== '대기') throw new Error('ALREADY_PROCESSED');
  tx.set(ref, {status:'진행중', avatarStaffId:staffId, approvedAt:new Date().toISOString()}, {merge:true});
});
```

강제 종료에도 `if (status !== '진행중') throw`를 넣고, 거절은 `종료` 대신 `거절`이라는 별도
상태를 쓰는 편이 낫습니다.

---

## P-06 — 모든 리스트 화면이 컬렉션 전체를 구독한다

**분류**: 성능/비용 · **근거**: [`partner-admin/app.js:285`](../../partner-admin/app.js#L285), [`partner-admin/app.js:251`](../../partner-admin/app.js#L251), [`partner-admin/app.js:453`](../../partner-admin/app.js#L453)

```js
LIST_UNSUB = db.collection(cfg.coll).onSnapshot(snap=>{ ... });
```

`limit()`도 `where()`도 없습니다. 필터·정렬·페이징은 전부 클라이언트에서 일어납니다.

`memberLedger`를 구독하는 화면이 10개입니다 — 베팅내역, 지급내역, 포인트누적, 포인트전환,
입출금리스트, 월렛이체, 월렛전환, 테이블베팅내역, 케이지이체내역, 뱅커절삭. 각 화면은
`extraFilter`로 클라이언트에서 걸러내지만, 다운로드는 원장 전량입니다.

여기에 파생 잔액이 겹칩니다. 대시보드 한 번 열면:

| 호출 | 읽는 문서 |
| --- | --- |
| `getBalances(true)` | `memberLedger` 전량 |
| `fetchAll('memberLedger')` | `memberLedger` 전량 (또 한 번) |
| `fetchAll('rounds')` | `rounds` 전량 |
| `getMembers(true)` · `getTables(true)` · `fetchAll('partners')` · `fetchAll('adminLogs')` | 각 전량 |

원장 10만 건이면 대시보드 진입 한 번에 20만 건 읽기입니다.

**왜 이렇게 두었나.** 복합 인덱스를 만들지 않기 위해서입니다. Firestore에서
`where(category).orderBy(createdAt)`은 복합 인덱스를 요구하고, 화면마다 조합이 달라 인덱스가
수십 개 필요해집니다. 클라이언트 필터는 인덱스 0개로 모든 조합을 지원합니다. 데모 규모에서는
합리적인 교환입니다.

**고치는 법 (규모가 커질 때).**
- 시간 축이 있는 컬렉션은 `orderBy('createdAt','desc').limit(200)`으로 최근 구간만 구독하고,
  페이저를 커서 기반으로 바꿉니다. 필요한 복합 인덱스는 `firestore.indexes.json`에 선언합니다.
- 대시보드·통계의 집계는 미리 계산한 일별 요약 문서를 읽게 합니다.
- `getBalances()`는 `balanceTotals` 컷오버 이후 전량 스캔을 없앨 수 있습니다
  ([보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md)).

---

## P-07 — 총 쿱프가 항상 0이다

**분류**: 표시 · **근거**: [`partner-admin/app.js:463`](../../partner-admin/app.js#L463), [`partner-admin/app.js:253-260`](../../partner-admin/app.js#L253-L260)

```js
const totalComp = Object.values(balances).reduce((s,b)=>s+(b.comp||0),0);
```

`getBalances()`가 만드는 객체에는 `comp` 키가 없습니다.

```js
map[r.memberId] = {balance:0, points:0, deposit:0, withdraw:0, bet:0, payout:0};
```

따라서 `b.comp`는 항상 `undefined`이고 `||0`으로 0이 되어, 대시보드 "총 쿱프" 카드는
데이터가 아무리 많아도 `0`을 표시합니다.

**고치는 법.** 쿱프(콤프)를 나타내는 원장 카테고리를 정하고 `getBalances()`에 누적을
추가합니다. 카테고리 자체가 아직 없다면, 지표를 대시보드에서 제거하거나 "미구현"으로
표시하는 편이 정직합니다.

```js
if (r.category==='comp') m.comp = (m.comp||0) + (Number(r.amount)||0);
```

---

## P-08 — 데모 시드가 `balanceTotals`를 갱신하지 않는다

**분류**: 데이터 정합성 · **근거**: [`partner-admin/app.js:1729`](../../partner-admin/app.js#L1729), [`partner-admin/app.js:1800-1816`](../../partner-admin/app.js#L1800-L1816), [`shared/cage-ui.js:202`](../../shared/cage-ui.js#L202)

파트너 어드민의 다른 모든 원장 쓰기는 `writeMemberLedgerEntry()`를 지나가며
`balanceTotals/member_{id}`를 함께 증분합니다. 시드만 예외입니다.

```js
const set = (coll, id, data) => { batch.set(db.collection(coll).doc(id), data); ops++; ... };
set('memberLedger', uuidv4(), {memberId:mid, amount:-betAmt, category:'bet', ...});
```

`batch.set()`으로 직접 씁니다. 성능상 합리적인 선택이지만(600건에 batch 쓰기 2배는 피하고
싶습니다), 결과적으로 시드 후 `balanceTotals`는 실제 원장과 어긋납니다.

**지금은 무해합니다.** 어떤 화면도 `balanceTotals`를 읽지 않기 때문입니다. 문제가 되는 시점은
[보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md)의 컷오버입니다 — 그때 파생 합계와
`balanceTotals`를 대조하는 검증이 시드 데이터에서 대량 불일치를 보고할 것입니다.

**고치는 법.** 시드 마지막에 회원별 합계를 계산해 `balanceTotals`를 한 번에 채웁니다.

```js
// 시드가 만든 원장을 그대로 합산해 batch에 추가
const totals = {};   // {memberId: {balance, points}}
// ... set('memberLedger', ...) 할 때마다 totals에 누적 ...
Object.entries(totals).forEach(([mid, t]) =>
  set('balanceTotals', 'member_'+mid, {balance:t.balance, points:t.points}));
```

`FieldValue.increment()`가 아니라 절대값 `set`이어야 재시드 시 누적되지 않습니다.

---

## P-09 — 시드의 `flush`가 `await`되지 않는다

**분류**: 런타임 오류 · **근거**: [`partner-admin/app.js:1726-1729`](../../partner-admin/app.js#L1726-L1729)

```js
let batch = db.batch();
let ops = 0;
const flush = async ()=>{ if (ops>0){ await batch.commit(); batch = db.batch(); ops = 0; } };
const set = (coll, id, data) => { batch.set(db.collection(coll).doc(id), data); ops++; if (ops>=400) flush(); };
```

`set()`은 동기 함수인데 `flush()`는 async입니다. `flush()`를 `await` 없이 호출하므로 즉시
반환되고, `batch = db.batch()`와 `ops = 0`은 커밋이 끝난 **뒤에야** 실행됩니다.

그 사이 `set()`이 계속 호출되면:
1. 이미 `commit()`이 시작된 batch 객체에 `batch.set()`을 부릅니다. Firebase compat SDK는
   커밋된 batch에 대한 쓰기를 거부합니다 — `"A write batch can no longer be used after commit()
   has been called."`
2. `ops`가 400에서 리셋되지 않은 채 계속 올라가 `flush()`가 매 호출마다 다시 불립니다.

시드가 쓰는 총 문서 수는 900건을 넘습니다(회원 40 + 라운드 150 + 원장 약 600 + 나머지). 즉
**400건 경계를 반드시 지나갑니다.**

**고치는 법.** `set()`을 async로 바꾸고 호출부에서 `await`합니다.

```js
const set = async (coll, id, data) => {
  batch.set(db.collection(coll).doc(id), data);
  ops++;
  if (ops>=400) await flush();
};
```

호출 지점이 `forEach` 안에 많으므로 `for...of`로 바꿔야 합니다. 대안으로 문서를 배열에 모은 뒤
마지막에 400개씩 잘라 순차 커밋하는 편이 변경 범위가 작습니다.

**재현 절차** (미실행): 좌측 하단 "데모 데이터 생성"을 누르고 브라우저 콘솔을 봅니다. 위
오류 메시지가 뜨는지, 그리고 `members` 40건 대비 `memberLedger` 건수가 예상(약 600)에
미치는지 확인합니다.

---

## P-10 — 와이프가 `balanceTotals`와 `avatarRequests`를 남긴다

**분류**: 데이터 정합성 · **근거**: [`partner-admin/app.js:1716`](../../partner-admin/app.js#L1716)

```js
const DEMO_COLLECTIONS = ['members','memberLedger','partners','shareLedger','tables','rounds',
  'notices','tickerNotices','noticeGuide','bannedWords','inquiries','inGameNotices','csContacts',
  'memberActionLogs','adminLogs','chatMessages','depositRequests','paymentRequests','events',
  'avatarMissCorrections'];
```

20개입니다. 앱이 쓰는 24개 중 4개가 빠졌습니다.

| 빠진 컬렉션 | 결과 |
| --- | --- |
| `balanceTotals` | 원장이 0건이 됐는데 합계 문서는 이전 값 유지. 다음 시드 후에도 계속 어긋남 |
| `avatarRequests` | `진행중` 신청이 남아 플레이어 사이트가 존재하지 않는 회원으로 자동 베팅 시도 |
| `partnerStaff` | **의도된 제외** — 지우면 로그인 계정이 사라짐 |
| `cageConfigPartner` | 설정값 유지. 무해 |

`balanceTotals`는 [P-08](#p-08--데모-시드가-balancetotals를-갱신하지-않는다)과 합쳐지면 더
나빠집니다. 실제 운영 쓰기로 쌓인 값이 와이프 후에도 남고, 재시드는 그걸 갱신하지 않습니다.

**고치는 법.** `balanceTotals`와 `avatarRequests`를 목록에 추가합니다. `partnerStaff`는
의도적으로 남기는 것이므로 주석으로 이유를 명시하는 편이 낫습니다.

```js
const DEMO_COLLECTIONS = [..., 'balanceTotals', 'avatarRequests'];
// partnerStaff는 의도적 제외 — 지우면 로그인 계정이 사라진다
```

---

## P-11 — 마켓비율 탭이 라운드 맵을 15번 다시 만든다

**분류**: 성능 · **근거**: [`partner-admin/app.js:1004-1022`](../../partner-admin/app.js#L1004-L1022)

```js
${scopes.map(sc=>{                        // 5회
  const cells = outcomes.map(o=>{         // × 3회 = 15회
    ...
    const rMap = {}; rounds.forEach(r=>rMap[r.id]=r);   // ← 매번 전체 재구축
    const grossReturn = bets.reduce((s,l)=>{ const r = rMap[l.relatedRoundId]; ... },0);
```

`rMap`은 루프 안에서 매번 처음부터 만들어집니다. 라운드가 N개면 15N번의 대입입니다. 시드
기본값(150 라운드)에서는 2,250회로 체감되지 않지만, 라운드 1만 건이면 15만 회입니다.

같은 루프에서 `betsInScope`도 스코프마다 원장 전체를 다시 필터합니다.

**고치는 법.** `rMap`을 루프 밖으로 한 번만 빼냅니다.

```js
const rMap = {};
rounds.forEach(r=>rMap[r.id]=r);
// 이후 루프에서 재사용
```

이 탭은 [P-03](#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다)의 영향도 받습니다 —
`rMap[l.relatedRoundId]`가 실플레이 베팅에서 항상 `undefined`라 `grossReturn`이 0이 되고,
환수율이 100%로 표시됩니다.

---

## P-12 — `partnerStaff`가 평문 비밀번호를 공개 노출한다

**분류**: 보안 · **근거**: [`firestore.rules:22-24`](../../firestore.rules#L22-L24), [`partner-admin/app.js:172`](../../partner-admin/app.js#L172)

규칙 파일은 `staff` 하나만 잠급니다.

```
match /staff/{staffId} { allow read, write: if request.auth != null; }
match /{collection}/{docId} { allow read, write: if collection != 'staff'; }
```

`partnerStaff`는 `staff`가 아닙니다. 인증 없이 읽고 쓸 수 있습니다. 그 문서에는 평문
비밀번호가 들어 있습니다.

```js
await db.collection('partnerStaff').doc('admin').set({id:'admin', pw:'0000', name:'Eric', role:'master', ...});
```

`members.pw`와 `members.withdrawPw`도 같습니다 ([L740](../../partner-admin/app.js#L740),
[L1765](../../partner-admin/app.js#L1765)).

**노출 범위.** Firebase 웹 설정([`shared/cage-ui.js:8`](../../shared/cage-ui.js#L8))은 클라이언트
번들에 그대로 있고 원래 공개 정보입니다. 그 설정과 프로젝트 ID만 있으면 누구나 Firestore
REST/SDK로 `partnerStaff` 전체를 읽을 수 있습니다. 어드민 URL을 몰라도 됩니다.

**왜 이 상태인가.** 규칙 파일 주석이 설명합니다 — `staff`만 Cloud Function
(`staffLogin` + TOTP) 뒤로 옮겼고, 나머지 컬렉션을 서버 API 뒤로 보내는 작업은 별도 트랙으로
남겨 두었습니다. 규칙 파일이 생기기 전에는 Firestore 기본 테스트 모드가 적용되고 있었으므로,
현재 규칙은 기존 동작을 명문화한 것입니다.

**고치는 법 (최소 조치부터).**
1. `partnerStaff`를 `staff`와 같은 취급으로 규칙에서 잠그고, 로그인을 Cloud Function으로
   옮깁니다. `staffLogin`이 이미 같은 일(PIN + TOTP 검증, 커스텀 토큰 발급)을 하므로 파트너용
   역할을 추가하는 형태가 자연스럽습니다.
2. 그 전이라도 `pw` 필드를 서버에서만 읽는 별도 문서로 분리하고, 클라이언트가 읽는 문서에는
   `id`/`name`/`role`만 둡니다.
3. 비밀번호를 평문 대신 해시로 저장합니다 (검증이 서버로 옮겨간 뒤에만 의미가 있습니다).

---

## P-13 — 베팅내역의 결과 열이 실플레이에서 항상 `—`다

**분류**: 표시 · **근거**: [`partner-admin/app.js:811-818`](../../partner-admin/app.js#L811-L818)

```js
const rounds = await fetchAll('rounds');
const roundMap = {}; rounds.forEach(r=>roundMap[r.id]=r);
...
{key:'result', label:'결과', render:r=>{ const rd = roundMap[r.relatedRoundId]; return rd ? pill(...) : '—'; }}
```

두 가지 이유로 비어 보입니다.

1. **ID 불일치** — [P-03](#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다)과 같은 원인.
   실플레이 베팅의 `relatedRoundId`는 `rounds` 문서 ID가 아니므로 `roundMap` 조회가 실패합니다.
2. **스냅샷 시점 고정** — `roundMap`은 마운트 시 한 번만 만들어집니다. 행 데이터는
   `onSnapshot`으로 실시간 갱신되지만, 새로 들어온 베팅이 참조하는 라운드가 맵에 없으면
   `—`가 됩니다. 화면을 다시 열어야 채워집니다.

시드 데이터에서는 1번이 해결되어 있어 정상으로 보입니다.

**고치는 법.** 1번은 플레이어 사이트에서 고쳐야 합니다. 2번은 `rounds`도 함께 구독하거나,
행 렌더 시점에 맵이 비어 있으면 개별 `get()`으로 채우는 지연 로딩을 넣습니다.

---

## P-14 — 라운드 결과 수정이 정산을 재계산하지 않는다

**분류**: 자금 · **근거**: [`partner-admin/app.js:1258-1262`](../../partner-admin/app.js#L1258-L1262), [`partner-admin/app.js:1354`](../../partner-admin/app.js#L1354)

```js
await db.collection('rounds').doc(id).set({
  result: document.getElementById('reResult').value,
  editedBy: CURRENT_STAFF?.id||'—',
  editedReason: document.getElementById('reReason').value,
}, {merge:true});
await db.collection('adminLogs').doc(uuidv4()).set({...});
```

`rounds.result`만 바꿉니다. 이미 지급된 `payout` 원장도, 잃은 `bet` 원장도 그대로입니다.

**무슨 일이 벌어지나.** 뱅커 승을 플레이어 승으로 정정하면, 조회 화면에서는 플레이어가
이긴 것으로 보이지만 실제 돈은 뱅커 승 기준으로 이미 정산돼 있습니다. 표시와 잔액이
영구히 어긋납니다.

`roundEditSettle` 화면([L1354](../../partner-admin/app.js#L1354))의 제목은
"게임라운드수정 정산 · 라운드 결과 수정에 따른 재정산 내역"이지만, 실제로는 `editedBy`가
있는 라운드 목록만 보여줍니다. **재정산 로직이 없습니다.**

**고치는 법.** 결과 수정을 "취소 후 재정산"으로 재정의하는 편이 안전합니다.

1. 기존 결과 기준 정산을 `correction`으로 되돌립니다 (`submitRoundCancel`의 2단계와 동일).
2. 새 결과 기준으로 각 베팅을 다시 정산해 `payout`을 씁니다.
3. 두 단계를 하나의 batch로 묶습니다 ([P-01](#p-01--라운드-취소-환불-루프가-원자적이지-않다)과
   같은 수정이 선행돼야 합니다).

당장 고칠 수 없다면, 결과 수정 모달에 "이 작업은 정산을 재계산하지 않습니다"를 명시하고
`roundEditSettle`의 부제를 실제 동작에 맞게 고칩니다.

---

## 관련 문서

- [앱 구조와 설계 배경](explanation-app-structure.md) — 이 결함들이 나온 설계 맥락
- [앱 레퍼런스](reference-partner-admin-app.md) — 함수·상태·계약
- [화면 58개](reference-screens.md) — 화면별 컬렉션·액션
- [avatar-speed 알려진 격차](../avatar-speed/explanation-known-gaps.md) — 플레이어 사이트 쪽 결함 12건
- [보안·데이터 정합성 리뷰](../review-security-data-integrity.md) — 프로젝트 전반 리뷰
