const test = require("node:test");
const assert = require("node:assert/strict");
const { planSpill } = require("../balance/spillPlan.js");

test("takes entirely from the selected casino when it alone covers the amount", () => {
  const r = planSpill({ HANN: 100000, NUSTAR: 0, ONLINE: 0 }, "HANN", 40000);
  assert.deepEqual(r.legs, [{ casino: "HANN", take: 40000 }]);
  assert.equal(r.remaining, 0);
  assert.equal(r.sufficient, true);
});

test("spills into the other casinos in fixed order when the selected one falls short", () => {
  const r = planSpill({ HANN: 10000, NUSTAR: 5000, ONLINE: 100000 }, "HANN", 40000);
  assert.deepEqual(r.legs, [
    { casino: "HANN", take: 10000 },
    { casino: "NUSTAR", take: 5000 },
    { casino: "ONLINE", take: 25000 },
  ]);
  assert.equal(r.remaining, 0);
  assert.equal(r.sufficient, true);
});

test("reports the unmet remainder when total balance across all casinos is short", () => {
  const r = planSpill({ HANN: 1000, NUSTAR: 2000, ONLINE: 0 }, "HANN", 5000);
  assert.equal(r.remaining, 2000);
  assert.equal(r.sufficient, false);
});

test("ignores casinos with zero/negative/missing balance", () => {
  const r = planSpill({ HANN: 0, ONLINE: 30000 }, "HANN", 10000);
  assert.deepEqual(r.legs, [{ casino: "ONLINE", take: 10000 }]);
  assert.equal(r.sufficient, true);
});

test("amount of 0 produces no legs and is trivially sufficient", () => {
  const r = planSpill({ HANN: 500 }, "HANN", 0);
  assert.deepEqual(r.legs, []);
  assert.equal(r.sufficient, true);
});
