/**
 * reset-scratch-db.cjs
 * ---------------------------------------------------------------------------
 * Development helper (never shipped in the release ZIP).
 *
 * Drops and recreates the throw-away database that `verify-installer.cjs`
 * provisions, so installation can be tested repeatedly from a clean slate.
 *
 *   node deploy/tools/reset-scratch-db.cjs            # drop + create
 *   node deploy/tools/reset-scratch-db.cjs --keep     # create if missing only
 *
 * It reads credentials from server/.env (the same file the backend uses) and
 * never prints them. It only ever touches a database whose name starts with
 * RMUDTS_SCRATCH_PREFIX.
 */
"use strict";

const path = require("path");
const { createRequire } = require("module");

const SERVER_DIR = path.join(__dirname, "..", "..", "server");
const serverRequire = createRequire(path.join(SERVER_DIR, "package.json"));
const mysql = require(path.join(SERVER_DIR, "node_modules", "mysql2", "promise.js"));
const dotenv = serverRequire("dotenv");
dotenv.config({ path: path.join(SERVER_DIR, ".env"), override: true });

const PREFIX = "rmudts_installer_";
const name = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : PREFIX + "scratch";
if (!name.startsWith(PREFIX)) {
  console.error("Refusing to touch a database that does not start with " + PREFIX);
  process.exit(1);
}

const keep = process.argv.includes("--keep");

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
  });
  if (!keep) {
    await conn.query("DROP DATABASE IF EXISTS `" + name + "`");
  }
  await conn.query("CREATE DATABASE IF NOT EXISTS `" + name + "` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
  const [rows] = await conn.query("SHOW TABLES FROM `" + name + "`");
  console.log("Scratch database `" + name + "` ready (" + rows.length + " tables)");
  await conn.end();
})().catch((err) => {
  console.error("reset-scratch-db failed:", err.message);
  process.exit(1);
});
