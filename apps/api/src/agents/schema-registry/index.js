/**
 * Schema registry — whitelisted tables for the db_query agent tool.
 */

import { readFileSync, readdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TABLES_DIR = join(__dirname, "tables");

let _registry = null;

function loadRegistry() {
  if (_registry) return _registry;

  const files = readdirSync(TABLES_DIR).filter((f) => f.endsWith(".json"));
  _registry = files.map((file) => {
    const raw = readFileSync(join(TABLES_DIR, file), "utf-8");
    return JSON.parse(raw);
  });

  return _registry;
}

export function getAllowedTables() {
  return loadRegistry().map((t) => t.table);
}

export function getTableSchema(tableName) {
  return loadRegistry().find((t) => t.table === tableName) || null;
}

export function getRegistrySummary() {
  return loadRegistry()
    .map((t) => {
      const cols = t.columns.map((c) => `  - ${c.name} (${c.type}): ${c.description}`).join("\n");
      return `Table: ${t.table}\n${t.description}\nColumns:\n${cols}`;
    })
    .join("\n\n");
}

const FORBIDDEN_KEYWORDS = [
  "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE",
  "CREATE", "GRANT", "REVOKE", "EXEC", "EXECUTE", "COPY",
  "MERGE", "CALL", "DO", "LOCK",
];

export function validateSql(sql) {
  const trimmed = sql.trim();

  if (!trimmed) {
    return { valid: false, error: "SQL query is empty" };
  }

  if (trimmed.includes(";")) {
    return { valid: false, error: "Multi-statement queries are not allowed" };
  }

  if (trimmed.includes("--") || trimmed.includes("/*")) {
    return { valid: false, error: "SQL comments are not allowed" };
  }

  const upper = trimmed.toUpperCase();

  if (!upper.startsWith("SELECT")) {
    return { valid: false, error: "Only SELECT queries are allowed" };
  }

  for (const kw of FORBIDDEN_KEYWORDS) {
    const pattern = new RegExp(`\\b${kw}\\b`, "i");
    if (pattern.test(trimmed)) {
      return { valid: false, error: `Forbidden keyword: ${kw}` };
    }
  }

  // Block SELECT ... INTO specifically
  if (/\bSELECT\b[\s\S]*\bINTO\b/i.test(trimmed)) {
    return { valid: false, error: "SELECT INTO is not allowed" };
  }

  const allowedTables = getAllowedTables();
  const fromMatch = upper.match(/\bFROM\s+([a-z_][a-z0-9_]*)/gi);
  const joinMatch = upper.match(/\bJOIN\s+([a-z_][a-z0-9_]*)/gi);

  const referencedTables = [];
  if (fromMatch) {
    for (const m of fromMatch) {
      referencedTables.push(m.replace(/^\s*FROM\s+/i, "").toLowerCase());
    }
  }
  if (joinMatch) {
    for (const m of joinMatch) {
      referencedTables.push(m.replace(/^\s*JOIN\s+/i, "").toLowerCase());
    }
  }

  for (const table of referencedTables) {
    if (!allowedTables.includes(table)) {
      return { valid: false, error: `Table not allowed: ${table}. Allowed: ${allowedTables.join(", ")}` };
    }
  }

  if (referencedTables.length === 0) {
    return { valid: false, error: "Query must reference at least one allowed table" };
  }

  let safeSql = trimmed;
  if (!/\bLIMIT\s+\d+/i.test(safeSql)) {
    safeSql = `${safeSql} LIMIT 50`;
  }

  return { valid: true, sql: safeSql };
}
