# 데모 환경 실행하기

이 튜토리얼에서는 Firebase Hosting 에뮬레이터에서 Cage Admin 화면을 열고, 파트너 콘솔이 만든 데모 회원으로 플레이어 화면에 로그인합니다. 완료하면 Avatar와 Speed 화면이 같은 회원 및 원장 데이터를 공유하는 것을 확인할 수 있습니다.

## 준비물

- Firebase 프로젝트 `cage-admin-25bbf`에 접근 가능한 Firebase CLI 로그인
- 최신 브라우저
- Functions까지 실행하려면 Node.js 24

## 1단계: 프로젝트와 Hosting 실행

저장소 루트에서 다음 명령을 실행합니다.

```bash
firebase use cage-admin-25bbf
firebase emulators:start --only hosting
```

명령이 표시하는 Hosting URL을 브라우저에서 엽니다. 케이지 운영 화면이 표시되면 정적 파일 제공이 정상입니다.

## 2단계: 데모 운영 데이터 생성

`/partner-admin/`을 열고 다음 계정으로 로그인합니다.

```text
ID: admin
비밀번호: 0000
```

처음 실행한 환경에 데이터가 없다면 왼쪽 하단의 **데모 데이터 생성**을 선택합니다. 이 작업은 파트너 직원, 회원, 테이블 등 플레이어 흐름에 필요한 Firestore 문서를 만듭니다.

## 3단계: 플레이어로 로그인

`/avatar/`을 열고 파트너 콘솔의 회원 목록에서 만든 데모 회원 ID를 입력합니다. 데모 회원의 기본 비밀번호는 `0000`입니다.

로그인 후 잔액과 포인트가 헤더에 표시되고, Avatar 또는 Speed 게임을 선택할 수 있습니다. 두 화면은 같은 `members` 회원 문서와 `memberLedger` 원장을 사용하므로 한 화면에서 발생한 잔액 변화가 다른 화면에도 반영됩니다.

## 확인

1. Avatar 로비에서 테이블을 선택하고 Avatar 신청을 제출합니다.
2. 파트너 콘솔의 Avatar 요청 화면에서 해당 요청을 승인합니다.
3. Avatar 화면으로 돌아가 요청 상태가 진행 중으로 바뀌는지 확인합니다.
4. Speed 테이블에서 베팅을 완료한 뒤 게임 기록을 열어 `memberLedger`에 기록된 베팅을 확인합니다.

## 문제 해결

### 테이블이 비어 있습니다

파트너 콘솔에서 데모 데이터를 생성했는지 확인하세요. Avatar와 Speed 로비는 각각 `tables` 컬렉션에서 해당 타입의 열린 테이블을 읽습니다.

### 로그인할 회원이 없습니다

파트너 콘솔의 회원 목록에서 데모 회원 ID를 확인하거나 새 회원을 생성하세요. 이 앱의 데모 로그인 검증은 Firebase Authentication이 아니라 `members/{id}` 문서의 `pw`와 `status` 필드를 사용합니다.

### Functions API까지 확인하고 싶습니다

Telegram 연동은 Hosting 에뮬레이터만으로 동작하지 않습니다. [Cloud Functions API 참조](reference-cloud-functions.md)의 비밀값 설정과 Functions 에뮬레이터 실행 절차를 따르세요.

## 다음 단계

- 운영 배포는 [Firebase 배포 방법](how-to-deploy.md)을 따르세요.
- 저장되는 컬렉션과 원장 규칙은 [Firestore 데이터 모델](FIRESTORE_DATA_MODEL.md)을 참고하세요.
