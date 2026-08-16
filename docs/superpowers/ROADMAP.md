# 구현 로드맵 — 계획 문서 대장

> **분류**: 실행 계획의 인덱스 (Plan registry)
> **작성일**: 2026-08-15 · 브랜치 `backend`
> **입력**: [`docs/spec/`](../spec/README.md) 13종 · [`docs/architecture/`](../architecture/README.md) · [`docs/spec/00-decisions.md`](../spec/00-decisions.md)
> **전제**: [`00-decisions.md`](../spec/00-decisions.md)의 결정이 이 문서 전체의 입력이다

---

## 0. 이 문서가 하는 일

| 세트 | 답하는 질문 | 시제 |
|---|---|---|
| [`docs/architecture/`](../architecture/README.md) | 무엇을 만드는가 | 설계 |
| [`10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) | 무엇이 참이어야 끝난 것인가 — `AC-*` 86건 | 검증 |
| [`docs/spec/`](../spec/README.md) | 누가 무엇을 언제 만드는가 — `R-*` · 마일스톤 | 실행 계약 |
| **이 문서** | **어떤 계획 파일이 어떤 `R-*`를 가져가는가** | 작업 배분 |
| `plans/*.md` | **엔지니어가 손을 어디에 대는가** — 파일 경로 · 코드 · 명령 | 구현 |

**이 문서는 계획이 아니다.** 계획 파일은 superpowers `writing-plans` 형식(정확한 파일 경로 · 완전한 코드 · 실행 명령 · TDD 스텝)으로 `plans/` 아래에 개별 작성한다. 이 문서는 그 파일들의 **범위 · 순서 · 차단 요인**만 고정한다.

---

## 1. 왜 스펙 1종 = 계획 1개가 아닌가

스펙 13종은 **도메인 축**으로 잘려 있고, 각 스펙 안에 세 계층이 섞여 있다.

| 계층　　　　　　| 내용　　　　　　　　　　　　　　　　　　　　　　　| 작성 가능 여부　　　　　　　　　　　　　 |
| -----------------| ---------------------------------------------------| ------------------------------------------|
| **A · DB**　　　| 스키마 · 트리거 · 뷰 · `op_*` 함수 · RLS · GRANT　| 선행 결정 2건(§2)만 있으면 **전부 가능** |
| **B · 현행 JS** | `index.html`의 지금 오지급을 내는 결함　　　　　　| 대상 파일 실재. 테스트 도구 결정 필요　　|
| **C · API/앱**　| 엔드포인트 · 아웃박스 소비자 · 실시간 채널 · 화면 | **런타임 언어 미결정으로 전부 막힘**　　 |

계획을 도메인 축으로만 자르면 한 계획 안에 "지금 쓸 수 있는 것"과 "쓸 수 없는 것"이 함께 들어가 **플레이스홀더가 생긴다.** `writing-plans`가 명시적으로 금지하는 계획 실패다. 그래서 **계층 축으로 먼저 자르고, 그 안에서 도메인으로 나눈다.**

---

## 2. 계획 작성 전 선행 결정

| # | 결정 | 상태 |
|---|---|---|
| **D1** | 스키마 실행 경로 · 마이그레이션 도구 | ✅ **2026-08-15 확정** — `db/schema/` + `db/scripts/apply.sh`. 마이그레이션 도구 없음, 빈 DB 전체 재적용 ([`00-decisions`](../spec/00-decisions.md) §12) |
| **D2** | 골든 테스트 러너 | ✅ **2026-08-15 확정** — `node:test` + `pg`. 기존 `test/*.test.js`와 같은 결, 신규 의존성 `pg` 1개 |
| **D3** | `index.html` DOM 테스트 도구 | ⬜ 미결. 단일 파일 · 빌드 없음 구조라 하니스가 0이다. **Track B 전용** |
| **D4** | **애플리케이션 런타임 언어** | ⬜ 미결. [`02-target-architecture.md` §6](../architecture/02-target-architecture.md)이 "Go 또는 TypeScript" **후보만** 적어 두었다. **Track C 전부가 여기 묶여 있다** |

---

## 3. Track A — DB 계층 (계획 14개)

파일명 규약: `plans/YYYY-MM-DD-<slug>.md`. 날짜는 **계획 작성일**을 붙인다. slug는 아래 고정값.

| # | slug | 스펙 범위 | 선행 | 마일스톤 | 상태 |
|---|---|---|---|---|---|
| **a01** | [`a01-ci-golden-harness`](plans/2026-08-15-a01-ci-golden-harness.md) | [`12`](../spec/12-ci-golden-tests.md) 전부 | — | M0 | ✅ 계획 작성 완료 |
| **a02** | [`a02-branch-reference`](plans/2026-08-16-a02-branch-reference.md) | [`01`](../spec/01-ledger-foundation.md) §2 · §7 | a01 | M0 | 🏁 구현 완료 |
| **a03** | [`a03-ledger-invariants`](plans/2026-08-16-a03-ledger-invariants.md) | [`01`](../spec/01-ledger-foundation.md) §3~§6 (**R10 제외 — B1**) | a02 | M1 | ✅ 계획 작성 완료 |
| **a04** | `a04-identity-rls` | [`02`](../spec/02-identity-access.md) 전부 | a02 | M1 | ⬜ |
| **a05** | `a05-idempotency-db` | [`03`](../spec/03-api-idempotency.md) §2~§4 · §7 | a04 | M1 | ⬜ |
| **a06** | `a06-game-rolling-db` | [`04`](../spec/04-cage-game-rolling.md) §3~§9 | a05 | M1 | 🔒 B1 |
| **a12** | `a12-actor-model` | [`13`](../spec/13-player-domain-deferred.md) §2~§4 **확정분만** | a05 | M1 | ⬜ |
| **a07** | `a07-concierge-schema` | [`07`](../spec/07-concierge.md) §3 | a04 | M2 | ⬜ |
| **a09** | `a09-notify-schema` | [`09`](../spec/09-notifications.md) §3 | a04 | M2 | ⬜ |
| **a11** | `a11-account-lifecycle-db` | [`08`](../spec/08-account-lifecycle.md) §3~§5 | a04 | M2 | 🔒 B2 · B3 |
| **a10** | `a10-points-db` | [`05`](../spec/05-cage-points.md) §3 · §4 · §6 | a05 · a11 | M2 | 🔒 B2 |
| **a13** | `a13-partner-db` | [`10`](../spec/10-partner-console.md) §3~§6 (**쉐어 op 제외**) | a05 | M4 | 🔒 B4 |
| **a14** | `a14-bonus-events-schema` | [`06`](../spec/06-event-commission.md) §3 · §4 | a06 | M4 | 🔒 B5 |
| **a08** | `a08-support-schema` | [`11`](../spec/11-chat-notice-support.md) §3 · §4 | a13 | M4 | ⬜ |

**번호는 의존 순서가 아니라 식별자다.** 순서는 §6 그래프를 따른다.

### 3-1. 범위 주의

- **a02가 병목이다.** `branch_code` ENUM → 참조 테이블 전환(U4)이 전 테이블 · 전 RLS 정책 · 전 검증 쿼리를 건드린다. 나중에 하면 두 번 고친다.
- **a12는 보류 도메인이 아니다.** [`13`](../spec/13-player-domain-deferred.md) §2~§4는 "아바타 개선이 어떻게 끝나든 바뀌지 않는" 확정분이다 — `transactions` 행위자 2행 모델 · 페이아웃 멱등키 분리 · 배당 규약 한 줄. 미루면 A2 착수 시 차단 등급이 된다.
- **a13에서 `op_share_accrue` · `op_share_settle` 본체를 뺀다.** 쉐어 요율 규칙이 U3 범위 밖이라 미확정이다(B4). `R-10-41`대로 "규칙 미확정 · 실행 경로 없음"을 `ddl/001`의 `tx_kind` 블록에 기록하는 것까지가 a13의 몫이다.
- **a10과 a11이 같은 질문을 공유한다** — 잔액·포인트가 남은 계좌를 `closed`로 만들 때의 처리(B2). 한쪽만 답할 수 없다.
- **a07 · a08은 자금과 무관하다.** 원장에 분개를 만들지 않는다. 스펙에 컬럼 정의까지 나와 있어 계획 난이도가 가장 낮다.

---

## 4. Track B — 현행 JS 결함 (계획 1개)

| # | slug | 스펙 범위 | 상태 |
|---|---|---|---|
| **b01** | `b01-commission-prefill-fix` | [`04` §2-1](../spec/04-cage-game-rolling.md) `R-04-05`~`R-04-09` | 🔒 D3 |

**Track A와 독립이며 지금 오지급을 낸다.** `Share 40%` 프리셋에서 커미션 프리필이 0, 요율 정규식이 "첫 퍼센트"를 집어 롤링 요율을 빗나감, 진행 중 게임 재정산 시 이미 정산된 구간을 차감하지 않음. **이관을 기다릴 이유가 없다.**

막는 것은 결함이 아니라 하니스다(D3). `AC-84-4` · `AC-85-3`(과거 오지급 역산 조사)는 U1=데모 결정으로 소멸했으므로 이 계획의 범위가 아니다.

---

## 5. Track C — API/앱 계층 (계획 9개 · 전부 D4 대기)

| # | slug | 스펙 범위 | 마일스톤 |
|---|---|---|---|
| **c01** | `c01-runtime-skeleton` | [`03` §8](../spec/03-api-idempotency.md) 오류 매핑 · [`05-api-contract.md`](../architecture/05-api-contract.md) 게이트웨이 | M1 |
| **c02** | `c02-outbox-relay` | [`03` §5 · §6](../spec/03-api-idempotency.md) — `ledger_relay` · 실시간 채널 · 토픽별 커서 | M2 |
| **c03** | `c03-cage-money-api` | [`04` §10](../spec/04-cage-game-rolling.md) 지점 간 이월 2단계 · 케이지 자금 엔드포인트 | M2 |
| **c04** | `c04-points-api` | [`05` §5](../spec/05-cage-points.md) | M2 |
| **c05** | `c05-concierge-api` | [`07` §4](../spec/07-concierge.md) | M2 |
| **c06** | `c06-notify-consumer` | [`09` §4 · §5 · §6](../spec/09-notifications.md) — 발송 소비자 · 웹훅 · 템플릿 | M2 |
| **c07** | `c07-bonus-consumer-api` | [`06` §5 · §6](../spec/06-event-commission.md) | M4 |
| **c08** | `c08-partner-console-api` | [`10` §9](../spec/10-partner-console.md) 58화면 · 인증 승격 | M4 |
| **c09** | `c09-support-api` | [`11` §5](../spec/11-chat-notice-support.md) | M4 |

**c08은 D4가 풀려도 바로 못 쓴다.** `R-10-60`이 요구하는 **24컬렉션 ↔ 목표 테이블/뷰 매핑표가 아직 산출물로 존재하지 않는다.** 그 표가 c08 계획의 입력 전체다. 매핑표 작성이 c08의 0단계다.

`R-10-66`(플레이어 도메인 의존 화면 목록)이 확정되기 전까지 통계 9화면 · 테이블관리 10화면 중 일부는 c08 범위에서 빠진다.

---

## 6. 착수 순서

```
      D1 · D2 결정
           │
        [a01] CI 하니스           ← 이후 모든 계획의 검증대. 없으면 Run: 칸이 빈다
           │
        [a02] 지점 참조테이블      ← 병목. 전 테이블 · 전 RLS
           │
     ┌─────┴─────┐
  [a03]        [a04]
  불변식·대사    신원·RLS
     │           │
     └────┬──[a05] 멱등성 DB
          │      │
       [a06]  [a12]  [a07]  [a09]  [a11]
       게임    행위자  컨시어지 알림   계좌
          │                          │
       [a14]                      [a10]
       이벤트                      포인트
          │
       [a13] 파트너 DB
          │
       [a08] 고객센터

  [b01] 커미션 프리필   ← Track A와 병렬. D3만 필요
  [c01] … [c09]        ← D4 확정 후. c01이 나머지의 선행
```

---

## 7. 진행 차단 결정 5건

**D1~D4와 성격이 다르다.** 이쪽은 기술 선택이 아니라 **운영 정책**이고, 답을 모르면 해당 계획의 판정 로직을 쓸 수 없다.

| # | 질문 | 막는 계획 | 출처 |
|---|---|---|---|
| **B1** | 교대 카운터 9종의 **항등식** — `nn_chip_in_shift`가 나머지 NN 카운터와 어떤 관계여야 하는가 | a03(R10) · a06 | [`04` §12](../spec/04-cage-game-rolling.md) `R-04-65` |
| **B2** | 잔액·포인트가 남은 계좌를 `closed`로 만들 때 — 소멸시키는가, 되돌리는가, 출금 강제 후에만 허용하는가 | a10 · a11 | [`05` §9](../spec/05-cage-points.md) `R-05-32` · [`08` §7](../spec/08-account-lifecycle.md) |
| **B3** | `suspended`가 **입금만 허용**인가 **전면 차단**인가 (현행 `type:"Full"`은 전면 차단) | a11 | [`08` §7](../spec/08-account-lifecycle.md) `R-08-08` |
| **B4** | 파트너 **쉐어 요율 규칙** — 현행 구현이 없어 이식할 대상이 없다 | a13(쉐어 op 부분) · c08 | [`10` §12](../spec/10-partner-console.md) `DR-62` |
| **B5** | 이벤트 커미션이 **지점별인가 전사인가** — `bonus_events.branch`의 NULL 허용 여부가 배타 제약을 바꾼다 | a14 | [`06` §8](../spec/06-event-commission.md) |

**B1 · B5는 스키마를 바꾼다. B2 · B3 · B4는 함수 본체를 바꾼다.** 나중에 답하면 두 번 고친다.

### 7-1. 차단이 아닌 미결

| 항목 | 처리 |
|---|---|
| 운영 파라미터 실제 값(`statement_timeout` · `lock_timeout` · 풀 크기) | a05는 설정 자리만 만들고 진행. **값이 빈 채로 `AC-09-3`을 닫지 않는다** ([`03` §10](../spec/03-api-idempotency.md)) |
| 분할 출금 임계값 · 윈도 (U5 유예) | a04에서 **"잠정"** 표기로 진행. 관할 확정 시 `AC-15-5`를 닫는다 ([`00-decisions` §6](../spec/00-decisions.md)) |
| 운영자 알림 채널(재시도 상한 도달 · 대사 위반 수신자) | a09 스키마는 진행. 경로 결정은 c06까지 |
| `spillPlan.js` 처리(이식/폐기/유지) | a06 안에서 결정하고 기록한다. **죽은 코드가 아니라 테스트까지 있는 유지보수 대상이다** (`R-04-83`) |
| KRW `minor_unit = 0` 표기 파급 | 화면·영수증·리포트 계층이므로 c04 · c06 · c08에서 확인 ([`01` §9](../spec/01-ledger-foundation.md)) |

---

## 8. 마일스톤 ↔ 계획 매핑

[`docs/spec/README.md` §3](../spec/README.md)의 마일스톤을 계획으로 환산한 것이다.

| 마일스톤 | 계획 | 종료 판정 |
|---|---|---|
| **M0** | a01 · a02 | `AC-12-1`~`AC-12-6` 전부 참 + [`00-decisions`](../spec/00-decisions.md)가 U1~U5·B1·B2를 전부 기록 |
| **M1** | a03 · a04 · a05 · a06 · a12 · c01 | `v_integrity_status` 전 행 `violations = 0` + R1~R11 존재 + 골든 테스트 전 통과 |
| **M2** | a07 · a09 · a10 · a11 · c02~c06 | 케이지 어드민 7개 네비 뷰가 전부 서버 API로 동작. `localStorage` 전용 기능 0개 |
| **M4** | a08 · a13 · a14 · c07~c09 | `orphan_kind` 0행 + 파트너 콘솔 58화면 조회 API 대응 완료 |
| **보류** | ([`13`](../spec/13-player-domain-deferred.md)의 나머지) | 아바타 개선 확정 후. §6 해제 조건 4건 |
| **병렬** | b01 | `R-04-05`~`R-04-09` 골든 테스트 통과 |

**M3는 없다.** [`07-migration.md`](../architecture/07-migration.md)의 Player & Game 라벨이었고 보류 도메인이다. **M5(이관·경화)는 U1=데모 결정으로 소멸했다** — 데이터를 옮기지 않는다. 기능과 스키마는 전부 위 계획에 들어 있다.

---

## 9. 각 계획이 지켜야 할 것

`writing-plans` 형식 요건에 더해, 이 프로젝트 고유 규약이다.

| # | 규약 | 근거 |
|---|---|---|
| 1 | **테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다** | [`12` §3](../spec/12-ci-golden-tests.md) |
| 2 | 계획의 Global Constraints에 [`00-decisions`](../spec/00-decisions.md) U1~U5·B1·B2를 **값까지** 옮긴다 — 통화 5종(PHP·USD·HKD·CNY·KRW, KRW `minor_unit = 0`) · 지점 시드 3행(HANN·NUSTAR·ONLINE) · `fx_exchange` 없음 | 결정 대장이 전 스펙의 전제 |
| 3 | 각 계획의 종료 게이트 = 해당 스펙의 **골든 테스트 절 전부 통과** | 스펙마다 §골든 테스트 존재 |
| 4 | 새 오류 코드를 만드는 커밋이 [`05-api-contract.md` §7](../architecture/05-api-contract.md) 오류 표를 **같은 커밋에서** 갱신한다 | `R-03-60` |
| 5 | 새 파생 멱등키를 만들면 [`03` §4](../spec/03-api-idempotency.md) 접두사 대장을 먼저 갱신한다 | `R-03-20` |
| 6 | 함수 시그니처를 바꾸면 `ddl/012`의 GRANT 인자 목록을 **함께** 바꾼다. 안 그러면 `009`~`013`이 적용 불가가 된다 | `R-02-24` |
| 7 | 새 대사 검사를 추가하기 전에 [`10-acceptance-criteria.md` §11](../architecture/10-acceptance-criteria.md) R 번호 대장을 먼저 갱신한다 | [`01` §6](../spec/01-ledger-foundation.md) |
| 8 | `SET CONSTRAINTS ALL IMMEDIATE`는 금지다. 지연 제약 트리거 I1·I2가 삽입 순서 의존이 된다 | `R-01-50` |
| 9 | 픽스처는 `ledger.provision_branch()`로 지점을 만든다. 수동 INSERT로 반쪽 지점을 만들지 않는다 | `R-12-20` |

---

## 10. 상태 표기

| 표기 | 뜻 |
|---|---|
| ⬜ | 미작성 — 선행 결정(§2)만 풀리면 쓸 수 있다 |
| 🔒 `B*` | 차단 — §7의 해당 결정이 없으면 판정 로직을 못 쓴다 |
| 🟨 | 작성 중 |
| ✅ | 계획 작성 완료 — `plans/` 아래 파일 존재 |
| 🏁 | 구현 완료 — 해당 스펙 골든 테스트 전 통과 |

**계획 파일을 만들 때 §3~§5 표의 상태와 파일 링크를 함께 갱신한다.** 문서가 서로 다른 말을 하면 스펙이 아니라 소설이다.

---

## 11. 관련 문서

| 문서 | 관계 |
|---|---|
| [`docs/spec/README.md`](../spec/README.md) | 마일스톤 인덱스 · 의존 순서. **이 로드맵의 상위** |
| [`docs/spec/00-decisions.md`](../spec/00-decisions.md) | 전 계획의 전제. **계획과 어긋나면 결정 대장이 맞다** |
| [`docs/architecture/10-acceptance-criteria.md`](../architecture/10-acceptance-criteria.md) | `AC-*` 원본. 각 계획의 종료 판정 근거 |
| [`docs/architecture/ddl/README.md`](../architecture/ddl/README.md) | 스키마 설계 문서 — 파일 구성 · 적용 순서 예외 · ENUM 변경 시 함께 고칠 곳 |
| [`db/README.md`](../../db/README.md) | Track A의 **수정 대상 실물**. `db/schema/` 13개 파일 · `apply.sh` · `db/tests/` |
| `plans/` | 개별 구현 계획. superpowers `writing-plans` 형식 |
