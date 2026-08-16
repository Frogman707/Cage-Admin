// R-12-05 · AC-12-5 — 매 실행 끝에 배포 게이트 뷰들이 0행이어야 한다.
// 한쪽에서 닫고 다른 쪽에서 기본값으로 다시 열리는 병(DR-24)을 잡는 유일한 검사다.
//
// 여기 있는 뷰들은 원장 정합성이 아니라 **설치·배포 완결성**을 본다 (013 의 등급
// 구분). 그래서 v_integrity_status 가 아니라 이 파일이 지킨다 — 거래를 차단할
// 일이 아니라 배포를 막을 일이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

test('R-12-05 · AC-12-5 정의자 뷰 드리프트 — v_check_view_security 0행', async () => {
  const rows = await query('SELECT * FROM ledger.v_check_view_security');
  assert.deepEqual(rows, [], `security_invoker 가 아닌 뷰가 남아 있다: ${JSON.stringify(rows)}`);
});

test('R-12-05 · AC-12-5 PUBLIC EXECUTE 드리프트 — v_check_public_execute 0행', async () => {
  const rows = await query('SELECT * FROM ledger.v_check_public_execute');
  assert.deepEqual(rows, [], `PUBLIC 에 열린 함수가 남아 있다: ${JSON.stringify(rows)}`);
});

// 위 두 뷰와 같은 등급인데 이것만 스위트 전역 가드가 없었다 — 검사 뷰를 읽는
// 모든 테스트가 지점 하나를 이름으로 지목한다. 그러면 나중 계획이 네 번째 지점을
// 반쪽으로 남겨도 CI 가 빨개지지 않는다. 탐지기는 있고 걸린 것이 없는 상태다.
//
// 스위트가 만드는 반쪽 지점은 전부 withRollback 안에서 살다 죽으므로, 실행이
// 끝난 시점의 0행은 실제 성질이다.
test('R-01-06 · AC-60-2 반쪽 지점 드리프트 — v_check_branch_provisioning 전 지점 ok', async () => {
  const rows = await query('SELECT branch FROM ledger.v_check_branch_provisioning WHERE NOT ok');
  assert.deepEqual(rows, [], `프로비저닝이 반쪽인 지점이 남아 있다: ${JSON.stringify(rows)}`);
});
