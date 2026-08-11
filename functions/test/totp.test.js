const test = require("node:test");
const assert = require("node:assert/strict");
const { base32Decode, hotp, verifyTotp, secretEquals } = require("../index.js").__test__;

// RFC 4226 Appendix D test vectors: HOTP-SHA1, 6 digits, secret = ASCII "12345678901234567890"
// (the same secret RFC 6238 reuses for its own TOTP vectors). If this ever fails, the HOTP
// implementation itself has drifted from the spec - staff's real authenticator apps would stop
// matching.
test("hotp matches RFC 4226 Appendix D test vectors", () => {
  const secret = Buffer.from("12345678901234567890", "ascii");
  const expected = [
    "755224", "287082", "359152", "969429", "338314",
    "254676", "287922", "162583", "399871", "520489",
  ];
  expected.forEach((code, counter) => {
    assert.equal(hotp(secret, counter, 6), code, `counter=${counter}`);
  });
});

// RFC 4648 Section 10 base32 test vectors.
test("base32Decode matches RFC 4648 test vectors", () => {
  assert.deepEqual(base32Decode(""), Buffer.from(""));
  assert.deepEqual(base32Decode("MY======"), Buffer.from("f"));
  assert.deepEqual(base32Decode("MZXQ===="), Buffer.from("fo"));
  assert.deepEqual(base32Decode("MZXW6==="), Buffer.from("foo"));
  assert.deepEqual(base32Decode("MZXW6YQ="), Buffer.from("foob"));
  assert.deepEqual(base32Decode("MZXW6YTB"), Buffer.from("fooba"));
  assert.deepEqual(base32Decode("MZXW6YTBOI======"), Buffer.from("foobar"));
});

test("base32Decode is case-insensitive and ignores non-alphabet characters", () => {
  assert.deepEqual(base32Decode("mzxw6ytboi"), Buffer.from("foobar"));
  assert.deepEqual(base32Decode("MZXW-6YTB OI"), Buffer.from("foobar"));
});

test("verifyTotp accepts the code currently valid for a secret, rejects a wrong one", () => {
  const secretBase32 = "JBSWY3DPEHPK3PXP"; // arbitrary valid base32 secret
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
  const validCode = hotp(secretBytes, counter, 6);
  assert.equal(verifyTotp(secretBase32, validCode), true);
  assert.equal(verifyTotp(secretBase32, "000000") === validCode, false);
  const wrongCode = validCode === "000000" ? "111111" : "000000";
  assert.equal(verifyTotp(secretBase32, wrongCode), false);
});

test("verifyTotp accepts a code from the adjacent 30s step (clock-skew window)", () => {
  const secretBase32 = "JBSWY3DPEHPK3PXP";
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(Math.floor(Date.now() / 1000) / 30);
  const nextStepCode = hotp(secretBytes, counter + 1, 6);
  assert.equal(verifyTotp(secretBase32, nextStepCode, 1), true);
});

test("verifyTotp rejects malformed codes without throwing", () => {
  const secretBase32 = "JBSWY3DPEHPK3PXP";
  assert.equal(verifyTotp(secretBase32, ""), false);
  assert.equal(verifyTotp(secretBase32, "12345"), false); // too short
  assert.equal(verifyTotp(secretBase32, "1234567"), false); // too long
  assert.equal(verifyTotp(secretBase32, "abcdef"), false); // non-numeric
  assert.equal(verifyTotp(secretBase32, null), false);
  assert.equal(verifyTotp(secretBase32, undefined), false);
});

test("secretEquals trims whitespace on both sides before comparing", () => {
  assert.equal(secretEquals("abc\n", "abc"), true);
  assert.equal(secretEquals("  abc  ", "abc"), true);
  assert.equal(secretEquals("abc", "abd"), false);
  assert.equal(secretEquals(null, ""), true);
  assert.equal(secretEquals(undefined, undefined), true);
});
