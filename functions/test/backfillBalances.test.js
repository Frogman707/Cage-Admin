const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseArgs, computeLedgerTotals, computeMainCageTotals, computeRollingTotals, computeShiftTotals, computeMemberTotals,
} = require("../balance/backfillBalances.js");

test("parseArgs defaults to dry-run and reads --project", () => {
  assert.deepEqual(parseArgs(["--project", "cage-admin-25bbf"]), { commit: false, project: "cage-admin-25bbf" });
  assert.deepEqual(parseArgs(["--project=cage-admin-25bbf", "--commit"]), { commit: true, project: "cage-admin-25bbf" });
});

// Minimal fake of the Admin SDK collection().get() surface these compute* functions need -
// avoids requiring a live emulator just to test the summing arithmetic itself.
function fakeCollection(docs) {
  return { get: async () => ({ size: docs.length, forEach: (fn) => docs.forEach((data) => fn({ data: () => data })) }) };
}
function fakeDb(collections) {
  return { collection: (name) => fakeCollection(collections[name] || []) };
}

test("computeLedgerTotals sums inn-out per accountId/casino, matching subscribeLedgerCloud's arithmetic", async () => {
  const db = fakeDb({
    ledger: [
      { accountId: "SE7419", casino: "HANN", inn: 50000, out: 0 },
      { accountId: "SE7419", casino: "HANN", inn: 0, out: 20000 },
      { accountId: "SE7419", casino: "NUSTAR", inn: 10000, out: 0 },
      { accountId: "OTHER", casino: "ONLINE", inn: 5000, out: 0 },
    ],
  });
  const { totals, docCount } = await computeLedgerTotals(db);
  assert.equal(docCount, 4);
  assert.deepEqual(totals.SE7419, { HANN: 30000, NUSTAR: 10000, ONLINE: 0 });
  assert.deepEqual(totals.OTHER, { HANN: 0, NUSTAR: 0, ONLINE: 5000 });
});

test("computeMainCageTotals: buyin/rollingCC/marker add, redeem subtracts, matching deriveMainCageForBranch", async () => {
  const db = fakeDb({
    mainCageLedger: [
      { branch: "HANN", type: "buyin", amt: 100000 },
      { branch: "HANN", type: "rollingCC", amt: 20000 },
      { branch: "HANN", type: "marker", amt: 5000 },
      { branch: "HANN", type: "redeem", amt: 30000 },
      { branch: "NUSTAR", type: "buyin", amt: 1000 },
    ],
  });
  const { totals } = await computeMainCageTotals(db);
  assert.equal(totals.HANN, 100000 + 20000 + 5000 - 30000);
  assert.equal(totals.NUSTAR, 1000);
});

test("computeRollingTotals sums signed amount per gameId, matching buildGameFromCache", async () => {
  const db = fakeDb({
    rollingEvents: [
      { gameId: "g1", amount: 10000 },
      { gameId: "g1", amount: -2000 },
      { gameId: "g2", amount: 5000 },
    ],
  });
  const { totals } = await computeRollingTotals(db);
  assert.equal(totals.g1, 8000);
  assert.equal(totals.g2, 5000);
});

test("computeShiftTotals sums delta per branch/field, matching deriveShiftTotalsForBranch", async () => {
  const db = fakeDb({
    shiftEvents: [
      { branch: "HANN", field: "rollingCashShift", delta: 1000 },
      { branch: "HANN", field: "rollingCashShift", delta: 500 },
      { branch: "HANN", field: "nnMarkerShift", delta: 200 },
      { branch: "NUSTAR", field: "rollingCashShift", delta: 999 },
    ],
  });
  const { totals } = await computeShiftTotals(db);
  assert.equal(totals.HANN.rollingCashShift, 1500);
  assert.equal(totals.HANN.nnMarkerShift, 200);
  assert.equal(totals.NUSTAR.rollingCashShift, 999);
});

test("computeMemberTotals splits point categories from balance, matching getPlayerBalance/getBalances", async () => {
  const db = fakeDb({
    memberLedger: [
      { memberId: "m1", amount: 100000, category: "deposit" },
      { memberId: "m1", amount: -20000, category: "bet" },
      { memberId: "m1", amount: 500, category: "point_earn" },
      { memberId: "m1", amount: -200, category: "point_convert" },
    ],
  });
  const { totals } = await computeMemberTotals(db);
  assert.equal(totals.m1.balance, 80000);
  assert.equal(totals.m1.points, 300);
});
