const test = require("node:test");
const assert = require("node:assert/strict");
const { reconcileAll, runReconciliation } = require("../balance/reconcile.js");

function fakeCollection(docs) {
  return {
    get: async () => ({
      size: docs.length,
      forEach: (fn) => docs.forEach((data) => fn({ id: data.__id, data: () => data })),
    }),
  };
}
function fakeDb(collections) {
  return { collection: (name) => fakeCollection(collections[name] || []) };
}

test("reconcileAll reports no mismatches when balanceTotals matches the source collections", async () => {
  const db = fakeDb({
    ledger: [{ accountId: "SE7419", casino: "HANN", inn: 50000, out: 0 }],
    mainCageLedger: [],
    rollingEvents: [{ gameId: "g1", amount: 5000 }],
    shiftEvents: [],
    memberLedger: [],
    balanceTotals: [{ __id: "acct_SE7419", balances: { HANN: 50000, NUSTAR: 0, ONLINE: 0 } }],
    games: [{ __id: "g1", rolling: 5000 }],
  });
  const mismatches = await reconcileAll(db);
  assert.deepEqual(mismatches, []);
});

test("reconcileAll flags a drifted account (e.g. a write site that forgot to increment)", async () => {
  const db = fakeDb({
    ledger: [
      { accountId: "SE7419", casino: "HANN", inn: 50000, out: 0 },
      { accountId: "SE7419", casino: "HANN", inn: 10000, out: 0 }, // this write never reached balanceTotals below
    ],
    mainCageLedger: [],
    rollingEvents: [],
    shiftEvents: [],
    memberLedger: [],
    balanceTotals: [{ __id: "acct_SE7419", balances: { HANN: 50000, NUSTAR: 0, ONLINE: 0 } }],
    games: [],
  });
  const mismatches = await reconcileAll(db);
  assert.equal(mismatches.length, 1);
  assert.equal(mismatches[0].key, "ledger:SE7419");
  assert.deepEqual(mismatches[0].derived, { HANN: 60000, NUSTAR: 0, ONLINE: 0 });
  assert.deepEqual(mismatches[0].maintained, { HANN: 50000, NUSTAR: 0, ONLINE: 0 });
});

test("runReconciliation logs info on clean and error on drift", async () => {
  const cleanDb = fakeDb({ ledger: [], mainCageLedger: [], rollingEvents: [], shiftEvents: [], memberLedger: [], balanceTotals: [], games: [] });
  const infoCalls = [], errorCalls = [];
  const logger = { info: (...a) => infoCalls.push(a), error: (...a) => errorCalls.push(a) };
  await runReconciliation(cleanDb, logger);
  assert.equal(infoCalls.length, 1);
  assert.equal(errorCalls.length, 0);

  const dirtyDb = fakeDb({
    ledger: [{ accountId: "X", casino: "HANN", inn: 100, out: 0 }],
    mainCageLedger: [], rollingEvents: [], shiftEvents: [], memberLedger: [],
    balanceTotals: [], games: [],
  });
  const infoCalls2 = [], errorCalls2 = [];
  const logger2 = { info: (...a) => infoCalls2.push(a), error: (...a) => errorCalls2.push(a) };
  await runReconciliation(dirtyDb, logger2);
  assert.equal(infoCalls2.length, 0);
  assert.equal(errorCalls2.length, 1);
});
