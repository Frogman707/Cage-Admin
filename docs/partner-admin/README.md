# Partner Admin 파트너 어드민 문서

[`partner-admin/`](../../partner-admin/)으로 구현된 파트너(에이전트) 운영 콘솔의 전체 문서입니다.
화면 58개의 구성, 리스트 엔진 계약, 돈이 움직이는 경로, 승인 흐름, 알려진 결함을 다룹니다.

문서는 [Diataxis](https://diataxis.fr/) 4분면 구조를 따릅니다 — 읽는 사람의 상황에 따라 진입점이
다릅니다.

---

## 어디서 시작할까

| 상황 | 문서 |
| --- | --- |
| 처음 본다. 일단 돌려보고 싶다 | [튜토리얼 — 로그인부터 첫 승인까지](tutorial-first-approval.md) |
| 아바타 대리베팅 신청을 처리해야 한다 | [하우투 — 아바타 대리베팅 승인·종료](howto-avatar-request-approval.md) |
| 라운드를 취소하고 환불해야 한다 | [하우투 — 라운드 취소와 환불](howto-round-cancel.md) |
| 이 코드가 왜 이런 구조인지 알고 싶다 | [설명 — 앱 구조와 설계 배경](explanation-app-structure.md) |
| 특정 함수의 인자/반환값을 찾는다 | [레퍼런스 — 앱](reference-partner-admin-app.md) |
| 어떤 화면이 어떤 컬렉션을 쓰는지 찾는다 | [레퍼런스 — 화면 58개](reference-screens.md) |
| 버그를 만났다. 알려진 것인지 확인하고 싶다 | [설명 — 알려진 격차 (P-01 ~ P-14)](explanation-known-gaps.md) |

---

## 문서 목록

### 튜토리얼 (학습 지향)

**[로그인부터 첫 승인까지](tutorial-first-approval.md)** — 약 15분
에뮬레이터 실행 → 로그인 → 데모 데이터 생성 → 디파짓 승인 → 계정관리에서 보유금 지급 →
Firestore 원장 대조. 3단계 안에 대시보드가 채워집니다.

### 하우투 (과제 지향)

**[아바타 대리베팅 승인·종료](howto-avatar-request-approval.md)** — 약 10분
신청 확인 → 담당 아바타 배정 승인 → 플레이어 사이트에서 자동 베팅 확인 → 강제 종료 →
관리자 로그 대조. 파트너 어드민과 플레이어 사이트를 오가는 전체 사이클입니다.

**[라운드 취소와 환불](howto-round-cancel.md)** — 약 10분
취소 사유 선택 → 베팅 환불·페이아웃 회수 → 인게임공지 등록 → 결과 검증. 환불이 0건으로
끝나는 경우([P-03](explanation-known-gaps.md#p-03--라운드-취소가-실플레이-베팅을-환불하지-못한다))의
판별법을 포함합니다.

### 레퍼런스 (정보 지향)

**[`partner-admin/app.js` 앱 레퍼런스](reference-partner-admin-app.md)**
전역 상태 8종, 캐시 3종, `mountListView(cfg)` 설정 계약 전체, 돈을 쓰는 함수 6개, 트랜잭션
가드 4곳, 데모 시드/와이프. 함수별 인자·Firestore 쓰기 내용·엣지 케이스.

**[화면 58개 레퍼런스](reference-screens.md)**
12개 내비게이션 그룹 아래 58개 화면 전체를 표로. 화면마다 렌더러 함수, 읽는 컬렉션, 필터,
행 액션, 쓰기 여부를 명시합니다.

### 설명 (이해 지향)

**[앱 구조와 설계 배경](explanation-app-structure.md)**
"서버 0대로 58개 운영 화면을 만든다"는 제약이 만들어낸 구조. 설정 주도 리스트 엔진, 파생
잔액 모델, 이중 쓰기, 트랜잭션 가드가 있는 곳과 없는 곳, 트레이드오프 표.

**[알려진 격차 (P-01 ~ P-14)](explanation-known-gaps.md)**
코드 정독으로 확인한 결함 14건. 각 항목마다 근거 파일·줄, 결과, 고치는 법, 재현 절차.
의도된 단순화와 구분해 두었습니다.

---

## 시스템 한 눈에

```
     ┌──────────────────────────────────────────────┐
     │  partner-admin/index.html                     │
     │  로그인 게이트 · 모달 4종 · 스크립트 로드 순서   │
     └───────────────────┬──────────────────────────┘
                         ▼
     ┌──────────────────────────────────────────────┐
     │  partner-admin/app.js  (1,867줄)              │
     │                                               │
     │  NAV_GROUPS ─────► 12 그룹 / 58 화면           │
     │       │                                       │
     │       ▼                                       │
     │  switchView(id) ──► VIEW_RENDERERS[id]        │
     │       │                                       │
     │       ├──► mountListView(cfg)   약 40 화면     │
     │       │      onSnapshot 실시간 · 검색 · 페이징  │
     │       │                                       │
     │       └──► 전용 렌더러          18 화면        │
     │              대시보드 · 통계 9탭 · 계정관리 등   │
     └───────────────────┬──────────────────────────┘
                         ▼
     ┌──────────────────────────────────────────────┐
     │  shared/cage-ui.js                            │
     │  cageInitFirebase · writeMemberLedgerEntry    │
     │  SVG 차트 3종 · 포맷 유틸 · 토스트/모달         │
     └───────────────────┬──────────────────────────┘
                         ▼
     ┌──────────────────────────────────────────────┐
     │              Firestore  (컬렉션 24종)          │
     │  memberLedger ◄──┐                            │
     │  balanceTotals ◄─┴─ 같은 batch 이중 쓰기       │
     │  members · rounds · avatarRequests · …        │
     └──────────────────────────────────────────────┘
```

### 내비게이션 그룹

| 그룹 | 화면 수 | 성격 |
| --- | --- | --- |
| 대시보드 | 1 | 전용 렌더러. 회원/보유금 요약 + SVG 차트 4개 |
| 내정보관리 | 1 | 전용. 로그인한 직원 계정 편집 |
| 실시간접속자 | 1 | 전용. `lastLoginAt` 6시간 이내 필터 |
| 계정관리 | 1 | 전용. 보유금 지급/차감, 비밀번호 초기화, 정지 |
| 파트너정산리포트 | 1 | 리스트 엔진 |
| 회원관리 | 10 | 리스트 엔진 9 + 전용 1 (데일리리포트) |
| 통계 | 9 | 전용 렌더러 하나가 9개 탭을 분기 |
| 테이블관리 | 10 | 리스트 엔진 7 + 전용 3 |
| 월렛관리 | 3 | 리스트 엔진 |
| 고객센터 | 7 | 리스트 엔진 6 + 전용 1 (이용안내) |
| 관리자 관리 | 10 | 리스트 엔진 |
| 결제 관리 | 4 | 리스트 엔진 3 + 재사용 1 (일자별정산 = 데일리리포트) |
| **합계** | **58** | |

---

## 돈이 움직이는 6곳

파트너 어드민에서 `memberLedger`에 쓰는 지점은 여섯 군데뿐입니다. 데모 시드를 뺀 다섯 곳은
전부 [`writeMemberLedgerEntry()`](../../shared/cage-ui.js#L202)를 거칩니다.

| 지점 | 함수 | 카테고리 | 부호 |
| --- | --- | --- | --- |
| 보유금 지급/차감 | [`submitBalanceAdjust`](../../partner-admin/app.js#L411) | `deposit` / `withdraw` | +/− |
| 디파짓 승인 | [`approveDeposit`](../../partner-admin/app.js#L890) | `deposit` | + |
| 결제처리 승인 | [`processPayment`](../../partner-admin/app.js#L1661) | `deposit` / `withdraw` | +/− |
| 라운드 취소 — 베팅 환불 | [`submitRoundCancel`](../../partner-admin/app.js#L1304) | `correction` | + |
| 라운드 취소 — 페이아웃 회수 | [`submitRoundCancel`](../../partner-admin/app.js#L1307) | `correction` | − |
| 데모 시드 | [`seedDemoData`](../../partner-admin/app.js#L1800) | 전 카테고리 | +/− |

데모 시드만 `writeMemberLedgerEntry()`를 **거치지 않고** `batch.set()`으로 직접 씁니다 —
따라서 시드로 만든 데이터는 `balanceTotals`에 반영되지 않습니다
([P-08](explanation-known-gaps.md#p-08--데모-시드가-balancetotals를-갱신하지-않는다) 참고).

---

## 관련 코드

| 파일 | 역할 |
| --- | --- |
| [`partner-admin/index.html`](../../partner-admin/index.html) | 화면 뼈대, 로그인 게이트, 모달 4종, 스크립트 로드 순서 (132줄) |
| [`partner-admin/app.js`](../../partner-admin/app.js) | 내비·리스트 엔진·58개 렌더러·데모 시드 (1,867줄) |
| [`shared/cage-ui.js`](../../shared/cage-ui.js) | Firebase 부트스트랩, 원장 이중 쓰기, SVG 차트, 포맷 유틸 (211줄) |
| [`shared/cage-ui.css`](../../shared/cage-ui.css) | 어드민 UI 클래스 계약 (231줄) |
| [`firestore.rules`](../../firestore.rules) | `staff`만 잠금. `partnerStaff` 포함 나머지는 무제한 |

파트너 어드민은 Cloud Function을 **호출하지 않습니다.** [`functions/`](../../functions/)의
`staffLogin`·TOTP·출금 트랜잭션은 루트 [`index.html`](../../index.html)(케이지 어드민 본체)
전용이며, 파트너 어드민은 전부 클라이언트에서 Firestore를 직접 읽고 씁니다.

---

## 저장소의 다른 문서

| 문서 | 내용 |
| --- | --- |
| [Avatar / Speed 플레이어 사이트](../avatar-speed/README.md) | 파트너 어드민이 승인하는 대리베팅의 반대편 |
| [Firestore 데이터 모델](../FIRESTORE_DATA_MODEL.md) | 전체 컬렉션 스키마와 append-only 원칙 |
| [보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md) | `balanceTotals` 이중 쓰기와 컷오버 계획 |
| [아키텍처와 운영 경계](../explanation-architecture.md) | 저장소 전체 구조 |
| [보안·데이터 정합성 리뷰](../review-security-data-integrity.md) | 프로젝트 전반 리뷰 |
| [전체 시스템 지도](../architecture/00-system-map.md) | 앱 4개·컬렉션 33종의 구성도. 이 문서 세트가 목표 설계의 어느 빈칸을 채우는지 |
| [목표 아키텍처](../architecture/README.md) | PostgreSQL 원장 이관 설계와 DDL |
| [Cloud Functions 레퍼런스](../reference-cloud-functions.md) | 본체 어드민이 쓰는 서버 API |
| [데모 환경 실행](../tutorial-run-demo.md) | Firebase 프로젝트 설정 |
| [배포 방법](../how-to-deploy.md) | Firebase Hosting 배포 |

---

## 이 문서에 대해

- **작성 기준일**: 2026-08-14 · 브랜치 `backend`
- **작성 방법**: [`partner-admin/app.js`](../../partner-admin/app.js) 1,867줄과
  [`partner-admin/index.html`](../../partner-admin/index.html) 132줄 전체 정독. 의존 모듈
  ([`shared/cage-ui.js`](../../shared/cage-ui.js)), [`firestore.rules`](../../firestore.rules),
  플레이어 사이트의 대응 코드([`avatar/app.js`](../../avatar/app.js),
  [`shared/game-engine.js`](../../shared/game-engine.js))를 함께 대조했습니다.
- **검증 범위**: 모든 서술은 코드 정독으로 확인했습니다. 브라우저에서 실행해 재현하지는
  않았으며, 실행 확인이 필요한 항목은
  [알려진 격차](explanation-known-gaps.md)에 그 사실을 명시했습니다.
