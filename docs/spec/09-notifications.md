# 09 — 알림 도메인 (Telegram Notifications)

> **마일스톤**: M2 · **선행**: [`03`](03-api-idempotency.md) · **후행**: [`06`](06-event-commission.md) 재시도 알림
> **입력**: `functions/index.js:201`~`339` · `index.html` `sendCageNotification` · [`reference-cloud-functions.md`](../reference-cloud-functions.md) · [`06-security.md`](../architecture/06-security.md) §8
> **상태**: 목표 설계 ⚠ — [`00` §6](../architecture/00-system-map.md) 커버리지 매트릭스가 "`06` §8만 · DDL ❌"로 기록. **자금 이벤트 전 구간에서 호출되는데 데이터 모델이 없다**

---

## 1. 범위

손님에게 나가는 거래 알림(텔레그램)과 그 연결·발송·실패 관리. 운영자 내부 알림도 여기서 다룬다.

**이 도메인이 없으면 안 되는 이유**: 현행 케이지 어드민은 입금 · 출금 · 이체 · 바이인 · 중간정산 · 종료 · 롤링커미션 · 이벤트커미션 **거의 모든 자금 이벤트에서 `sendCageNotification`을 호출한다.** 알림이 빠지면 손님이 받던 영수증이 사라진다.

---

## 2. 현행 근거

```js
// index.html  sendCageNotification(accountId, lines)
const links = acc && acc.telegramLinks;
if(!links || !links.length || !links[0].chatId) return;      // ← 첫 번째 링크만 쓴다
fetch(`${TG_FUNCTIONS_BASE}/sendTelegramMessage`, {
  headers: {'X-App-Secret': TG_APP_API_SECRET},               // ← 공유 시크릿
  body: JSON.stringify({account: accountId, chatId: links[0].chatId, text}),
}).catch(()=>{});                                             // ← 실패 무시
```

```js
// functions/index.js:201  telegramWebhook — 손님이 /start 하면 링크 생성
const docId = `${accountId.toUpperCase()}_${chatId}`;
await db.collection("telegramLinks").doc(docId).set({account, chatId, username, dt});
```

| Cloud Function | 하는 일 | 위치 |
|---|---|---|
| `telegramWebhook` | `/start {accountId}` 로 `(account, chatId)` 링크 생성 | `functions/index.js:201` |
| `getTelegramLinks` | 계좌의 링크 목록 조회 (브라우저 직접 읽기를 막으려 함수 경유) | `:268` |
| `sendTelegramMessage` | 메시지 발송 — `chatId`가 그 계좌에 등록된 것인지 확인 | `:299` |
| `deleteTelegramLink` | 링크 해제 | `:339` |

**메시지 본문 형식**(영수증): `{지점} / DATE / TIME / ACC. / AMT. / CURR. / BAL / REMARKS`

### 2-1. 현행 결함

| # | 결함 | 결과 |
|---|---|---|
| 1 | `.catch(()=>{})` — 발송 실패가 **어디에도 안 남는다** | 손님이 못 받은 알림을 찾을 방법이 없다 |
| 2 | `links[0]`만 쓴다 | 링크가 여럿이어도 한 명에게만 간다 |
| 3 | 발송이 자금 조작 흐름에 섞여 있다 | 알림 지연이 조작 응답을 늦춘다 |
| 4 | 공유 시크릿(`X-App-Secret`)이 프런트엔드 상수 | 브라우저에서 읽을 수 있다 |
| 5 | 발송 이력이 없다 | "이 손님에게 무엇을 보냈나"를 답할 수 없다 |

---

## 3. 목표 데이터 모델

| ID | 요구사항 |
|---|---|
| `R-09-01` | `notify` 스키마를 신설한다. 자금 원장과 분리한다 |
| `R-09-02` | `notify.telegram_links(id, account_id, chat_id, username, linked_at, unlinked_at, unlinked_by)` — **해제가 행을 지우지 않는다.** 현행 `deleteTelegramLink`의 삭제 동작을 이식하지 않는다 |
| `R-09-03` | `UNIQUE (account_id, chat_id) WHERE unlinked_at IS NULL` — 현행 문서 ID 규약 `{ACCOUNT}_{chatId}`의 대응물 |
| `R-09-04` | `notify.messages(id, account_id, chat_id, channel, template, payload JSONB, status('queued','sent','failed','skipped'), attempt_count, failure_reason, created_at, sent_at)` |
| `R-09-05` | `notify.templates` — 영수증 본문이 코드 문자열이 아니라 **템플릿 레코드**다. 현행은 본문이 8개 이상의 호출부에 흩어져 있다 |
| `R-09-06` | 지점 RLS가 적용된다 |

---

## 4. 발송 경로 — 아웃박스 소비자

```
자금 op (트랜잭션 A) ──▶ outbox {topic:'notify', account_id, template, payload}
                                  │  같은 트랜잭션에서 커밋
                                  ▼
소비자 (트랜잭션 B) ──▶ notify.messages INSERT(status='queued')
                   ──▶ Telegram Bot API 호출
                   ──▶ status='sent' | 'failed' + failure_reason + attempt_count++
```

| ID | 요구사항 |
|---|---|
| `R-09-10` | 알림 발송이 **자금 트랜잭션 경로에서 분리**된다. 알림 실패가 자금 조작을 되돌리지 않고 응답을 지연시키지도 않는다 |
| `R-09-11` | **발송 실패가 기록된다**(`status='failed'` + 사유). 현행 `.catch(()=>{})`를 이식하지 않는다 |
| `R-09-12` | 재시도 정책(상한 · 백오프)이 정의돼 있고, 상한 도달이 운영 알림을 낸다 |
| `R-09-13` | 계좌에 링크가 여럿이면 **전부에게 발송**한다 — 또는 "대표 링크"가 데이터 모델의 명시적 개념이 된다. `links[0]` 암묵 규칙을 이식하지 않는다 |
| `R-09-14` | 링크가 0개인 계좌의 알림은 `status='skipped'`로 남는다 — 조용한 무시가 아니다 |
| `R-09-15` | 아웃박스 소비자가 셋이므로([`03`](03-api-idempotency.md) §5) `topic`별 커서와 재시도가 서로 간섭하지 않는다 |

---

## 5. 인증 · 비밀 관리

| ID | 요구사항 |
|---|---|
| `R-09-20` | 봇 토큰 · 공유 시크릿이 **프런트엔드 상수에서 사라진다.** 발송은 서버 대 서버다 |
| `R-09-21` | 웹훅이 텔레그램 시크릿 토큰을 검증한다 |
| `R-09-22` | `chat_id`가 해당 계좌에 등록된 것인지 서버가 검증한다 (현행 `sendTelegramMessage`가 이미 한다 — **이 검사를 잃지 않는다**) |
| `R-09-23` | 링크 생성·해제가 감사 로그에 남는다 |

---

## 6. 메시지 내용 계약

| ID | 요구사항 |
|---|---|
| `R-09-30` | 금액 표기가 통화 `minor_unit`을 따른다 — KRW는 소수 0자리 ([`01`](01-ledger-foundation.md) §3-1) |
| `R-09-31` | 통화 라벨이 서버에서 온다. 현행은 화면 상수 `{PHP:'페소', USD:'달러', HKD:'홍콩달러', CNY:'위안', KRW:'원'}`(`index.html:7144`)이다 |
| `R-09-32` | 템플릿 종류가 현행 발송 지점 전수와 1:1 대응한다 — 입금 · 출금 · 이체(보내는쪽/받는쪽) · 바이인(현금/계좌) · 추가 바이인 · 중간정산 · 종료 · 롤링커미션 · 이벤트커미션 |
| `R-09-33` | **잔액을 알림에 실을 때 원장 파생값을 쓴다.** 화면 계산값을 그대로 넣지 않는다 |

---

## 7. 골든 테스트

| 테스트 | 기대 |
|---|---|
| 텔레그램 API 실패 | 자금 거래는 커밋된 채 유지, `messages.status='failed'` |
| 링크 0개 계좌 입금 | `status='skipped'` 행 생성 |
| 링크 2개 계좌 입금 | 발송 2건 (또는 대표 링크 규칙대로 1건 + 근거) |
| 다른 계좌의 `chat_id`로 발송 시도 | 거부 |
| 링크 해제 후 재조회 | 행이 `unlinked_at` 채워진 채 남아 있다 |
| KRW 계좌 알림 | 금액이 소수 0자리로 표기 |

---

## 8. 열린 항목

- **운영자 알림 채널**: 재시도 상한 도달 · 이벤트 커미션 지급 실패 · 대사 위반을 누구에게 어떻게 알릴지. 현행에 개념이 없다. [`06`](06-event-commission.md) `R-06-23`이 이 결정을 기다린다.
- 텔레그램 외 채널(SMS 등) 확장 여부 — `notify.messages.channel` 컬럼은 두되 구현은 텔레그램만 한다.
