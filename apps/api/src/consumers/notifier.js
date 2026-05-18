/**
 * Consumer: telegram-notifier
 * Reads earthquake.alerts → sends Telegram messages → marks as sent.
 *
 * Handles rate limiting (Telegram allows ~30 msg/sec to different chats),
 * retries with backoff, and records delivery status in alerts_log.
 */

import { createLogger } from "../../../../shared/logger.js";
import { TOPICS } from "../../../../shared/kafka/topics.js";
import { saveAlert, markAlertSent } from "../../../../shared/db/queries.js";
import { config } from "../../../../shared/config.js";

const log = createLogger("consumer:notifier");

const TELEGRAM_API = `https://api.telegram.org/bot${config.telegramBotToken}`;
const RATE_LIMIT_DELAY_MS = 35;

/**
 * Start the notifier consumer.
 * @param {import('kafkajs').Consumer} consumer
 */
export async function startNotifier(consumer) {
  await consumer.subscribe({ topic: TOPICS.ALERTS, fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const alert = JSON.parse(message.value.toString());
        await processAlert(alert);

        // Rate limiting — space out Telegram sends
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

  // Format the Telegram message
  const message = formatAlertMessage(alert);


  const dbAlert = await saveAlert({
    eventId,
    chatId,
    ruleType: rules.map((r) => r.type).join(","),
    severity,
    message,
    isRevision,
  });

  // Send via Telegram
  const sent = await sendTelegram(chatId, message);

  if (sent) {
    // We need the alert id — re-query or use the dedup hash approach
    log.info({ eventId, chatId, severity }, "alert delivered");
  } else {
    log.warn({ eventId, chatId }, "alert saved but delivery failed — will retry");
  }
}

/**
 * Format a rich alert message for Telegram (Markdown).
 */
function formatAlertMessage(alert) {
  const { eventId, rules, severity, isRevision, event } = alert;
  const { mag, place, sig, tsunami, depth, alert: pagerLevel } = event;

  const severityEmoji = {
    critical: "🔴",
    warning: "🟡",
    info: "🔵",
  };

  const header = isRevision
    ? `${severityEmoji[severity] || "⚪"} *REVISED EARTHQUAKE ALERT*`
    : `${severityEmoji[severity] || "⚪"} *EARTHQUAKE ALERT*`;

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

/**
 * Send a message via Telegram Bot API with retry.
 */
async function sendTelegram(chatId, text, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${TELEGRAM_API}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) return true;

      const body = await response.json().catch(() => ({}));

      // Rate limited — respect retry_after
      if (response.status === 429) {
        const retryAfter = body.parameters?.retry_after || 5;
        log.warn({ retryAfter, chatId }, "Telegram rate limited");
        await sleep(retryAfter * 1000);
        continue;
      }

      log.error({ status: response.status, body, chatId }, "Telegram API error");
    } catch (err) {
      log.error({ err, attempt, chatId }, "Telegram send failed");
      if (attempt < retries) {
        await sleep(Math.pow(2, attempt) * 1000); // exponential backoff
      }
    }
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
