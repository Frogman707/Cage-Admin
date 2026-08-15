# 10 — 파트너 콘솔 · 쉐어 · 요청 승인

> **마일스톤**: M4 · **선행**: [`01`](01-ledger-foundation.md) · [`02`](02-identity-access.md) · [`03`](03-api-idempotency.md) · **후행**: [`11`](11-chat-notice-support.md) · [`13`](13-player-domain-deferred.md)
> **입력**: [`reference-screens.md`](../partner-admin/reference-screens.md) 58화면 · `partner-admin/app.js` · [`04-posting-rules.md`](../architecture/04-posting-rules.md) §12·§13 · [`00-decisions.md`](00-decisions.md) U3 · DR-34
> **닫는 수용 기준**: `AC-07-*` `AC-08-*` `AC-34-4` `AC-40-*` `AC-47-*` `AC-62-*` `AC-74-*` `AC-75-*` `AC-77-*`

> **파트너 도메인은 개별 결함이 아니라 도메인 하나가 통째로 준비되지 않았다.** 인증 · 권한 · 자금 · 계층 네 축이 모두 미완성이다. **넷을 따로 고치면 네 번 손댄다. 한 묶음으로 설계한다.**

---

## 1. 범위

파트너 주체·계층 · 회원 관리 · 요청 승인 워크플로 · 포인트/쉐어 연산 · 58화면 조회 API.

---

## 2. 현행 근거 — 화면 58개, 컬렉션 24종

| 그룹 | 화면 수 | 대표 |
|---|---|---|
| 단독 | 5 | 대시보드 · 내정보 · 실시간접속자 · 계정관리 · 파트너정산리포트 |
| 회원관리 | 10 | 유저리스트 · 베팅내역 · 지급내역 · 포인트누적/전환 · 쉐어관리 · **디파짓관리** · 쉐어누적리스트 · 쉐어설정로그 · 데일리리포트 |
| 통계 | 9 | 마켓비율 · 입출금내역 · 실적비교 · 실시간위험감지 · 고액베팅 · 리더보드 · 회원활동 · 가입현황 · 베팅현황 |
| 테이블관리 | 10 | 테이블 · 아바타게임 · **아바타대리베팅신청** · **게임라운드수정** · 채팅로그 · 뱅커절사 · 아바타미스수정 |
| 월렛관리 | 3 | — |
| 고객센터 | 7 | [`11`](11-chat-notice-support.md)에서 다룬다 |
| 관리자관리 | 10 | — |
| 결제관리 | 4 | `processPayment` |

```js
// partner-admin/app.js:890  approveDeposit — 상태 전이와 기장이 분리돼 있다
await db.runTransaction(async tx => { ...; tx.set(ref,{status:'승인'},{merge:true}); });  // 트랜잭션 A
await writeMemberLedgerEntry(db, {...category:'deposit'...});                             // 트랜잭션 밖
```

**실패 창**: 상태 커밋 후 기장 실패 시 **요청은 '승인'인데 잔액 변동이 없고** 재시도는 `ALREADY_PROCESSED`로 거부된다. 수동 복구 외에 경로가 없다.

---

## 3. 요청 승인 워크플로 (`DR-74`)

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-01` | 요청 엔티티가 목표 스키마에 있다 — `partner.deposit_requests` · `partner.payment_requests` | `AC-74-1` |
| `R-10-02` | **승인이 단일 op다** — 상태 전이 + 분개가 한 트랜잭션이다. 현행 2단계 구조를 이식하지 않는다 | `AC-74-2` |
| `R-10-03` | 멱등키가 자연키다 — `deposit_req:{request_id}` · `payment_req:{request_id}` | `AC-74-3` |
| `R-10-04` | 금액 임계 시 4-eyes가 연동된다 — `require_approval_if_over_threshold` 재사용 | `AC-74-4` |
| `R-10-05` | 이 실패 창이 `P-*` 결함 목록에 등록돼 있다 — **현행 시스템의 알려진 결함으로도 기록돼야 한다** | `AC-74-6` |
| `R-10-06` | 상태값 3종(`대기`·`승인`·`거절`)의 ENUM 매핑이 정의돼 있다. 한글 표시값은 화면 계층에 둔다 | — |

---

## 4. 계정 개설 경로 (`DR-08`)

**문제**: `op_open_account`가 `party_type='member'` + `kind='member_deposit'`로 **고정**이다. `player_wallet` · `player_points` · `partner_share_payable` · 파트너 주체를 만들 수 없다. `op_wallet_transfer`가 `account_id_of(..., 'player_wallet', ...)`를 호출하므로 **그 계정을 만든 적이 없어 항상 `no_data_found`다** — [`04` §12](../architecture/04-posting-rules.md)가 정의한 신규 기능 전체가 동작하지 않는다.

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-10` | `ledger.op_open_ledger_account(p_party_code, p_kind, p_currency, ...)`가 존재하고 허용 종류가 **화이트리스트**다 — `player_wallet` · `player_points` · `partner_share_payable` · `cage_point`([`05`](05-cage-points.md)) | `AC-08-1` |
| `R-10-11` | 금지 종류가 거부된다 — `house_*` · `chips_outstanding` · `opening_equity`는 부트스트랩·게임개설 전용이다 | `AC-08-2` |
| `R-10-12` | `ledger.op_register_partner(...)`가 파트너 주체 + `partner_profiles` + `partner_share_payable`을 **한 트랜잭션에서** 만든다 | `AC-08-3` |
| `R-10-13` | `op_register_partner`가 `depth = parent.depth + 1`을 강제한다 | `AC-08-4` |
| `R-10-14` | 계정 개설이 **상대 하우스 계정 존재를 강제**한다 (U2, [`01`](01-ledger-foundation.md) `R-01-12`) | `AC-06-5` |

---

## 5. 파트너 계층 순환 방지 (`DR-40`)

**문제**: `partner_no_self_parent`는 직접 자기참조만 막는다 — `A → B → A`는 통과한다. `depth`는 부모와 대조되지 않아 장식이다. **순환이 있는 트리에서 쉐어를 상향 정산하면 무한 루프이거나 이중 지급이다.** `partner_subtree()`의 재귀 종료가 `UNION`의 중복 제거에 우연히 기대고 있고, 그 함수는 **RLS 정책이 매 조회마다 호출한다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-20` | `ledger.assert_partner_no_cycle()` 트리거가 있다 | `AC-40-1` |
| `R-10-21` | `A → B → A` 삽입이 거부된다 | `AC-40-2` |
| `R-10-22` | 깊이 8 초과가 거부된다 | `AC-40-3` |
| `R-10-23` | **`depth`가 장식이 아니라 사실이다** — 트리거가 `NEW.depth = parent_depth + 1`을 강제한다 | `AC-40-4` |
| `R-10-24` | **이 트리거가 `op_share_accrue`를 만드는 커밋에 함께 들어간다.** 순환이 지금 발생하지 않는 유일한 이유는 쉐어 정산 함수가 없기 때문이다 | `AC-40-5` |
| `R-10-25` | `identity.staff.partner_party_id`가 `party_type='partner'`를 가리킴을 트리거가 강제한다 | `AC-47-1` |

---

## 6. 포인트 · 쉐어 연산 (`DR-07` + `DR-73` + `DR-38` 잔여)

**문제**: 타입 · 계정 · 분개 규칙 · RBAC 권한 문자열까지 있고 **op 함수만 비어 있다.** ADR-013 구조상 `ledger_app`은 op EXECUTE만 가능하므로 **이 4종 분개는 어떤 권한으로도 만들 수 없다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-30` | `op_point_earn` · `op_point_convert` · `op_share_accrue` · `op_share_settle`이 존재한다 | `AC-07-1` |
| `R-10-31` | `ddl/002`에 쉐어 권한 2행, `ddl/012`에 GRANT 4행이 추가됐다 | `AC-07-2` |
| `R-10-32` | [`00` §8](../architecture/00-system-map.md) A4가 재개되거나 신규 항목으로 등록됐고, 상태가 **"산출물 파일이 존재하는가"가 아니라 "그 기능을 실행할 수 있는가"** 로 판정됐다 | `AC-07-3` |
| `R-10-33` | 나머지 `✅` 항목(A3·A5·A6·A7·A9)도 같은 기준으로 재검증되고 결과가 기록됐다 | `AC-07-4` |
| `R-10-34` | A8 착수 조건에 op 계층이 명시돼 있다 — **엔드포인트를 만들고 나서 호출할 함수가 없는 상황을 막는다** | `AC-07-5` |
| `R-10-35` | `op_share_settle`은 U3와 무관하게 만든다 — 입력이 금액이지 요율이 아니다 | `AC-07-6` |
| `R-10-36` | `op_share_accrue`의 멱등키가 `share_accrue:{partner_code}:{period_code}` — 기간별 1회라 재계산해도 중복 적립이 없다 | `AC-07-7` |
| `R-10-37` | 잔여 `bet`·`payout`이 A2에 묶여 있음이 `ddl/001` `tx_kind` 블록에 기록돼 있다. **그 블록이 비는 것이 이 항목의 최종 완료 조건이다** | `AC-07-8` |

**검증 — 실행 경로 전수 검사 (이 병의 재발 탐지기)**

```sql
SELECT k AS orphan_kind
  FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k
 WHERE NOT EXISTS (SELECT 1 FROM ledger.posting_rules r WHERE r.kind = k);
-- 기대: 0행
```

---

## 7. 쉐어 요율 — 여전히 미확정 (`DR-62`)

U3는 **롤링 커미션**을 확정했다. **파트너 쉐어에는 현행 구현이 없다.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-40` | U3 결정 문서에 **"파트너 쉐어에는 현행 구현이 없다"** 가 결정의 **입력**으로 기록돼 있다 — [`00-decisions`](00-decisions.md) §4에 기록 완료 | `AC-62-1` |
| `R-10-41` | 요율 규칙 확정 전까지 `share_accrue`·`share_settle`·`partner_share_payable`과 관련 분개 4행이 DDL에 **없거나**, 있다면 "규칙 미확정 · 실행 경로 없음"이 `001`의 `tx_kind` 블록에 기록돼 있다. **`commission_expense`는 `DR-66` 해소로 실사용 계정이 됐으므로 이 목록에서 뺀다** | `AC-62-2` |
| `R-10-42` | `member_profiles.rolling_rate`를 **유지**한다. 컬럼 주석에 "현행 저장값 보존. 계산 규칙 미확정" | `AC-62-3` |
| `R-10-43` | `partners.shareRate` 표기 규약이 명시돼 있다 — 시드 `0.5`는 0.5%이므로 **`50`bp다. 순진한 `×10000`은 100배 오류이며 자금 계산 직결이다** | `AC-77-1`(변경) |
| `R-10-44` | 현행 `userList` 파생 컬럼의 `rolling * 0.015`(1.5% 하드코딩)가 **저장 요율 참조로 바뀐다** | — |

---

## 8. 회원 모델 (`DR-75` — A8 범위)

결정 §10: **주체 · 상태 · 인증은 A8, 게임 참여 이력은 A1.**

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-50` | [`00` §8](../architecture/00-system-map.md)에 소속 결정이 기록돼 있다 | `AC-75-1` |
| `R-10-51` | `member_profiles`(케이지 손님)와 온라인 회원 프로필의 분리/통합이 **ADR로** 결정돼 있다 | `AC-75-2` |
| `R-10-52` | 케이지 손님과 온라인 회원의 **매칭 규칙**이 정의돼 있다 — [`04` §12](../architecture/04-posting-rules.md) `wallet_transfer`가 둘의 연결을 전제한다 | `AC-75-3` |
| `R-10-53` | `members`의 나머지 실체가 매핑돼 있다 — `memberType` 4종 · `status` 3종(`정상`/`정지`/`블랙리스트`) · `smsVerified` · `parentAgent` · `betMax`/`betMin` · `pw`/`withdrawPw`(**평문 → identity 이전**) | `AC-75-4`·`AC-77-2` |
| `R-10-54` | [`02`](../architecture/02-target-architecture.md)가 Identity 스코프에 선언한 "회원 인증"에 대응하는 테이블이 `ddl/002`에 있다 | `AC-75-5` |
| `R-10-55` | `memberLedger.category` 10종 → `tx_kind` 대응표가 있다. `correction`·`avatar_tip`·`dealer_tip`이 A2 보류임은 명시한다 | `AC-77-3` |

---

## 9. 조회 API — 58화면

| ID | 요구사항 |
|---|---|
| `R-10-60` | 58화면이 읽는 컬렉션 24종이 목표 스키마의 **어느 테이블/뷰에 대응하는지** 표로 정리돼 있다 |
| `R-10-61` | 파생 컬럼(보유금 · 보유포인트 · 롤링 · 롤링커미션 · 윈로스 · 내수익금 · 입출금)이 **뷰로 정의**된다. 화면이 원장을 직접 합산하지 않는다 |
| `R-10-62` | 목록 API가 페이지네이션 · 정렬 · 필터를 갖는다. 현행 `fetchAll(coll)` 전량 조회를 이식하지 않는다 |
| `R-10-63` | 파트너 계층 RLS(`party_visible()`)가 모든 조회에 걸린다 |
| `R-10-64` | 실시간 채널이 정의돼 있다 — 승인 대기열 · 회원 목록 · 정산 상태 ([`03`](03-api-idempotency.md) `R-03-40`) |
| `R-10-65` | **파트너 콘솔 인증이 서버 인증으로 올라간다** — 현행 `admin`/`0000` 클라이언트 비교를 이식하지 않는다 |
| `R-10-66` | 통계 9화면 · 테이블관리 10화면 중 **플레이어 도메인(A1/A2)에 의존하는 것**이 목록으로 구분돼 있다 — 보류 해제 전에는 구현할 수 없다 |

---

## 10. 승인 정책 (DR-34)

| ID | 요구사항 | AC |
|---|---|---|
| `R-10-70` | 파트너 조직 내 4-eyes를 **만들지 않는다.** 파트너 승인 요청은 케이지 매니저가 승인한다 ([`02`](02-identity-access.md) §7) | `AC-34-1`·`AC-34-2` |
| `R-10-71` | `partner.share_settle`이 케이지 승인에 의존한다는 **운영 절차**가 이 문서에 적혀 있다 — 파트너는 요청만 올리고 실행은 케이지 매니저 승인 후다 | 결정 §9 |
| `R-10-72` | 파트너 운영자의 `staff_branches` 행 유무가 확인·기록돼 있다 | `AC-34-4` |

---

## 11. 골든 테스트

| 테스트 | 기대 |
|---|---|
| `AC-74-5` 기장 실패 주입 | 상태 전이도 함께 롤백 |
| `AC-08-5` 계정 개설 → `op_wallet_transfer` | 성공 (현행은 `no_data_found`) |
| `AC-08-2` `house_cash` 종류로 개설 시도 | 거부 |
| `AC-40-2` `A → B → A` | 거부 |
| `AC-40-4` `depth` 조작 INSERT | 거부 |
| `AC-07-1` 4종 op 존재 확인 | 전부 존재, `orphan_kind` 0행 |
| `R-10-03` 같은 `request_id` 2회 승인 | 캐시 재생, 기장 1회 |
| `R-10-43` `shareRate 0.5` 저장 | `50`bp로 저장되고 화면에 `0.5%`로 표시 |
| `R-10-63` 다른 서브트리 파트너 조회 | 0행 |

---

## 12. 열린 항목

- **쉐어 요율 규칙**(U3 범위 밖) — 확정 전까지 `share_accrue`는 실행 경로 없음으로 남는다. `R-10-41`이 그 상태를 명시적으로 기록한다.
- `R-10-66` 플레이어 도메인 의존 화면 목록 — [`13`](13-player-domain-deferred.md)의 보류 해제와 연동된다.
- 관리자관리 10화면 · 월렛관리 3화면의 상세 요구는 [`reference-screens.md`](../partner-admin/reference-screens.md)를 입력으로 별도 확장한다. **이 스펙은 자금·권한·계층 계약을 먼저 고정한다.**
