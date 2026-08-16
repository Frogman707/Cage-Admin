// 지점 픽스처 (R-12-20).
//
// ledger.branches 에 직접 INSERT 하지 않는다. 그러면 branch_config ·
// chain_heads · 하우스 주체 · 하우스 계정이 빠진 반쪽 지점이 남고,
// 그 지점을 쓰는 테스트는 "첫 거래에서 터지는" 결함을 재현하게 된다.
// 반쪽 지점을 일부러 만드는 것은 그 자체가 검사 대상인 테스트뿐이다
// (db/tests/golden/spec-01-branch.test.js 의 AC-60-2 케이스).
//
// 소유자 커넥션으로 만들고 커밋한다. provision_branch 의 EXECUTE 는
// ledger_migrator 에만 있고 ledger_app 에는 없다 — 자금 레인이 지점을 만들 수
// 있으면 자기 거래의 상대 계정을 스스로 지어낼 수 있다 (012).
import { asOwner, uniq } from '../helpers/db.mjs';

// branches_code_format: ^[A-Z][A-Z0-9_-]{1,15}$ — 대문자 시작, 총 2~16자.
export function branchCode(prefix) {
  return `${prefix}${uniq('')}`.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16);
}

export async function provisionBranch({
  prefix = 'T',
  name,
  openedOn = '2026-01-01',
  // DR-39: 임계는 반드시 정한다. 끄려면 BIGINT 최댓값을 넣는다 — 0 이나 NULL 로
  // 끄면 "끄기로 했다" 가 데이터에 남지 않는다.
  approvalThresholdMinor = 50000000,
  isOnline = false,
  timezone = 'Asia/Manila',
  cutoffTime = '06:00',
} = {}) {
  const code = branchCode(prefix);
  await asOwner((client) =>
    client.query('SELECT ledger.provision_branch($1, $2, $3, $4, $5, $6, $7)', [
      code,
      name ?? `TEST ${code}`,
      openedOn,
      approvalThresholdMinor,
      isOnline,
      timezone,
      cutoffTime,
    ])
  );
  return code;
}
