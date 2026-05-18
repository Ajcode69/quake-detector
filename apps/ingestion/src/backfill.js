/**
 * Manual Backfill / Reconciliation Script.
 * Use this to manually trigger the reconciliation process outside the normal cron schedule.
 *
 * Usage:  npm run backfill
 */

import { createLogger } from "../../../shared/logger.js";
import { runReconciliation } from "./services/reconciliation.service.js";
import { disconnect } from "../../../shared/db/client.js";

const log = createLogger("backfill-script");

async function main() {
  log.info("Starting manual reconciliation (backfill) script...");
  await runReconciliation();
  log.info("Manual reconciliation complete.");
}

main()
  .catch((err) => {
    log.fatal({ err }, "backfill script crashed");
    process.exit(1);
  })
  .finally(async () => {
    await disconnect();
    process.exit(0);
  });
