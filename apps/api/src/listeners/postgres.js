import pg from 'pg';
import { config } from "../../../../shared/config.js";
import { createLogger } from "../../../../shared/logger.js";
import prisma from "../../../../shared/db/client.js";
import { broadcastToSSE } from "../services/persister.service.js";
import { evaluateEvent, evaluateRevision, handleSystemAlert } from "../services/evaluator.service.js";
import { processAlertId } from "../services/notifier.service.js";
import { startLocationCache } from "../services/location.cache.js";

const log = createLogger("postgres-listener");

export async function startPostgresListener() {
  await startLocationCache();

  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();

  await client.query('LISTEN earthquake_raw');
  await client.query('LISTEN earthquake_alerts');

  client.on('notification', async (msg) => {
    try {
      const payload = JSON.parse(msg.payload);

      if (msg.channel === 'earthquake_raw') {
        if (payload._systemAlert) {
          await handleSystemAlert(payload);
          return;
        }

        // Fetch the fresh event from Postgres
        const event = await prisma.earthquake.findUnique({
          where: { id: payload.id },
        });

        if (!event) {
          log.warn({ eventId: payload.id }, "Received raw event but not found in DB");
          return;
        }

        if (payload.revision) {

          await evaluateRevision(payload.id);
        } else {
          // Broadcast to SSE
          broadcastToSSE(event);
          // Evaluate alerts
          await evaluateEvent(event, false);
        }
      }
      else if (msg.channel === 'earthquake_alerts') {
        await processAlertId(payload.id);
      }
    } catch (err) {
      log.error({ err, channel: msg.channel, payload: msg.payload }, "Error processing Postgres notification");
    }
  });

  log.info("postgres pub/sub listener running on earthquake_raw and earthquake_alerts");
}
