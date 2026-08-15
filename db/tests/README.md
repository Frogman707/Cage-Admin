# db/tests — 골든 테스트

빈 DB에 `db/schema` 를 적용한 뒤 도는 검증 한 벌이다.
요구사항 원본은 [`docs/spec/12-ci-golden-tests.md`](../../docs/spec/12-ci-golden-tests.md).

| 디렉터리      | 담는 것                                                                                    | 근거                  |
| ------------- | ------------------------------------------------------------------------------------------ | --------------------- |
| `helpers/`    | 접속 · 커밋/롤백 래퍼 · SQLSTATE 단언 · `ledger.entries` 조회                              | —                     |
| `fixtures/`   | 직원 · 스텝업 토큰 · 4-eyes 승인 · 회원 주체                                               | `R-12-23`             |
| `posting/`    | [`04-posting-rules.md`](../../docs/architecture/04-posting-rules.md) 절별 분개 계약 테스트 | `R-12-02`             |
| `invariants/` | 지연 제약이 COMMIT 에서 발화하는 것 · `SET CONSTRAINTS` 금지 증명                          | `R-01-52` · `R-12-03` |
| `drift/`      | `v_check_view_security` · `v_check_public_execute` 각 0행                                  | `R-12-05`             |

스펙 번호별 골든 테스트(`01-ledger-foundation` … `11-support`, [`12` §3](../../docs/spec/12-ci-golden-tests.md))는 각 도메인 계획이 자기 몫을 채운다.

## 규약

- **테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다** ([`12` §3](../../docs/spec/12-ci-golden-tests.md)). 검색으로 스펙까지 한 번에 닿아야 한다.
- **`op_*` 를 부르는 테스트는 커밋한다.** 잔액 하한 · 차대 균형 · 봉인 트리거가 `DEFERRABLE INITIALLY DEFERRED` 라 롤백하면 **발화하지 않는다.** 롤백은 읽기 전용 테스트에만 쓴다.
- **분개는 `ledger.entries` 를 다시 읽어 단언한다.** `op_*` 반환 JSON 은 함수의 자기 보고서다 (`R-12-02`).
- **파일 병렬 실행을 끈다** (`--test-concurrency=1`). 커밋하는 테스트가 지점 공유 계정을 동시에 건드리면 결과가 실행마다 달라진다.
- 픽스처는 시드 지점 3종(`HANN` · `NUSTAR` · `ONLINE`)을 쓴다. `ledger.provision_branch()` 가 생기면 그 위로 옮긴다 (`R-12-20`, a02).
- 픽스처에 개인정보·실계좌 값을 쓰지 않는다 (`R-12-23`).
- **잡이 조용히 건너뛰지 않는다.** 경로 필터·조건부 실행으로 스킵되면 머지 차단 신호가 된다 (`R-12-06`).

## 아직 비어 있다

계획 `a01-ci-golden-harness` 가 채운다. 대장은 [`docs/superpowers/ROADMAP.md`](../../docs/superpowers/ROADMAP.md).
