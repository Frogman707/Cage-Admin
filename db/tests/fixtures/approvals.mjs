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
//  4. approvers 수가 required_count(기본 2) 보다 적으면 op_cast_vote 는 매번
//     정상 응답하지만 승인은 pending 인 채로 남는다 — 그 결과 approve() 가
//     "소비 가능한 승인 id" 라며 돌려준 id 가 사실은 아직 소비할 수 없다.
//     실패는 그 approvalId 를 실제로 쓰는 op_* 안의 consume_approval() 에서야
//     터진다. 이 픽스처의 잘못이 다른 함수의 실패로 위장하는 셈이라, op_cast_vote
//     가 돌려주는 ready 플래그(011_operations_admin.sql)를 여기서 직접 본다.
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

  let lastVote = null;
  for (const staffId of approvers) {
    const tokenId = await issueStepUp({ staffId, deviceId, scope: 'approval.vote', method: 'totp' });
    const { rows: voteRows } = await client.query('SELECT identity.op_cast_vote($1, $2, $3, $4, $5) AS result', [
      staffId,
      approvalId,
      'approve',
      tokenId,
      deviceId,
    ]);
    lastVote = voteRows[0].result;
  }

  if (!lastVote?.ready) {
    const got = lastVote ? `${lastVote.approve_votes}/${lastVote.required_count}` : '0표 (approvers 가 비어 있다)';
    throw new Error(
      `approval ${approvalId} 은 아직 소비 가능한 상태가 아니다 (${got}) — approvers 수가 required_count 보다 적다`
    );
  }

  return approvalId;
}
