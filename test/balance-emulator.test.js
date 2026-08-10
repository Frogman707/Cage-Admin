/**
 * Concurrency proof for docs/BALANCE_ARCHITECTURE_DESIGN.md's chosen mechanism (client/transaction
 * applies FieldValue.increment() to a maintained balanceTotals doc in the same transaction as the
 * ledger write). NOT part of `npm test` / CI - this needs a live Firestore emulator, which the
 * existing `deploy-functions` CI job does not start. Run it explicitly:
 *
 *   npx firebase-tools emulators:exec --only firestore "node test/balance-emulator.test.js"
 *
 * Fires many concurrent withdrawals against one seeded account - some affordable, some not, on
 * purpose - and checks three things that together prove the design's core safety claim:
 *   1. No overdraft: successful withdrawals never sum past the seeded balance.
 *   2. Every successful transaction produced exactly one ledger doc per casino leg it touched -
 *      no ledger writes were left behind by a transaction that failed/retried and never committed.
 *   3. The maintained balanceTotals doc, after the dust settles, exactly equals a from-scratch
 *      derive-by-summing-every-ledger-doc computation (the old method) - i.e. the new maintained
 *      number and the old ground truth never disagree, even after heavy concurrent contention.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, query, where, setDoc } = require("firebase/firestore");
const { withdrawFromAccount, InsufficientBalanceError } = require("../functions/balance/withdrawTransaction.js");

const PROJECT_ID = "cage-admin-balance-emulator-test";

async function withTestEnv(fn) {
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
  try {
    await fn(testEnv);
  } finally {
    await testEnv.cleanup();
  }
}

test("concurrent withdrawals against the same account never overdraft, and the maintained balance matches a fresh derive-by-sum afterward", async () => {
  await withTestEnv(async (testEnv) => {
    const db = testEnv.unauthenticatedContext().firestore();
    const accountId = "CONC_TEST_1";
    const casino = "HANN";
    const seeded = 100000;

    await setDoc(doc(db, "balanceTotals", "acct_" + accountId), { balances: { [casino]: seeded } });

    // 12 concurrent withdrawals of 15000 each = 180000 requested against a 100000 balance.
    // At most 6 can succeed (6 * 15000 = 90000, a 7th would need 105000 > 100000).
    const attempts = 12;
    const each = 15000;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        withdrawFromAccount(db, { accountId, casino, amount: each, staff: "test", memo: "concurrency test" })
      )
    );

    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    assert.ok(succeeded.length >= 1, "at least one withdrawal should have succeeded");
    assert.ok(failed.length >= 1, "at least one withdrawal should have been rejected as insufficient");
    failed.forEach((r) => assert.ok(r.reason instanceof InsufficientBalanceError, `unexpected rejection: ${r.reason}`));

    const totalDebited = succeeded.length * each;
    assert.ok(totalDebited <= seeded, `overdraft: debited ${totalDebited} against a balance of ${seeded}`);

    const balSnap = await getDoc(doc(db, "balanceTotals", "acct_" + accountId));
    const maintained = balSnap.data().balances[casino];
    assert.equal(maintained, seeded - totalDebited, "maintained balance must equal seeded minus successful debits exactly");

    const ledgerSnap = await getDocs(
      query(collection(db, "ledger"), where("accountId", "==", accountId), where("casino", "==", casino))
    );
    assert.equal(ledgerSnap.size, succeeded.length, "one ledger OUT doc per successful withdrawal, none orphaned by a failed/retried transaction");
    const derivedFromLedger = seeded - ledgerSnap.docs.reduce((sum, d) => sum + (d.data().out || 0), 0);
    assert.equal(derivedFromLedger, maintained, "maintained balance must match a fresh full-history derive-by-sum");
  });
});

test("a withdrawal larger than the balance is rejected and leaves no ledger trace", async () => {
  await withTestEnv(async (testEnv) => {
    const db = testEnv.unauthenticatedContext().firestore();
    const accountId = "CONC_TEST_2";
    const casino = "NUSTAR";
    await setDoc(doc(db, "balanceTotals", "acct_" + accountId), { balances: { [casino]: 5000 } });

    await assert.rejects(
      () => withdrawFromAccount(db, { accountId, casino, amount: 9000, staff: "test", memo: "too much" }),
      InsufficientBalanceError
    );

    const balSnap = await getDoc(doc(db, "balanceTotals", "acct_" + accountId));
    assert.equal(balSnap.data().balances[casino], 5000, "balance must be untouched after a rejected withdrawal");
    const ledgerSnap = await getDocs(query(collection(db, "ledger"), where("accountId", "==", accountId)));
    assert.equal(ledgerSnap.size, 0, "no ledger doc should exist for a rejected withdrawal");
  });
});

test("a withdrawal spills across casinos in order when the selected casino alone is short", async () => {
  await withTestEnv(async (testEnv) => {
    const db = testEnv.unauthenticatedContext().firestore();
    const accountId = "CONC_TEST_3";
    await setDoc(doc(db, "balanceTotals", "acct_" + accountId), { balances: { HANN: 3000, NUSTAR: 4000, ONLINE: 100000 } });

    const plan = await withdrawFromAccount(db, { accountId, casino: "HANN", amount: 10000, staff: "test", memo: "spill" });
    assert.deepEqual(
      plan.legs.map((l) => [l.casino, l.take]),
      [["HANN", 3000], ["NUSTAR", 4000], ["ONLINE", 3000]]
    );

    const balSnap = await getDoc(doc(db, "balanceTotals", "acct_" + accountId));
    assert.deepEqual(balSnap.data().balances, { HANN: 0, NUSTAR: 0, ONLINE: 97000 });

    const ledgerSnap = await getDocs(query(collection(db, "ledger"), where("accountId", "==", accountId)));
    assert.equal(ledgerSnap.size, 3, "one ledger OUT doc per casino leg actually drawn from");
  });
});
