# Avatar / Speed 플레이어 사이트 문서

[`avatar/`](../../avatar/)와 [`shared/game-engine.js`](../../shared/game-engine.js)로 구현된
플레이어용 게임 사이트의 전체 문서입니다. 처리 흐름, 게임 룰, 두 게임 모드의 동작, 함수 단위
계약, 알려진 결함을 다룹니다.

문서는 [Diataxis](https://diataxis.fr/) 4분면 구조를 따릅니다 — 읽는 사람의 상황에 따라 진입점이
다릅니다.

---

## 어디서 시작할까

| 상황 | 문서 |
| --- | --- |
| 처음 본다. 일단 돌려보고 싶다 | [튜토리얼 — 첫 베팅부터 원장 확인까지](tutorial-first-bet.md) |
| 대리베팅 세션을 운영해야 한다 | [하우투 — 아바타 세션 운영](howto-avatar-session.md) |
| 이 코드가 왜 이런 구조인지 알고 싶다 | [설명 — 처리 흐름과 설계 배경](explanation-round-flow.md) |
| 게임 룰과 로드맵 알고리즘이 궁금하다 | [설명 — 룰과 로드맵](explanation-rules-roadmaps.md) |
| 특정 함수의 인자/반환값을 찾는다 | [레퍼런스 — 게임 엔진](reference-game-engine.md) · [레퍼런스 — 앱](reference-avatar-app.md) |
| 버그를 만났다. 알려진 것인지 확인하고 싶다 | [설명 — 알려진 격차](explanation-known-gaps.md) |

---

## 문서 목록

### 튜토리얼 (학습 지향)

**[첫 베팅부터 원장 확인까지](tutorial-first-bet.md)** — 약 15분
에뮬레이터 실행 → 데모 데이터 생성 → 로그인 → 스피드 베팅 → 결과 확인 → 로드맵 읽기 →
Firestore 원장 대조. 3단계 안에 첫 라운드 결과를 봅니다.

### 하우투 (과제 지향)

**[아바타 대리베팅 세션 운영](howto-avatar-session.md)** — 약 10분
테이블 생성 → 회원 신청 → 운영자 승인 → 자동 베팅 → 팁 → 종료 → 원장 확인. 파트너 어드민과
플레이어 사이트를 오가는 전체 사이클과 문제 해결 항목을 포함합니다.

### 레퍼런스 (정보 지향)

**[`shared/game-engine.js` 엔진 레퍼런스](reference-game-engine.md)**
상수 7종, 함수 25개 전체. 인자·반환 구조·Firestore 쓰기 내용·엣지 케이스. 순수 함수 15개를
표로 구분해 두어 테스트 대상을 바로 고를 수 있습니다.

**[`avatar/app.js` 앱 레퍼런스](reference-avatar-app.md)**
전역 상태, 뷰 5개, 부팅·인증 흐름, 아바타 모드 전체, 스피드 모드 전체, DOM ID 계약,
로드맵 렌더링 창 크기.

### 설명 (이해 지향)

**[처리 흐름과 설계 배경](explanation-round-flow.md)**
"서버 0대로 진짜 데이터를 남긴다"는 제약이 만들어낸 구조. 라운드 상태 기계, 아바타 대리베팅
수명 주기, 돈이 움직이는 경로, Firestore 쿼리 전략, 렌더링 모델, 트레이드오프 표.

**[게임 룰과 로드맵 알고리즘](explanation-rules-roadmaps.md)**
서드카드 룰 없는 2장 바카라. 덱 모델, 카드값, 배당 계산, 페어 판정, 로드맵 알고리즘,
실제 바카라와의 차이 정리표.

**[알려진 격차 (G-01 ~ G-12)](explanation-known-gaps.md)**
코드 정독으로 확인한 결함 12건. 각 항목마다 근거 파일·줄, 결과, 고치는 법, 재현 절차.
의도된 단순화와 구분해 두었습니다.

---

## 시스템 한 눈에

```
                      ┌──────────────────┐
                      │  게임 선택 화면    │
                      └────────┬─────────┘
             ┌─────────────────┴─────────────────┐
             ▼                                   ▼
    ┌─────────────────┐                 ┌─────────────────┐
    │  AVATAR (아바타)  │                 │  SPEED (스피드)  │
    │  대리 베팅        │                 │  셀프 서비스      │
    ├─────────────────┤                 ├─────────────────┤
    │ 30 / 4 / 5 초    │                 │ 15 / 3 / 3 초    │
    │ 테이블 1개        │                 │ 테이블 N개 동시   │
    │ 지시대로 자동     │                 │ 직접 칩 배치      │
    │ 직원 승인 필요    │                 │ 즉시 시작         │
    │ 팁 · 채팅         │                 │ 반복 베팅         │
    └────────┬────────┘                 └────────┬────────┘
             └─────────────────┬─────────────────┘
                               ▼
                  ┌────────────────────────┐
                  │  shared/game-engine.js  │
                  │  결과 생성 · 정산 · 로드  │
                  └───────────┬────────────┘
                              ▼
                  ┌────────────────────────┐
                  │       Firestore         │
                  │  memberLedger · rounds  │
                  │  avatarRequests · …     │
                  └────────────────────────┘
```

| 항목 | 아바타 | 스피드 |
| --- | --- | --- |
| 베팅 주체 | 승인된 담당 아바타(직원)를 대신해 클라이언트가 자동 실행 | 회원 본인 |
| 라운드 주기 | 39초 (30 / 4 / 5) | 21초 (15 / 3 / 3) |
| 동시 테이블 | 1개 | 제한 없음 |
| 베팅 종류 | 지시 1종 (P / B / T 중 하나) | 5종 (P / B / T / 플레이어 페어 / 뱅커 페어) |
| 진입 조건 | 신청 → 파트너 어드민 승인 | 없음 |
| 부가 기능 | 팁, 채팅, 슈체인지 요청 | 반복 베팅, 다중 테이블 |
| 원장 `staff` | `'avatar'` | `'system'` |

두 모드는 **같은 로그인, 같은 보유금**을 씁니다. 헤더의 "게임 변경"으로 언제든 오갈 수 있습니다.

---

## 관련 코드

| 파일 | 역할 |
| --- | --- |
| [`avatar/index.html`](../../avatar/index.html) | 화면 뼈대, 로그인 게이트, 모달, 스크립트 로드 순서 |
| [`avatar/app.js`](../../avatar/app.js) | 두 모드의 상태·뷰·라운드 루프 (1,202줄) |
| [`shared/game-engine.js`](../../shared/game-engine.js) | 결과 생성, 인증, 원장 쓰기, 로드맵 (300줄) |
| [`shared/cage-ui.js`](../../shared/cage-ui.js) | Firebase 부트스트랩, 원장 이중 쓰기, 포맷 유틸 |
| [`shared/i18n.js`](../../shared/i18n.js) | ko / zh / en / ja / vi 5개 언어 |
| [`shared/game-ui.css`](../../shared/game-ui.css) | 칩·카드·로드맵 CSS 클래스 계약 |
| [`shared/theme.js`](../../shared/theme.js) | 다크/라이트 테마 |
| [`speed/index.html`](../../speed/index.html) | `/avatar/?mode=speed`로 리다이렉트 (호환용) |
| [`partner-admin/app.js`](../../partner-admin/app.js) | 아바타 신청 승인, 테이블 관리, 데모 데이터 생성 |

---

## 저장소의 다른 문서

| 문서 | 내용 |
| --- | --- |
| [파트너 어드민](../partner-admin/README.md) | 아바타 신청을 승인하고 테이블·정산을 운영하는 반대편 |
| [Firestore 데이터 모델](../FIRESTORE_DATA_MODEL.md) | 전체 컬렉션 스키마와 append-only 원칙 |
| [보유금 아키텍처 설계](../BALANCE_ARCHITECTURE_DESIGN.md) | `balanceTotals` 이중 쓰기와 컷오버 계획 |
| [아키텍처와 운영 경계](../explanation-architecture.md) | 저장소 전체 구조 |
| [보안·데이터 정합성 리뷰](../review-security-data-integrity.md) | 프로젝트 전반 리뷰 |
| [데모 환경 실행](../tutorial-run-demo.md) | Firebase 프로젝트 설정 |
| [배포 방법](../how-to-deploy.md) | Firebase Hosting 배포 |
| [목표 아키텍처](../architecture/) | PostgreSQL 원장 이관 설계와 DDL |

---

## 이 문서에 대해

- **작성 기준일**: 2026-08-12 · 브랜치 `backend`
- **작성 방법**: `avatar/`와 `shared/game-engine.js` 전체 정독. 의존 모듈(`cage-ui.js`,
  `i18n.js`, `game-ui.css`), 파트너 어드민의 승인 흐름, `firestore.rules`를 함께 대조했습니다.
- **검증 범위**: 모든 서술은 코드 정독으로 확인했습니다. 브라우저에서 실행해 재현하지는
  않았으며, 실행 확인이 필요한 항목은
  [알려진 격차](explanation-known-gaps.md)에 그 사실을 명시했습니다.
