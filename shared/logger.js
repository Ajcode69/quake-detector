/**
 * Structured logger via pino.
 * Usage:  import { logger } from '../../shared/logger.js';
 *         logger.info({ eventId }, 'ingested event');
 */

import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  transport:
    config.nodeEnv === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

/**
 * Create a child logger scoped to a specific module.
 * @param {string} module - e.g. 'poller', 'evaluator', 'notifier'
 */
export function createLogger(module) {
  return logger.child({ module });
}
