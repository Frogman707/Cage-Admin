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
      // 같다. entries.mjs 의 ORDER BY 는 e.id 를 마지막 키로 더해 "같은
      // 조회를 두 번 돌리면 같은 순서가 나온다"는 결정적 읽기 순서를
      // 보장한다 — 이는 참이다. 하지만 그 e.id 자체가 어느 논리적 다리(바이인
      // 다리 vs 워킹칩 다리)에 배정되는지는 보장하지 않는다: ledger.post_transaction
      // 의 분개 INSERT (008_post_transaction.sql:443-459)가
      // `INSERT ... SELECT ... FROM jsonb_array_elements(p_entries) e JOIN ...`
      // 형태로 WITH ORDINALITY 도 ORDER BY 도 없이 짜여 있어, JSON 배열 순서와
      // 실행 계획이 고른 삽입 순서가 같다는 보장이 없다 — 이 테스트의 RED 단계
      // 실측에서 실제로 배열 역순(-100000 이 -500000 보다 먼저)이 나왔다.
      // 그래서 두 행만 금액을 정렬해 비교한다. 정보 손실은 없다 — 두 다리는
      // 같은 계정(chips_account_id)에 같은 category·sign 으로 찍히므로, 어느
      // 물리적 행이 어느 금액을 받았는지는 관측 가능한 상태가 아니다. 반면
      // 금액 자체(−500000, −100000 이라는 사실)와 나머지 두 행의 위치는
      // 여전히 정확히 검사한다 — 다리가 뒤섞이는 결함(예: 바이인에 워킹칩
      // 금액이 찍히는 회귀)은 이 비교로도 잡힌다.
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

      // 전역 count(*) 비교는 --test-concurrency=1(package.json)에 기대는
      // 것이라 파일 동시성이 올라가면 깨진다. 대신 이 호출이 만든
      // rolling_events 행 자체를 키로 찾아 transaction_id 가 NULL 인지
      // 본다 — 같은 사실을 더 직접적으로, 동시성에 안전하게 확인한다
      // (010_operations_game.sql:334-338).
      const token = await ctx.stepUp('game.rolling');
      const { rows } = await client.query('SELECT cage.op_record_rolling($1, $2, $3, $4, $5, $6) AS result', [
        uniq('roll'),
        ctx.staffId,
        token,
        ctx.device,
        gameNo,
        300000,
      ]);
      const rollingEventId = rows[0].result.rolling_event_id;

      const { rows: ev } = await client.query('SELECT transaction_id FROM cage.rolling_events WHERE id = $1', [
        rollingEventId,
      ]);
      assert.equal(ev[0].transaction_id, null, '롤링 입력은 자금 이동이 아니다 (04 §6)');
    }
  );
});
