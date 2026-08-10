const crypto = require("node:crypto");
const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

initializeApp();
const db = getFirestore();

setGlobalOptions({ maxInstances: 10 });

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const APP_API_SECRET = defineSecret("APP_API_SECRET");

const ALLOWED_ORIGINS = ["https://cage-admin-25bbf.web.app", "https://cage-admin-25bbf.firebaseapp.com"];

// CORS headers alone are not a security boundary - a non-browser caller (curl, a script) ignores
// them entirely, since Origin-checking is enforced by browsers, not servers. This only stops a
// malicious *webpage* from calling these endpoints on a victim's behalf; it's not a substitute for
// the X-App-Secret / login-credential checks each handler still does on its own.
function applyCors(req, res) {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-App-Secret");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

async function callTelegram(token, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${token.trim()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

// Secrets set via `"value" | firebase functions:secrets:set NAME --data-file -` from PowerShell
// can pick up an invisible trailing newline/whitespace depending on how PowerShell encodes the
// piped stdin, which breaks a strict === comparison silently (looks identical in any terminal).
// Trim defensively on both sides everywhere a secret is compared.
function secretEquals(provided, expected) {
  return String(provided || "").trim() === String(expected || "").trim();
}

// RFC 6238 TOTP (SHA-1, 6 digits, 30s step) - a server-side port of the same algorithm index.html
// runs client-side (see verifyTotp there), so a code from a staff member's real authenticator app
// verifies identically here.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(str) {
  const clean = String(str || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function hotp(secretBytes, counter, digits) {
  digits = digits || 6;
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter >>> 0, 4);
  const sig = crypto.createHmac("sha1", secretBytes).update(counterBuf).digest();
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode = ((sig[offset] & 0x7f) << 24) | ((sig[offset + 1] & 0xff) << 16) |
                  ((sig[offset + 2] & 0xff) << 8) | (sig[offset + 3] & 0xff);
  return String(binCode % (10 ** digits)).padStart(digits, "0");
}
function verifyTotp(secretBase32, code, otpWindow) {
  otpWindow = otpWindow === undefined ? 1 : otpWindow;
  const cleanCode = String(code || "").trim();
  if (!/^\d{6}$/.test(cleanCode)) return false;
  const secretBytes = base32Decode(secretBase32);
  const baseCounter = Math.floor(Math.floor(Date.now() / 1000) / 30);
  for (let offset = -otpWindow; offset <= otpWindow; offset++) {
    if (hotp(secretBytes, baseCounter + offset, 6) === cleanCode) return true;
  }
  return false;
}

/**
 * Public, pre-login staff picker. Returns names only - never pin/totpSecret. The client used to
 * populate the login dropdown from a live Firestore listener on the `staff` collection directly,
 * which is exactly what let anyone who knew the project ID (public in the client bundle) read
 * every staff member's PIN and TOTP secret with zero credentials. That collection is now denied to
 * direct client reads/writes entirely (see firestore.rules); this function and staffLogin below
 * are the only two paths to it, and neither ever returns a secret field.
 */
exports.listStaffNames = onRequest({}, async (req, res) => {
  if (applyCors(req, res)) return;
  const snap = await db.collection("staff").orderBy("dt").get();
  const staff = snap.docs.map((d) => {
    const v = d.data();
    return { id: v.id || d.id, name: v.name || "" };
  });
  res.status(200).json({ staff });
});

/**
 * Verifies a staff PIN + TOTP code server-side (Admin SDK, bypasses firestore.rules) and, on
 * success, mints a Firebase custom auth token so the client can sign in and reach the rest of
 * Firestore for the remainder of the session. The PIN and TOTP secret never leave this function.
 */
exports.staffLogin = onRequest({}, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, reason: "method" });
    return;
  }
  const { name, pin, otp } = req.body || {};
  if (!name || !pin || !otp) {
    res.status(400).json({ ok: false, reason: "missing" });
    return;
  }
  const snap = await db.collection("staff").where("name", "==", name).limit(1).get();
  if (snap.empty) {
    res.status(200).json({ ok: false, reason: "pin" });
    return;
  }
  const staffDoc = snap.docs[0];
  const staffData = staffDoc.data();
  if (String(pin) !== String(staffData.pin)) {
    res.status(200).json({ ok: false, reason: "pin" });
    return;
  }
  // Temporary, user-requested exception mirrored from the client (see attemptLogin in index.html):
  // ERIC has no working authenticator app set up, so a fixed code stands in for a real TOTP check.
  const otpOk = String(name).toUpperCase() === "ERIC"
    ? String(otp).trim() === "123456"
    : staffData.totpSecret && verifyTotp(staffData.totpSecret, otp);
  if (!otpOk) {
    res.status(200).json({ ok: false, reason: "otp" });
    return;
  }
  const token = await getAuth().createCustomToken(`staff:${staffDoc.id}`, {
    role: "staff",
    staffId: staffDoc.id,
    name: staffData.name,
  });
  res.status(200).json({ ok: true, token });
});

// Duplicated from index.html's MASTER_RESET_PASSWORD_HASH rather than shared, since the client
// bundle and this function deploy through entirely separate pipelines (Hosting vs Functions) with
// no shared config step between them. Update both together when the master password is rotated.
const MASTER_PASSWORD_HASH = "a28bda95db05b4b2b710c9286166bfcc7038a1948e2f7a0dc4e1801b295f78e6";
/**
 * Same idea as staffLogin, for the master login screen. The client already checks this password's
 * hash and the master OTP locally before calling this - this re-verifies the password server-side
 * (the master TOTP secret isn't synced to Firestore, so it can't be re-checked here too) before
 * minting a real session token, so a forged client-side "pwOk=true" alone can't reach any
 * collection that now requires request.auth != null.
 */
exports.masterSessionToken = onRequest({}, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  const { password } = req.body || {};
  const hash = crypto.createHash("sha256").update(String(password || "")).digest("hex");
  if (hash !== MASTER_PASSWORD_HASH) {
    res.status(200).json({ ok: false });
    return;
  }
  const token = await getAuth().createCustomToken("master", { role: "master" });
  res.status(200).json({ ok: true, token });
});

/**
 * Telegram calls this URL for every update sent to @CageAdminVIPBot (configured via
 * setWebhook). We only care about "/start <accountId>" - the deep link opened when a guest
 * scans the QR code / taps the link shown by openTelegramLink() in the app.
 */
exports.telegramWebhook = onRequest(
  { secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET] },
  async (req, res) => {
    if (!secretEquals(req.get("X-Telegram-Bot-Api-Secret-Token"), TELEGRAM_WEBHOOK_SECRET.value())) {
      res.status(401).send("unauthorized");
      return;
    }

    const msg = req.body && req.body.message;
    const text = msg && msg.text;

    if (msg && text && text.startsWith("/start")) {
      const rawAccountId = text.trim().split(/\s+/)[1];
      const chatId = msg.chat.id;
      // Account IDs are always alphanumeric (e.g. SE7419) - reject anything else before it ever
      // reaches a Firestore document path. An unvalidated value here (e.g. containing "/") gets
      // parsed as a path separator by the Firestore client, letting `/start` target document
      // paths outside the telegramLinks collection entirely.
      const accountId = rawAccountId && /^[A-Za-z0-9]{4,16}$/.test(rawAccountId) ? rawAccountId : null;
      if (accountId) {
        const username = msg.from && msg.from.username ? "@" + msg.from.username : null;
        const firstName = (msg.from && msg.from.first_name) || null;

        // One doc per (account, chatId) pair - re-scanning the same guest's QR just refreshes dt.
        const docId = `${accountId.toUpperCase()}_${chatId}`;
        await db.collection("telegramLinks").doc(docId).set({
          account: accountId.toUpperCase(),
          chatId,
          username,
          firstName,
          dt: FieldValue.serverTimestamp(),
        });

        try {
          await callTelegram(TELEGRAM_BOT_TOKEN.value(), "sendMessage", {
            chat_id: chatId,
            text: `${accountId.toUpperCase()} 계좌에 연동되었습니다. / Linked to account ${accountId.toUpperCase()}.`,
          });
        } catch (e) {
          logger.error("Failed to send confirmation message", e);
        }
      } else {
        // Plain "/start" with no payload, or a payload that failed the format check above - only
        // reachable by typing it manually, not through the app's QR/link. Still reply so a manual
        // test isn't silently indistinguishable from a dead webhook.
        try {
          await callTelegram(TELEGRAM_BOT_TOKEN.value(), "sendMessage", {
            chat_id: chatId,
            text: "이 봇은 Cage Admin 앱에서 제공하는 전용 링크로만 사용됩니다. / This bot only works via the link provided in the Cage Admin app.",
          });
        } catch (e) {
          logger.error("Failed to send no-payload reply", e);
        }
      }
    }

    // Telegram only cares that we respond 200 - it retries on anything else.
    res.status(200).send("ok");
  }
);

/**
 * The app polls this while the "텔레그램 연동 관리" / QR modal is open, instead of listening
 * to Firestore directly from the browser - keeps this collection's read access entirely behind
 * the function (protected by APP_API_SECRET) rather than depending on the project's existing
 * Firestore security rules, which this session doesn't have visibility into.
 */
exports.getTelegramLinks = onRequest(
  { secrets: [APP_API_SECRET] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (!secretEquals(req.get("X-App-Secret"), APP_API_SECRET.value())) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const account = String(req.query.account || "").toUpperCase();
    if (!account) {
      res.status(400).json({ error: "missing account" });
      return;
    }
    const snap = await db.collection("telegramLinks").where("account", "==", account).get();
    const links = snap.docs.map((d) => {
      const v = d.data();
      return {
        id: v.username || String(v.chatId),
        chatId: v.chatId,
        dt: v.dt && v.dt.toDate ? v.dt.toDate().toISOString().slice(0, 16).replace("T", " ") : "",
      };
    });
    res.status(200).json({ links });
  }
);

/**
 * Lets the app actually send a message (e.g. the withdrawal-password verification link) to a
 * guest who has already linked via /start. chatId must be one already on file for that account,
 * so this can't be used as an open relay to message arbitrary Telegram users.
 */
exports.sendTelegramMessage = onRequest(
  { secrets: [TELEGRAM_BOT_TOKEN, APP_API_SECRET] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    if (!secretEquals(req.get("X-App-Secret"), APP_API_SECRET.value())) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const { account, chatId, text } = req.body || {};
    if (!account || !chatId || !text) {
      res.status(400).json({ error: "missing account/chatId/text" });
      return;
    }
    const docId = `${String(account).toUpperCase()}_${chatId}`;
    const linkDoc = await db.collection("telegramLinks").doc(docId).get();
    if (!linkDoc.exists) {
      res.status(403).json({ error: "chatId not linked to this account" });
      return;
    }
    try {
      const result = await callTelegram(TELEGRAM_BOT_TOKEN.value(), "sendMessage", {
        chat_id: chatId,
        text: String(text),
      });
      res.status(200).json({ ok: true, result });
    } catch (e) {
      logger.error("sendTelegramMessage failed", e);
      res.status(500).json({ error: "send failed" });
    }
  }
);

/**
 * Lets the app actually remove a link (the "×" button in 텔레그램 연동 관리) instead of just
 * hiding it locally, which used to get silently re-added on the next getTelegramLinks poll.
 */
exports.deleteTelegramLink = onRequest(
  { secrets: [APP_API_SECRET] },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST only" });
      return;
    }
    if (!secretEquals(req.get("X-App-Secret"), APP_API_SECRET.value())) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const { account, chatId } = req.body || {};
    if (!account || !chatId) {
      res.status(400).json({ error: "missing account/chatId" });
      return;
    }
    const docId = `${String(account).toUpperCase()}_${chatId}`;
    await db.collection("telegramLinks").doc(docId).delete();
    res.status(200).json({ ok: true });
  }
);
