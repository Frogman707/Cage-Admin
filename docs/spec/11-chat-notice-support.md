# 11 — 채팅 · 공지 · 고객센터 (Support)

> **마일스톤**: M4 · **선행**: [`02`](02-identity-access.md) · [`10`](10-partner-console.md)
> **입력**: `partner-admin/app.js:1322`·`1393`·`1411`·`1470`·`1504` · [`reference-screens.md`](../partner-admin/reference-screens.md) 고객센터 7화면 · [`00-decisions.md`](00-decisions.md) §11
> **상태**: 목표 설계 **없음** — [`00` §6](../architecture/00-system-map.md) 커버리지 매트릭스 ❌. 자금 무관 도메인이라 마지막에 온다

---

## 1. 범위

파트너 콘솔 고객센터 그룹 7화면과 플레이어 사이트의 대응 화면. **자금과 무관하다** — 원장에 분개를 만들지 않는다.

| 화면 | 컬렉션 | 위치 |
|---|---|---|
| 한줄공지 | `tickerNotices` | `partner-admin/app.js:1393` |
| 공지사항 | `notices` | `:1411` |
| 채팅내역 | `chatMessages` | `:1322` |
| 일대일문의 | `inquiries` | `:1470` |
| 인게임공지 | `inGameNotices` | `:1504` |
| 고객센터연락처관리 | (연락처) | 네비 `csContact` |
| 회원 360 모달 문의 탭 | `inquiries` (회원별) | `:800` |

---

## 2. 현행 근거

```js
// partner-admin/app.js:1427  공지 저장
await db.collection('notices').doc(id||uuidv4())
  .set({title, body, pinned, staff:CURRENT_STAFF?.id||'—', dt: n.dt || new Date().toISOString()});

// :1484  문의 등록 → :1497 답변
await db.collection('inquiries').doc(uuidv4()).set({memberId, title, body, status:'대기', dt});
await db.collection('inquiries').doc(id).set({reply, status:'답변완료'}, {merge:true});
```

특징: 상태값이 한글 문자열(`'대기'`·`'답변완료'`), 작성자 기본값이 `'—'`, 시각이 **클라이언트 `new Date()`**, 문서 ID가 클라이언트 `uuidv4()`.

---

## 3. 목표 데이터 모델

| ID | 요구사항 |
|---|---|
| `R-11-01` | `support` 스키마를 신설한다. `ledger`·`cage`와 분리 |
| `R-11-02` | `support.notices(id, scope, title, body, pinned, published_at, expires_at, created_by, created_at, updated_by, updated_at)` |
| `R-11-03` | `support.ticker_notices(id, scope, text, active_from, active_to, created_by, created_at)` — 한줄공지 |
| `R-11-04` | `support.in_game_notices(id, table_id, text, active_from, active_to, created_by, created_at)` — 라운드 취소 흐름(`partner-admin/app.js:1275` `rcNotice` 체크박스)이 이 테이블에 쓴다 |
| `R-11-05` | `support.inquiries(id, member_id, title, body, status, answered_by, answered_at, created_at)` + `support.inquiry_replies(id, inquiry_id, body, author_kind, author_id, created_at)` — **답변을 원본 행에 덮어쓰지 않는다.** 현행은 `reply` 한 칸이라 재답변 이력이 없다 |
| `R-11-06` | `support.chat_messages(id, table_id, member_id, nickname, text, created_at, hidden_at, hidden_by)` — 로그이므로 append-only. 숨김은 상태 전이다 |
| `R-11-07` | `support.cs_contacts(id, channel, handle, display_order, active)` |
| `R-11-08` | 모든 테이블의 시각이 **서버 시각**이다. 클라이언트 `new Date()`를 신뢰하지 않는다 |
| `R-11-09` | ID를 서버가 발급한다 — 클라이언트 `uuidv4()`를 이식하지 않는다 |
| `R-11-10` | 상태값이 ENUM이고 한글 표시값은 화면 계층에 둔다 (`inquiries.status` = `'open'`·`'answered'`·`'closed'`) |

---

## 4. 접근 통제

| ID | 요구사항 |
|---|---|
| `R-11-20` | 공지 작성·수정이 파트너 운영자 권한을 요구하고 `created_by`가 실제 직원 ID다. **현행 `'—'` 기본값을 이식하지 않는다** |
| `R-11-21` | 회원은 자기 문의만 읽는다. 운영자는 `party_visible()` 범위의 회원 문의만 읽는다 |
| `R-11-22` | 채팅 로그 조회에 파트너 계층 RLS가 걸린다 |
| `R-11-23` | 공지 본문이 사용자 입력을 그대로 렌더하지 않는다 — **XSS 방어가 저장 시점과 렌더 시점 양쪽에 있다** |
| `R-11-24` | 공지·문의 편집 이력이 남는다 (`updated_by`·`updated_at`) |

---

## 5. API

| ID | 엔드포인트 |
|---|---|
| `R-11-30` | `GET/POST/PATCH /v1/support/notices` · `/ticker-notices` · `/in-game-notices` |
| `R-11-31` | `GET/POST /v1/support/inquiries` · `POST /v1/support/inquiries/{id}/replies` |
| `R-11-32` | `GET /v1/support/chat-messages?table_id=&from=&to=` (페이지네이션) |
| `R-11-33` | `GET/PUT /v1/support/cs-contacts` |
| `R-11-34` | 활성 공지 조회가 **서버 시각 기준**이다 — [`06`](06-event-commission.md) `R-06-10`과 같은 원칙 |

---

## 6. 골든 테스트

| 테스트 | 기대 |
|---|---|
| 문의 답변 2회 | 답변 행이 2개 남는다 (덮어쓰기 아님) |
| 다른 서브트리 회원의 문의 조회 | 0행 |
| 만료된 한줄공지 조회 | 활성 목록에 없음 |
| 스크립트 태그가 든 공지 저장·조회 | 이스케이프되어 렌더 |
| 채팅 메시지 숨김 | 행은 남고 `hidden_at`이 채워짐 |
| 클라이언트가 `created_at`을 실어 보냄 | 무시하고 서버 시각 사용 |

---

## 7. 열린 항목

- **플레이어 사이트 대응 화면**(공지 노출 · 1:1 문의 작성)은 A1 보류 도메인과 화면을 공유한다. **데이터 모델은 지금 확정할 수 있고 화면은 보류 해제 후다.**
- 채팅 실시간 전송 경로(WebSocket) 설계는 [`03`](03-api-idempotency.md) §6 실시간 채널 표에 행을 추가한다.
