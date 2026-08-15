# db/tests — 골든 테스트

빈 DB에 `db/schema` 를 적용한 뒤 도는 검증 한 벌이다.
요구사항 원본은 [`docs/spec/12-ci-golden-tests.md`](../../docs/spec/12-ci-golden-tests.md).

| 디렉터리      | 담는 것                                                                                    | 근거                  |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------- |
| `helpers/`    | 세 역할 풀 · 커밋/롤백 래퍼 · SQLSTATE 단언 · `ledger.entries` 조회                        | —                     |
| `fixtures/`   | 직원 · 스텝업 토큰 · 4-eyes 승인 · 회원 · 게임 · `withActor`                               | `R-12-23`             |
| `posting/`    | [`04-posting-rules.md`](../../docs/architecture/04-posting-rules.md) 절별 분개 계약 테스트 | `R-12-02`             |
| `invariants/` | 앱 역할 경계 · 지연 제약이 COMMIT 에서 발화하는 것 · `SET CONSTRAINTS` 금지 증명           | `R-01-52` · `R-12-03` |
| `drift/`      | `v_check_view_security` · `v_check_public_execute` 각 0행                                  | `R-12-05`             |

스펙 번호별 골든 테스트(`01-ledger-foundation` … `11-support`, [`12` §3](../../docs/spec/12-ci-golden-tests.md))는 각 도메인 계획이 자기 몫을 채운다.

## 규약

- **테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다** ([`12` §3](../../docs/spec/12-ci-golden-tests.md)). 검색으로 스펙까지 한 번에 닿아야 한다.
- **`op_*` 를 소유자로 부르지 않는다.** `postgres` 로 붙으면 RLS 와 테이블 권한이 우회되어 GRANT 실수 · REVOKE 누락 · 지점 격리 실패가 초록으로 통과한다. 픽스처만 소유자로 만들고, `op_*` 는 `ledger_app`(§14 기초 잔액은 `ledger_migrator`)로 부른다. 역할은 `db/scripts/test-role.sh` 가 만든다.
- **로그인 역할 하나가 `ledger_app` 과 `identity_app` 을 겸하지 않는다.** 겸하면 자금 경로가 자기 스텝업 토큰을 발급할 수 있게 되어 DR-03(발급자 ≠ 소비자)이 테스트에서 사라진다 (`db/schema/012_roles_and_grants.sql:214`). 레인은 셋이다 — `cage_test_app`(`ledger_app`) · `cage_test_identity`(`identity_app`, 경계 테스트 전용) · `cage_test_migrator`(`ledger_migrator`). 픽스처 스텝업 토큰은 소유자가 발급한다: `identity_app` 은 `step_up_tokens` 에 SELECT 가 없어 `INSERT ... RETURNING id` 가 거부된다.
- **`op_*` 를 부르는 테스트는 커밋한다.** 잔액 하한 · 차대 균형 · 봉인 트리거가 `DEFERRABLE INITIALLY DEFERRED` 라 롤백하면 **발화하지 않는다.** 롤백은 읽기 전용 테스트에만 쓴다.
- **분개는 `ledger.entries` 를 다시 읽어 단언한다.** `op_*` 반환 JSON 은 함수의 자기 보고서다 (`R-12-02`).
- **연산 함수는 세 스키마에 흩어져 있다** — `ledger` 12 · `cage` 8 · `identity` 3. 게임 · 실사는 `cage.op_*` 다. `ledger` 만 보면 절반을 놓친다.
- **파일 병렬 실행을 끈다** (`--test-concurrency=1`). 커밋하는 테스트가 지점 공유 계정을 동시에 건드리면 결과가 실행마다 달라진다.
- 픽스처는 시드 지점 3종(`HANN` · `NUSTAR` · `ONLINE`)을 쓴다. `ledger.provision_branch()` 가 생기면 그 위로 옮긴다 (`R-12-20`, a02).
- 픽스처에 개인정보·실계좌 값을 쓰지 않는다 (`R-12-23`).
- **잡이 조용히 건너뛰지 않는다.** 경로 필터·조건부 실행으로 스킵되면 머지 차단 신호가 된다 (`R-12-06`).

## 아직 비어 있다

계획 `a01-ci-golden-harness` 가 채운다. 대장은 [`docs/superpowers/ROADMAP.md`](../../docs/superpowers/ROADMAP.md).
