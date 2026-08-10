# 07. 마이그레이션 계획

---

## 1. 첫 번째 결정 — 데이터를 옮길 것인가

**이 답에 따라 계획 전체가 갈린다.**

```
현재 Firestore 데이터가 실거래인가?
│
├── 아니오 (데모/시연 데이터)
│     → 옮기지 않는다. 새 DB에서 시작한다
│     → 마이그레이션 작업이 통째로 사라진다. 가장 안전하고 가장 빠르다
│
└── 예 (실제 자금 이력)
      → 3절 이관 절차. 감사가 선행되어야 한다
```

### 실거래 여부 판별 방법

`seedDB()`가 데모 계좌를 생성한다 (`index.html:5591-5686`). 다음 계좌들은 시드값이다:

```
SE7419 · MK2201 · PL0001 · PL8888 · PL9999 · PL7777 · PL9642   (전부 balance 5,000,000)
MAIN-HANN · MAIN-NUSTAR · MAIN-ONLINE                          (NUSTAR 만 50,000,000)
직원 7명: Kyle · Teddy · Jena · Woni · Liv · Minami · May       (PIN 전부 '1234')
```

판별 절차:
1. Firestore `accounts` 컬렉션에서 위 목록에 없는 계좌 코드가 있는지 확인
2. `ledger` 컬렉션에 `id`가 `ldg_seed_`로 시작하지 않는 문서가 있는지 확인
3. `games` 컬렉션에 실제 게임 기록이 있는지 확인

> 셋 다 없으면 데모다. **이 확인을 먼저 하라.** 결과에 따라 이후 4~6주 분량의 작업이 없어질 수 있다.

---

## 2. 이관을 어렵게 만드는 것들

실거래라면 **있는 그대로 옮길 수 없다.** 현행 데이터에 다음 문제가 있다.

| # | 문제 | 근거 | 결과 |
|---|---|---|---|
| M1 | 원장 금액 필드명이 셋 다 다름 | `inn`/`out` · `amt` · `amount` | 정규화 필요 |
| M2 | 롤링 `memo` 모호성 | 빈 문자열 = `'rolling'` (`index.html:4553`) | `source` 판정 불가 건 발생 |
| M3 | 시각이 클라이언트 벽시계 | `phNow()` (`:4153`) | 영업일 재계산 불가 |
| M4 | 금액이 부동소수점 | 전역 | 정수 변환 시 반올림 정책 필요 |
| M5 | 중복 거래 가능성 | 호출 시점 랜덤 ID (`:4396`) | 앱 재시도로 중복 원장 생성됐을 수 있음 |
| M6 | 반쪽 거래 가능성 | `toastTransferHalfFailed` 경로 존재 | 미러 누락 건이 있을 수 있음 |
| M7 | 게임 취소가 삭제 | `deleteGameDoc` (`:4529`) | 취소된 게임의 이력이 없음 |
| M8 | 로컬/클라우드 이중 경로 | `if(fbDb)` 분기 전반 | 로컬에만 있는 데이터 존재 가능 |

**M6이 특히 위험하다.** 반쪽 거래가 남아 있으면 복식부기 스키마에 넣는 순간 분개 합이 0이 아니게 되고, 첫 대사에서 항등식이 깨진다.

---

## 3. 이관 전략 — 기초 잔액 개시

**과거 원장을 재해석해 옮기지 않는다.**

```
❌ 하지 않는 것
   Firestore ledger 문서 하나하나를 entries 로 변환
   → M2·M3·M5·M6 때문에 분개 합이 맞지 않는다
   → 맞추려면 과거 데이터를 "고쳐야" 하는데, 그건 조작이다

✅ 하는 것
   1. 감사로 시점 잔액을 확정한다
   2. 확정 잔액을 opening_balance 거래 한 건으로 새 원장에 세운다
   3. 과거 이력은 별도 아카이브 테이블에 원본 그대로 보관한다
```

### 3-1. 단계

```
1단계  동결
       현행 시스템의 자금 조작을 중단한다. 읽기만 허용

2단계  추출
       Firestore 전 컬렉션을 원본 JSON 그대로 덤프
       → archive.firestore_snapshot (JSONB, 무손실)

3단계  감사
       계좌별 잔액 계산 (inn − out 합산)
       중복 후보 탐지 (같은 계좌·금액·1분 이내)
       반쪽 거래 탐지 (MAIN 미러가 없는 손님 거래)
       게임별 chips_outstanding 이 0이 아닌 진행 중 게임 목록
       → 사람이 검토하고 서명한다

4단계  확정
       감사 결과를 운영 책임자가 승인한다
       이 시점의 계좌별 잔액이 "확정 개시 잔액"

5단계  개시
       ledger.post_transaction(kind='opening_balance') 1건으로
       전 계정 잔액을 세운다 (균형 계정: opening_equity)

6단계  진행 중 게임 이관
       status='ongoing' 게임은 chips_outstanding 계정을 만들고
       현재 미회수 칩 잔액을 개시 분개에 포함한다

7단계  검증
       R1·R2 대사 통과 확인
       계좌별 표시 잔액이 감사 확정값과 일치하는지 전수 대조

8단계  전환
       신규 시스템 가동. 현행 시스템 읽기 전용으로 보존
```

### 3-2. 병행 운영 금지

**두 원장이 동시에 살아 있는 기간을 만들지 않는다.** 이중 기록·누락·정합성 확인 불가가 동시에 발생하는 가장 위험한 구간이다.

전환은 영업 중단 시간(컷오프 직후)에 한 번에 한다.

### 3-3. 롤백

7단계 검증 실패 시 현행 시스템을 다시 쓰기 가능 상태로 되돌린다. 신규 DB는 폐기하고 원인 수정 후 재시도한다. **부분 전환은 하지 않는다.**

---

## 4. 반올림 정책 (M4)

부동소수점 → 정수 변환 규칙을 명시한다.

```
amount_minor = ROUND(amount × 10^scale)      -- PHP: scale = 2

예: 1234567.891  →  123456789 (센타보)
```

**전 계좌 변환 후 반드시 확인:**
```
Σ(변환 전 잔액 × 100)  vs  Σ(변환 후 amount_minor)
차이가 있으면 반올림 잔차다. 크기를 기록하고 opening_equity 로 흡수한다
```

차액을 조용히 흡수하지 않는다. **감사 보고서에 명시한다.**

---

## 5. 롤링 `source` 판정 (M2)

현행 `memo` 값에서 `source`를 결정한다.

| `memo` | `source` | `counts_toward_branch_total` |
|---|---|---|
| `'rolling'` | `manual` | `true` |
| `'buy-in'` | `buyin` | `false` |
| `'working-chip'` | `working_chip` | `false` |
| `'mid-settle'` | `mid_settle` | `false` |
| `'game-end'` | `game_end` | `false` |
| `'month-settle-reset'` | `month_reset` | `false` |
| `''` (빈 문자열) | **판정 불가** | — |

**빈 `memo`는 자동 변환하지 않는다.** 현행 코드는 이를 `manual`과 동일 취급하지만(`index.html:4553`), 실제로는 구버전 데이터일 뿐 의미가 확인되지 않았다. 별도 검토 큐로 보내 사람이 판정한다.

> 개시 잔액 방식을 쓰면 이 문제의 영향 범위가 좁아진다. 롤링 이력은 아카이브에 보존되고, 신규 원장의 롤링 누계는 개시 시점부터 새로 쌓인다. **누계 연속성이 필요한지는 사업 결정이다.**

---

## 6. 아카이브

```sql
CREATE SCHEMA archive;

CREATE TABLE archive.firestore_snapshot (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  collection      TEXT NOT NULL,
  document_id     TEXT NOT NULL,
  data            JSONB NOT NULL,        -- 원본 그대로. 변환하지 않음
  snapshot_at     TIMESTAMPTZ NOT NULL,
  UNIQUE (collection, document_id)
);

CREATE TABLE archive.migration_audit (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_code   TEXT NOT NULL,
  legacy_balance NUMERIC NOT NULL,       -- 감사 시점 계산값 (부동소수 원본)
  opening_minor  BIGINT NOT NULL,        -- 확정 개시 잔액 (정수)
  rounding_delta BIGINT NOT NULL,        -- 반올림 잔차
  anomalies      JSONB,                  -- 중복 후보 · 반쪽 거래 등
  approved_by    TEXT NOT NULL,
  approved_at    TIMESTAMPTZ NOT NULL
);
```

**아카이브는 조회 전용이며 신규 원장과 연결되지 않는다.** 분쟁 발생 시 근거 자료로만 쓴다.

---

## 7. 전체 일정

각 단계는 앞 단계 없이 성립하지 않는다.

```
M0  기반 확정                                          [선행 조건]
    ├── 실거래 여부 판별 (1절)
    ├── 미확정 4항목 결정 (08-adr.md 말미)
    ├── 원장 DDL 확정 + 불변식 제약 (ddl/)
    ├── 분개 정의표 확정 (04-posting-rules.md)
    └── CI: 원장 재생 테스트 · 대사 쿼리

M1  Ledger + Identity                                  [핵심]
    ├── post_transaction() · 역분개 · 멱등 · 해시 체인
    ├── 인증 (Argon2id · TOTP · 세션) · RBAC
    ├── 4-eyes 승인 엔진
    └── 골든 테스트: 04번 문서 전 연산의 분개 검증

M2  Cage API
    ├── 계좌 명령 4종 (입금 · 출금 · 이체 · 지점이체)
    ├── 게임 명령 6종 (시작 · 바이인 · 롤링 · 중간정산 · 종료 · 취소)
    ├── 케이지 운영 (메인케이지 · 실사 · 기간)
    └── Outbox + Realtime Gateway

M3  Player & Game
    ├── 테이블 워커 · 라운드 권위 · commit-reveal RNG
    └── 회원 자금을 통합 원장으로

M4  정산 · 리포팅
    ├── 컷오프 · 월정산 (기간 마감)
    ├── 롤링 커미션 (요율 규칙 확정 후)
    └── 리포트 · PDF

M5  경화
    ├── 부하 테스트 · 장애 주입
    ├── 침투 테스트
    ├── 백업 복구 리허설
    └── 마이그레이션 리허설 (실데이터 사본으로 전 과정 예행)

M6  전환
    └── 3-1절 8단계
```

> **골든 테스트를 M1에 두는 이유:** 정산·요율 케이스를 기획이 먼저 스냅샷으로 고정해야 이후 리팩터링이 안전하다. 나중에 만들면 이미 있는 버그를 정답으로 굳힌다.

---

## 8. 프런트엔드 트랙

백엔드와 병렬로 진행하되 **M0의 API 계약 확정 이후** 착수한다.

```
F0  API 계약 기반 타입 생성 · 목 서버
F1  디자인 시스템 + 공통 프레임 (그리드 · 폼 · 권한 · 지점 전환)
F2  케이지 화면 (현행 index.html 기능 전수)
F3  파트너 콘솔
F4  플레이어 화면 (Avatar · Speed)
```

현행 화면을 **기능 스펙으로 참조**한다. `shared/i18n.js` 다국어 사전은 그대로 이식한다.

---

## 9. 전환 전 필수 확인

- [ ] 실데이터 여부 판별 완료 (1절)
- [ ] 감사 보고서에 운영 책임자 서명
- [ ] 반올림 잔차 규모 기록 및 승인
- [ ] 롤링 판정 불가 건 처리 방침 확정
- [ ] 진행 중 게임 목록 확정 및 개시 분개 반영
- [ ] R1 · R2 대사 통과
- [ ] 계좌별 표시 잔액 전수 대조 완료
- [ ] 마이그레이션 리허설 1회 이상 성공
- [ ] 롤백 절차 문서화 및 담당자 지정
- [ ] 현행 시스템 읽기 전용 보존 계획 확정

---

**이전:** [06. 보안 아키텍처](06-security.md) · **다음:** [08. 설계 결정 기록](08-adr.md)
