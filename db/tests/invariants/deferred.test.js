// 이 파일이 지키는 것:
//   1. 지연 제약 트리거가 실재하고 DEFERRABLE INITIALLY DEFERRED 다 (하니스의 전제)
//   2. R-01-52 · AC-59-3 — SET CONSTRAINTS ALL IMMEDIATE 후 다중 분개 거래가
//      의도대로 실패한다. R-01-50 금지의 반대편 짝이다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { expectCommitFailure, withRollback, query, uniq, closePool } from '../helpers/db.mjs';
import { issueStepUp } from '../fixtures/actors.mjs';
import { createActor, withActor } from '../fixtures/scenario.mjs';
import { openAccount } from '../fixtures/members.mjs';
import { entryRowsOf } from '../helpers/entries.mjs';

after(closePool);

test('지연 제약 트리거가 전부 DEFERRABLE INITIALLY DEFERRED 다', async () => {
  // tgdeferrable = 지연 가능, tginitdeferred = 기본이 지연.
  // 하나라도 즉시 제약으로 바뀌면 다중 분개 거래가 첫 분개에서 깨진다 (R-01-50).
  const rows = await query(`
    SELECT n.nspname || '.' || c.relname AS table_name, t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('ledger', 'cage') AND t.tgconstraint <> 0 AND NOT t.tgisinternal
       AND NOT (t.tgdeferrable AND t.tginitdeferred)
     ORDER BY 1, 2`);
  assert.deepEqual(rows, [], `즉시 제약으로 바뀐 트리거가 있다: ${JSON.stringify(rows)}`);
});

test('지연 제약 트리거가 4개 이상 실재한다', async () => {
  const rows = await query(`
    SELECT count(*)::int AS n
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('ledger', 'cage') AND t.tgconstraint <> 0 AND NOT t.tgisinternal`);
  assert.ok(rows[0].n >= 4, `지연 제약 트리거가 ${rows[0].n} 개다. 사라졌다면 하니스가 무의미해진다`);
});

test('R-01-52 · AC-59-3 SET CONSTRAINTS ALL IMMEDIATE 후 다중 분개 거래가 실패한다', async () => {
  // 이것이 R-01-50 이 금지하는 이유다. 봉인 트리거(transactions_sealed)는
  // `AFTER INSERT ON ledger.transactions` 다 — entries 가 아니라 거래 행 자체의
  // INSERT 직후에 돈다(004_ledger.sql:559-562). IMMEDIATE 아래에서는 그 INSERT
  // 문이 끝나자마자 발화하므로, 그 시점엔 entries 가 아직 하나도 삽입되지 않았고
  // 해시도 계산되지 않았다 — 해시는 entries 를 다 넣은 뒤에야 계산된다
  // (008_post_transaction.sql:483-499). 그래서 IMMEDIATE 아래에서는 항상,
  // 예외 없이 미봉인으로 걸린다.
  //
  // 이 테스트는 다른 모든 expectCommitFailure 사용과 정반대 모양이다. 정상
  // 사용에서는 fn(호출) 이 성공하고 COMMIT 만 실패해야 "지연 제약" 이 증명된다
  // (§2·§8 이 그 모양이다). 여기서는 그 반대 — 잘못된 상태 — 를 증명한다:
  // SET CONSTRAINTS ALL IMMEDIATE 뒤에는 op_deposit 호출 **자체**가 트랜잭션
  // 중간에 죽는다. expectCommitFailure 는 fn 이 던진 오류를 삼키지 않으므로
  // (하니스 계약 참고) 그 실패는 expectCommitFailure 호출 전체의 reject 로 그대로
  // 올라온다 — 아래에서 err.code 가 존재하는 것 자체가 증거다: COMMIT 실패를
  // 감싼 wrapper Error(new Error(...), .code 없음)가 아니라 fn 안에서 던져진
  // 원본 pg 오류(.code === '23000')가 그대로 전파됐다는 뜻이고, 그것이 곧
  // "COMMIT 이 아니라 그 전에 죽었다"는 뜻이다.
  const ctx = await createActor({ branches: ['HANN'], roles: ['cage_manager'] });

  await assert.rejects(
    () =>
      expectCommitFailure(
        '23000',
        async (client) => {
          const acct = await openAccount(client, ctx);
          const token = await issueStepUp({
            staffId: ctx.staffId,
            deviceId: ctx.device,
            scope: 'ledger.deposit',
            method: 'totp',
          });

          // 여기가 금지된 구문이다. 이 하니스 전체에서 이 테스트 하나에서만 쓴다
          // — R-01-50 금지가 존재하는 이유를 증명하기 위한 유일한 사용처다.
          // 다른 어떤 테스트도 이 구문을 써서는 안 된다.
          await client.query('SET CONSTRAINTS ALL IMMEDIATE');

          await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7)', [
            uniq('dep'),
            ctx.staffId,
            token,
            ctx.device,
            ctx.branch,
            acct,
            1000,
          ]);
        },
        { staffId: ctx.staffId }
      ),
    (err) => {
      assert.equal(err.code, '23000');
      assert.match(err.message, /was never sealed/);
      return true;
    }
  );
});

test('정상 경로는 SET CONSTRAINTS 없이 커밋된다', async () => {
  // R-01-52 와 같은 호출 순서(계좌 개설 → 스텝업 → 입금)를 SET CONSTRAINTS 없이
  // 돌린다 — 위 실패가 그 구문 때문이지 다른 어떤 구조적 결함 때문이 아니라는
  // 대조군이다. fundedAccount 를 쓰지 않고 op_deposit 을 직접 불러 결과를
  // 잡는다 — 반환된 external_id 로 아래에서 실제 저장된 행을 다시 찾기 위해서다.
  const { staffId, result } = await withActor({}, async (client, ctx) => {
    const acct = await openAccount(client, ctx);
    const token = await issueStepUp({
      staffId: ctx.staffId,
      deviceId: ctx.device,
      scope: 'ledger.deposit',
      method: 'totp',
    });
    const { rows } = await client.query('SELECT ledger.op_deposit($1, $2, $3, $4, $5, $6, $7) AS result', [
      uniq('dep'),
      ctx.staffId,
      token,
      ctx.device,
      ctx.branch,
      acct,
      1000,
    ]);
    return { staffId: ctx.staffId, result: rows[0].result };
  });

  // 계좌 코드 문자열 같은 상수를 assert.ok 하면 절대 실패할 수 없는 단언이 되어
  // 이 테스트의 진짜 내용(입금이 실제로 커밋됐다)을 아무것도 증명하지 못한다.
  // 커밋된 분개를 앱 역할로 다시 읽어 두 다리가 실제로 기록됐음을 본다 — 순수
  // 조회라 withRollback 을 쓴다.
  const rows = await withRollback((client) => entryRowsOf(client, result), { staffId });
  assert.deepEqual(
    rows.map((r) => [r.account_kind, r.sign, r.category]),
    [
      ['house_cash', 1, 'deposit_cash'],
      ['member_deposit', -1, 'deposit_cash'],
    ]
  );
  assert.deepEqual(
    rows.map((r) => r.amount_minor),
    [1000n, -1000n]
  );
});
