/**
 * Prototype safety-net job for docs/BALANCE_ARCHITECTURE_DESIGN.md. NOT exported from
 * functions/index.js, so firebase-tools' deploy discovery (which finds exports by their trigger
 * metadata - see the __test__ comment in index.js) will not deploy this until a human wires it up
 * after reviewing the design doc.
 *
 * Deliberately a scheduled (onSchedule / Cloud Scheduler) job, not a per-write onDocumentCreated
 * Firestore trigger - see "Mechanism" in the design doc for why: a per-write trigger would need a
 * new Eventarc IAM grant this project doesn't have yet, and would add nothing here since this job
 * is explicitly NOT on the hot path (it never gates a check-then-act decision, only audits after
 * the fact) so its latency doesn't matter. onSchedule is far more common/well-trodden than a
 * Firestore-Eventarc trigger and is far more likely to deploy cleanly under the existing service
 * account's roles (Editor + Cloud Functions Admin + Service Account User) - see the design doc's
 * IAM section for the caveat if it doesn't.
 *
 * What it does: re-derives each collection's totals from scratch (the exact same arithmetic as
 * backfillBalances.js) and compares against the live balanceTotals/games.rolling docs, logging any
 * mismatch loudly. A mismatch means some write site is failing to apply its increment (a bug, not
 * expected drift) - see it as a smoke alarm for exactly the "every write site has to remember"
 * risk the design doc calls out about the chosen mechanism, not as part of the mechanism itself.
 */
const {
  computeLedgerTotals, computeMainCageTotals, computeRollingTotals, computeShiftTotals, computeMemberTotals,
} = require("./backfillBalances.js");

function diffMaps(derived, maintained, keyLabel) {
  const mismatches = [];
  const keys = new Set([...Object.keys(derived), ...Object.keys(maintained)]);
  keys.forEach((k) => {
    const d = JSON.stringify(derived[k] ?? null);
    const m = JSON.stringify(maintained[k] ?? null);
    if (d !== m) mismatches.push({ key: `${keyLabel}:${k}`, derived: derived[k] ?? null, maintained: maintained[k] ?? null });
  });
  return mismatches;
}

/** `db` is an Admin SDK Firestore instance. Returns the full list of mismatches found (empty = clean). */
async function reconcileAll(db) {
  const [ledger, mainCage, rolling, shift, member] = await Promise.all([
    computeLedgerTotals(db), computeMainCageTotals(db), computeRollingTotals(db), computeShiftTotals(db), computeMemberTotals(db),
  ]);

  const [balSnap, gameSnap] = await Promise.all([db.collection("balanceTotals").get(), db.collection("games").get()]);
  const maintainedAcct = {}, maintainedMainCage = {}, maintainedShift = {}, maintainedMember = {};
  balSnap.forEach((d) => {
    const id = d.id;
    const data = d.data();
    if (id.startsWith("acct_")) maintainedAcct[id.slice("acct_".length)] = data.balances;
    else if (id.startsWith("maincage_")) maintainedMainCage[id.slice("maincage_".length)] = data.total;
    else if (id.startsWith("shift_")) {
      const { backfilledAt: _backfilledAt, updatedAt: _updatedAt, ...fields } = data;
      maintainedShift[id.slice("shift_".length)] = fields;
    } else if (id.startsWith("member_")) maintainedMember[id.slice("member_".length)] = { balance: data.balance, points: data.points };
  });
  const maintainedRolling = {};
  gameSnap.forEach((d) => { maintainedRolling[d.id] = d.data().rolling || 0; });

  const mismatches = [
    ...diffMaps(ledger.totals, maintainedAcct, "ledger"),
    ...diffMaps(mainCage.totals, maintainedMainCage, "mainCageLedger"),
    ...diffMaps(rolling.totals, maintainedRolling, "rollingEvents"),
    ...diffMaps(shift.totals, maintainedShift, "shiftEvents"),
    ...diffMaps(member.totals, maintainedMember, "memberLedger"),
  ];
  return mismatches;
}

/**
 * Handler body for the eventual `onSchedule("every 24 hours", ...)` export. Kept separate from the
 * onSchedule() wrapper itself so it can be unit-tested (and run manually / from a callable function
 * for an on-demand "check now" admin action) without needing the Cloud Scheduler machinery.
 */
async function runReconciliation(db, logger) {
  const mismatches = await reconcileAll(db);
  if (mismatches.length === 0) {
    logger.info("balanceTotals reconciliation: clean, 0 mismatches");
  } else {
    logger.error(`balanceTotals reconciliation: ${mismatches.length} mismatch(es) found`, { mismatches });
  }
  return mismatches;
}

module.exports = { reconcileAll, runReconciliation, diffMaps };
