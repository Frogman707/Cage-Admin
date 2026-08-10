# How to Firebase에 배포하기

이 가이드는 Cage Admin 정적 화면을 Firebase Hosting에 배포하고, Telegram Cloud Functions를 별도로 배포하는 방법을 설명합니다.

## 준비물

- Firebase CLI
- `cage-admin-25bbf` Firebase 프로젝트의 Hosting 및 Functions 배포 권한
- Functions 배포 시 Node.js 24와 `functions/` 의존성

## Hosting만 배포하기

저장소 루트에서 다음을 실행합니다.

```bash
firebase use cage-admin-25bbf
firebase deploy --only hosting
```

`firebase.json`은 저장소 루트를 Hosting 공개 디렉터리로 사용합니다. `functions/`와 `docs/`, 숨김 파일 및 `node_modules`는 배포 대상에서 제외됩니다. HTML, JavaScript, CSS 응답에는 캐시를 남기지 않는 헤더가 설정되어 있으므로 최신 화면을 즉시 제공합니다.

## Cloud Functions 비밀값 설정하기

Telegram Functions는 다음 Firebase Functions 비밀값을 요구합니다.

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `APP_API_SECRET`

각 값을 배포 전에 설정합니다.

```powershell
"<telegram-bot-token>" | firebase functions:secrets:set TELEGRAM_BOT_TOKEN --data-file -
"<webhook-secret>" | firebase functions:secrets:set TELEGRAM_WEBHOOK_SECRET --data-file -
"<app-api-secret>" | firebase functions:secrets:set APP_API_SECRET --data-file -
```

값을 따옴표와 함께 소스 코드나 Git에 저장하지 마세요. Functions 구현은 PowerShell 파이프 입력에서 생길 수 있는 앞뒤 공백을 제거해 비교하지만, 비밀값 노출 자체를 막아 주지는 않습니다.

## Cloud Functions 배포하기

```bash
cd functions
npm install
npm run deploy
```

배포 후 Functions URL은 Firebase CLI 출력 또는 Firebase Console에서 확인합니다. `telegramWebhook`은 Telegram Bot API의 webhook URL로 설정해야 합니다. webhook secret token은 `TELEGRAM_WEBHOOK_SECRET`과 동일해야 합니다.

## Functions 로컬 실행하기

```bash
cd functions
npm install
npm run serve
```

로컬 에뮬레이터에서도 비밀값과 Telegram webhook의 외부 접근 경로가 필요합니다. 실제 Telegram 업데이트 검증은 공개 HTTPS URL이 없으면 수행할 수 없습니다.

## 배포 확인

1. 배포 URL에서 `/`, `/partner-admin/`, `/avatar/`, `/speed/`를 엽니다.
2. `/speed/`가 `/avatar/?mode=speed`로 이동하는지 확인합니다.
3. Functions를 배포했다면 로그를 확인합니다.

   ```bash
   cd functions
   npm run logs
   ```

4. Telegram 연동을 쓰는 경우 잘못된 `X-App-Secret` 요청이 `401 unauthorized`로 거부되는지, 다른 계정의 `chatId`로 메시지를 보낼 수 없는지 확인합니다.

## GitHub Actions로 Hosting 배포하기

GitHub Actions는 `main` 및 `claude/cage-admin-5-features-75k9ac` 브랜치에서 Hosting 관련 파일이 바뀌면 `live` 채널에 배포합니다. Functions 경로는 워크플로 감시 대상이 아니므로 Functions 변경은 이 가이드의 수동 배포 절차가 필요합니다.

## 관련 문서

- [Cloud Functions API 참조](reference-cloud-functions.md)
- [아키텍처와 운영 경계](explanation-architecture.md)
