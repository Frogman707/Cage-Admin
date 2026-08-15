# db/tests — 골든 테스트

빈 DB에 `db/schema` 를 적용한 뒤 도는 검증 한 벌이다.
요구사항 원본은 [`docs/spec/12-ci-golden-tests.md`](../../docs/spec/12-ci-golden-tests.md).

| 디렉터리 | 담는 것 | 근거 |
|---|---|---|
| `helpers/` | 접속 · 트랜잭션 래퍼 · SQLSTATE 단언 | — |
| `fixtures/` | `ledger.provision_branch()` 기반 지점 · 통화 5종 매트릭스 | `R-12-20` · `R-12-21` |
| `golden/` | 스펙 번호별 테스트 (`01-ledger-foundation` … `11-support`) 87건 | [`12` §3](../../docs/spec/12-ci-golden-tests.md) |
| `posting/` | [`04-posting-rules.md`](../../docs/architecture/04-posting-rules.md) 절별 분개 계약 테스트 | `R-12-02` |
| `drift/` | `v_check_view_security` · `v_check_public_execute` 각 0행 | `R-12-05` |

## 규약

- **테스트 이름에 `AC-*` / `R-*` ID를 그대로 쓴다** ([`12` §3](../../docs/spec/12-ci-golden-tests.md)). 검색으로 스펙까지 한 번에 닿아야 한다.
- 픽스처는 `ledger.provision_branch()` 로 지점을 만든다. 수동 INSERT로 반쪽 지점을 만들지 않는다 (`R-12-20`).
- 픽스처에 개인정보·실계좌 값을 쓰지 않는다 (`R-12-23`).
- **잡이 조용히 건너뛰지 않는다.** 경로 필터·조건부 실행으로 스킵되면 머지 차단 신호가 된다 (`R-12-06`).

## 아직 비어 있다

계획 `a01-ci-golden-harness` 가 채운다. 대장은 [`docs/superpowers/ROADMAP.md`](../../docs/superpowers/ROADMAP.md).
