// 픽스처는 소유자 커넥션으로, op_* 호출은 앱 역할 커넥션으로 돈다.
// 커넥션이 다르므로 두 트랜잭션이다. 전부 커밋하는 구조라 문제되지 않는다.
//
// 이 래퍼를 거치지 않고 소유자로 op_* 를 부르면 GRANT EXECUTE 누락 ·
// 지점 격리 실패가 전부 통과한다. 검사할 경계 바깥에서 검사하는 셈이다.
//
// **커밋 경계 규칙.** `asActor` 콜백 하나가 앱 트랜잭션 하나다. 그 안에서 op_* 가
// 만든 행은 콜백이 끝나 COMMIT 될 때까지 **다른 커넥션에서 보이지 않는다.**
// 그래서 op_* 가 만든 행을 소유자 커넥션(`asOwner` 픽스처)이 읽거나 고쳐야 하면
// `asActor` 를 두 번 부른다 — 한 콜백 안에서 섞으면 픽스처의 UPDATE 가
// 0행을 치고 조용히 지나간다 (§6-1 커미션 요율 스냅샷이 그 경우다).
import { asOwner, asStaff, asMigrator, uniq, uniqCode } from '../helpers/db.mjs';
import { createStaff } from './actors.mjs';

// 액터만 만든다. 소유자 트랜잭션 하나로 끝나고 커밋된다.
// as: 'app'(기본) 또는 'migrator'. §14 만 migrator 를 쓴다 —
// ledger.op_load_opening_balance 의 EXECUTE 가 ledger_migrator 에만 있다.
export async function createActor({ branches = ['HANN'], roles = ['cage_manager'], setup, as = 'app' } = {}) {
  return asOwner(async (client) => {
    const staffId = await createStaff(client, { code: uniqCode('T-MGR'), branches, roles });
    // setup 은 이 asOwner 트랜잭션이 커밋되기 **전에** 돈다 — staffId 는 아직
    // 이 커넥션 밖에서 보이지 않는다. issueStepUp·approve 는 별도 커넥션에서
    // 즉시 커밋하므로, 여기서 부르면 staffId 가 안 보여
    // step_up_tokens_staff_id_fkey 위반으로 거부된다(actors.mjs 의 issueStepUp
    // 참고). setup 은 커밋을 필요로 하지 않는 픽스처(계좌 개설 등)에만 쓴다.
    const extra = setup ? await setup(client, { staffId }) : {};
    return { staffId, device: uniq('dev'), branch: branches[0], as, ...extra };
  });
}

// 이미 만든 액터로 앱(또는 migrator) 트랜잭션을 **하나** 연다. 끝에서 COMMIT 한다.
// 커밋 경계를 넘겨야 하면 같은 ctx 로 여러 번 부른다.
export async function asActor(ctx, act) {
  const run = ctx.as === 'migrator' ? asMigrator : asStaff;
  return run(ctx.staffId, (client) => act(client, ctx));
}

// 액터 생성 + 앱 트랜잭션 하나. 커밋 경계를 나눌 필요가 없는 대다수 테스트용.
export async function withActor(opts = {}, act) {
  return asActor(await createActor(opts), act);
}
