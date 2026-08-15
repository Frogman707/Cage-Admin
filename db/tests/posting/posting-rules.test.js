// R-12-13 — ledger.tx_kind 전수 대비 posting_rules 고아 검사.
// 목록에 없는 새 고아가 생기면 실패한다. 규칙이 생겨서 목록이 남아도 실패한다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, closePool } from '../helpers/db.mjs';

after(closePool);

// 규칙 없음이 의도인 tx_kind. kind -> 사유. 사유 없이는 이 목록에 올리지 않는다.
// 현재는 비어 있다 — 실측 결과 tx_kind 24종 전부가 posting_rules 행을 갖는다.
// bet · payout · share_accrue · share_settle 도 규칙은 있고 op 함수만 없다.
// 따라서 이 목록에 무엇이든 추가되는 순간이 회귀다.
const KNOWN_RULELESS = new Map();

test('R-12-13 posting_rules 고아 tx_kind 가 허용목록과 정확히 일치한다', async () => {
  const rows = await query(`
    SELECT k.kind::text AS kind
      FROM unnest(enum_range(NULL::ledger.tx_kind)) AS k(kind)
     WHERE NOT EXISTS (SELECT 1 FROM ledger.posting_rules r WHERE r.kind = k.kind)
     ORDER BY 1
  `);
  const actual = rows.map((r) => r.kind).sort();
  const allowed = [...KNOWN_RULELESS.keys()].sort();
  const reasons = allowed.map((kind) => `  ${kind}: ${KNOWN_RULELESS.get(kind)}`).join('\n');
  assert.deepEqual(
    actual,
    allowed,
    '규칙 없는 tx_kind 가 바뀌었다. 새로 생겼으면 규칙을 넣거나 허용목록에 사유를 적는다. ' +
      '허용목록에만 있으면 규칙이 생긴 것이므로 목록에서 지운다.\n' +
      `허용목록 현재 사유:\n${reasons || '  (비어 있음)'}`
  );
});

test('R-12-02 posting_rules 의 sign 이 −1 또는 1 뿐이다', async () => {
  const rows = await query('SELECT DISTINCT sign FROM ledger.posting_rules ORDER BY 1');
  assert.deepEqual(
    rows.map((r) => r.sign),
    [-1, 1]
  );
});
