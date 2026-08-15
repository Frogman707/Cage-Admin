// 4-eyes 승인 픽스처.
//
// identity.approvals · approval_votes 에 직접 INSERT 하지 않는다.
// identity.op_request_approval() + op_cast_vote() 를 거친다 — 실제 승인 경로를
// 우회하는 픽스처는 그 경로가 망가져도 알려주지 못한다.
// (db/README.md 가 provision_branch 우회를 금지한 것과 같은 이유다.)
//
// 반드시 지켜야 소비된다:
//  1. payload 가 op_* 내부의 v_args 와 **정확히 같아야** 한다. 키 하나만 달라도
//     approval N payload does not match the request being executed 로 거부된다.
//  2. 요청자는 자기 요청에 투표할 수 없다. required_count 가 기본 2 이므로
//     요청자 1 + 승인자 2 = 직원 3명이 필요하다.
//  3. 투표에도 스텝업이 필요하다. scope 는 'approval.vote' 다.
import { issueStepUp } from './actors.mjs';

export async function approve(client, { actor, approvers, branch, subjectKind, subjectRef, payload, deviceId }) {
  if (approvers.includes(actor)) {
    throw new Error('요청자는 승인자가 될 수 없다 — 픽스처가 four-eyes 를 우회하려 한다');
  }

  const { rows } = await client.query('SELECT identity.op_request_approval($1, $2, $3, $4, $5) AS result', [
    actor,
    branch,
    subjectKind,
    subjectRef,
    payload,
  ]);
  const approvalId = Number(rows[0].result.approval_id);

  for (const staffId of approvers) {
    const tokenId = await issueStepUp({ staffId, deviceId, scope: 'approval.vote', method: 'totp' });
    await client.query('SELECT identity.op_cast_vote($1, $2, $3, $4, $5)', [
      staffId,
      approvalId,
      'approve',
      tokenId,
      deviceId,
    ]);
  }
  return approvalId;
}
