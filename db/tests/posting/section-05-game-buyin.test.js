// R-12-02 04 §5 게임 시작 · 바이인 추가 — cage.op_open_game · cage.op_add_buyin.
//   현금 바이인:  house_cash +buyin_cash / chips_outstanding −chips_issue
//   워킹칩 지급:  promo_expense +working_chip_issue / chips_outstanding −chips_issue
//
// game_no 와 member 코드는 둘 다 대문자 전용 CHECK 제약이 걸려 있다
// (cage.games.games_no_format · ledger.parties.parties_code_format) —
// uniq() 가 아니라 uniqCode() 로 만든다.
//
// 삼중항과 금액을 같은 entryRowsOf 결과에서 함께 본다(harness-contract.md 의
// 금액 단언 룰링) — 두 번 왕복하지 않는다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { uniq, uniqCode, closePool } from '../helpers/db.mjs';
import { createMember } from '../fixtures/members.mjs';
import { withActor } from '../fixtures/scenario.mjs';
import { openGame } from '../fixtures/games.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('R-12-02 · AC-12-2 04 §5 게임 개설 분개 집합 (현금 + 워킹칩)', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      const result = await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 100000 });

      const stored = await entryRowsOf(client, result);
      assert.deepEqual(
        stored.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['chips_outstanding', -1, 'chips_issue'],
          ['chips_outstanding', -1, 'chips_issue'],
          ['house_cash', 1, 'buyin_cash'],
          ['promo_expense', 1, 'working_chip_issue'],
        ]
      );
      // 앞의 두 chips_outstanding 행은 (kind, category, sign) 삼중항이 완전히
      // 같아 e.id 순서가 보장되지 않는다 (entries.mjs 의 ORDER BY 주석 참고;
      // 실측으로도 확인했다). 그 둘만 정렬해 비교하고, kind 로 이미 구분되는
      // 나머지 두 행은 위치 그대로 비교한다.
      const [chipA, chipB, houseCash, promoExpense] = stored;
      assert.deepEqual(
        [chipA.amount_minor, chipB.amount_minor].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
        [-500000n, -100000n]
      );
      assert.equal(houseCash.amount_minor, 500000n);
      assert.equal(promoExpense.amount_minor, 100000n);
    }
  );
});

test('R-12-02 04 §5 추가 바이인이 같은 분개를 낸다', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member, buyin: 500000, workingChip: 0 });

      const token = await ctx.stepUp('game.buyin');
      const { rows } = await client.query('SELECT cage.op_add_buyin($1, $2, $3, $4, $5, $6, $7, $8) AS result', [
        uniq('buyin'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        'cash',
        200000,
        0,
      ]);

      const stored = await entryRowsOf(client, rows[0].result);
      assert.deepEqual(
        stored.map((r) => [r.account_kind, r.sign, r.category]),
        [
          ['chips_outstanding', -1, 'chips_issue'],
          ['house_cash', 1, 'buyin_cash'],
        ]
      );
      assert.deepEqual(
        stored.map((r) => r.amount_minor),
        [-200000n, 200000n]
      );
    }
  );
});

test('R-12-02 04 §6 롤링 입력은 원장 거래를 만들지 않는다', async () => {
  const member = uniqCode('TEST-MEM');
  const gameNo = uniqCode('G');
  await withActor(
    { setup: (client) => createMember(client, { code: member, branch: 'HANN' }) },
    async (client, ctx) => {
      await openGame(client, ctx, { gameNo, member });

      const before = await client.query('SELECT count(*)::int AS n FROM ledger.transactions');
      const token = await ctx.stepUp('game.rolling');
      await client.query('SELECT cage.op_record_rolling($1, $2, $3, $4, $5, $6)', [
        uniq('roll'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        300000,
      ]);
      const after_ = await client.query('SELECT count(*)::int AS n FROM ledger.transactions');

      assert.equal(after_.rows[0].n, before.rows[0].n, '롤링 입력은 자금 이동이 아니다 (04 §6)');
    }
  );
});
