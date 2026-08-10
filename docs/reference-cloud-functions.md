# Cloud Functions API 참조

`functions/index.js`는 Telegram Bot 연동을 담당하는 HTTP Cloud Functions 네 개를 제공합니다. 모든 함수는 `us-central1` 기본 리전에 배포되며, 인스턴스 수는 최대 10개로 설정됩니다.

## 공통 구성

| 항목 | 값 |
| --- | --- |
| Firebase 프로젝트 | `cage-admin-25bbf` |
| 허용 Origin | `https://cage-admin-25bbf.web.app` |
| CORS 메서드 | `GET`, `POST`, `OPTIONS` |
| 앱 인증 헤더 | `X-App-Secret` |
| Firestore 컬렉션 | `telegramLinks` |

앱용 엔드포인트는 Origin, 메서드, `X-App-Secret`을 확인합니다. 모든 비밀값 비교는 앞뒤 공백을 제거한 뒤 수행합니다.

## `telegramWebhook`

Telegram이 봇 업데이트를 전달하는 webhook입니다.

### 인증

`X-Telegram-Bot-Api-Secret-Token` 헤더가 `TELEGRAM_WEBHOOK_SECRET`과 일치해야 합니다. 불일치하면 `401 unauthorized`를 반환합니다.

### 동작

`/start <accountId>` 메시지를 받으면 다음 ID로 `telegramLinks` 문서를 생성 또는 갱신합니다.

```text
{ACCOUNT_ID_UPPERCASE}_{chatId}
```

문서에는 `account`, `chatId`, Telegram 사용자명, 이름, 서버 타임스탬프가 저장됩니다. 같은 계정과 채팅의 QR 링크를 다시 열어도 문서가 중복되지 않고 시간만 갱신됩니다.

`/start`에 계정 ID가 없으면 봇 사용 방법을 답장하고, Telegram 재시도를 막기 위해 정상 응답을 반환합니다.

## `getTelegramLinks`

특정 케이지 계정에 연결된 Telegram 채팅 목록을 반환합니다.

### 요청

```http
GET /getTelegramLinks?account=SE7419
X-App-Secret: <APP_API_SECRET>
Origin: https://cage-admin-25bbf.web.app
```

`account`는 필수이며 대문자로 정규화됩니다.

### 성공 응답

```json
{
  "links": [
    {
      "id": "@example",
      "chatId": 123456789,
      "dt": "2026-08-10 11:26"
    }
  ]
}
```

### 오류

- `400`: `account` 쿼리 값이 없습니다.
- `401`: 앱 비밀값이 일치하지 않습니다.

## `sendTelegramMessage`

이미 연결된 채팅에 Telegram 메시지를 보냅니다.

### 요청

```http
POST /sendTelegramMessage
Content-Type: application/json
X-App-Secret: <APP_API_SECRET>
Origin: https://cage-admin-25bbf.web.app

{
  "account": "SE7419",
  "chatId": 123456789,
  "text": "출금 비밀번호 확인 링크입니다."
}
```

### 제약

- `POST`만 허용합니다.
- `account`, `chatId`, `text`가 모두 필요합니다.
- `{ACCOUNT_ID}_{chatId}` 문서가 `telegramLinks`에 있어야 합니다. 따라서 이 함수는 임의의 Telegram 사용자에게 메시지를 전달하는 공개 relay가 아닙니다.

### 오류

- `400`: 필수 본문 값이 없습니다.
- `401`: 앱 비밀값이 일치하지 않습니다.
- `403`: 해당 채팅이 해당 계정에 연결되지 않았습니다.
- `405`: `POST` 이외의 메서드입니다.
- `500`: Telegram 전송에 실패했습니다.

## `deleteTelegramLink`

계정과 Telegram 채팅의 연결을 제거합니다.

### 요청

```http
POST /deleteTelegramLink
Content-Type: application/json
X-App-Secret: <APP_API_SECRET>
Origin: https://cage-admin-25bbf.web.app

{
  "account": "SE7419",
  "chatId": 123456789
}
```

성공하면 `{ "ok": true }`를 반환합니다. 없는 문서를 삭제해도 Firestore 삭제는 성공으로 처리됩니다.

## 관련 문서

- [Firebase 배포 방법](how-to-deploy.md)
- [Firestore 데이터 모델](FIRESTORE_DATA_MODEL.md)
