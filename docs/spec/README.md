# 스펙 — 마일스톤 인덱스

> **분류**: 실행 계약 (Execution contract)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **입력**: [`docs/architecture/`](../architecture/README.md) 설계 문서 · [`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) 수용 기준 86건 · 현행 코드(`index.html` · `partner-admin/` · `avatar/` · `functions/`)
> **전제**: [`00-decisions.md`](00-decisions.md)의 결정이 이 세트 전체의 입력이다

---

## 0. 문서 세트의 역할 구분

| 세트 | 답하는 질문 | 시제 |
|---|---|---|
| [`docs/architecture/`](../architecture/README.md) | **무엇을 만드는가** — 모델 · 분개 규칙 · 보안 설계 | 미래 설계 |
| [`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) | **무엇이 참이어야 끝난 것인가** — `AC-*` 86건 | 검증 |
| **`docs/spec/`** (이 세트) | **누가 무엇을 언제 만드는가** — 도메인별 요구사항 `R-*` · 마일스톤 순서 | 실행 |

`AC-*`는 수용 기준(검사), `R-*`는 요구사항(작업)이다. 각 `R-*`는 자기가 닫는 `AC-*`를 명시한다.

---

## 1. 도메인 스펙 13종

| # | 스펙 | 마일스톤 | 상태 |
|---|---|---|---|
| [`00`](00-decisions.md) | **결정 대장** | — | ✅ 확정 |
| [`12`](12-ci-golden-tests.md) | CI · 골든 테스트 | **M0** | 착수 대상 — **가장 먼저** |
| [`01`](01-ledger-foundation.md) | 원장 기반 (지점 참조테이블 · 통화 5종 · 불변식 · 대사) | M0 · M1 | 착수 대상 |
| [`02`](02-identity-access.md) | 신원 · 접근 통제 | M1 | 착수 대상 |
| [`03`](03-api-idempotency.md) | API 계약 · 멱등성 | M1 · M2 | 착수 대상 |
| [`04`](04-cage-game-rolling.md) | 케이지 게임 · 롤링 · 커미션 | M1 · M2 | 착수 대상 |
| [`05`](05-cage-points.md) | 케이지 포인트 | M2 | **신규 도메인** |
| [`07`](07-concierge.md) | 컨시어지 | M2 | **신규 도메인** |
| [`08`](08-account-lifecycle.md) | 계좌 생명주기 · 차단 | M2 | **신규 도메인** |
| [`09`](09-notifications.md) | 알림 (텔레그램) | M2 | **신규 도메인** |
| [`06`](06-event-commission.md) | 이벤트 커미션 | M4 | **신규 도메인** |
| [`10`](10-partner-console.md) | 파트너 콘솔 · 쉐어 · 요청 승인 | M4 | **신규 도메인** |
| [`11`](11-chat-notice-support.md) | 채팅 · 공지 · 고객센터 | M4 | **신규 도메인** |
| [`13`](13-player-domain-deferred.md) | 플레이어 도메인 | 보류 | 확정분 3종만 지금 |

**M5(이관 · 경화)는 U1=데모 결정으로 사라졌다.** 데이터를 옮기지 않는다. 기능과 스키마는 전부 위 13종에 들어 있다 ([`00-decisions`](00-decisions.md) §2).

---

## 2. 의존 순서

```
        [12] CI · 골든 테스트        ← 가장 먼저. 이후 모든 작업의 검증대
                 │
        [01] 원장 기반               ← 지점 참조테이블 전환이 끝나야 나머지가 붙는다
                 │
        ┌────────┼────────┐
     [02]인증  [03]API   [04]게임·롤링
        │        │        │
        └────────┼────────┴──────────┐
                 │                   │
     ┌───────────┼──────────┐        │
  [05]포인트 [07]컨시어지 [08]계좌   [09]알림
                                      │
                 ┌────────────────────┼──────────┐
            [06]이벤트커미션    [10]파트너콘솔  [11]고객센터
                                      │
                                 [13]플레이어 (보류)
```

**병목은 [`01`](01-ledger-foundation.md)이다.** `branch_code` ENUM → 참조 테이블 전환(U4)이 전 테이블 · 전 RLS 정책 · 전 검증 쿼리를 건드린다. 나중에 하면 두 번 고친다.

---

## 3. 마일스톤

### M0 — 기반 확정

| 항목 | 스펙 |
|---|---|
| CI + 골든 테스트 하니스 | [`12`](12-ci-golden-tests.md) 전부 |
| 지점 참조 테이블 전환 | [`01`](01-ledger-foundation.md) §2 |
| 결정 기록 완료 (`AC-20-1`) | [`00`](00-decisions.md) — ✅ 완료 |
| `SET CONSTRAINTS` 금지 명문화 | [`01`](01-ledger-foundation.md) §7 |

**종료 판정**: `AC-12-1`~`AC-12-6` 전부 참 + [`00`](00-decisions.md)가 U1~U5·B1·B2를 전부 기록.

### M1 — Ledger + Identity

[`01`](01-ledger-foundation.md) §3~§7 · [`02`](02-identity-access.md) 전부 · [`03`](03-api-idempotency.md) §2~§4 · [`04`](04-cage-game-rolling.md) §2~§9

**종료 판정**: `v_integrity_status` 전 행 `violations = 0` + R1~R11 존재 + 골든 테스트 전 통과.

### M2 — Cage API

[`03`](03-api-idempotency.md) §5~§8 · [`05`](05-cage-points.md) · [`07`](07-concierge.md) · [`08`](08-account-lifecycle.md) · [`09`](09-notifications.md) · [`04`](04-cage-game-rolling.md) §10

**종료 판정**: 케이지 어드민 7개 네비 뷰가 전부 서버 API로 동작. `localStorage` 전용 기능 0개.

### M4 — 정산 · 파트너

[`06`](06-event-commission.md) · [`10`](10-partner-console.md) · [`11`](11-chat-notice-support.md)

**종료 판정**: `orphan_kind` 0행(선언된 `tx_kind`에 전부 실행 경로 존재) + 파트너 콘솔 58화면 조회 API 대응 완료.

### 보류 — A1 · A2

[`13`](13-player-domain-deferred.md). 단 **§2~§4 확정분(배당 규약 · 페이아웃 멱등키 · 행위자 모델)은 지금 반영한다.**

---

## 4. 이 세트가 닫는 수용 기준

[`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) 잔여 72건의 처리:

| 처리 | 대상 | 근거 |
|---|---|---|
| 스펙에 요구사항으로 전개 | 대부분 | 각 스펙의 "닫는 수용 기준" |
| U1=데모로 **소멸** | `AC-63-*` `AC-29-*` `AC-70-8`·`9` `AC-84-4` `AC-85-3` | [`00`](00-decisions.md) §2 |
| U1=데모로 **성격 변경** | `AC-21-*` `AC-71-*` `AC-77-*` `AC-61-4` | [`00`](00-decisions.md) §2 |
| U2 결정으로 **범위 밖** | `AC-06-6`(환전 분개) `AC-06-7`(환율표) | [`00`](00-decisions.md) §3 |
| DR-34 결정으로 **범위 밖** | `AC-34-3` `AC-34-5` | [`00`](00-decisions.md) §9 |
| `AC-18-1` 채택으로 **범위 밖** | `AC-18-2` | [`00`](00-decisions.md) §10 |
| **이월** | `AC-15-5` (U5 관할 확정 시) | [`00`](00-decisions.md) §6 |

---

## 5. 기존 문서 갱신 — 2026-08-15 완료

**문서가 서로 다른 말을 하면 스펙이 아니라 소설이다.** 설계 문서를 이 세트의 결정에 맞춰 손봤다.

| 문서 | 갱신 내용 | 근거 | 상태 |
|---|---|---|---|
| [`08-adr.md`](../architecture/08-adr.md) | "미확정 사항" U1~U5가 [`00-decisions.md`](00-decisions.md)를 가리킨다 + "남아 있는 미확정" 5건 신설 | `AC-20-1` | ✅ |
| [`00-system-map.md`](../architecture/00-system-map.md) §6 | 커버리지 매트릭스 — **목표 설계 열에 빈 칸이 없다.** DDL 열의 공백이 곧 M2·M4 크기 | `AC-69-1` `AC-68-4` | ✅ |
| [`ddl/001`~`013`](../architecture/ddl/) | `branch_code` ENUM 제거(12파일 72참조) · 통화 5종 · `fx_exchange` 없음 · `tx_kind` 신규 4종 · `account_kind` 신규 2종 · 분개 8행 · `entry_category.reversal` 제거 | U2 · U4 · B1 · B2 · `DR-23` | ✅ **PG18 재적용 검증** |
| [`04-posting-rules.md`](../architecture/04-posting-rules.md) | §5-3-1 마커 발행 · §6-2 이벤트 커미션 · §13-4 케이지 포인트 · U3 산정 기준 · `shareRate` bp 함정 · §16 목록 | `AC-11-4` `AC-64-1` `AC-67-4` `AC-68-1` | ✅ |
| [`05-api-contract.md`](../architecture/05-api-contract.md) | §2-3-1 멱등키 접두사 대장 17행 · 파생 키 규약 · §4-1 신규 엔드포인트 | `AC-19-1` `AC-54-3` `AC-64-3` | ✅ |
| [`06-security.md`](../architecture/06-security.md) | RLS 13→17 · 조작별 재인증 표 8행 추가 · §3-5 파트너 승인 정책(`DR-34`) · `current_branches()` `TEXT[]` | `AC-16-3` `AC-34-2` | ✅ |
| [`02-target-architecture.md`](../architecture/02-target-architecture.md) | §5-2-1 운영 파라미터 9행 · 역할 표(`ledger_relay`·`identity_app`) · §4-2 파트너·플레이어 채널 | `AC-09-3` `AC-10-4` `AC-80-1` | ✅ |
| [`README.md`](../architecture/README.md) | "8채널"을 케이지 범위로 한정 · 통화·지점 행 추가 · 결정 요약 · spec 세트 연결 | `AC-80-2` | ✅ |
| [`ddl/README.md`](../architecture/ddl/) | U4 전환 전제 · 통화 5종 · 하우스 부트스트랩 PHP 한정 경고 · 재적용 검증 기록 | — | ✅ |

**미반영 잔여** — 스펙에는 있으나 아직 DDL이 아닌 것:

| 항목 | 어디 | 왜 미룸 |
|---|---|---|
| 하우스 계정 `currencies` 곱집합 부트스트랩 | [`01`](01-ledger-foundation.md) `R-01-11` | M0 작업. **현재 PHP만 생성되므로 다른 통화 거래는 실패한다** |
| `provision_branch()` | [`01`](01-ledger-foundation.md) `R-01-05` | M0 작업 |
| R10 · R11 대사 | [`01`](01-ledger-foundation.md) §6 | M1 작업. 현재 R1~R9 |
| `op_*` 신규 함수 전부 | [`04`](04-cage-game-rolling.md)~[`11`](11-chat-notice-support.md) | M2 · M4. 분개 규칙만 먼저 |
| `cage.bonus_events` · `concierge` · `support` · `notify` 스키마 | [`06`](06-event-commission.md)·[`07`](07-concierge.md)·[`11`](11-chat-notice-support.md)·[`09`](09-notifications.md) | M2 · M4 |

---

## 6. 관련 문서

| 문서 | 관계 |
|---|---|
| [`00-decisions.md`](00-decisions.md) | 이 세트의 전제. **스펙과 어긋나면 결정 대장이 맞다** |
| [`docs/architecture/`](../architecture/README.md) | 설계 원본 |
| [`docs/partner-admin/`](../partner-admin/README.md) · [`docs/avatar-speed/`](../avatar-speed/README.md) | 현행 파트너·플레이어 문서. [`10`](10-partner-console.md)·[`13`](13-player-domain-deferred.md)의 입력 |
