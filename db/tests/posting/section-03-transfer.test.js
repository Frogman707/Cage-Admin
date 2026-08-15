// R-12-02 04 §3 계좌 간 이체 + R-12-21 통화 시드.
// op_transfer 는 pin 스텝업을 거부한다 — totp 를 쓴다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { query, uniq, asOwner, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openAccount, fundedAccount } from '../fixtures/members.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §3 계좌 간 이체 분개 집합', async () => {
  await withActor({}, async (client, ctx) => {
    const from = await fundedAccount(client, ctx, { amount: 100000 });
    const to = await openAccount(client, ctx);

    const transferToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
      uniq('xfer'),
      ctx.staffId,
      transferToken,
      ctx.device,
      ctx.branch,
      from,
      to,
      30000,
    ]);

    // 삼중항(종류·부호·범주)과 금액을 같은 entryRowsOf 결과에서 함께 본다 — 두 번 왕복하지
    // 않는다. 삼중항만 보면 요청한 30000 대신 ±300 이 찍혀도 I1(차대 균형)은 통과하고
    // 이 테스트도 통과해 버린다 — 그 구멍을 막는다.
    const stored = await entryRowsOf(client, rows[0].result);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['member_deposit', -1, 'transfer_in'],
        ['member_deposit', 1, 'transfer_out'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [-30000n, 30000n]
    );
  });
});

test('R-12-02 op_transfer 가 pin 스텝업을 거부한다', async () => {
  await withActor({}, async (client, ctx) => {
    const from = await openAccount(client, ctx);
    const to = await openAccount(client, ctx);

    const pinToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'pin',
    });
    await assert.rejects(
      () =>
        client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8)', [
          uniq('xfer'),
          ctx.staffId,
          pinToken,
          ctx.device,
          ctx.branch,
          from,
          to,
          1000,
        ]),
      { code: '42501', message: /requires step-up auth, got pin/ }
    );
  });
});

test('R-12-21 통화 5종이 시드되어 있고 KRW 는 scale = 0 이다', async () => {
  const rows = await query('SELECT code, scale FROM ledger.currencies ORDER BY code');
  assert.deepEqual(
    rows.map((r) => r.code),
    ['CNY', 'HKD', 'KRW', 'PHP', 'USD']
  );
  assert.equal(rows.find((r) => r.code === 'KRW').scale, 0);
});

// 실제로 시나리오가 도는 통화. 통화 -> 어느 테스트가 도는지.
// R-12-21 은 "통화 5종 **각각**에 대해 최소 한 시나리오" 를 요구한다 (12 §R-12-21).
// 시드 표만 보는 위 테스트로는 그 요구를 채우지 못한다 — DR-41 이 말하는
// "PHP만 통과하고 나머지가 비뚤어지는 사각" 이 그대로 남는다. 지금 도는 것은
// 아래 둘뿐이고, 나머지 셋은 계획 문서의 범위 밖 표에 적어 두었다.
const CURRENCIES_EXERCISED = new Map([
  ['PHP', '기본값. 이 하니스의 거의 모든 시나리오'],
  ['KRW', 'scale = 0. 아래 §3 KRW 이체 시나리오'],
]);

test('R-12-21 시나리오가 도는 통화와 안 도는 통화가 명시돼 있다', async () => {
  // 미달을 숨기지 않고 고정한다. 새 통화 시나리오가 생기면 이 테스트가 먼저
  // 실패해서 CURRENCIES_EXERCISED 를 갱신하게 만들고, 통화가 하나 더 시드되면
  // 그 통화가 자동으로 "안 도는" 쪽에 나타난다.
  const seeded = (await query('SELECT code FROM ledger.currencies ORDER BY code')).map((r) => r.code);
  const uncovered = seeded.filter((code) => !CURRENCIES_EXERCISED.has(code));
  assert.deepEqual(
    uncovered,
    ['CNY', 'HKD', 'USD'],
    'R-12-21 은 아직 부분 충족이다. 시나리오를 추가했으면 CURRENCIES_EXERCISED 에 올린다'
  );
});

// 하우스 계정 시드(003_accounts.sql:280-330)는 통화가 'PHP' 로 고정돼 있다 —
// 그 블록의 ⚠️ 주석이 "다른 통화 거래는 상대 하우스 계정이 없어 실패한다" 고
// 이미 적어 둔 M0 미결 사항이다. 확인한 사실: 준비 없이 KRW 로 입금하면
// P0002 `account not found: MAIN-HANN / house_cash / KRW` 로 거부된다.
// 그래서 상대 계정을 시드 블록과 같은 모양(debit · allow_negative=FALSE)으로 먼저
// 만든다. db/schema 는 건드리지 않는다 — 시드가 branches × currencies 곱집합으로
// 넓어지면 이 함수만 지우면 된다.
async function seedHouseAccount(branch, kind, currency) {
  await asOwner((client) =>
    client.query(
      `INSERT INTO ledger.accounts (party_id, kind, currency, normal_balance, allow_negative)
       SELECT p.id, $2::ledger.account_kind, $3, 'debit', FALSE
         FROM ledger.parties p
        WHERE p.code = 'MAIN-' || $1
       ON CONFLICT (party_id, kind, currency) DO NOTHING`,
      [branch, kind, currency]
    )
  );
}

test('R-12-21 · AC-12-2 04 §3 KRW(scale = 0) 이체 — 기본값 아닌 통화 경로', async () => {
  // openAccount · fundedAccount 의 currency 옵션은 여기 전까지 아무 테스트도
  // 기본값 말고는 넘긴 적이 없다 (harness-contract.md "Unproven path").
  // KRW 는 scale = 0 이라 amount_minor 가 원 단위 그대로다 — 30000 은 3만 원이지
  // 300원이 아니다. 스키마는 ledger.currencies.scale 을 **읽는 곳이 없다**
  // (선언값일 뿐이다) — 그래서 자릿수 때문에 걸리는 제약은 없고, 아래 금액
  // 단언이 그 사실을 그대로 고정한다.
  await seedHouseAccount('HANN', 'house_cash', 'KRW');

  await withActor({ branches: ['HANN'] }, async (client, ctx) => {
    const from = await fundedAccount(client, ctx, { amount: 100000, currency: 'KRW' });
    const to = await openAccount(client, ctx, { currency: 'KRW' });

    const transferToken = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.transfer',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_transfer($1, $2, $3, $4, $5, $6, $7, $8, $9) AS result', [
      uniq('xfer-krw'),
      ctx.staffId,
      transferToken,
      ctx.device,
      ctx.branch,
      from,
      to,
      30000,
      'KRW',
    ]);

    const stored = await entryRowsOf(client, rows[0].result);
    assert.deepEqual(
      stored.map((r) => [r.account_kind, r.sign, r.category]),
      [
        ['member_deposit', -1, 'transfer_in'],
        ['member_deposit', 1, 'transfer_out'],
      ]
    );
    assert.deepEqual(
      stored.map((r) => r.amount_minor),
      [-30000n, 30000n]
    );

    // 분개가 실제로 KRW 계정에 붙었는지 본다. op_transfer 는 통화까지 포함해
    // 계정을 찾으므로(account_id_of(code, kind, currency)) PHP 계정에 잘못
    // 실렸다면 애초에 P0002 로 죽었겠지만, 그 추론에 기대지 않고 확인한다.
    const { rows: currencies } = await client.query(
      `SELECT DISTINCT a.currency
         FROM ledger.entries e
         JOIN ledger.transactions t ON t.id = e.transaction_id
         JOIN ledger.accounts a ON a.id = e.account_id
        WHERE t.external_id = $1`,
      [rows[0].result.transaction.external_id]
    );
    assert.deepEqual(
      currencies.map((r) => r.currency),
      ['KRW']
    );
  });
});
