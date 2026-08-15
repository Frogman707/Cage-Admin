// R-12-05 · AC-12-5 — 매 실행 끝에 두 드리프트 뷰가 0행이어야 한다.
// 한쪽에서 닫고 다른 쪽에서 기본값으로 다시 열리는 병(DR-24)을 잡는 유일한 검사다.
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
