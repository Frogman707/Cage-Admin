#!/usr/bin/env node
/**
 * One-time historical backfill for the new balanceTotals collection (docs/BALANCE_ARCHITECTURE_DESIGN.md).
 * NOT deployed, NOT run automatically by CI or this repo's app code - a human runs this manually,
 * once, against a specific Firebase project, after:
 *   1. the dual-write code (every ledger/mainCageLedger/rollingEvents/shiftEvents/memberLedger
 *      write site also applying FieldValue.increment() to the matching balanceTotals doc / games/{id}.rolling
 *      field) has been deployed and is live, and
 *   2. a short announced maintenance window has started during which the app's write paths are
 *      paused (see the design doc's "Historical backfill" section for why the scan needs a quiet
 *      source collection, and why that's simpler and safer than a timestamp-cutoff scheme given
 *      ledger/mainCageLedger/rollingEvents/shiftEvents don't carry a serverTimestamp today).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node functions/balance/backfillBalances.js --project cage-admin-25bbf --dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json node functions/balance/backfillBalances.js --project cage-admin-25bbf --commit
 *
 * --dry-run (default): computes every total and prints them, writes nothing.
 * --commit: also writes the computed totals to balanceTotals/* and games/{id}.rolling, overwriting
 *   whatever's there (safe: this collection has no other writer yet at backfill time under the
 *   ordering above).
 *
 * Every arithmetic rule here is copied verbatim from the existing derive-by-summing code it
 * replaces (subscribeLedgerCloud/deriveMainCageForBranch/buildGameFromCache/deriveShiftTotalsForBranch
 * in index.html, getPlayerBalance/getBalances in shared/game-engine.js + partner-admin/app.js) -
 * this script must never invent its own balance formula, only reproduce the existing one so its
 * output is comparable against the numbers staff already trust today.
 */
function parseArgs(argv) {
  const args = { commit: false, project: null };
  argv.forEach((a) => {
    if (a === "--commit") args.commit = true;
    else if (a === "--dry-run") args.commit = false;
    else if (a.startsWith("--project=")) args.project = a.slice("--project=".length);
    else if (a === "--project") args.project = argv[argv.indexOf(a) + 1];
  });
  return args;
}

// mainCageLedger: buyin/rollingCC/marker add to the branch total, redeem subtracts.
const MAINCAGE_SIGN = { buyin: 1, rollingCC: 1, marker: 1, redeem: -1 };
const SHIFT_FIELDS = [
  "rollingCashShift", "nnChipInShift", "buyinRollingShift", "workingChipRollingShift",
  "nnCashoutShift", "nnMarkerShift", "cashBuyinShift", "ccChipInShift", "ccMarkerShift",
];

async function computeLedgerTotals(db) {
  const totals = {}; // accountId -> {HANN,NUSTAR,ONLINE}
  const snap = await db.collection("ledger").get();
  snap.forEach((d) => {
    const r = d.data();
    totals[r.accountId] = totals[r.accountId] || { HANN: 0, NUSTAR: 0, ONLINE: 0 };
    totals[r.accountId][r.casino] = (totals[r.accountId][r.casino] || 0) + (r.inn || 0) - (r.out || 0);
  });
  return { totals, docCount: snap.size };
}

async function computeMainCageTotals(db) {
  const totals = {}; // branch -> number
  const snap = await db.collection("mainCageLedger").get();
  snap.forEach((d) => {
    const r = d.data();
    const branch = r.branch || "HANN";
    const sign = MAINCAGE_SIGN[r.type] || 0;
    totals[branch] = (totals[branch] || 0) + sign * (r.amt || 0);
  });
  return { totals, docCount: snap.size };
}

async function computeRollingTotals(db) {
  const totals = {}; // gameId -> number
  const snap = await db.collection("rollingEvents").get();
  snap.forEach((d) => {
    const r = d.data();
    totals[r.gameId] = (totals[r.gameId] || 0) + (r.amount || 0);
  });
  return { totals, docCount: snap.size };
}

async function computeShiftTotals(db) {
  const totals = {}; // branch -> {field: number}
  const snap = await db.collection("shiftEvents").get();
  snap.forEach((d) => {
    const r = d.data();
    const branch = r.branch || "HANN";
    totals[branch] = totals[branch] || {};
    totals[branch][r.field] = (totals[branch][r.field] || 0) + (r.delta || 0);
  });
  return { totals, docCount: snap.size };
}

async function computeMemberTotals(db) {
  const totals = {}; // memberId -> {balance, points}
  const snap = await db.collection("memberLedger").get();
  snap.forEach((d) => {
    const r = d.data();
    const m = totals[r.memberId] || (totals[r.memberId] = { balance: 0, points: 0 });
    if (r.category === "point_earn" || r.category === "point_convert") m.points += Number(r.amount) || 0;
    else m.balance += Number(r.amount) || 0;
  });
  return { totals, docCount: snap.size };
}

async function writeBatched(db, writes, { commit }) {
  if (!commit) return;
  const CHUNK = 400; // stay under Firestore's 500-writes-per-batch limit
  for (let i = 0; i < writes.length; i += CHUNK) {
    const batch = db.batch();
    writes.slice(i, i + CHUNK).forEach(({ ref, data, merge }) => batch.set(ref, data, merge ? { merge: true } : undefined));
    await batch.commit();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    console.error("Usage: node backfillBalances.js --project <firebase-project-id> [--commit]");
    process.exit(1);
  }
  // Deferred require so this file can be unit-tested (pure arg parsing etc.) without firebase-admin
  // actually needing valid credentials in that context.
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore } = require("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: args.project });
  const db = getFirestore();

  console.log(`Backfilling balanceTotals for project=${args.project} mode=${args.commit ? "COMMIT" : "DRY-RUN"}`);

  const [ledger, mainCage, rolling, shift, member] = await Promise.all([
    computeLedgerTotals(db), computeMainCageTotals(db), computeRollingTotals(db), computeShiftTotals(db), computeMemberTotals(db),
  ]);
  console.log(`ledger: ${Object.keys(ledger.totals).length} accounts from ${ledger.docCount} docs`);
  console.log(`mainCageLedger: ${Object.keys(mainCage.totals).length} branches from ${mainCage.docCount} docs`);
  console.log(`rollingEvents: ${Object.keys(rolling.totals).length} games from ${rolling.docCount} docs`);
  console.log(`shiftEvents: ${Object.keys(shift.totals).length} branches from ${shift.docCount} docs`);
  console.log(`memberLedger: ${Object.keys(member.totals).length} members from ${member.docCount} docs`);

  const writes = [];
  Object.entries(ledger.totals).forEach(([accountId, balances]) => {
    writes.push({ ref: db.collection("balanceTotals").doc("acct_" + accountId), data: { balances, backfilledAt: new Date().toISOString() } });
  });
  Object.entries(mainCage.totals).forEach(([branch, total]) => {
    writes.push({ ref: db.collection("balanceTotals").doc("maincage_" + branch), data: { total, backfilledAt: new Date().toISOString() } });
  });
  Object.entries(rolling.totals).forEach(([gameId, rollingTotal]) => {
    writes.push({ ref: db.collection("games").doc(gameId), data: { rolling: rollingTotal, backfilledAt: new Date().toISOString() }, merge: true });
  });
  Object.entries(shift.totals).forEach(([branch, fields]) => {
    const data = { backfilledAt: new Date().toISOString() };
    SHIFT_FIELDS.forEach((f) => { data[f] = fields[f] || 0; });
    writes.push({ ref: db.collection("balanceTotals").doc("shift_" + branch), data });
  });
  Object.entries(member.totals).forEach(([memberId, v]) => {
    writes.push({ ref: db.collection("balanceTotals").doc("member_" + memberId), data: { ...v, backfilledAt: new Date().toISOString() } });
  });

  console.log(`${writes.length} balanceTotals/games docs to write`);
  await writeBatched(db, writes, args);
  if (!args.commit) console.log("Dry run only - nothing was written. Re-run with --commit to apply.");
  else console.log("Backfill committed. Now re-verify every key against the old derive-by-sum reads before trusting balanceTotals anywhere.");
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { parseArgs, computeLedgerTotals, computeMainCageTotals, computeRollingTotals, computeShiftTotals, computeMemberTotals, MAINCAGE_SIGN, SHIFT_FIELDS };
