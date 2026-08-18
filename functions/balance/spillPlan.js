/**
 * Pure logic, no Firestore dependency - extracted from index.html's withdrawAcrossBranches() so
 * the exact same spill-order arithmetic can be reused inside the new transactional debit path
 * (withdrawTransaction.js) and unit-tested in isolation. Not wired into the live app yet - see
 * docs/BALANCE_ARCHITECTURE_DESIGN.md.
 *
 * Draws `amount` out of `balances` (a {casino: number} map) starting with `casino`, spilling any
 * shortfall into the other known casinos in a fixed order (HANN, NUSTAR, ONLINE, minus whichever
 * was already tried first) - same behavior as the current withdrawAcrossBranches/hasSufficientTotalBalance
 * pair, just expressed as one pure function instead of a balance check + a separate mutating loop.
 */
const CASINO_ORDER = ["HANN", "NUSTAR", "ONLINE"];

function planSpill(balances, casino, amount) {
  const order = [casino, ...CASINO_ORDER.filter((c) => c !== casino)];
  let remaining = amount;
  const legs = [];
  for (const c of order) {
    if (remaining <= 0) break;
    const avail = (balances && balances[c]) || 0;
    const take = Math.min(avail, remaining);
    if (take <= 0) continue;
    legs.push({ casino: c, take });
    remaining -= take;
  }
  return { legs, remaining, sufficient: remaining <= 0 };
}

module.exports = { planSpill, CASINO_ORDER };
