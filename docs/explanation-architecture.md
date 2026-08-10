# Cage Admin의 아키텍처와 운영 경계

Cage Admin은 서로 다른 사용자를 위한 네 화면이 하나의 Firebase 프로젝트와 Firestore 데이터 모델을 공유하는 구조입니다. 운영자는 케이지와 파트너 콘솔에서 데이터를 만들고 관리하며, 플레이어는 Avatar와 Speed 화면에서 같은 회원·잔액 데이터를 사용합니다.

## 문제: 서로 다른 화면의 금전 기록을 일관되게 유지하기

케이지 단말, 파트너 운영자, 플레이어 화면이 잔액 숫자를 각자 덮어쓰면 오프라인 복구나 동시 수정 시 마지막 저장이 이전 거래를 지울 수 있습니다. 이 문제는 실제 돈이 오가는 시스템에서 거래 유실과 감사 불가능으로 이어집니다.

또한 화면마다 독립된 회원·잔액을 쓰면 Avatar에서 발생한 결과가 Speed와 파트너 정산에 반영되지 않습니다.

## 접근: 공용 Firestore와 원장 이벤트

```text
┌───────────────────── Firebase Hosting ─────────────────────┐
│ /                 케이지 운영 화면                         │
│ /partner-admin/    파트너 운영 콘솔                        │
│ /avatar/           플레이어 Avatar·Speed 화면              │
│ /speed/            Avatar 화면의 Speed 모드로 이동         │
└────────────────────────────┬────────────────────────────────┘
                             │ Firebase compat SDK
                             ▼
┌────────────────────────── Firestore ───────────────────────┐
│ members · partnerStaff · tables · rounds                    │
│ memberLedger · ledger · mainCageLedger · rollingEvents      │
│ avatarRequests · telegramLinks · 운영 로그                  │
└────────────────────────────┬────────────────────────────────┘
                             ▲
                             │ Admin SDK + Firebase Secrets
┌────────────────── Cloud Functions ─────────────────────────┐
│ Telegram webhook · 연결 조회 · 메시지 전송 · 연결 삭제      │
└────────────────────────────────────────────────────────────┘
```

플레이어 영역의 금액 변화는 `memberLedger`에 부호 있는 이벤트로 기록하고 합산합니다. 따라서 Avatar와 Speed 베팅은 하나의 보유금을 공유합니다. 케이지 영역도 `ledger`, `mainCageLedger`, `rollingEvents`를 사용하지만, 현행 구현에는 `inn`/`out` 필드와 전역 `rollingEvents` 컬렉션처럼 목표 모델과 다른 형식이 남아 있습니다.

[Firestore 데이터 모델](FIRESTORE_DATA_MODEL.md)은 다단말 충돌을 막기 위한 목표 구조입니다. 특히 UUID 기반 append-only 이벤트, 부호 있는 `amount`, 게임별 `rollingEvents` 서브컬렉션을 정의합니다. 케이지 기능을 변경하거나 마이그레이션할 때는 이 문서를 현행 스키마 명세로 오해하지 말고 구현과 함께 대조해야 합니다.

## 화면의 역할

### 케이지 운영 화면

루트 `index.html`은 기존 케이지 운영 기능과 Firestore 동기화를 함께 포함합니다. 직원, 원장, 게임, 롤링 이벤트, 메인 케이지, 지점 이체·교대 데이터를 구독하고 표시합니다.

### 파트너 운영 콘솔

`partner-admin/`은 `members`, `tables`, `partners`, `depositRequests`, `avatarRequests`와 같은 운영 데이터를 관리합니다. 데모 시드 생성도 여기에서 수행합니다. 화면 내부 로그인은 Firestore의 `partnerStaff` 문서를 직접 조회합니다.

### 플레이어 화면

`avatar/`은 가입·로그인, 다국어 UI, Avatar 신청 및 Speed 베팅을 제공합니다. `shared/game-engine.js`는 카드 시뮬레이션, 베팅 원장 기록, 정산, 로드맵 계산을 담당합니다. `speed/`는 코드 중복을 피하기 위해 이 화면의 Speed 모드로 이동합니다.

## 공용 코드와 배포 방식

`shared/`는 Firebase 초기화, UI 도우미, 테마, 다국어 사전, 게임 엔진 및 스타일을 제공합니다. 각 화면은 이 파일들을 `<script>`로 직접 로드하므로 Node 패키지 설치나 프런트엔드 빌드가 필요하지 않습니다.

Firebase Hosting은 저장소 루트를 그대로 배포합니다. Cloud Functions만 `functions/`의 Node.js 프로젝트로 별도 의존성과 배포 경로를 가집니다.

## 트레이드오프와 운영 전제

이 구조는 정적 배포가 단순하고 화면 간 데이터를 쉽게 공유한다는 장점이 있습니다. 반면 브라우저가 Firestore에 직접 접근하므로 보안 규칙이 권한 검증의 핵심이 됩니다. 현재 저장소에는 Firestore 보안 규칙이 없으며, 플레이어와 파트너 로그인도 Firebase Authentication이 아닌 문서 필드 기반 데모 구현입니다.

또한 게임 엔진은 `Math.random()`으로 라운드를 생성합니다. 이는 UI와 원장 흐름을 보여 주는 데모에는 적합하지만, 공인 난수·게임 서버·감사 추적이 필요한 실제 베팅 서비스의 결과 생성 방식으로 사용할 수 없습니다.

## 다음에 읽을 문서

- 처음 실행하려면 [데모 환경 실행하기](tutorial-run-demo.md)
- 배포 절차는 [Firebase 배포 방법](how-to-deploy.md)
- Telegram 연동의 HTTP 계약은 [Cloud Functions API 참조](reference-cloud-functions.md)
