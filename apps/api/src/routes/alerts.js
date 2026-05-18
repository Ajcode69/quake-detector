/**
 * Alerts routes — alert history, rules, and delivery logs.
 */

import { Router } from "express";
import prisma from "../../../../shared/db/client.js";

const router = Router();

/**
 * GET /api/alerts?severity=critical,warning&limit=50&offset=0
 */
router.get("/", async (req, res) => {
  try {
    const { severity, limit = 50, offset = 0, ruleType } = req.query;

    const where = {};
    if (severity) {
      where.severity = { in: severity.split(",") };
    }
    if (ruleType) {
      where.ruleType = { in: ruleType.split(",") };
    }

    const [data, totalCount, summary] = await Promise.all([
      prisma.alertLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: Math.min(parseInt(limit), 200),
        skip: parseInt(offset),
        include: {
          earthquake: {
            select: { mag: true, place: true, eventTime: true, alert: true, tsunami: true },
          },
        },
      }),
      prisma.alertLog.count({ where }),
      prisma.$queryRaw`
        SELECT
          COUNT(CASE WHEN severity = 'critical' THEN 1 END)::int AS critical,
          COUNT(CASE WHEN severity = 'warning' THEN 1 END)::int AS warning,
          COUNT(CASE WHEN severity = 'info' THEN 1 END)::int AS info,
          COUNT(CASE WHEN rule_type = 'system' OR rule_type LIKE '%system%' THEN 1 END)::int AS system,
          COUNT(CASE WHEN sent = false THEN 1 END)::int AS unsent,
          COUNT(CASE WHEN sent = true THEN 1 END)::int AS sent,
          COUNT(CASE WHEN sent = false AND created_at < NOW() - INTERVAL '5 minutes' THEN 1 END)::int AS failed
        FROM alerts_log
      `,
    ]);

    // Serialize BigInt chatId
    const serialized = data.map((a) => ({
      ...a,
      chatId: a.chatId.toString(),
    }));

    res.json({
      data: serialized,
      totalCount,
      summary: summary[0] || {},
    });
  } catch (err) {
    req.log.error({ err }, "failed to fetch alerts");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/alerts/rules?chatId=123
 */
router.get("/rules", async (req, res) => {
  try {
    const { chatId } = req.query;
    const where = {};
    if (chatId) {
      where.telegramChatId = BigInt(chatId);
    }

    const rules = await prisma.userAlertRule.findMany({
      where,
      include: {
        location: { select: { id: true, label: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const serialized = rules.map((r) => ({
      ...r,
      telegramChatId: r.telegramChatId.toString(),
    }));

    res.json({ data: serialized });
  } catch (err) {
    req.log.error({ err }, "failed to fetch alert rules");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PUT /api/alerts/rules/:id
 */
router.put("/rules/:id", async (req, res) => {
  try {
    const { minMag, alertOnTsunami, alertOnPager, quietHoursStart, quietHoursEnd, enabled } = req.body;

    const data = {};
    if (minMag != null) data.minMag = parseFloat(minMag);
    if (alertOnTsunami != null) data.alertOnTsunami = alertOnTsunami;
    if (alertOnPager != null) data.alertOnPager = alertOnPager;
    if (quietHoursStart !== undefined) data.quietHoursStart = quietHoursStart;
    if (quietHoursEnd !== undefined) data.quietHoursEnd = quietHoursEnd;
    if (enabled != null) data.enabled = enabled;

    const rule = await prisma.userAlertRule.update({
      where: { id: parseInt(req.params.id) },
      data,
    });

    res.json({ data: { ...rule, telegramChatId: rule.telegramChatId.toString() } });
  } catch (err) {
    req.log.error({ err }, "failed to update alert rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/alerts/rules
 */
router.post("/rules", async (req, res) => {
  try {
    const { chatId, locationId, minMag = 3.0, alertOnTsunami = true, alertOnPager = ["orange", "red"] } = req.body;

    if (!chatId) return res.status(400).json({ error: "chatId is required" });

    const rule = await prisma.userAlertRule.create({
      data: {
        telegramChatId: BigInt(chatId),
        locationId: locationId ? parseInt(locationId) : null,
        minMag: parseFloat(minMag),
        alertOnTsunami,
        alertOnPager,
      },
    });

    res.status(201).json({ data: { ...rule, telegramChatId: rule.telegramChatId.toString() } });
  } catch (err) {
    req.log.error({ err }, "failed to create alert rule");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
