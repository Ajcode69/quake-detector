/**
 * Persist and fetch critical contacts for locations.
 */

import prisma from "../../../../../shared/db/client.js";
import { createLogger } from "../../../../../shared/logger.js";
import { invokeContactDiscovery } from "../graph/contactDiscovery.graph.js";
import { isAgentConfigured } from "../llm.js";
import { isWebSearchConfigured } from "../tools/webSearch.tool.js";

const log = createLogger("agent:contacts");

export function isContactDiscoveryConfigured() {
  return isAgentConfigured() && isWebSearchConfigured();
}

export async function getContactsForLocation(locationId) {
  return prisma.locationCriticalContact.findMany({
    where: { locationId },
    orderBy: [{ priority: "asc" }, { discoveredAt: "desc" }],
  });
}

export async function saveContacts(locationId, contacts) {
  if (!contacts.length) return [];

  await prisma.locationCriticalContact.deleteMany({
    where: { locationId, source: "web_search" },
  });

  const created = await prisma.locationCriticalContact.createMany({
    data: contacts.map((c) => ({
      locationId,
      name: c.name,
      organization: c.organization,
      role: c.role,
      phone: c.phone || null,
      email: c.email || null,
      website: c.website || null,
      address: c.address || null,
      coverageArea: c.coverageArea || null,
      alertTypes: c.alertTypes || [],
      priority: c.priority || "high",
      source: "web_search",
      sourceUrl: c.sourceUrl || null,
      notes: c.notes || null,
    })),
  });

  log.info({ locationId, count: created.count }, "critical contacts saved");
  return getContactsForLocation(locationId);
}

export async function discoverCriticalContacts({ location, onComplete }) {
  if (!isContactDiscoveryConfigured()) {
    log.warn({ locationId: location.id }, "contact discovery skipped — agent not configured");
    return [];
  }

  log.info({ locationId: location.id, label: location.label }, "contact discovery started");

  try {
    const contacts = await invokeContactDiscovery({
      label: location.label,
      latitude: location.latitude,
      longitude: location.longitude,
    });

    const saved = await saveContacts(location.id, contacts);

    log.info(
      { locationId: location.id, count: saved.length },
      "contact discovery completed"
    );

    if (onComplete) {
      await onComplete(saved);
    }

    return saved;
  } catch (err) {
    log.error({ err, locationId: location.id }, "contact discovery failed");
    if (onComplete) {
      await onComplete([], err);
    }
    return [];
  }
}

export function formatContactsSummary(contacts) {
  if (!contacts.length) {
    return "No emergency contacts were found for this location.";
  }

  const lines = contacts.slice(0, 5).map((c) => {
    const parts = [`• *${c.name}* (${c.organization})`];
    if (c.role) parts.push(`  Role: ${c.role.replace(/_/g, " ")}`);
    if (c.phone) parts.push(`  📞 ${c.phone}`);
    if (c.website) parts.push(`  🌐 ${c.website}`);
    return parts.join("\n");
  });

  const extra = contacts.length > 5 ? `\n\n_+${contacts.length - 5} more contacts saved._` : "";
  return `🆘 *Emergency Alert Contacts* (${contacts.length} found):\n\n${lines.join("\n\n")}${extra}`;
}
