/**
 * Consumer: telegram-notifier
 * Reads earthquake.alerts → sends Telegram messages → marks as sent.
 * Rate limiting + exponential backoff retry.
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";
import { saveAlert, markAlertSent } from "../services/alert.service.js";
import { config } from "../../../../shared/config.js";

const log = createLogger("consumer:notifier");

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;
const RATE_LIMIT_DELAY_MS = 35;

export async function startNotifier(consumer) {
  await consumer.subscribe({ topic: TOPICS.ALERTS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const alert = JSON.parse(message.value.toString());
        await processAlert(alert);
        await sleep(RATE_LIMIT_DELAY_MS);
      } catch (err) {
        log.error({ err }, "notifier failed to process message");
      }
    },
  });

  log.info("notifier consumer running");
}

async function processAlert(alert) {
  const { eventId, chatId, rules, severity, isRevision, event } = alert;
  const message = formatAlertMessage(alert);

  await saveAlert({ eventId, chatId, ruleType: rules.map((r) => r.type).join(","), severity, message, isRevision });

  const sent = await sendTelegram(chatId, message);
  if (sent) {
    log.info({ eventId, chatId, severity }, "alert delivered");
  } else {
    log.warn({ eventId, chatId }, "alert saved but delivery failed — will retry");
  }
}

function formatAlertMessage(alert) {
  const { eventId, rules, severity, isRevision, event } = alert;
  const { mag, place, sig, tsunami, depth, alert: pagerLevel } = event;

  const emoji = { critical: "🔴", warning: "🟡", info: "🔵" };
  const header = isRevision
    ? `${emoji[severity] || "⚪"} *REVISED EARTHQUAKE ALERT*`
    : `${emoji[severity] || "⚪"} *EARTHQUAKE ALERT*`;

  const rulesText = rules.map((r) => `  • _${r.type}_: ${r.reason}`).join("\n");

  let details = `📍 *${place}*\n`;
  details += `💪 Magnitude: *M${mag}*\n`;
  details += `📊 Significance: ${sig}/1000\n`;
  details += `📏 Depth: ${depth}km\n`;
  if (pagerLevel) details += `🚨 PAGER Level: *${pagerLevel.toUpperCase()}*\n`;
  if (tsunami === 1) details += `🌊 *TSUNAMI WARNING ISSUED*\n`;

  const link = `https://earthquake.usgs.gov/earthquakes/eventpage/${eventId}`;
  return `${header}\n\n${details}\n*Triggered rules:*\n${rulesText}\n\n[View on USGS](${link})`;
}

async function sendTelegram(chatId, text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return true;

      const body = await response.json().catch(() => ({}));
      if (response.status === 429) {
        const retryAfter = body.parameters?.retry_after || 5;
        log.warn({ retryAfter, chatId }, "Telegram rate limited");
        await sleep(retryAfter * 1000);
        continue;
      }

      log.error({ status: response.status, body, chatId }, "Telegram API error");
    } catch (err) {
      log.error({ err, attempt, chatId }, "Telegram send failed");
      if (attempt < retries) await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
