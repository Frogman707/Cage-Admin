/**
 * The functions actually shipped into index.html/shared/cage-ui.js (writeLedgerEntry,
 * writeMainCageEntry, writeRollingEvent, writeShiftEvent, writeMemberLedgerEntry) use the
 * *compat* Firestore SDK (firebase.firestore(), db.batch(), firebase.firestore.FieldValue.increment())
 * - a different call surface than the modular SDK used by
 * functions/balance/withdrawTransaction.js and its emulator test. That earlier test proved the
 * transactional-increment mechanism is atomic under concurrency; this one proves the simpler
 * dual-write shape (a plain batch: one ledger-style doc set + one FieldValue.increment() on a
 * nested balanceTotals field) behaves identically under the *compat* SDK actually used in the
 * files that were just edited - same emulator, same firestore.rules, just the other SDK surface.
 *
 * Not a test of index.html/cage-ui.js's actual source (those load in a browser DOM context this
 * harness doesn't have) - it reproduces the exact same batch shape those functions now write,
 * against a live emulator, to catch any compat-API misuse (wrong FieldValue import path, nested
 * map merge behaving unexpectedly, etc.) that reasoning about the diff alone could miss.
 *
 * Run: npx firebase-tools emulators:exec --only firestore "node test/dual-write-compat.test.js"
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const firebase = require("firebase/compat/app");
require("firebase/compat/firestore");

const PROJECT_ID = "cage-admin-balance-compat-test";

function freshApp(name) {
  const app = firebase.initializeApp({ projectId: PROJECT_ID }, name);
  const db = app.firestore();
  db.settings({ host: "127.0.0.1:8080", ssl: false });
  return db;
}

// Mirrors writeLedgerEntry's cloud path in index.html: one batch, ledger doc + balanceTotals
// nested-map increment for the casino drawn from.
async function writeLedgerEntryLike(db, { id, accountId, casino, type, amount }) {
  const entry = { id, accountId, casino, type, inn: type === "IN" ? amount : 0, out: type === "OUT" ? amount : 0 };
  const balRef = db.collection("balanceTotals").doc("acct_" + accountId);
  const delta = type === "IN" ? amount : -amount;
  const batch = db.batch();
  batch.set(db.collection("ledger").doc(id), entry);
  batch.set(balRef, { balances: { [casino]: firebase.firestore.FieldValue.increment(delta) } }, { merge: true });
  return batch.commit();
}

test("compat SDK: batched ledger write + nested balanceTotals increment lands correctly", async () => {
  const db = freshApp("ledger-dual-write");
  const accountId = "COMPAT_TEST_1";

  await writeLedgerEntryLike(db, { id: "l1", accountId, casino: "HANN", type: "IN", amount: 50000 });
  await writeLedgerEntryLike(db, { id: "l2", accountId, casino: "HANN", type: "OUT", amount: 20000 });
  await writeLedgerEntryLike(db, { id: "l3", accountId, casino: "NUSTAR", type: "IN", amount: 10000 });

  const balSnap = await db.collection("balanceTotals").doc("acct_" + accountId).get();
  assert.deepEqual(balSnap.data().balances, { HANN: 30000, NUSTAR: 10000 });

  const ledgerSnap = await db.collection("ledger").where("accountId", "==", accountId).get();
  assert.equal(ledgerSnap.size, 3);
});

test("compat SDK: concurrent increments on the same nested field never lose a write (increment is commutative/atomic per-field)", async () => {
  const db = freshApp("ledger-concurrency");
  const accountId = "COMPAT_TEST_2";

  await Promise.all(
    Array.from({ length: 20 }, (_, i) => writeLedgerEntryLike(db, { id: "c" + i, accountId, casino: "HANN", type: "IN", amount: 1000 }))
  );

  const balSnap = await db.collection("balanceTotals").doc("acct_" + accountId).get();
  assert.equal(balSnap.data().balances.HANN, 20000, "20 concurrent +1000 increments must sum to exactly 20000, none dropped");

  const ledgerSnap = await db.collection("ledger").where("accountId", "==", accountId).get();
  assert.equal(ledgerSnap.size, 20, "all 20 ledger docs must exist - a batch never partially commits");
});

// Mirrors writeMemberLedgerEntry in shared/cage-ui.js (used by avatar/app.js, partner-admin/app.js,
// shared/game-engine.js) - routes point categories to a separate `points` field.
async function writeMemberLedgerEntryLike(db, entry) {
  const POINT_CATEGORIES = ["point_earn", "point_convert"];
  const ledgerRef = db.collection("memberLedger").doc();
  const balRef = db.collection("balanceTotals").doc("member_" + entry.memberId);
  const field = POINT_CATEGORIES.includes(entry.category) ? "points" : "balance";
  const batch = db.batch();
  batch.set(ledgerRef, entry);
  batch.set(balRef, { [field]: firebase.firestore.FieldValue.increment(entry.amount) }, { merge: true });
  await batch.commit();
}

test("compat SDK: memberLedger dual-write routes point categories to `points`, everything else to `balance`", async () => {
  const db = freshApp("member-dual-write");
  const memberId = "COMPAT_MEMBER_1";

  await writeMemberLedgerEntryLike(db, { memberId, amount: 100000, category: "deposit" });
  await writeMemberLedgerEntryLike(db, { memberId, amount: -20000, category: "bet" });
  await writeMemberLedgerEntryLike(db, { memberId, amount: 500, category: "point_earn" });
  await writeMemberLedgerEntryLike(db, { memberId, amount: -200, category: "point_convert" });

  const balSnap = await db.collection("balanceTotals").doc("member_" + memberId).get();
  assert.equal(balSnap.data().balance, 80000);
  assert.equal(balSnap.data().points, 300);
});
