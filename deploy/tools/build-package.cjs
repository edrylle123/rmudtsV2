/**
 * build-package.cjs
 * ---------------------------------------------------------------------------
 * Builds the one-click deployment archive: dist/RMUDTS_v1.0.zip
 *
 *   node deploy/tools/build-package.cjs                # stage + zip
 *   node deploy/tools/build-package.cjs --stage-only   # leave dist/stage for inspection
 *   node deploy/tools/build-package.cjs --out FILE.zip
 *
 * The staged tree mirrors exactly what an administrator extracts into
 * public_html:
 *
 *   index.php  .htaccess  install/  client/  server/  database/schema.sql
 *   config/ storage/ backup/ logs/ uploads/ restore/ docs/ README.md
 *
 * The script refuses to produce an archive that would leak secrets or bloat:
 *   • a missing frontend build fails the build (the installer needs index.html);
 *   • node_modules, .env files, logs and test attachments are never copied;
 *   • any .env/.pem/.key found in the staged tree aborts the run;
 *   • the archive size and file count are reported for review.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Zip } = require("./lib/zip.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const OVERLAY = path.join(ROOT, "deploy", "package");
const CLIENT_BUILD = path.join(ROOT, "client", "build");
const SERVER_DIR = path.join(ROOT, "server");
const SCHEMA = path.join(ROOT, "deploy", "database", "schema.sql");
const DIST = path.join(ROOT, "dist");
const VERSION = "1.0";

const argv = process.argv.slice(2);
const stageOnly = argv.includes("--stage-only");
const outFlag = argv.indexOf("--out");
const OUTPUT = outFlag !== -1 && argv[outFlag + 1]
  ? path.resolve(argv[outFlag + 1])
  : path.join(DIST, `RMUDTS_v${VERSION}.zip`);
const STAGE = path.join(DIST, "stage");

/** Never copied out of the backend folder. */
const SERVER_EXCLUDE = new Set([
  "node_modules", ".env", ".env.local", "package-lock.json.bak",
  "server.log", "server.err.log", "test-attach.pdf", ".cache", "uploads",
]);
const SERVER_EXCLUDE_PATTERNS = [/\.log$/, /\.tmp$/, /^\.DS_Store$/, /^Thumbs\.db$/];

/** Files that must never end up inside a public archive. */
const FORBIDDEN_PATTERNS = [/\.env$/, /\.env\.[a-z]+$/, /\.pem$/, /\.key$/, /installed\.lock$/, /\.install-state\.json$/];

/**
 * Source maps are dropped from the published frontend. They are ~19 MB here
 * and, because the web root is public, shipping them would hand every visitor
 * a readable copy of the React source. Debugging on the server is done against
 * the log files instead.
 */
const CLIENT_EXCLUDE_PATTERNS = [/\.map$/];

const failures = [];
const notes = [];

function log(message) {
  console.log(message);
}

function fail(message) {
  failures.push(message);
  console.error("  ✖ " + message);
}

function copyTree(src, dst, filter) {
  let count = 0;
  if (!fs.existsSync(src)) return 0;
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (filter && !filter(from, entry)) continue;
    if (entry.isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      count += copyTree(from, to, filter);
    } else if (entry.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      count++;
    }
  }
  return count;
}

function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push({ dir: true, path: full, rel: path.relative(base, full) });
      walk(full, base, out);
    } else if (entry.isFile()) {
      out.push({ dir: false, path: full, rel: path.relative(base, full) });
    }
  }
  return out;
}

function human(bytes) {
  const units = ["B", "kB", "MB", "GB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return (i === 0 ? value : value.toFixed(value < 10 ? 1 : 0)) + " " + units[i];
}

// ---------------------------------------------------------------------------
// 0. Preconditions
// ---------------------------------------------------------------------------
log("RMUDTS release packager");
log("======================");

if (!fs.existsSync(OVERLAY)) {
  fail(`The package overlay is missing: ${OVERLAY}`);
}
if (!fs.existsSync(path.join(CLIENT_BUILD, "index.html"))) {
  fail(
    "No built frontend found at client/build/index.html.\n" +
    "    Run `npm run build` in the client folder first — the installer publishes that build."
  );
}
if (!fs.existsSync(SCHEMA)) {
  fail(
    `database/schema.sql is missing (${SCHEMA}).\n` +
    "    Generate it with: node deploy/tools/generate-schema.cjs"
  );
}
if (!fs.existsSync(path.join(SERVER_DIR, "server.js"))) {
  fail("server/server.js is missing — nothing to deploy.");
}
if (failures.length) {
  console.error("\nBuild aborted.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. Stage
// ---------------------------------------------------------------------------
log(`\n1. Staging into ${path.relative(ROOT, STAGE)}`);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

const overlayFiles = copyTree(OVERLAY, STAGE);
log(`   overlay (installer, docs, placeholders): ${overlayFiles} files`);

const clientDir = path.join(STAGE, "client");
let skippedMaps = 0;
const clientFiles = copyTree(CLIENT_BUILD, clientDir, (full, entry) => {
  if (CLIENT_EXCLUDE_PATTERNS.some((re) => re.test(entry.name))) {
    skippedMaps++;
    return false;
  }
  return true;
});
log(`   frontend build → client/: ${clientFiles} files (${skippedMaps} source map(s) excluded)`);

const serverDir = path.join(STAGE, "server");
const serverFiles = copyTree(SERVER_DIR, serverDir, (full, entry) => {
  if (SERVER_EXCLUDE.has(entry.name)) return false;
  return !SERVER_EXCLUDE_PATTERNS.some((re) => re.test(entry.name));
});
log(`   backend → server/ (node_modules and logs excluded): ${serverFiles} files`);

fs.mkdirSync(path.join(STAGE, "database"), { recursive: true });
fs.copyFileSync(SCHEMA, path.join(STAGE, "database", "schema.sql"));
// The documented archive layout ships schema.sql both inside database/ (what
// the installer imports) and at the root (what a DBA imports by hand into
// phpMyAdmin). Both copies come from the same file in the same build, so they
// cannot drift apart.
fs.copyFileSync(SCHEMA, path.join(STAGE, "schema.sql"));
log("   database/schema.sql (+ root schema.sql for manual imports)");

// ---------------------------------------------------------------------------
// 2. Guardrails
// ---------------------------------------------------------------------------
log("\n2. Checking the staged tree");

const staged = walk(STAGE);
let leaks = 0;
let bloat = 0;
for (const item of staged) {
  const rel = item.rel.split(path.sep).join("/");
  if (item.dir && item.rel.includes("node_modules")) {
    fail(`node_modules must not ship: ${rel}`);
    bloat++;
    continue;
  }
  // Templates are documentation by design: they show the *names* of the
  // variables with placeholder values and never a real credential.
  const isTemplate = rel.startsWith("templates/") && rel.endsWith(".example");
  if (!item.dir && !isTemplate && FORBIDDEN_PATTERNS.some((re) => re.test(item.rel))) {
    fail(`secret-like file in the archive: ${rel}`);
    leaks++;
  }
}
if (!leaks && !bloat) {
  log(`   ${staged.length} entries staged, no secrets and no node_modules`);
}

// The installer's own requirements, re-checked here so a broken package never
// reaches the administrator.
const required = [
  "index.php",
  "VERSION",
  ".htaccess",
  "install/index.php",
  "install/upgrade.php",
  "install/lib/Installer.php",
  "install/lib/Upgrader.php",
  "install/lib/Migrations.php",
  "install/views/layout.php",
  "install/views/upgrade.php",
  "install/assets/css/installer.css",
  "install/assets/js/installer.js",
  "database/schema.sql",
  "schema.sql",
  "client/index.html",
  "server/server.js",
  "server/package.json",
  "templates/frontend.htaccess",
  "templates/backend.env.example",
  "docs/INSTALL.md",
  "docs/TROUBLESHOOTING.md",
  "docs/DEPLOYMENT-CHECKLIST.md",
  "README.md",
];
for (const rel of required) {
  const target = path.join(STAGE, rel.split("/").join(path.sep));
  if (!fs.existsSync(target)) {
    fail(`required file missing from the package: ${rel}`);
  }
}
if (failures.length) {
  console.error("\nBuild aborted — the staged package is incomplete.");
  process.exit(1);
}

// Every PHP file must parse. The host runs the same PHP the archive will, so a
// syntax error here is a failed installation there.
log("\n3. Linting every PHP file with the local PHP binary");
const phpCandidates = [
  path.join(ROOT, "deploy", "tools", "php", process.platform === "win32" ? "php.exe" : "php"),
  "php",
];
let linted = 0;
let lintTool = null;
for (const candidate of phpCandidates) {
  try {
    execFileSync(candidate, ["-v"], { stdio: "ignore" });
    lintTool = candidate;
    break;
  } catch (err) {
    /* try the next candidate */
  }
}
if (lintTool === null) {
  notes.push("PHP was not available, so the staged PHP files were not linted.");
  log("   skipped — no PHP binary found");
} else {
  const phpFiles = staged.filter((item) => !item.dir && item.rel.endsWith(".php")).map((item) => item.path);
  let bad = 0;
  for (const file of phpFiles) {
    try {
      execFileSync(lintTool, ["-l", file], { stdio: "pipe" });
      linted++;
    } catch (err) {
      bad++;
      fail(`php -l failed: ${path.relative(STAGE, file)}\n${(err.stdout || "").toString().trim()}`);
    }
  }
  log(`   ${linted} file(s) parsed${bad ? `, ${bad} failed` : ""}`);
  if (bad) {
    console.error("\nBuild aborted — fix the PHP errors above.");
    process.exit(1);
  }
}

if (stageOnly) {
  log(`\nStaged package left in ${path.relative(ROOT, STAGE)} (--stage-only).`);
  if (notes.length) notes.forEach((note) => log("   note: " + note));
  process.exit(0);
}

// ---------------------------------------------------------------------------
// 3b. Checksums
// ---------------------------------------------------------------------------
// checksums.json lets the installer answer "is this archive complete and
// unmodified?" before it writes anything. It covers every staged file except
// itself, so it can never claim a hash for its own content.
log("\n3b. Writing checksums.json");
const manifest = {
  product: "RMUDTS",
  version: VERSION,
  generated_at: new Date().toISOString(),
  algorithm: "sha256",
  files: {},
};
const allStaged = walk(STAGE).filter((item) => !item.dir);
for (const item of allStaged) {
  const rel = item.rel.split(path.sep).join("/");
  if (rel === "checksums.json") continue;
  manifest.files[rel] = require("crypto").createHash("sha256").update(fs.readFileSync(item.path)).digest("hex");
}
const checksumFile = path.join(STAGE, "checksums.json");
fs.writeFileSync(checksumFile, JSON.stringify(manifest, null, 2) + "\n");
// `staged` was collected before this file existed; add it so the archive
// carries the manifest it documents.
staged.push({ dir: false, path: checksumFile, rel: "checksums.json" });
log(`   ${Object.keys(manifest.files).length} file(s) hashed`);

// ---------------------------------------------------------------------------
// 4. Zip
// ---------------------------------------------------------------------------
log("\n4. Writing the archive");
const zip = new Zip();
// Entries sit at the ARCHIVE ROOT on purpose: the deployment scenario is
// "upload RMUDTS_v1.0.zip to public_html and extract", and the wizard must
// then answer on https://domain/install — not on /RMUDTS/install.
let added = 0;
let bytes = 0;
const sorted = staged.sort((a, b) => a.rel.localeCompare(b.rel));
for (const item of sorted) {
  const name = item.rel.split(path.sep).join("/");
  if (item.dir) {
    zip.addDirectory(name, { mode: 0o40755 });
    continue;
  }
  zip.addFileFromDisk(name, item.path);
  added++;
  bytes += fs.statSync(item.path).size;
}

zip.writeTo(OUTPUT);
const archiveSize = fs.statSync(OUTPUT).size;

log(`   ${added} files, ${human(bytes)} of content → ${human(archiveSize)} archive`);
log(`\n✔ ${path.relative(ROOT, OUTPUT)}`);
log("\nNext: upload it to public_html, extract, and open /install.");
if (notes.length) {
  log("\nNotes:");
  notes.forEach((note) => log("   • " + note));
}
