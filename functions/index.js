const { setGlobalOptions } = require("firebase-functions");
const { onRequest } = require("firebase-functions/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

setGlobalOptions({ maxInstances: 10 });

const TELEGRAM_BOT_TOKEN = defineSecret("TELEGRAM_BOT_TOKEN");
const TELEGRAM_WEBHOOK_SECRET = defineSecret("TELEGRAM_WEBHOOK_SECRET");
const APP_API_SECRET = defineSecret("APP_API_SECRET");

const ALLOWED_ORIGIN = "https://cage-admin-25bbf.web.app";

function applyCors(req, res) {
  res.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-App-Secret");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

async function callTelegram(token, method, payload) {
  const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return resp.json();
}

/**
 * Telegram calls this URL for every update sent to @CageAdminVIPBot (configured via
 * setWebhook). We only care about "/start <accountId>" - the deep link opened when a guest
 * scans the QR code / taps the link shown by openTelegramLink() in the app.
 */
exports.telegramWebhook = onRequest(
  { secrets: [TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET] },
  async (req, res) => {
    if (req.get("X-Telegram-Bot-Api-Secret-Token") !== TELEGRAM_WEBHOOK_SECRET.value()) {
      res.status(401).send("unauthorized");
      return;
    }

    const msg = req.body && req.body.message;
    const text = msg && msg.text;

    if (msg && text && text.startsWith("/start")) {
      const accountId = text.trim().split(/\s+/)[1];
      if (accountId) {
        const chatId = msg.chat.id;
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
    if (req.get("X-App-Secret") !== APP_API_SECRET.value()) {
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
    if (req.get("X-App-Secret") !== APP_API_SECRET.value()) {
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
