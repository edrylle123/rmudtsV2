// server/activityLog.js
// Audit trail: every signed-in action (all writes, sign-ins and page views) is
// stored in `activity_logs`, and the super admin can read it from the
// "Activity Logs" page. Reads are deliberately NOT logged one by one, otherwise
// the dashboard/notification polling would bury the real events.
// ---- Human readable labels ------------------------------------------------
// Ordered: the first matching rule wins. `:id` segments are captured and shown
// as "#id" so an entry stays readable without a database lookup.
const RULES = [
  ["POST", /^\/login$/, "Signed in"],
  ["POST", /^\/signup$/, "Created an account"],
  ["POST", /^\/records$/, "Created a record"],
  ["PUT", /^\/records\/(\d+)$/, "Updated record #$1"],
  ["DELETE", /^\/records\/([\d]+)$/, "Deleted record #$1"],
  ["DELETE", /^\/records\/(\d+)\/files\/([^/]+)$/, "Deleted an attachment from record #$1"],
  ["PUT", /^\/records\/forward\/(\d+)$/, "Forwarded record #$1"],
  ["POST", /^\/records\/move$/, "Moved a record"],
  ["POST", /^\/api\/records\/(\d+)\/slip$/, "Generated the routing slip for record #$1"],
  ["POST", /^\/api\/tracking\/release$/, "Released a document"],
  ["POST", /^\/api\/tracking\/receive$/, "Received a document"],
  ["POST", /^\/api\/incoming-documents$/, "Uploaded an incoming document"],
  ["PUT", /^\/api\/incoming-documents\/(\d+)\/process$/, "Processed incoming document #$1"],
  ["DELETE", /^\/api\/incoming-documents\/(\d+)$/, "Deleted incoming document #$1"],
  ["PUT", /^\/users\/(\d+)$/, "Updated user #$1"],
  ["DELETE", /^\/users\/(\d+)$/, "Deleted user #$1"],
  ["POST", /^\/createuser$/, "Created a user"],
  ["POST", /^\/api\/admin\/offices$/, "Added an office"],
  ["PUT", /^\/api\/admin\/offices\/(\d+)\/assign$/, "Assigned a user to office #$1"],
  ["PUT", /^\/api\/admin\/offices\/(\d+)\/unassign$/, "Removed a user from office #$1"],
  ["PUT", /^\/api\/admin\/offices\/(\d+)$/, "Renamed office #$1"],
  ["DELETE", /^\/api\/admin\/offices\/(\d+)$/, "Deleted office #$1"],
  ["POST", /^\/api\/admin\/dropdown-options$/, "Added a dropdown option"],
  ["PUT", /^\/api\/admin\/dropdown-options\/(\d+)$/, "Edited a dropdown option"],
  ["DELETE", /^\/api\/admin\/dropdown-options\/(\d+)$/, "Deleted a dropdown option"],
  ["GET", /^\/api\/admin\/database\/backup$/, "Downloaded a database backup"],
  ["POST", /^\/api\/admin\/database\/restore$/, "Restored the database from a backup"],
  ["PUT", /^\/api\/settings\/routing-slip$/, "Updated routing slip settings"],
  ["POST", /^\/api\/activity\/page-view$/, "Opened a page"],
];

const VERB = {
  POST: "Created (POST ",
  PUT: "Updated (PUT ",
  PATCH: "Updated (PATCH ",
  DELETE: "Deleted (DELETE ",
};

function describe(method, rawPath) {
  const clean = String(rawPath || "").split("?")[0];
  for (const [m, re, label] of RULES) {
    if (m !== method) continue;
    const match = re.exec(clean);
    if (match) return label.replace(/\$(\d)/g, (_, i) => match[Number(i)] || "");
  }
  const prefix = VERB[method];
  return prefix ? `${prefix}${clean})` : `${method} ${clean}`;
}

// ---- Details --------------------------------------------------------------
// Only a few harmless fields are kept so the log is useful without ever
// storing credentials or large blobs.
const DETAIL_FIELDS = [
  "control_number",
  "description",
  "title",
  "classification",
  "priority",
  "record_origin",
  "office_requestor",
  "destination_office",
  "concerned_personnel",
  "status",
  "name",
  "email",
  "office",
  "from_office",
  "to_office",
  "value",
  "category",
  "path",
  "action",
];

function summarize(body) {
  if (!body || typeof body !== "object") return "";
  const parts = [];
  for (const key of DETAIL_FIELDS) {
    const raw = body[key];
    if (raw === undefined || raw === null || raw === "") continue;
    let value = typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    if (value.length > 70) value = value.slice(0, 70) + "…";
    parts.push(`${key}: ${value}`);
    if (parts.length >= 4) break;
  }
  return parts.join(" · ").slice(0, 400);
}

// ---- Skip list ------------------------------------------------------------
// Noise or non-user traffic: auth refresh, notification counters, uploads and
// the page-view call itself (which is logged explicitly with its own label).
function isIgnored(req) {
  const p = String(req.originalUrl || req.url || "").split("?")[0];
  if (p.startsWith("/socket.io")) return true;
  if (p.startsWith("/uploads")) return true;
  if (p.startsWith("/api/file-proxy")) return true;
  if (p === "/refresh-token") return true;
  if (p === "/login") return true; // the login route logs success and failure itself
  if (p === "/api/activity/page-view") return true; // logged explicitly by that route
  if (p === "/api/notifications/mark-read") return true;
  return false;
}

const CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS activity_logs (
    id INT NOT NULL AUTO_INCREMENT,
    user_id INT NULL,
    user_name VARCHAR(150) NULL,
    user_role VARCHAR(40) NULL,
    office VARCHAR(150) NULL,
    action VARCHAR(200) NOT NULL,
    method VARCHAR(10) NULL,
    path VARCHAR(255) NULL,
    details VARCHAR(500) NULL,
    status_code INT NULL,
    ip VARCHAR(64) NULL,
    user_agent VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_activity_created (created_at),
    KEY idx_activity_user (user_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

function createActivityLogger(db) {
  let ready = false;

  function run(sql, params) {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err, result) => (err ? reject(err) : resolve(result)));
    });
  }

  async function ensureTable() {
    await run(CREATE_SQL);
    // Keep the table from growing forever: drop entries older than a year.
    await run(
      "DELETE FROM activity_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 365 DAY)"
    );
    ready = true;
  }

  function log(entry) {
    const user = entry.user || {};
    const params = [
      user.id ?? null,
      user.name ? String(user.name).slice(0, 150) : null,
      user.role ? String(user.role).slice(0, 40) : null,
      user.office ? String(user.office).slice(0, 150) : null,
      String(entry.action || "Unknown action").slice(0, 200),
      entry.method ? String(entry.method).slice(0, 10) : null,
      entry.path ? String(entry.path).slice(0, 255) : null,
      entry.details ? String(entry.details).slice(0, 500) : null,
      entry.status ?? null,
      entry.ip ? String(entry.ip).slice(0, 64) : null,
      entry.userAgent ? String(entry.userAgent).slice(0, 255) : null,
    ];
    db.query(
      `INSERT INTO activity_logs
         (user_id, user_name, user_role, office, action, method, path, details, status_code, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params,
      (err) => {
        if (err) console.error("[activity] insert failed:", err.message);
      }
    );
  }

  function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded) return String(forwarded).split(",")[0].trim();
    return (req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  }

  // Logs every write request (POST/PUT/PATCH/DELETE) once the response is
  // finished, so the recorded status code is the real one.
  function middleware(req, res, next) {
    if (req.method === "GET" || req.method === "OPTIONS") return next();
    if (isIgnored(req)) return next();

    res.on("finish", () => {
      if (!ready) return; // table not ready yet (first seconds after boot)
      const cleanPath = String(req.originalUrl || req.url || "").split("?")[0];
      log({
        user: req.user || null,
        action: describe(req.method, cleanPath),
        method: req.method,
        path: cleanPath,
        details: summarize(req.body),
        status: res.statusCode,
        ip: clientIp(req),
        userAgent: req.get?.("user-agent") || "",
      });
    });
    next();
  }

  return { ensureTable, log, middleware, clientIp, describe, summarize };
}

module.exports = { createActivityLogger, describe, summarize };
