/**
 * Prototype of the transactional cage-withdrawal debit under the new maintained-balance design
 * (docs/BALANCE_ARCHITECTURE_DESIGN.md, mechanism (b)). NOT wired into the live app - index.html
 * still uses the old derive-by-summing-the-full-ledger path. This module exists to be exercised by
 * ../../test/balance-emulator.test.js against the real Firestore emulator, proving the atomicity
 * claim the design doc makes before any of this touches production.
 *
 * Written against the modular Firestore client SDK (firebase/firestore) because that's what
 * @firebase/rules-unit-testing hands back for emulator tests. index.html/partner-admin/app.js use
 * the older compat SDK (firebase.firestore(), db.runTransaction(tx=>...)) - porting this logic
 * there later is a mechanical translation (tx.get/tx.set keep the same shape; FieldValue.increment
 * becomes firebase.firestore.FieldValue.increment), not a design change.
 *
 * Balance doc shape: balanceTotals/acct_{accountId} = { balances: { HANN, NUSTAR, ONLINE } }
 * (same map shape for guest and MAIN accounts - see docs/BALANCE_ARCHITECTURE_DESIGN.md for why).
 */
const { doc, runTransaction, getDoc, setDoc, increment, serverTimestamp } = require("firebase/firestore");
const { planSpill } = require("./spillPlan.js");

function newLedgerId(rand) {
  const r = rand || Math.random;
  return "ldg_" + Date.now() + "_" + r().toString(36).slice(2, 9);
}

class InsufficientBalanceError extends Error {
  constructor(shortBy) {
    super("INSUFFICIENT_BALANCE");
    this.shortBy = shortBy;
  }
}

/**
 * Atomically checks and debits `amount` from account `accountId`, drawing first from `casino`
 * and spilling into the other casinos if needed (mirrors withdrawAcrossBranches/hasSufficientTotalBalance
 * in index.html today). Writes one `ledger` OUT entry per casino actually drawn from, plus a single
 * FieldValue.increment(-take) per casino on the balanceTotals doc, all inside one transaction.
 *
 * This is what closes the race: two concurrent calls against the same account both start by
 * reading balanceTotals/acct_{accountId} inside their own transaction. Firestore guarantees that if
 * transaction A commits a write to that document, transaction B - having read the pre-A version -
 * fails its commit and is automatically retried by the SDK, re-reading the now-A-adjusted balance
 * before B's insufficient-funds check runs again. Two withdrawals that together exceed the real
 * balance can never both succeed, regardless of how close together they were submitted.
 */
async function withdrawFromAccount(db, { accountId, casino, amount, staff, memo }) {
  if (!(amount > 0)) throw new Error("amount must be positive");
  const balRef = doc(db, "balanceTotals", "acct_" + accountId);
  return runTransaction(db, async (tx) => {
    const balSnap = await tx.get(balRef);
    const balances = (balSnap.exists() && balSnap.data().balances) || {};
    const plan = planSpill(balances, casino, amount);
    if (!plan.sufficient) throw new InsufficientBalanceError(plan.remaining);

    const balanceUpdate = { balances: {}, updatedAt: serverTimestamp() };
    plan.legs.forEach((leg) => {
      const ledgerId = newLedgerId();
      tx.set(doc(db, "ledger", ledgerId), {
        id: ledgerId,
        accountId,
        casino: leg.casino,
        type: "OUT",
        inn: 0,
        out: leg.take,
        staff,
        memo: memo || "",
        createdAt: serverTimestamp(),
      });
      balanceUpdate.balances[leg.casino] = increment(-leg.take);
    });
    tx.set(balRef, balanceUpdate, { merge: true });
    return plan;
  });
}

/** Pure credit (deposit) - no read-then-check needed, so a transaction isn't required for
 * correctness, but it's used anyway to keep the ledger write and the balance increment atomic as a
 * pair (a partial failure must not leave one without the other). */
async function depositToAccount(db, { accountId, casino, amount, staff, memo }) {
  if (!(amount > 0)) throw new Error("amount must be positive");
  const balRef = doc(db, "balanceTotals", "acct_" + accountId);
  const ledgerId = newLedgerId();
  return runTransaction(db, async (tx) => {
    tx.set(doc(db, "ledger", ledgerId), {
      id: ledgerId,
      accountId,
      casino,
      type: "IN",
      inn: amount,
      out: 0,
      staff,
      memo: memo || "",
      createdAt: serverTimestamp(),
    });
    tx.set(balRef, { balances: { [casino]: increment(amount) }, updatedAt: serverTimestamp() }, { merge: true });
  });
}

async function readAccountBalances(db, accountId) {
  const snap = await getDoc(doc(db, "balanceTotals", "acct_" + accountId));
  return (snap.exists() && snap.data().balances) || {};
}

module.exports = { withdrawFromAccount, depositToAccount, readAccountBalances, InsufficientBalanceError, newLedgerId, setDoc };
