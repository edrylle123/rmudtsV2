/**
 * generate-schema.cjs
 * ---------------------------------------------------------------------------
 * Builds `deploy/database/schema.sql` — the schema the RMUDTS installer
 * provisions into a fresh cPanel MySQL database.
 *
 * Source of truth is the live development database (server/.env), so the
 * shipped schema can never drift from what the application actually uses.
 *
 *   node deploy/tools/generate-schema.cjs            # write schema.sql
 *   node deploy/tools/generate-schema.cjs --out FILE # write somewhere else
 *
 * Structure for every table in the database is emitted as
 * `CREATE TABLE IF NOT EXISTS` (never DROP), so provisioning a database that
 * already holds other tables is safe and re-running is idempotent.
 *
 * Seed rows are emitted for configuration/reference tables only
 * (offices, dropdown_options, app_settings). Tables that hold operational
 * records (users, records, record_files, record_movements, notifications,
 * incoming_documents, employees, ...) ship structure only.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

// Reuse the backend's installed dependencies (mysql2, dotenv) instead of
// adding a second node_modules tree just for this tool.
const SERVER_DIR = path.join(__dirname, "..", "..", "server");
const serverRequire = createRequire(path.join(SERVER_DIR, "package.json"));
let mysql;
let dotenv;
try {
  mysql = serverRequire("mysql2/promise");
  dotenv = serverRequire("dotenv");
} catch (err) {
  console.error(
    "This tool needs the backend dependencies. Run `npm install` inside server/ first.",
    "\n(" + err.message + ")"
  );
  process.exit(1);
}

// server/.env is authoritative for credentials; load it explicitly so the
// script behaves the same no matter which cwd it is launched from.
dotenv.config({ path: path.join(SERVER_DIR, ".env"), override: true });

/** Tables whose rows are seeded into the installer payload. */
const SEED_TABLES = {
  offices: { order: "name ASC" },
  dropdown_options: { order: "category ASC, value ASC" },
  app_settings: { order: "setting_key ASC" },
};

/** Columns that must never appear in shipped seed data. */
const NEVER_EMIT = new Set(["password", "token", "secret", "api_key"]);

function q(id) {
  return "`" + String(id).replace(/`/g, "``") + "`";
}

/**
 * Kahn topological sort. `deps(name)` returns the tables that must exist
 * first. Ties are broken alphabetically so the output is deterministic and
 * diff-friendly. A cycle falls back to the remaining names in order rather
 * than throwing — the emitted file lifts FOREIGN_KEY_CHECKS for the DDL block.
 *
 * @param {string[]} nodes
 * @param {(node: string) => string[]} deps
 * @returns {string[]}
 */
function dependencyOrder(nodes, deps) {
  const remaining = new Set(nodes);
  const order = [];
  while (remaining.size) {
    const ready = [...remaining]
      .filter((n) => deps(n).every((d) => !remaining.has(d) || d === n))
      .sort();
    if (!ready.length) {
      order.push(...[...remaining].sort());
      break;
    }
    for (const n of ready) {
      order.push(n);
      remaining.delete(n);
    }
  }
  return order;
}

function sqlValue(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  if (v instanceof Date) return "'" + v.toISOString().slice(0, 19).replace("T", " ") + "'";
  if (Buffer.isBuffer(v)) return "X'" + v.toString("hex") + "'";
  return "'" + String(v).replace(/\\/g, "\\\\").replace(/'/g, "''") + "'";
}

/** `CREATE TABLE` from MySQL arrives without IF NOT EXISTS — add it. */
function asIfNotExists(ddl) {
  return ddl.replace(/^CREATE TABLE (\`)/i, "CREATE TABLE IF NOT EXISTS $1");
}

/** InnoDB AUTO_INCREMENT=n carries dev data; drop it so counters start clean. */
function normaliseDdl(ddl) {
  return ddl.replace(/\s+AUTO_INCREMENT=\d+\s+/i, " ");
}

async function main() {
  const argv = process.argv.slice(2);
  const outFlag = argv.indexOf("--out");
  const outFile =
    outFlag !== -1 && argv[outFlag + 1]
      ? path.resolve(argv[outFlag + 1])
      : path.join(__dirname, "..", "database", "schema.sql");

  const cfg = {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    database: process.env.DB_NAME,
  };
  if (!cfg.database) throw new Error("DB_NAME missing from server/.env");

  const conn = await mysql.createConnection(cfg);
  const [tables] = await conn.query("SHOW FULL TABLES");
  // SHOW FULL TABLES row = { Tables_in_<db>: "name", Table_type: "BASE TABLE" }
  const names = tables
    .map((r) => Object.values(r))
    .filter((v) => String(v[1]).toUpperCase() === "BASE TABLE")
    .map((v) => v[0])
    .sort();

  const out = [];
  out.push("-- =====================================================================");
  out.push("-- RMUDTS — Records Management Unit Document Tracking System");
  out.push("-- Database schema (generated by deploy/tools/generate-schema.cjs)");
  out.push("--");
  out.push("-- Generated : " + new Date().toISOString());
  out.push("-- Source    : " + cfg.database + " @ " + cfg.host + ":" + cfg.port);
  out.push("-- Tables    : " + names.length);
  out.push("--");
  out.push("-- Every statement is idempotent: existing tables are left untouched and");
  out.push("-- existing seed rows are updated in place. This file never drops data.");
  out.push("-- =====================================================================");
  out.push("");
  out.push("SET NAMES utf8mb4;");
  out.push("SET time_zone = '+00:00';");
  out.push("SET sql_mode = 'NO_AUTO_VALUE_ON_ZERO';");
  out.push("SET FOREIGN_KEY_CHECKS = 1;");
  out.push("");

  // Read every table first so we can emit them in foreign-key-safe order.
  // A table that is referenced by another must be created before its
  // referrer, otherwise `CREATE TABLE ... FOREIGN KEY` fails on a fresh
  // database (MySQL checks the parent table exists).
  const ddlByTable = new Map();
  for (const name of names) {
    const [rows] = await conn.query("SHOW CREATE TABLE " + q(name));
    ddlByTable.set(name, normaliseDdl(rows[0]["Create Table"] || rows[0]["Create View"]));
  }
  const ordered = dependencyOrder(names, (name) => {
    const ddl = ddlByTable.get(name) || "";
    const deps = new Set();
    const re = /REFERENCES\s+`([^`]+)`/gi;
    let m;
    while ((m = re.exec(ddl)) !== null) {
      if (m[1] !== name && names.includes(m[1])) deps.add(m[1]);
    }
    return [...deps];
  });

  const referenced = ordered.some((name) => /REFERENCES\s+`/.test(ddlByTable.get(name) || ""));
  if (referenced) {
    out.push("-- Referenced tables are emitted before the tables that point at them,");
    out.push("-- and key checks are lifted for the DDL block so a partially ordered or");
    out.push("-- circular relationship can still be provisioned. They are restored below.");
    out.push("SET FOREIGN_KEY_CHECKS = 0;");
    out.push("");
  }

  let seedStatements = 0;
  for (const name of ordered) {
    const ddl = ddlByTable.get(name);
    out.push("-- ---------------------------------------------------------------------");
    out.push("-- Table: " + name);
    out.push("-- ---------------------------------------------------------------------");
    out.push(asIfNotExists(ddl) + ";");
    out.push("");
  }

  if (referenced) {
    out.push("SET FOREIGN_KEY_CHECKS = 1;");
    out.push("");
  }

  for (const name of ordered) {
    const seed = SEED_TABLES[name];
    if (!seed) continue;
    const [cols] = await conn.query("SHOW COLUMNS FROM " + q(name));
    const colNames = cols.map((c) => c.Field).filter((c) => !NEVER_EMIT.has(c));
    const [data] = await conn.query(
      "SELECT " + colNames.map(q).join(", ") + " FROM " + q(name) + " ORDER BY " + seed.order
    );
    if (!data.length) continue;

    out.push("-- Seed data: " + name + " (" + data.length + " rows)");
    const keyCol = colNames.includes("name")
      ? "name"
      : colNames.includes("setting_key")
        ? "setting_key"
        : colNames[0];
    const updateCols = colNames.filter((c) => c !== keyCol);
    out.push(
      "INSERT INTO " +
        q(name) +
        " (" +
        colNames.map(q).join(", ") +
        ") VALUES"
    );
    out.push(
      data
        .map((row) => "  (" + colNames.map((c) => sqlValue(row[c])).join(", ") + ")")
        .join(",\n") + "\n" +
        "ON DUPLICATE KEY UPDATE " +
        updateCols.map((c) => q(c) + " = VALUES(" + q(c) + ")").join(", ") +
        ";"
    );
    out.push("");
    seedStatements += data.length;
  }

  out.push("-- =====================================================================");
  out.push("-- Schema load complete: " + ordered.length + " tables, " + seedStatements + " seed rows.");
  out.push("-- =====================================================================");

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, out.join("\n") + "\n", "utf8");

  await conn.end();
  console.log(
    "Wrote " + outFile + " — " + names.length + " tables, " + seedStatements + " seed rows, " +
      (fs.statSync(outFile).size / 1024).toFixed(1) + " kB"
  );
  console.log("Seed tables: " + Object.keys(SEED_TABLES).join(", "));
}

main().catch((err) => {
  console.error("generate-schema failed:", err.message);
  process.exit(1);
});
