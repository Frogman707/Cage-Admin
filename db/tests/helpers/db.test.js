// 하니스 자체에 대한 배선 테스트 — 픽스처 없음, 커버리지 드라이브 아님.
// appPool/identityPool/migratorPool/asOwner/asStaff 가 실제로 의도한 로그인 역할로
// 붙는다는 것과, app.staff_id 가 트랜잭션 밖으로 새지 않는다는 것을 고정한다.
// 여기서 깨지면(PGAPPUSER 오타, GRANT 누락, COMMIT/ROLLBACK 반전, 액터 컨텍스트 누수)
// Task 2 이후에서 무관해 보이는 실패로 나타난다.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appPool, identityPool, migratorPool, asOwner, asStaff, closePool } from './db.mjs';

after(closePool);

test('역할 배선 — 각 풀이 의도한 로그인 역할로 붙는다', async () => {
  const app = await appPool.query('SELECT current_user');
  assert.equal(app.rows[0].current_user, 'cage_test_app');

  const identity = await identityPool.query('SELECT current_user');
  assert.equal(identity.rows[0].current_user, 'cage_test_identity');

  const migrator = await migratorPool.query('SELECT current_user');
  assert.equal(migrator.rows[0].current_user, 'cage_test_migrator');

  const owner = await asOwner(async (client) => {
    const { rows } = await client.query('SELECT current_user');
    return rows[0].current_user;
  });
  assert.equal(owner, 'postgres');
});

test('app.staff_id 는 트랜잭션 안에서만 보이고 풀에 남지 않는다', async () => {
  // 존재할 필요 없는 staffId 다 — GUC 왕복을 확인하는 것이지 액터가 조회되는지를
  // 확인하는 게 아니다.
  const staffId = 999999;

  const seenInside = await asStaff(staffId, async (client) => {
    const { rows } = await client.query('SELECT current_setting($1) AS v', ['app.staff_id']);
    return rows[0].v;
  });
  assert.equal(seenInside, String(staffId));

  const { rows } = await appPool.query("SELECT current_setting('app.staff_id', true) AS v");
  assert.ok(
    rows[0].v === null || rows[0].v === '',
    `app.staff_id 가 트랜잭션 밖으로 새어 나왔다: ${JSON.stringify(rows[0].v)}`
  );
});
