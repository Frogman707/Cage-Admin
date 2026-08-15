// 테스트 전용 행위자. 개인정보·실계좌 값을 쓰지 않는다 (R-12-23).
// 직원 코드는 T- 로 시작한다. pin_hash 는 NOT NULL 이라 합성 문자열을 넣는다 —
// DB 는 형식을 강제하지 않고, 애플리케이션이 Argon2id 로 해시해 넣는 자리다.
import { asOwner } from '../helpers/db.mjs';

const FIXTURE_PIN_HASH = '$argon2id$test-fixture-not-a-real-hash';

// branches 는 배열이다. cage.op_branch_transfer 는 보내는 지점과 받는 지점 양쪽에
// 배정된 직원을 요구한다 — 한쪽만 주면 staff N is not assigned to branch X 로 거부된다.
// app.staff_id 기반 RLS 도 이 표를 읽는다 (ledger.current_branches()).
export async function createStaff(client, { code, branches, roles = ['cage_operator'] }) {
  // identity.staff.code 는 대문자만 허용한다 (staff_code_format 체크 제약, 002).
  // uniq() 의 실행 토큰은 base36 이라 소문자가 섞인다 — 여기서 정규화한다.
  const staffCode = code.toUpperCase();
  const { rows } = await client.query(
    `INSERT INTO identity.staff (code, name, principal_type, status, pin_hash)
     VALUES ($1, $2, 'cage_staff', 'active', $3)
     RETURNING id`,
    [staffCode, `TEST ${staffCode}`, FIXTURE_PIN_HASH]
  );
  const staffId = rows[0].id;

  for (const branch of branches) {
    await client.query('INSERT INTO identity.staff_branches (staff_id, branch) VALUES ($1, $2)', [staffId, branch]);
  }
  for (const role of roles) {
    await client.query('INSERT INTO identity.staff_roles (staff_id, role_code) VALUES ($1, $2)', [staffId, role]);
  }
  return staffId;
}

// 스텝업 토큰은 1회용이다. op_* 호출 하나에 토큰 하나를 발급한다.
// op_transfer 처럼 pin 을 거부하는 연산이 있으므로 method 를 호출부가 정한다.
//
// **호출부의 client 를 받지 않는다.** 발급은 소유자 레인에서 별도 트랜잭션으로
// 커밋한다. 두 가지 이유다:
//
//  1. 자금 레인(cage_test_app = ledger_app)은 step_up_tokens 에 INSERT 권한이
//     없다. 있으면 안 된다 — 그게 DR-03 이다. 호출부 client 로 INSERT 하면
//     테스트 역할에 identity_app 을 얹어야 하고, 그 순간 자금 경로가 자기
//     재인증 근거를 만들어 낼 수 있게 되어 경계가 테스트에서 사라진다.
//  2. identity_app 으로도 못 한다. 그 역할은 INSERT 는 되지만 SELECT 가 없어
//     `INSERT ... RETURNING id` 가 거부된다. 확인한 사실이다:
//       permission denied for table step_up_tokens
//     (RETURNING 없는 INSERT 는 같은 역할로 통과한다 — 막는 것은 RETURNING 이다.)
//
// 별도 트랜잭션이라도 문제없다. 토큰은 op_* 호출 **전에** 커밋되므로 뒤이은
// 자금 트랜잭션에서 보인다. consume_step_up 의 소비는 그 트랜잭션 안에서 일어나
// 롤백하면 함께 되돌아간다.
export async function issueStepUp({ staffId, deviceId, scope, method = 'pin' }) {
  return asOwner(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO identity.step_up_tokens (staff_id, method, device_id, scope, expires_at)
       VALUES ($1, $2, $3, $4, clock_timestamp() + interval '30 minutes')
       RETURNING id`,
      [staffId, method, deviceId, scope]
    );
    return rows[0].id;
  });
}

export { createMember } from './members.mjs';
