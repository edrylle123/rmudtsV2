// server.js
// Load .env with override so a stray PORT (or other var) inherited from the
// shell environment can't hijack the backend — .env is authoritative.
require("dotenv").config({ override: true });
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2");
const bcrypt = require("bcrypt");
const multer = require("multer");
const { execFile, execFileSync, spawn } = require("child_process");
const sharp = require("sharp");
const { PDFDocument } = require("pdf-lib");
const QRCode = require("qrcode");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createActivityLogger } = require("./activityLog");
const {
  getRoutingSlipSettings,
  saveRoutingSlipSettings,
  attachRoutingSlipToRecord,
  buildRoutingSlipPdf,
  mergeRoutingSlipWithDocument,
  drawRoutingSlipPng,
} = require("./routingSlip");

// ====== Core middleware ======
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || "http://localhost:3000,http://localhost:3001")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const app = express();
app.use(cors({ origin: CLIENT_ORIGINS }));
app.use(express.json());

// Upload root. Defaults to ./uploads next to this file; the one-click
// installer points UPLOAD_DIR at a writable folder outside public_html so
// attachments are never web-addressable as anything but proxied downloads.
const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Multer file storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Max file size 10MB
});

// ====== Database ======
// Use a pool (not a single connection) so a connection dropped by MySQL
// (idle wait_timeout, server restart, network blip) is replaced instead of
// leaving the process with a dead connection that rejects every query with
// "Can't add new command when connection is in closed state".
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  // The installer writes DB_PORT; honour it so a host that does not use 3306
  // (or a socket-less remote MySQL) works without editing source.
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "records_db",
  connectionLimit: 10,
  waitForConnections: true,
  enableKeepAlive: true, // ping idle connections so MySQL doesn't close them
  keepAliveInitialDelay: 0,
});
db.on("error", (err) => {
  console.error("MySQL pool error:", err.message);
});

// Detect whether the users table has an email column so signup/user routes
// work with either schema (older installs were created without it).
let HAS_EMAIL_COL = true;
db.query(
  "SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email'",
  (err, rows) => {
    if (!err && rows && rows[0]) HAS_EMAIL_COL = rows[0].c > 0;
  }
);

function queryPromise(sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// ====== Activity log ======
// One row per signed-in write action / sign-in / page view. The super admin
// reads it from the "Activity Logs" page.
const activityLogger = createActivityLogger(db);
app.use(activityLogger.middleware);

// ====== JWT Secrets ======
const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || "dev_refresh_secret_change_me";
const JWT_SECRET = process.env.JWT_SECRET || "dev_jwt_secret_change_me";

// ====== File proxy (serves uploads with headers that prevent IDM interception) ======
app.get("/api/file-proxy", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: "path required" });
  // Normalize: strip leading slash if present since uploadDir already has it
  const cleanPath = filePath.replace(/^\/+uploads\//, "");
  const fullPath = path.join(uploadDir, cleanPath);
  // Security: ensure the resolved path stays inside uploadDir
  const resolved = path.resolve(fullPath);
  const uploadResolved = path.resolve(uploadDir);
  if (!resolved.startsWith(uploadResolved)) {
    return res.status(403).json({ error: "access denied" });
  }
  if (!fs.existsSync(resolved)) {
    return res.status(404).json({ error: "file not found" });
  }
  const ext = path.extname(resolved).toLowerCase();
  const mimeMap = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
  };
  const mime = mimeMap[ext] || "application/octet-stream";
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "no-cache, must-revalidate");
  res.setHeader("Access-Control-Allow-Origin", "*");
  fs.createReadStream(resolved).pipe(res);
});

// ====== PDF Viewer (HTML wrapper to bypass IDM) ======
app.get("/api/pdf-viewer", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send("path required");
  const cleanPath = filePath.replace(/^\/+uploads\//, "");
  const fullPath = path.join(uploadDir, cleanPath);
  const resolved = path.resolve(fullPath);
  const uploadResolved = path.resolve(uploadDir);
  if (!resolved.startsWith(uploadResolved)) return res.status(403).send("access denied");
  if (!fs.existsSync(resolved)) return res.status(404).send("file not found");
  // Serve an HTML page that renders the PDF as page images via /preview-pdf
  // IDM cannot intercept <img> tags — the PDF is rasterized server-side
  const fileParam = encodeURIComponent(cleanPath);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: #525659; }
  body { display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 10px; overflow-y: auto; }
  .page { background: white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); max-width: 95vw; }
  .page img { display: block; max-width: 100%; height: auto; }
  #loading { display: flex; align-items: center; justify-content: center; height: 80vh; font-family: Arial; color: #999; font-size: 18px; }
  .page-num { text-align: center; color: #aaa; font-family: Arial; font-size: 12px; padding: 4px; }
</style></head><body>
  <div id="loading">Loading PDF...</div>
  <script>
  (async function() {
    const container = document.body;
    try {
      const infoResp = await fetch("/preview-pdf?file=${fileParam}&info=1");
      if (!infoResp.ok) throw new Error("Cannot get page count");
      const { numPages } = await infoResp.json();
      document.getElementById("loading").remove();
      for (let i = 1; i <= numPages; i++) {
        const div = document.createElement("div");
        div.className = "page";
        const img = document.createElement("img");
        img.src = "/preview-pdf?file=${fileParam}&page=" + i;
        img.loading = "lazy";
        div.appendChild(img);
        const num = document.createElement("div");
        num.className = "page-num";
        num.textContent = "Page " + i + " of " + numPages;
        div.appendChild(num);
        container.appendChild(div);
      }
    } catch(e) {
      document.getElementById("loading").textContent = "Error: " + e.message;
    }
  })();
  </script>
</body></html>`);
});

// ====== Static uploads ======
app.use(
  "/uploads",
  express.static(uploadDir, {
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.setHeader("Access-Control-Allow-Origin", "*");
    },
  })
);

// ====== PDF page previews ======
// Rasterize PDF pages to PNGs server-side (pdfPreview.js) so the attachment
// viewer only ever displays plain <img> tags — no browser PDF viewer, no
// pdf.js worker, no HTTP-cache dependency. GET /preview-pdf?file=<name>&info=1
// returns { numPages }; GET /preview-pdf?file=<name>&page=N returns the PNG.
const pdfPreview = require("./pdfPreview");
app.get("/preview-pdf", async (req, res) => {
  try {
    const file = req.query.file;
    const etag = pdfPreview.fileEtag(file);
    if (etag === null)
      return res.status(404).json({ error: "File not found" });

    if (req.query.info === "1") {
      const numPages = await pdfPreview.getNumPages(file);
      if (numPages === null)
        return res.status(404).json({ error: "File not found" });
      return res.json({ numPages, etag });
    }

    const page = parseInt(req.query.page, 10);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    if (req.headers["if-none-match"] === etag) return res.status(304).end();

    const png = await pdfPreview.renderPagePng(file, page, etag);
    if (png === null)
      return res.status(404).json({ error: "Page not found" });
    res.setHeader("Content-Type", "image/png");
    return res.send(png);
  } catch (err) {
    console.error("preview-pdf error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ====== File siblings ======
// Given a stored file path, return every file that belongs to the same record
// plus the record's control number. The AttachmentViewer uses this to show
// the document and its routing slip side by side in a split view (and, when
// no slip has been saved yet, to generate a slip preview for the document).
app.get("/api/files/siblings", verifyToken, (req, res) => {
  const file = req.query.file;
  if (!file) return res.status(400).json({ error: "Missing file" });
  const stored = String(file).split("?")[0].replace(/^\/+/, "");
  db.query(
    `SELECT rf.id, rf.file_name, rf.file_path, rf.file_type, r.control_number, r.id AS record_id
     FROM record_files rf
     JOIN record_files self ON self.record_id = rf.record_id
     JOIN records r ON r.id = rf.record_id
     WHERE self.file_path = ?
     ORDER BY rf.id ASC`,
    [`/${stored}`],
    (err, rows) => {
      if (err) {
        console.error("siblings error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      res.json({
        files: rows || [],
        control_number: rows?.[0]?.control_number || null,
        record_id: rows?.[0]?.record_id || null,
      });
    }
  );
});

// ====== Save a routing slip onto a record (without forwarding) ======
// Lets an office fill in a routing slip (checked actions + comments) and
// attach it to the document directly from the AttachmentViewer, so the slip
// is saved as its own PDF before the document is ever forwarded.
app.post("/api/records/:id/slip", verifyToken, async (req, res) => {
  const { id } = req.params;
  const slip = req.body && typeof req.body === "object" ? req.body : {};
  try {
    const recRows = await queryPromise(
      "SELECT control_number, routing_slip_data FROM records WHERE id = ?",
      [id]
    );
    if (!recRows || recRows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    // Only allow one routing slip per document — reject if one already exists
    if (recRows[0].routing_slip_data) {
      return res.status(409).json({ error: "A routing slip already exists for this document. Only one routing slip is allowed per document." });
    }
    const settings = await getRoutingSlipSettings(db);
    const attached = await attachRoutingSlipToRecord({
      db,
      uploadDir,
      recordId: id,
      controlNumber: recRows[0].control_number,
      slip,
      settings,
    });
    // Store the slip data so it can be reused when forwarding
    await queryPromise(
      "UPDATE records SET routing_slip_data = ? WHERE id = ?",
      [JSON.stringify(slip), id]
    );

    // Immediately merge routing slip + document into one PDF
    let mergedInfo = null;
    try {
      const slipPdfPath = path.join(uploadDir, path.basename(attached.filePath));
      if (fs.existsSync(slipPdfPath)) {
        const slipPdfBuffer = fs.readFileSync(slipPdfPath);
        const docFiles = await queryPromise(
          "SELECT file_path FROM record_files WHERE record_id = ? AND LOWER(file_name) NOT LIKE 'routing%' AND LOWER(file_name) NOT LIKE 'merged%' LIMIT 1",
          [id]
        );
        if (docFiles && docFiles[0] && docFiles[0].file_path) {
          console.log(`Instant merge: merging routing slip with document for record ${id}...`);
          mergedInfo = await mergeRoutingSlipWithDocument({
            db, uploadDir, recordId: id, controlNumber: recRows[0].control_number,
            slipPdfBuffer, documentFilePath: docFiles[0].file_path,
          });
          if (mergedInfo) {
            console.log(`Instant merge SUCCESS for record ${id}: ${mergedInfo.filePath}`);
          }
        }
      }
    } catch (mergeErr) {
      console.error("Instant merge error:", mergeErr.message);
    }

    io.emit("recordUpdated", { record_id: id });
    res.json({ success: true, ...attached, merged: mergedInfo ? mergedInfo.fileName : null });
  } catch (err) {
    console.error("Save routing slip error:", err.message);
    res.status(500).json({ error: err.message || "Failed to save routing slip" });
  }
});

// ====== Routing slip preview ======
// Render a routing slip template PNG on the fly for a control number, WITHOUT
// saving anything. The AttachmentViewer shows this in the slip pane for every
// PDF — prefilled with the document's control number — until the document is
// actually forwarded with a slip (which saves a real slip PDF instead).
// Like /preview-pdf, this is served without auth because it is rendered as a
// plain <img> in the browser (no Authorization header possible).
app.get("/api/routing-slip/preview.png", async (req, res) => {
  try {
    const controlNumber = String(req.query.control_number || "").trim();
    if (!controlNumber)
      return res.status(400).json({ error: "Missing control_number" });
    const settings = await getRoutingSlipSettings(db);
    const today = new Date();
    const dateStr = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(
      today.getDate()
    ).padStart(2, "0")}/${today.getFullYear()}`;
    const png = await drawRoutingSlipPng(
      {
        control_number: controlNumber,
        to: "",
        from: settings.signer_name || "",
        from_title: settings.signer_title || "",
        date: dateStr,
        actions: [],
        others: "",
        comments: "",
      },
      settings
    );
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    return res.send(png);
  } catch (err) {
    console.error("routing-slip preview error:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ====== Get saved routing slip data for a record ======
app.get("/api/records/:id/slip-data", verifyToken, async (req, res) => {
  try {
    const rows = await queryPromise(
      "SELECT routing_slip_data FROM records WHERE id = ?",
      [req.params.id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    const data = rows[0].routing_slip_data;
    if (!data) {
      return res.json({ slip: null });
    }
    const slip = typeof data === "string" ? JSON.parse(data) : data;
    res.json({ slip });
  } catch (err) {
    console.error("Get slip data error:", err.message);
    res.status(500).json({ error: "Failed to load slip data" });
  }
});

// ====== HTTP + Socket.IO ======
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CLIENT_ORIGINS, methods: ["GET", "POST"] },
});
app.set("io", io);

// ====== Health and service identity ======
// A deployment check must be able to prove the API is alive and can reach
// MySQL without exposing configuration, credentials or stack traces.
const SERVICE_STARTED_AT = new Date();
app.get("/api/health", (req, res) => {
  db.query("SELECT 1 AS ok", (err) => {
    res.status(err ? 503 : 200).json({
      status: err ? "degraded" : "ok",
      service: "rmudts-api",
      database: err ? "unreachable" : "connected",
      uptime_seconds: Math.round(process.uptime()),
      started_at: SERVICE_STARTED_AT.toISOString(),
    });
  });
});

app.get("/", (req, res) => {
  res.json({
    service: "rmudts-api",
    status: "ok",
    health: "/api/health",
    socket: "/socket.io",
  });
});

io.on("connection", (socket) => {
  console.log("⚡ Socket connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// ====== Auth helpers ======
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader)
    return res.status(401).json({ message: "No token provided" });
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer")
    return res.status(401).json({ message: "Bad authorization header" });
  const token = parts[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });
    req.user = decoded; // { id, idnumber, role, name, office }
    next();
  });
}
// Populates req.user when a valid token is present, but never rejects the
// request. Used by routes that have always been open (record creation) while
// still letting them attribute the action to the signed-in account.
function softAuth(req, _res, next) {
  const parts = (req.headers["authorization"] || "").split(" ");
  if (parts.length === 2 && parts[0] === "Bearer") {
    try {
      req.user = jwt.verify(parts[1], JWT_SECRET); // { id, idnumber, role, name, office }
    } catch (err) {
      // Anonymous caller — the route keeps working, the actor stays unknown.
    }
  }
  next();
}
function verifyAdmin(req, res, next) {
  const role = req.user?.role;
  if (!role || (role !== "admin" && role !== "super_admin")) {
    return res.status(403).json({ message: "Admins only" });
  }
  next();
}
// Super-admin only: office management + all-users list.
function verifySuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== "super_admin") {
    return res.status(403).json({ message: "Super admin access required" });
  }
  next();
}

// ====== File conversion (images / office docs -> PDF) ======
const OFFICE_EXTS = [
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".txt",
];
function findSoffice() {
  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
      "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ];
    for (const p of candidates) if (fs.existsSync(p)) return p;
  }
  return "soffice";
}
function convertOfficeToPdf(inputAbs, outDir) {
  return new Promise((resolve) => {
    const soffice = findSoffice();
    const args = [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      inputAbs,
    ];
    execFile(soffice, args, { windowsHide: true }, (err) => {
      if (err) return resolve(null);
      const basename = path.basename(inputAbs, path.extname(inputAbs)) + ".pdf";
      const outAbs = path.join(outDir, basename);
      resolve(fs.existsSync(outAbs) ? outAbs : null);
    });
  });
}
async function convertImageToPdf(inputPath, outPath) {
  try {
    const ext = path.extname(inputPath).toLowerCase();
    const bytes = fs.readFileSync(inputPath);
    const pdfDoc = await PDFDocument.create();
    if (ext === ".jpg" || ext === ".jpeg") {
      const img = await pdfDoc.embedJpg(bytes);
      const { width, height } = img;
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
    } else {
      let pngBytes = bytes;
      if (ext !== ".png") pngBytes = await sharp(bytes).png().toBuffer();
      const img = await pdfDoc.embedPng(pngBytes);
      const { width, height } = img;
      const page = pdfDoc.addPage([width, height]);
      page.drawImage(img, { x: 0, y: 0, width, height });
    }
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(outPath, pdfBytes);
    return outPath;
  } catch (e) {
    console.error("convertImageToPdf failed:", e?.message);
    return null;
  }
}
// Returns conversion metadata when a PDF was produced, or null to keep the
// original file (already a PDF, unsupported type, or conversion failure).
async function convertToPdfIfNeeded(file) {
  try {
    const inputAbs = path.join(uploadDir, file.filename);
    const ext = path.extname(file.originalname || file.filename).toLowerCase();
    const mime = file.mimetype || "";

    if (mime.includes("pdf") || ext === ".pdf") return null;

    const targetAbs = path.join(
      uploadDir,
      path.basename(file.filename, path.extname(file.filename)) + ".pdf"
    );

    if (
      mime.startsWith("image/") ||
      [
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".tif",
        ".tiff",
        ".jxl",
        ".jp2",
        ".j2k",
        ".jpx",
      ].includes(ext)
    ) {
      const out = await convertImageToPdf(inputAbs, targetAbs);
      if (!out) return null;
      const stat = fs.statSync(out);
      return {
        name: path.basename(file.originalname, ext) + ".pdf",
        type: "application/pdf",
        size: stat.size,
        pdfPath: "/uploads/" + path.basename(out),
      };
    }

    if (OFFICE_EXTS.includes(ext)) {
      const out = await convertOfficeToPdf(inputAbs, uploadDir);
      if (!out) return null;
      const stat = fs.statSync(out);
      return {
        name: path.basename(file.originalname, ext) + ".pdf",
        type: "application/pdf",
        size: stat.size,
        pdfPath: "/uploads/" + path.basename(out),
      };
    }
  } catch (e) {
    console.error("convertToPdfIfNeeded failed:", e?.message);
  }
  return null;
}

// Store uploaded files (optionally converted to PDF) for a record.
async function storeUploadedFiles(recordId, files, retentionPeriod = "") {
  if (!Array.isArray(files) || files.length === 0) return;
  const rows = [];
  for (const file of files) {
    let name = file.originalname || file.filename;
    let type = file.mimetype || "application/octet-stream";
    let size = file.size;
    let filePath = "/uploads/" + file.filename;

    const converted = await convertToPdfIfNeeded(file);
    if (converted) {
      name = converted.name;
      type = converted.type;
      size = converted.size;
      filePath = converted.pdfPath;
      fs.unlink(path.join(uploadDir, file.filename), () => {}); // remove original
    }
    // record_files.retention_period is NOT NULL — supply it explicitly so the
    // insert works even when MySQL runs in strict mode.
    rows.push([
      recordId,
      filePath,
      name,
      size,
      type,
      String(retentionPeriod || ""),
    ]);
  }
  if (rows.length) {
    await queryPromise(
      "INSERT INTO record_files (record_id, file_path, file_name, file_size, file_type, retention_period) VALUES ?",
      [rows]
    );
  }
}

// ====== AUTH ROUTES ======
app.get("/login", (req, res) => {
  res.json({ message: "POST /login with { idnumber, password }" });
});

app.post("/signup", async (req, res) => {
  const { name, password, role, idnumber, office, email } = req.body || {};
  if (!name || !password || !idnumber) {
    return res.status(400).json({
      success: false,
      message: "Name, password, and ID number are required",
    });
  }
  if (!role || role === "Select Role") {
    return res.status(400).json({
      success: false,
      message: "Please select a role",
    });
  }
  if (!office) {
    return res.status(400).json({
      success: false,
      message: "Office is required",
    });
  }
  // Only admins / super-admins may create admin accounts.
  if (role === "admin" || role === "super_admin") {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.split(" ")[1];
    let canCreate = false;
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        canCreate = decoded && (decoded.role === "admin" || decoded.role === "super_admin");
      } catch {
        /* ignore */
      }
    }
    if (!canCreate) {
      return res.status(403).json({
        success: false,
        message: "Only an administrator can create admin accounts",
      });
    }
  }

  try {
    const rows = await queryPromise(
      "SELECT id FROM users WHERE idnumber = ?",
      [idnumber]
    );
    if (rows.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "ID Number already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const emailValue = email && String(email).trim() ? email : "";
    const columns = ["name", "password", "role", "idnumber", "office"];
    const values = [name, hashedPassword, role, idnumber, office];
    if (HAS_EMAIL_COL) {
      columns.push("email");
      values.push(emailValue);
    }
    const result = await queryPromise(
      `INSERT INTO users (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
      values
    );

    const user = { id: result.insertId, name, role, idnumber, office };
    if (HAS_EMAIL_COL) user.email = emailValue;
    return res.status(201).json({
      success: true,
      message: "User created successfully",
      user,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.post("/login", (req, res) => {
  const { idnumber, password } = req.body || {};
  if (!idnumber || !password)
    return res.status(400).json({ message: "ID Number and password required" });

  const logSignIn = (user, ok, reason) => {
    activityLogger.log({
      user: user
        ? { id: user.id, name: user.name, role: user.role, office: user.office }
        : null,
      action: ok ? "Signed in" : "Failed sign-in attempt",
      method: "POST",
      path: "/login",
      details: ok
        ? `ID number: ${idnumber}`
        : `ID number: ${idnumber}${reason ? ` · ${reason}` : ""}`,
      status: ok ? 200 : 401,
      ip: activityLogger.clientIp(req),
      userAgent: req.get?.("user-agent") || "",
    });
  };

  db.query(
    "SELECT * FROM users WHERE idnumber = ?",
    [idnumber],
    async (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      if (!rows || rows.length === 0) {
        logSignIn(null, false, "unknown ID number");
        return res
          .status(401)
          .json({ success: false, message: "Invalid ID Number or password" });
      }
      const user = rows[0];
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        logSignIn(user, false, "wrong password");
        return res
          .status(401)
          .json({ success: false, message: "Invalid ID Number or password" });
      }
      logSignIn(user, true);

      const payload = {
        id: user.id,
        idnumber: user.idnumber,
        role: user.role,
        name: user.name,
        office: user.office,
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1h" });
      const refreshToken = jwt.sign(payload, REFRESH_TOKEN_SECRET, {
        expiresIn: "7d",
      });

      return res.json({
        success: true,
        token,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          idnumber: user.idnumber,
          office: user.office,
          ...(HAS_EMAIL_COL && user.email ? { email: user.email } : {}),
        },
      });
    }
  );
});

app.post("/refresh-token", (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(400).json({ error: "refreshToken required" });
  jwt.verify(refreshToken, REFRESH_TOKEN_SECRET, (err, decoded) => {
    if (err)
      return res
        .status(403)
        .json({ error: "Invalid or expired refresh token" });
    const newToken = jwt.sign(
      {
        id: decoded.id,
        idnumber: decoded.idnumber,
        role: decoded.role,
        name: decoded.name,
        office: decoded.office,
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );
    return res.json({
      token: newToken,
      user: {
        id: decoded.id,
        idnumber: decoded.idnumber,
        role: decoded.role,
        name: decoded.name,
        office: decoded.office,
      },
    });
  });
});

// ====== USERS ======
const USER_COLS = () =>
  HAS_EMAIL_COL
    ? "id, name, email, role, idnumber, office"
    : "id, name, role, idnumber, office";

app.get("/users", verifyToken, verifySuperAdmin, (req, res) => {
  db.query(`SELECT ${USER_COLS()} FROM users`, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    return res.json(rows);
  });
});

app.put("/users/:id", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, role, password, idnumber, office } = req.body || {};
  if (!name || !idnumber || !role) {
    return res
      .status(400)
      .json({ message: "name, idnumber and role are required" });
  }
  try {
    const sets = ["name = ?", "role = ?", "idnumber = ?", "office = ?"];
    const values = [name, role, idnumber || "", office || ""];
    if (HAS_EMAIL_COL) {
      sets.push("email = ?");
      values.push((email && String(email).trim()) || "");
    }
    if (password && String(password).trim() !== "") {
      const hashed = await bcrypt.hash(password, 10);
      sets.push("password = ?");
      values.push(hashed);
    }
    values.push(id);
    await queryPromise(
      `UPDATE users SET ${sets.join(", ")} WHERE id = ?`,
      values
    );
    return res.json({ success: true, message: "User updated successfully" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

app.delete("/users/:id", verifyToken, verifySuperAdmin, (req, res) => {
  db.query("DELETE FROM users WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ message: err.message });
    return res.json({ success: true, message: "User deleted successfully" });
  });
});

// ====== OFFICES ======
// Ensure the offices table exists.
queryPromise(
  `CREATE TABLE IF NOT EXISTS offices (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
).then(() => {
  // Seed static offices into the DB so they're all manageable from the UI.
  const placeholders = STATIC_OFFICES.map(() => "(?)").join(", ");
  return queryPromise(
    `INSERT IGNORE INTO offices (name) VALUES ${placeholders}`,
    STATIC_OFFICES
  );
}).catch((err) => console.error("Seed static offices:", err.message));

const STATIC_OFFICES = [
  "Office of the President",
  "VP Admin and Finance",
  "VP Academic Research and Extension",
  "Office of the Campus Administrator",
  "Office of the University Board Secretary",
  "Office of the Supervising Administrative Officer",
  "Office of the Chief Administrative Officer",
  "Accounting Office",
  "Cashier",
  "Supply Office",
  "Budget Office",
  "Accounting and Finance Office",
  "Planning and Development Office",
  "Quality Assurance Office",
  "Legal Unit",
  "CITCS",
  "Office of the Registrar",
  "Alumni Office",
  "Information Technology Office",
  "General Services Unit",
  "Project Management Unit",
  "Information Office",
  "International Relations Office",
  "Procurement Office",
  "Human Resource Management Office",
];

// GET /offices — merged list of static + DB + user-assigned offices.
app.get("/offices", verifyToken, (req, res) => {
  const userSql = `SELECT DISTINCT office FROM users WHERE office IS NOT NULL AND office <> ''`;
  const dbSql = `SELECT id, name FROM offices ORDER BY name ASC`;
  db.query(userSql, (err1, userRows) => {
    db.query(dbSql, (err2, dbRows) => {
      const names = new Set();
      if (!err1 && Array.isArray(userRows))
        userRows.forEach((r) => r && r.office && names.add(String(r.office)));
      STATIC_OFFICES.forEach((n) => names.add(n));
      if (!err2 && Array.isArray(dbRows))
        dbRows.forEach((r) => r && r.name && names.add(String(r.name)));
      res.json(Array.from(names).sort((a, b) => a.localeCompare(b)));
    });
  });
});

// ====== OFFICE MANAGEMENT (super admin) ======
// List ALL offices: DB offices + user-assigned offices not already in the table.
app.get("/api/admin/offices", verifyToken, verifySuperAdmin, (req, res) => {
  const dbSql = "SELECT id, name, created_at FROM offices ORDER BY name ASC";
  const userSql = `SELECT DISTINCT office FROM users WHERE office IS NOT NULL AND office <> ''`;
  db.query(dbSql, (err1, dbRows) => {
    if (err1) return res.status(500).json({ message: err1.message });
    db.query(userSql, (err2, userRows) => {
      const byName = new Map();
      (dbRows || []).forEach((r) => byName.set(r.name, { id: r.id, name: r.name, created_at: r.created_at, source: 'db' }));
      (userRows || []).forEach((r) => {
        if (r && r.office && !byName.has(r.office)) {
          byName.set(r.office, { id: null, name: r.office, created_at: null, source: 'user' });
        }
      });
      res.json(Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)));
    });
  });
});

// Create a new office.
app.post("/api/admin/offices", verifyToken, verifySuperAdmin, async (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Office name is required" });
  }
  const trimmed = String(name).trim();
  try {
    const existing = await queryPromise("SELECT id FROM offices WHERE name = ?", [trimmed]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "Office already exists" });
    }
    const result = await queryPromise("INSERT INTO offices (name) VALUES (?)", [trimmed]);
    res.status(201).json({ success: true, id: result.insertId, name: trimmed });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: "Office already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
});

// Update / rename an office.
app.put("/api/admin/offices/:id", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: "Office name is required" });
  }
  const trimmed = String(name).trim();
  try {
    const existing = await queryPromise("SELECT id FROM offices WHERE name = ? AND id != ?", [trimmed, id]);
    if (existing.length > 0) {
      return res.status(409).json({ message: "An office with that name already exists" });
    }
    const result = await queryPromise("UPDATE offices SET name = ? WHERE id = ?", [trimmed, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Office not found" });
    }
    res.json({ success: true, name: trimmed });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: "An office with that name already exists" });
    }
    return res.status(500).json({ message: err.message });
  }
});

// Delete an office.
app.delete("/api/admin/offices/:id", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await queryPromise("DELETE FROM offices WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Office not found" });
    }
    res.json({ success: true, message: "Office deleted" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// ====== OFFICE MEMBERS ======
// List users assigned to a specific office.
app.get("/api/admin/offices/:id/users", verifyToken, verifySuperAdmin, (req, res) => {
  const { id } = req.params;
  // First, get the office name from the offices table.
  db.query("SELECT id, name FROM offices WHERE id = ?", [id], (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    if (!rows || rows.length === 0) {
      // Office might be a user-assigned office (not in offices table).
      // Find by user-assigned name from the request.
      return res.json([]);
    }
    const officeName = rows[0].name;
    db.query(
      `SELECT id, idnumber, name, email, role FROM users WHERE office = ? ORDER BY name ASC`,
      [officeName],
      (err2, userRows) => {
        if (err2) return res.status(500).json({ message: err2.message });
        return res.json(userRows || []);
      }
    );
  });
});

// Assign a user to an office.
app.put("/api/admin/offices/:id/assign", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    const officeRows = await queryPromise("SELECT name FROM offices WHERE id = ?", [id]);
    if (!officeRows.length) {
      // If office is user-assigned (not in offices table), the name comes from query.
      return res.status(404).json({ message: "Office not found" });
    }
    const officeName = officeRows[0].name;
    await queryPromise("UPDATE users SET office = ? WHERE id = ?", [officeName, userId]);
    return res.json({ success: true, message: `User assigned to ${officeName}` });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// Remove a user from an office (clear their office assignment).
app.put("/api/admin/offices/:id/unassign", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { userId } = req.body || {};
  if (!userId) return res.status(400).json({ message: "userId is required" });
  try {
    await queryPromise("UPDATE users SET office = '' WHERE id = ?", [userId]);
    return res.json({ success: true, message: "User removed from office" });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
});

// List users NOT yet assigned to any office (for the assign dropdown).
app.get("/api/admin/users/unassigned", verifyToken, verifySuperAdmin, (req, res) => {
  db.query(
    `SELECT id, idnumber, name, email, role FROM users WHERE office IS NULL OR office = '' ORDER BY name ASC`,
    (err, rows) => {
      if (err) return res.status(500).json({ message: err.message });
      return res.json(rows || []);
    }
  );
});

// ====== DROPDOWN OPTIONS (super admin manages classification, priority, office_requestor, etc.) ======
app.get("/api/admin/dropdown-options", verifyToken, verifySuperAdmin, (req, res) => {
  const { category } = req.query;
  let sql = "SELECT * FROM dropdown_options";
  const params = [];
  if (category) {
    sql += " WHERE category = ?";
    params.push(category);
  }
  sql += " ORDER BY category, value";
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.get("/api/dropdown-options", verifyToken, (req, res) => {
  const { category } = req.query;
  let sql = "SELECT * FROM dropdown_options";
  const params = [];
  if (category) {
    sql += " WHERE category = ?";
    params.push(category);
  }
  sql += " ORDER BY category, value";
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

app.post("/api/admin/dropdown-options", verifyToken, verifySuperAdmin, async (req, res) => {
  const { category, value } = req.body;
  if (!category || !value || !String(value).trim()) {
    return res.status(400).json({ error: "Category and value are required" });
  }
  try {
    await queryPromise(
      "INSERT INTO dropdown_options (category, value) VALUES (?, ?)",
      [category, String(value).trim()]
    );
    res.json({ message: "Option added" });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "This option already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/admin/dropdown-options/:id", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  const { value } = req.body;
  if (!value || !String(value).trim()) {
    return res.status(400).json({ error: "Value is required" });
  }
  try {
    await queryPromise(
      "UPDATE dropdown_options SET value = ? WHERE id = ?",
      [String(value).trim(), id]
    );
    res.json({ message: "Option updated" });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: "This option already exists" });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/admin/dropdown-options/:id", verifyToken, verifySuperAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await queryPromise("DELETE FROM dropdown_options WHERE id = ?", [id]);
    res.json({ message: "Option deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ====== ACTIVITY LOG (super admin) ======
// Read side of the audit trail written by activityLog.js.
const PAGE_LABELS = {
  "/dashboard": "the dashboard",
  "/createrecord": "Create Record",
  "/all": "All Records",
  "/all-records": "All Records",
  "/analytics": "Analytics",
  "/reports": "Reports",
  "/trackrecord": "Tracking",
  "/createuser": "Create User",
  "/incoming-documents": "Incoming Documents",
  "/dashboard/all-users": "All Users",
  "/office-management": "Office Management",
  "/dropdown-management": "Dropdown Options",
  "/database-backup": "Database Backup",
  "/activity-logs": "Activity Logs",
  "/user-dashboard": "My Dashboard",
  "/finished-documents": "Finished Documents",
  "/routing-slip-settings": "Routing Slip Settings",
};

// POST /api/activity/page-view — the SPA reports each page it opens
app.post("/api/activity/page-view", verifyToken, (req, res) => {
  const rawPath = String(req.body?.path || "").split("?")[0].slice(0, 200);
  if (!rawPath.startsWith("/")) {
    return res.status(400).json({ error: "path required" });
  }
  const label = PAGE_LABELS[rawPath] || rawPath;
  activityLogger.log({
    user: req.user,
    action: `Opened ${label}`,
    method: "POST",
    path: "/api/activity/page-view",
    details: rawPath,
    status: 200,
    ip: activityLogger.clientIp(req),
    userAgent: req.get?.("user-agent") || "",
  });
  res.json({ ok: true });
});

// GET /api/admin/activity — paged, filterable audit trail
app.get("/api/admin/activity", verifyToken, verifySuperAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;

    const where = [];
    const params = [];
    const q = String(req.query.q || "").trim();
    if (q) {
      where.push("(action LIKE ? OR details LIKE ? OR user_name LIKE ? OR path LIKE ?)");
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (req.query.userId) {
      where.push("user_id = ?");
      params.push(Number(req.query.userId));
    }
    if (req.query.role) {
      where.push("user_role = ?");
      params.push(req.query.role);
    }
    if (req.query.from) {
      where.push("created_at >= ?");
      params.push(`${req.query.from} 00:00:00`);
    }
    if (req.query.to) {
      where.push("created_at <= ?");
      params.push(`${req.query.to} 23:59:59`);
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const countRows = await queryPromise(
      `SELECT COUNT(*) AS total FROM activity_logs ${whereSql}`,
      params
    );
    const rows = await queryPromise(
      `SELECT id, user_id, user_name, user_role, office, action, method, path,
              details, status_code, ip, created_at
         FROM activity_logs ${whereSql}
        ORDER BY id DESC
        LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const total = countRows?.[0]?.total || 0;
    res.json({
      rows,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (err) {
    console.error("[activity] query failed:", err.message);
    res.status(500).json({ error: "Could not load the activity log", detail: err.message });
  }
});

// GET /api/admin/activity/users — accounts that appear in the log
app.get("/api/admin/activity/users", verifyToken, verifySuperAdmin, async (req, res) => {
  try {
    const rows = await queryPromise(
      `SELECT user_id, MAX(user_name) AS name, MAX(user_role) AS role, COUNT(*) AS actions
         FROM activity_logs
        WHERE user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load activity users", detail: err.message });
  }
});

// ====== DATABASE BACKUP / RESTORE (super admin) ======
// Backups are produced with the `mysqldump` / `mysql` command-line tools that
// ship with XAMPP, WAMP or a standalone MySQL/MariaDB server, so the .sql file
// is a normal dump the admin can also open in phpMyAdmin or move to another
// machine. Set MYSQL_DUMP_BIN / MYSQL_CLIENT_BIN to override the paths.
function findMysqlTool(name, envKey) {
  const explicit = process.env[envKey];
  if (explicit && fs.existsSync(explicit)) return explicit;
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const pathDirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, file);
    if (fs.existsSync(candidate)) return candidate;
  }
  const known = [
    `C:\\xampp\\mysql\\bin\\${file}`,
    `C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\${file}`,
    `C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\${file}`,
    `C:\\Program Files\\MariaDB 10.4\\bin\\${file}`,
    `C:\\Program Files\\MariaDB 10.11\\bin\\${file}`,
    `/usr/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/local/mysql/bin/${name}`,
  ];
  for (const candidate of known) if (fs.existsSync(candidate)) return candidate;
  return null;
}

function mysqlCliArgs() {
  return [
    `--host=${process.env.DB_HOST || "localhost"}`,
    `--port=${Number(process.env.DB_PORT || 3306)}`,
    `--user=${process.env.DB_USER || "root"}`,
    "--default-character-set=utf8mb4",
  ];
}

function mysqlCliEnv() {
  // MYSQL_PWD keeps the password out of the process list.
  return { ...process.env, MYSQL_PWD: process.env.DB_PASS || "" };
}

function dbName() {
  return process.env.DB_NAME || "records_db";
}

const dbImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 256 * 1024 * 1024 }, // 256 MB is plenty for this schema
  fileFilter: (req, file, cb) => {
    const ok = /\.(sql|txt|dump)$/i.test(file.originalname || "");
    cb(ok ? null : new Error("Only .sql backup files are accepted"), ok);
  },
});

// GET /api/admin/database/backup — download a full .sql dump
app.get("/api/admin/database/backup", verifyToken, verifySuperAdmin, async (req, res) => {
  const dumpBin = findMysqlTool("mysqldump", "MYSQL_DUMP_BIN");
  if (!dumpBin) {
    return res.status(503).json({
      error: "mysqldump was not found on this machine.",
      detail:
        "Install the MySQL client tools, or set MYSQL_DUMP_BIN in the server .env to the full path of mysqldump (for XAMPP: C:\\xampp\\mysql\\bin\\mysqldump.exe).",
    });
  }

  const stamp = new Date()
    .toISOString()
    .replace(/[:T]/g, "-")
    .replace(/\..+$/, "");
  const fileName = `${dbName()}-backup-${stamp}.sql`;
  const tmpFile = path.join(os.tmpdir(), `rtms-backup-${Date.now()}-${process.pid}.sql`);
  const args = [
    ...mysqlCliArgs(),
    "--single-transaction", // consistent snapshot without locking the app out
    "--quick",
    "--skip-lock-tables",
    "--routines",
    "--events",
    "--triggers",
    "--hex-blob",
    "--add-drop-table",
    `--result-file=${tmpFile}`,
    dbName(),
  ];

  try {
    await new Promise((resolve, reject) => {
      execFile(
        dumpBin,
        args,
        { env: mysqlCliEnv(), windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            return reject(
              new Error((stderr || err.message || "mysqldump failed").trim().slice(0, 1500))
            );
          }
          if (stderr && stderr.trim()) {
            console.warn("[db-backup] mysqldump warnings:", stderr.trim().slice(0, 500));
          }
          resolve();
        }
      );
    });

    const size = fs.existsSync(tmpFile) ? fs.statSync(tmpFile).size : 0;
    if (!size) throw new Error("mysqldump produced an empty file.");

    // GET requests are not logged by the middleware, so record this one here.
    activityLogger.log({
      user: req.user,
      action: "Downloaded a database backup",
      method: "GET",
      path: "/api/admin/database/backup",
      details: `${fileName} · ${(size / 1024).toFixed(1)} KB`,
      status: 200,
      ip: activityLogger.clientIp(req),
      userAgent: req.get?.("user-agent") || "",
    });

    res.download(tmpFile, fileName, (downloadErr) => {
      fs.unlink(tmpFile, () => {});
      if (downloadErr && !res.headersSent) {
        res.status(500).json({ error: "Backup download failed", detail: downloadErr.message });
      }
    });
  } catch (err) {
    fs.unlink(tmpFile, () => {});
    console.error("[db-backup] failed:", err.message);
    res.status(500).json({ error: "Backup failed", detail: err.message });
  }
});

// POST /api/admin/database/restore — import a .sql dump over the live database
app.post("/api/admin/database/restore", verifyToken, verifySuperAdmin, (req, res) => {
  dbImportUpload.single("file")(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message });
    }
    if (!req.file || !req.file.size) {
      return res.status(400).json({ error: "No backup file uploaded" });
    }

    const clientBin = findMysqlTool("mysql", "MYSQL_CLIENT_BIN");
    if (!clientBin) {
      return res.status(503).json({
        error: "The mysql command-line client was not found on this machine.",
        detail:
          "Install the MySQL client tools, or set MYSQL_CLIENT_BIN in the server .env to the full path of mysql (for XAMPP: C:\\xampp\\mysql\\bin\\mysql.exe).",
      });
    }

    const sql = req.file.buffer.toString("utf8");
    if (sql.includes("\u0000")) {
      return res.status(400).json({ error: "That file is not a text SQL dump." });
    }
    if (!/(create|insert|replace|alter|drop|set)\s/i.test(sql.slice(0, 200000))) {
      return res.status(400).json({ error: "No SQL statements were found in that file." });
    }

    const args = [...mysqlCliArgs(), "--max-allowed-packet=256M", dbName()];
    let child;
    try {
      child = spawn(clientBin, args, { env: mysqlCliEnv(), windowsHide: true });
    } catch (spawnErr) {
      return res.status(500).json({ error: "Restore failed", detail: spawnErr.message });
    }

    let stderr = "";
    let settled = false;
    const finish = (status, payload) => {
      if (settled) return;
      settled = true;
      res.status(status).json(payload);
    };

    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (e) =>
      finish(500, { error: "Restore failed", detail: e.message })
    );
    child.on("close", (code) => {
      if (code === 0) {
        console.log(`[db-restore] restored ${req.file.size} bytes from ${req.file.originalname}`);
        finish(200, {
          message: "Database restored successfully.",
          bytes: req.file.size,
          filename: req.file.originalname,
        });
      } else {
        console.error("[db-restore] failed:", stderr.slice(0, 500));
        finish(500, {
          error: "Restore failed",
          detail:
            stderr.trim().slice(0, 2000) || `mysql exited with code ${code}`,
        });
      }
    });
    // The client can close the pipe early when the SQL is invalid; that is
    // reported through the exit code above, not as an unhandled stream error.
    child.stdin.on("error", () => {});
    child.stdin.write(req.file.buffer);
    child.stdin.end();
  });
});

// ====== CONTROL NUMBER ======
// Counter continues across days (never resets).
// Format: YYMMDD-NNN where NNN can be any number of digits.
// Each day gets a new date prefix but the sequential number keeps incrementing.
function generateControlNumber(origin, cb) {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePrefix = `${yy}${mm}${dd}`;
  const originValue = String(origin || "internal").toLowerCase();

  // Get the MAX sequence across ALL records (not just today's) for this origin.
  // Only well-formed YYMMDD-NNN numbers are counted: a malformed control number
  // (e.g. "DEL-1791363687262" from test data) must never poison the sequence and
  // push every future number to a seven-trillion-sized value.
  const sql = `
    SELECT MAX(CAST(SUBSTRING_INDEX(control_number, '-', -1) AS UNSIGNED)) AS max_seq
    FROM records
    WHERE control_number REGEXP '^[0-9]{6}-[0-9]+$' AND record_origin = ?
  `;
  db.query(sql, [originValue], function (err, rows) {
    if (err) {
      console.error("Error generating control number:", err);
      return cb(err);
    }
    const maxSeq = rows && rows[0] ? rows[0].max_seq || 0 : 0;
    const nextSeq = maxSeq + 1;
    cb(null, `${datePrefix}-${nextSeq}`);
  });
}

app.get("/next-control-number", verifyToken, (req, res) => {
  const origin = req.query.origin || req.query.recordOrigin || "internal";
  generateControlNumber(origin, (err, controlNumber) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Failed to generate control number" });
    }
    res.json({ control_number: controlNumber });
  });
});

// ====== RECORDS ======
// Multer turns repeated multipart fields into arrays; take the last value so
// a duplicated field can't break an INSERT/UPDATE with a value-count error.
const pickField = (v) => (Array.isArray(v) ? v[v.length - 1] : v);

function logRecordMovement(recordId, action, fromOffice, toOffice, actor) {
  return queryPromise(
    "INSERT INTO record_movements (record_id, action, from_office, to_office, actor) VALUES (?, ?, ?, ?, ?)",
    [recordId, action, fromOffice, toOffice, actor]
  );
}

app.get("/records", verifyToken, (req, res) => {
  // Office-scoped: admins see everything, regular users only their office's
  // documents. Keeps every records surface consistent with /records/my-office.
  const isAdmin = req.user.role === "admin" || req.user.role === "super_admin";
  const sql = isAdmin
    ? "SELECT id, control_number, qrcode_path FROM records"
    : "SELECT id, control_number, qrcode_path FROM records WHERE LOWER(TRIM(destination_office)) = LOWER(TRIM(?))";
  const params = isAdmin ? [] : [req.user.office || ""];
  db.query(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ message: err.message });
    res.json(rows);
  });
});

app.post("/records", softAuth, upload.array("files"), async (req, res) => {
  try {
    const body = req.body || {};
    const control_number = pickField(body.control_number);
    const office_requestor = pickField(body.office_requestor);
    const classification = pickField(body.classification);
    const priority = pickField(body.priority);
    const description = pickField(body.description);
    const record_origin = pickField(body.record_origin);
    const destination_office = pickField(body.destination_office);
    const current_office = pickField(body.current_office);

    const currentOffice = current_office || "Office of the President";

    const missingFields = [];
    if (!control_number) missingFields.push("control_number");
    if (!office_requestor) missingFields.push("office_requestor");
    if (!classification) missingFields.push("classification");
    if (!priority) missingFields.push("priority");
    if (!description) missingFields.push("description");
    if (!destination_office) missingFields.push("destination_office");
    if (!current_office) missingFields.push("current_office");

    if (missingFields.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missingFields.join(", ")}`,
      });
    }

    const dup = await queryPromise(
      "SELECT id FROM records WHERE control_number = ? AND record_origin = ?",
      [control_number, record_origin || ""]
    );
    if (dup.length > 0) {
      return res.status(400).json({
        error: `Duplicate entry detected for the control number '${control_number}' with record origin '${record_origin}'.`,
      });
    }

    const result = await queryPromise(
      `INSERT INTO records
        (control_number, office_requestor, classification, priority, description, record_origin, destination_office, current_office, forwarded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        control_number,
        office_requestor,
        classification,
        priority,
        description,
        record_origin,
        destination_office || "Office of the President",
        currentOffice,
      ]
    );

    const recordId = result.insertId;

    // Link any uploaded attachments to the record.
    await storeUploadedFiles(recordId, req.files);

    // Track the record movement to its initial office. The actor is the account
    // that created the document so the Operations Stream can name the creator;
    // anonymous callers keep the old "System" placeholder.
    const creator = String(req.user?.name || "").trim();
    await logRecordMovement(
      recordId,
      "CREATED",
      "Unknown",
      currentOffice,
      creator || "System"
    );

    io.emit("recordUpdated", {
      record_id: recordId,
      to_office: currentOffice,
      control_number,
    });

    // Create notification for the destination office
    try {
      const destOffice = destination_office || "Office of the President";
      await queryPromise(
        `INSERT INTO notifications (record_id, target_office, title, message, from_office)
         VALUES (?, ?, ?, ?, ?)`,
        [recordId, destOffice,
         `New Document: ${control_number}`,
         `${office_requestor} created document ${control_number} (${description || 'No description'}) destined for ${destOffice}.`,
         office_requestor]
      );
    } catch (notifErr) {
      console.error("Notification error on create:", notifErr);
    }

    res.status(201).json({
      message: "Record created and tracked successfully",
      control_number,
      recordId,
    });
  } catch (error) {
    console.error("Create record failed:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to create record." });
  }
});

// Records visible to current user (admin = all; user = office only)
app.get("/records/my-office", verifyToken, (req, res) => {
  let sql, params;
  if (req.user.role === "admin" || req.user.role === "super_admin") {
    sql = `
      SELECT r.*, rf.id AS file_id, rf.file_name, rf.file_path, r.record_origin, r.current_office
      FROM records r
      LEFT JOIN record_files rf ON r.id = rf.record_id
      ORDER BY r.created_at DESC
    `;
    params = [];
  } else {
    // Non-admin users see:
    //  1. Documents destined for their office
    //  2. Documents physically in their office (current_office)
    //  3. Documents they originally created/requested (office_requestor)
    //  4. Documents that previously passed through this office (via movements)
    // This ensures documents never disappear after being forwarded away.
    sql = `
      SELECT DISTINCT r.*, rf.id AS file_id, rf.file_name, rf.file_path, r.record_origin, r.current_office
      FROM records r
      LEFT JOIN record_files rf ON r.id = rf.record_id
      WHERE LOWER(TRIM(r.destination_office)) = LOWER(TRIM(?))
         OR LOWER(TRIM(r.current_office)) = LOWER(TRIM(?))
         OR LOWER(TRIM(r.office_requestor)) = LOWER(TRIM(?))
         OR r.id IN (
           SELECT rm.record_id FROM record_movements rm
           WHERE LOWER(TRIM(rm.from_office)) = LOWER(TRIM(?))
              OR LOWER(TRIM(rm.to_office)) = LOWER(TRIM(?))
         )
      ORDER BY r.created_at DESC
    `;
    const myOff = req.user.office || "";
    params = [myOff, myOff, myOff, myOff, myOff];
  }

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Error in SQL query:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }
    res.json(rows);
  });
});

app.get("/records/:id", verifyToken, verifyAdmin, (req, res) => {
  const { id } = req.params;

  const recordSql = `
    SELECT r.*, rf.id AS file_id, rf.file_name, rf.file_type, rf.file_size, rf.file_path
    FROM records r
    LEFT JOIN record_files rf ON r.id = rf.record_id
    WHERE r.id = ?
  `;
  const movementSql = `
    SELECT rm.action, rm.from_office, rm.to_office, rm.actor, rm.timestamp
    FROM record_movements rm
    WHERE rm.record_id = ?
    ORDER BY rm.timestamp DESC
  `;

  db.query(recordSql, [id], (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    const record = rows[0];

    db.query(movementSql, [id], (err, historyRows) => {
      if (err)
        return res.status(500).json({ error: "Failed to fetch history" });

      res.json({
        id: record.id,
        control_number: record.control_number,
        office_requestor: record.office_requestor,
        classification: record.classification,
        priority: record.priority,
        description: record.description,
        retention_period: record.retention_period,
        concerned_personnel: record.concerned_personnel,
        destination_office: record.destination_office,
        current_office: record.current_office,
        record_origin: record.record_origin,
        files: rows
          .filter((r) => r.file_path)
          .map((r) => ({
            id: r.file_id,
            name: r.file_name,
            path: r.file_path,
            type: r.file_type,
            size: r.file_size,
          })),
        history: historyRows.map((h) => ({
          action: h.action,
          from_office: h.from_office,
          to_office: h.to_office,
          actor: h.actor,
          timestamp: h.timestamp,
        })),
      });
    });
  });
});

app.put("/records/:id", verifyToken, verifyAdmin, upload.array("files"), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const concerned_personnel = pickField(body.concerned_personnel);
  const destination_office = pickField(body.destination_office);
  const retention_period = pickField(body.retention_period);
  const current_office = pickField(body.current_office);
  const remarks = pickField(body.remarks);
  const office_requestor = pickField(body.office_requestor);
  const classification = pickField(body.classification);
  const priority = pickField(body.priority);
  const description = pickField(body.description);
  const status = pickField(body.status);

  try {
    // Guard: admin can only edit documents physically in their office
    const recCheck = await queryPromise(
      "SELECT current_office FROM records WHERE id = ?",
      [id]
    );
    if (recCheck && recCheck.length > 0 && recCheck[0].current_office) {
      const docOffice = String(recCheck[0].current_office).trim().toLowerCase();
      const myOffice = String(req.user.office || "").trim().toLowerCase();
      if (docOffice !== myOffice && docOffice !== 'unknown office') {
        return res.status(403).json({ error: "Cannot edit document: it is not currently in your office." });
      }
    }
    // Update only the fields that were provided.
    const updates = {};
    if (concerned_personnel !== undefined) updates.concerned_personnel = concerned_personnel;
    if (destination_office !== undefined) updates.destination_office = destination_office;
    if (retention_period !== undefined) updates.retention_period = retention_period;
    if (remarks !== undefined) updates.remarks = remarks;
    if (current_office !== undefined) updates.current_office = current_office;
    if (office_requestor !== undefined) updates.office_requestor = office_requestor;
    if (classification !== undefined) updates.classification = classification;
    if (priority !== undefined) updates.priority = priority;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const setClause = Object.keys(updates)
      .map((k) => `${k} = ?`)
      .join(", ");
    const result = await queryPromise(
      `UPDATE records SET ${setClause} WHERE id = ?`,
      [...Object.values(updates), id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    // Generate and persist the QR code (supplementary: a QR failure must
    // not roll back the record update itself).
    try {
      const qrData = `Record ID: ${id}, Retention Period: ${retention_period || "N/A"}`;
      const qrCodePath = `/uploads/qr_${id}.png`;
      const qrCodeAbsolutePath = path.join(uploadDir, `qr_${id}.png`);
      await QRCode.toFile(qrCodeAbsolutePath, qrData);
      await queryPromise("UPDATE records SET qrcode_path = ? WHERE id = ?", [
        qrCodePath,
        id,
      ]);
    } catch (qrErr) {
      console.error("QR code generation failed:", qrErr.message);
    }

    // Link any uploaded attachments to the record.
    await storeUploadedFiles(id, req.files, retention_period);

    io.emit("recordUpdated", { record_id: id });
    res.json({ success: true, message: "Record updated successfully" });
  } catch (err) {
    console.error("Error during record update:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Remove a single attachment from a record (admin). Deletes the DB row and,
// when no other record still references the file, the physical file too.
app.delete("/records/:id/files/:fileId", verifyToken, verifyAdmin, async (req, res) => {
  const { id, fileId } = req.params;
  try {
    const rows = await queryPromise(
      "SELECT file_path FROM record_files WHERE id = ? AND record_id = ?",
      [fileId, id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "File not found" });
    }
    const filePath = rows[0].file_path;

    await queryPromise("DELETE FROM record_files WHERE id = ?", [fileId]);

    // Remove the physical file only if nothing else references it.
    const refs = await queryPromise(
      "SELECT COUNT(*) AS n FROM record_files WHERE file_path = ?",
      [filePath]
    );
    if (refs && refs[0] && refs[0].n === 0 && filePath && filePath.startsWith("/uploads/")) {
      fs.unlink(path.join(uploadDir, path.basename(filePath)), () => {});
    }

    io.emit("recordUpdated", { record_id: id });
    res.json({ success: true, message: "File removed" });
  } catch (err) {
    console.error("Error deleting file:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.put("/records/forward/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { destination_office, destination_offices, slip } = req.body;
  const user = req.user;

  // Support both single and multi-office forwarding
  const offices = Array.isArray(destination_offices) && destination_offices.length > 0
    ? destination_offices
    : destination_office ? [destination_office] : [];

  if (offices.length === 0) {
    return res.status(400).json({ error: "Destination office(s) required" });
  }

  if (
    user.office !== "Office of the President" &&
    user.role !== "admin" &&
    user.role !== "super_admin" &&
    !String(user.office || "").includes("Office")
  ) {
    return res
      .status(403)
      .json({ error: "You are not authorized to forward records" });
  }

  try {
    // Security: block forwarding if no routing slip exists
    const slipCheck = await queryPromise(
      "SELECT routing_slip_data FROM records WHERE id = ?",
      [id]
    );
    const hasSlipData = slipCheck?.[0]?.routing_slip_data;
    // Also check for routing slip PDF in record_files
    const slipFileCheck = await queryPromise(
      "SELECT id FROM record_files WHERE record_id = ? AND LOWER(file_name) LIKE 'routing%' LIMIT 1",
      [id]
    );
    const hasSlipFile = slipFileCheck && slipFileCheck.length > 0;
    if (!hasSlipData && !hasSlipFile) {
      return res.status(400).json({ error: "Cannot forward: a routing slip must be created first. Open the document and create a routing slip before forwarding." });
    }

    // Forwarding to multiple offices: the document stays in the sender's
    // office but each destination gets a copy in the movements log.
    // For the primary destination, update the record; additional offices
    // get separate movement entries.
    const primaryOffice = offices[0];
    const result = await queryPromise(
      `UPDATE records
       SET destination_office = ?, current_office = ?, forwarded_at = NOW(), received_at = NOW(), status = 'IN_OFFICE'
       WHERE id = ?`,
      [primaryOffice, primaryOffice, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    await logRecordMovement(
      id,
      "FORWARDED",
      user.office,
      primaryOffice,
      user.name
    );

    // For additional offices, just log movement and notify — no COPY records
    for (let i = 1; i < offices.length; i++) {
      await logRecordMovement(
        id,
        "FORWARDED",
        user.office,
        offices[i],
        user.name
      );
    }

    // Routing slip handling: always merge the routing slip PDF into the document
    // when forwarding from the Office of the President
    let slipAttached = false;
    let slipError = null;
    try {
      const recRows = await queryPromise(
        "SELECT control_number, routing_slip_data FROM records WHERE id = ?",
        [id]
      );
      const controlNum = recRows?.[0]?.control_number;

      // Find the routing slip PDF for this record
      const existingSlipFiles = await queryPromise(
        "SELECT file_path, file_name FROM record_files WHERE record_id = ? AND LOWER(file_name) LIKE 'routing%' LIMIT 1",
        [id]
      );

      let slipPdfBuffer = null;

      if (existingSlipFiles && existingSlipFiles.length > 0 && existingSlipFiles[0].file_path) {
        // Routing slip PDF already exists on disk — read it
        const slipPdfPath = path.join(uploadDir, path.basename(existingSlipFiles[0].file_path));
        if (fs.existsSync(slipPdfPath)) {
          slipPdfBuffer = fs.readFileSync(slipPdfPath);
          console.log(`Found existing routing slip PDF for record ${id}: ${existingSlipFiles[0].file_name}`);
        }
      }

      // If no existing slip PDF, try to create one from slip data or settings
      if (!slipPdfBuffer) {
        let slipToUse = slip;
        if (!slipToUse || typeof slipToUse !== "object") {
          // Try loading saved slip data
          const savedData = recRows?.[0]?.routing_slip_data;
          if (savedData) {
            slipToUse = typeof savedData === "string" ? JSON.parse(savedData) : savedData;
          }
        }
        if (!slipToUse || typeof slipToUse !== "object") {
          // Generate a minimal slip with defaults
          const settings = await getRoutingSlipSettings(db);
          const today = new Date();
          slipToUse = {
            control_number: controlNum,
            to: primaryOffice,
            from: settings.signer_name || "",
            from_title: settings.signer_title || "",
            date: `${String(today.getMonth()+1).padStart(2,'0')}/${String(today.getDate()).padStart(2,'0')}/${today.getFullYear()}`,
            actions: [],
            others: "",
            comments: "",
          };
        }
        slipToUse.to = primaryOffice;
        const settings = await getRoutingSlipSettings(db);
        const slipResult = await attachRoutingSlipToRecord({
          db, uploadDir, recordId: id, controlNumber: controlNum,
          slip: slipToUse, settings,
        });
        if (slipResult && slipResult.filePath) {
          const slipPdfPath = path.join(uploadDir, path.basename(slipResult.filePath));
          if (fs.existsSync(slipPdfPath)) {
            slipPdfBuffer = fs.readFileSync(slipPdfPath);
          }
        }
        // Save slip data
        await queryPromise(
          "UPDATE records SET routing_slip_data = ? WHERE id = ?",
          [JSON.stringify(slipToUse), id]
        );
      }

      // Step 2: Check if merged PDF already exists (from instant merge in /slip endpoint)
      // If not, create it now as a fallback
      const existingMerged = await queryPromise(
        "SELECT id FROM record_files WHERE record_id = ? AND LOWER(file_name) LIKE 'merged%' LIMIT 1",
        [id]
      );
      if (existingMerged && existingMerged.length > 0) {
        console.log(`Merged PDF already exists for record ${id} — skipping re-merge.`);
        slipAttached = true;
      } else if (slipPdfBuffer) {
        try {
          const docFiles = await queryPromise(
            "SELECT file_path FROM record_files WHERE record_id = ? AND LOWER(file_name) NOT LIKE 'routing%' AND LOWER(file_name) NOT LIKE 'merged%' LIMIT 1",
            [id]
          );
          if (docFiles && docFiles[0] && docFiles[0].file_path) {
            console.log(`Fallback merge: merging routing slip with document for record ${id}...`);
            const mergeResult = await mergeRoutingSlipWithDocument({
              db, uploadDir, recordId: id, controlNumber: controlNum,
              slipPdfBuffer, documentFilePath: docFiles[0].file_path,
            });
            if (mergeResult) {
              console.log(`Fallback merge SUCCESS for record ${id}: ${mergeResult.filePath}`);
              slipAttached = true;
            }
          }
        } catch (mergeErr) {
          console.error("Fallback merge error:", mergeErr.message);
        }
      }
    } catch (slipErr) {
      slipError = slipErr.message || "Failed to attach routing slip";
      console.error("Routing slip attach error:", slipErr);
    }

    // Create notifications for each destination office
    for (const destOffice of offices) {
      try {
        const recInfo = await queryPromise(
          "SELECT control_number, description FROM records WHERE id = ?",
          [id]
        );
        const cn = recInfo?.[0]?.control_number || id;
        const desc = recInfo?.[0]?.description || 'A document';
        await queryPromise(
          `INSERT INTO notifications (record_id, target_office, title, message, from_office)
           VALUES (?, ?, ?, ?, ?)`,
          [id, destOffice, `New Document: ${cn}`,
           `${user.office} forwarded document "${cn}" (${desc}) to your office.`,
           user.office]
        );
      } catch (notifErr) {
        console.error("Notification error:", notifErr);
      }
    }

    io.emit("recordUpdated", {
      record_id: id,
      to_office: primaryOffice,
      from_office: user.office,
    });

    res.status(200).json({
      message: "Record forwarded successfully",
      slipAttached,
      offices: offices,
      ...(slipError ? { slipError } : {}),
    });
  } catch (err) {
    console.error("Error forwarding record:", err);
    res.status(500).json({ error: "Failed to forward record" });
  }
});

app.delete("/records/:id", verifyToken, verifyAdmin, (req, res) => {
  const { id } = req.params;

  db.query(
    "DELETE FROM record_movements WHERE record_id = ?",
    [id],
    (deleteMovementsErr) => {
      if (deleteMovementsErr) {
        console.error("Error deleting related movements:", deleteMovementsErr);
        return res
          .status(500)
          .json({ error: "Failed to delete related records." });
      }

      db.query(
        "SELECT file_path FROM record_files WHERE record_id = ?",
        [id],
        (fileSelectErr, files) => {
          if (fileSelectErr) {
            console.error("Error fetching files:", fileSelectErr);
            return res.status(500).json({ error: "Failed to fetch files." });
          }
          files.forEach((file) => {
            if (file.file_path && file.file_path.startsWith("/uploads/")) {
              const absPath = path.join(uploadDir, path.basename(file.file_path));
              fs.unlink(absPath, () => {});
            }
          });

          db.query(
            "DELETE FROM record_files WHERE record_id = ?",
            [id],
            (fileDeleteErr) => {
              if (fileDeleteErr) {
                console.error("Error deleting record files:", fileDeleteErr);
                return res.status(500).json({ error: "Failed to delete files." });
              }

              db.query(
                "DELETE FROM records WHERE id = ?",
                [id],
                (deleteRecordErr, result) => {
                  if (deleteRecordErr) {
                    console.error("Error deleting record:", deleteRecordErr);
                    return res
                      .status(500)
                      .json({ error: "Failed to delete record." });
                  }
                  if (result.affectedRows === 0) {
                    return res.status(404).json({ error: "Record not found" });
                  }
                  // Clean up the QR image if one exists.
                  const qrAbs = path.join(uploadDir, `qr_${id}.png`);
                  if (fs.existsSync(qrAbs)) fs.unlink(qrAbs, () => {});
                  res.json({ success: true, message: "Record and files deleted" });
                }
              );
            }
          );
        }
      );
    }
  );
});

// ====== TRACKING ======
app.get("/api/tracking/history/:id", verifyToken, (req, res) => {
  const recordId = req.params.id;
  const q = `
    SELECT rm.*, COALESCE(u.name, rm.actor) AS actor_name
    FROM record_movements rm
    LEFT JOIN users u ON u.name = rm.actor
    WHERE rm.record_id = ?
    ORDER BY rm.timestamp ASC
  `;
  db.query(q, [recordId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Records currently assigned to an office (admin sees everything).
app.get("/api/tracking/my-office", verifyToken, (req, res) => {
  const userOffice = req.user.office;
  const q = `
    SELECT r.*
    FROM records r
    WHERE r.id IN (
      SELECT rm.record_id
      FROM record_movements rm
      WHERE rm.id = (SELECT MAX(id) FROM record_movements WHERE record_id = rm.record_id)
      AND rm.to_office = ?
    )
  `;
  db.query(q, [userOffice], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Dashboard feed for a specific office: documents in office, in transit, and
// the most recent movements.
app.get("/api/tracking/:office", verifyToken, (req, res) => {
  const office = req.params.office;

  const inOfficeSql = `
    SELECT r.id, r.control_number, r.description AS title
    FROM records r
    WHERE r.destination_office = ?
    ORDER BY r.created_at DESC
  `;
  const inTransitSql = `
    SELECT r.id, r.control_number, r.description AS title, rm.from_office
    FROM records r
    JOIN record_movements rm ON rm.record_id = r.id
    WHERE rm.id IN (
      SELECT MAX(id) FROM record_movements GROUP BY record_id
    )
      AND rm.action = 'RELEASED'
      AND rm.to_office = ?
  `;
  const recentSql = `
    SELECT rm.id, rm.record_id, r.description AS title, rm.action,
           rm.from_office, rm.to_office, rm.actor, rm.timestamp
    FROM record_movements rm
    JOIN records r ON r.id = rm.record_id
    ORDER BY rm.timestamp DESC
    LIMIT 10
  `;

  db.query(inOfficeSql, [office], (err, documentsInOffice) => {
    if (err) return res.status(500).json({ error: err.message });
    db.query(inTransitSql, [office], (err2, inTransit) => {
      if (err2) return res.status(500).json({ error: err2.message });
      db.query(recentSql, (err3, recentMovements) => {
        if (err3) return res.status(500).json({ error: err3.message });
        res.json({
          office,
          documentsInOffice: documentsInOffice || [],
          inTransit: inTransit || [],
          recentMovements: recentMovements || [],
        });
      });
    });
  });
});

// ====== ANALYTICS ======
// Aggregates for the Records Analytics page. Every figure is computed here from
// the real columns so the page never has to guess. Snapshot = every record in
// scope; window figures = records whose created_at falls inside from..to.
const anPad = (n) => String(n).padStart(2, "0");
const anDayKey = (d) => `${d.getFullYear()}-${anPad(d.getMonth() + 1)}-${anPad(d.getDate())}`;
const anNum = (v) => Number(v || 0);

function anBucketKey(value, gran) {
  const d = new Date(value);
  if (gran === "month") return `${d.getFullYear()}-${anPad(d.getMonth() + 1)}`;
  if (gran === "week") {
    const w = new Date(d);
    w.setDate(w.getDate() - ((w.getDay() + 6) % 7)); // Monday-based week
    return anDayKey(w);
  }
  return anDayKey(d);
}

function anEnumerateBuckets(fromKey, toKey, gran) {
  const out = [];
  const start = new Date(fromKey + "T00:00:00");
  const end = new Date(toKey + "T00:00:00");
  if (gran === "month") {
    let y = start.getFullYear();
    let m = start.getMonth();
    const ey = end.getFullYear();
    const em = end.getMonth();
    while (y < ey || (y === ey && m <= em)) {
      out.push(`${y}-${anPad(m + 1)}`);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  } else if (gran === "week") {
    const w = new Date(start);
    w.setDate(w.getDate() - ((w.getDay() + 6) % 7));
    while (w <= end) {
      out.push(anDayKey(w));
      w.setDate(w.getDate() + 7);
    }
  } else {
    const d = new Date(start);
    while (d <= end) {
      out.push(anDayKey(d));
      d.setDate(d.getDate() + 1);
    }
  }
  return out;
}

// Fold legacy classification labels onto the current dropdown vocabulary.
const AN_CLASS_ALIASES = {
  administrative: "Administrative and Management Records",
  "administrative and management records": "Administrative and Management Records",
  financial: "Financial and Accounting record",
  "financial and accounting record": "Financial and Accounting record",
  hr: "Human Resource Personnel Management Records",
  "human resource personnel management records": "Human Resource Personnel Management Records",
};

app.get("/api/analytics", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const granParam = String(req.query.granularity || "auto").toLowerCase();
    const today = new Date();

    const toKey = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))
      ? String(req.query.to)
      : anDayKey(today);

    let fromKey = String(req.query.from || "");
    if (!fromKey || fromKey === "earliest") {
      const e = await queryPromise("SELECT MIN(created_at) AS d FROM records");
      fromKey = e[0] && e[0].d ? anDayKey(new Date(e[0].d)) : toKey;
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(fromKey)) {
      fromKey = toKey;
    }

    const start = new Date(fromKey + "T00:00:00");
    const end = new Date(toKey + "T23:59:59");
    const days = Math.max(1, Math.round((new Date(toKey) - new Date(fromKey)) / 86400000) + 1);

    let granularity = granParam;
    if (granularity === "auto") granularity = days <= 31 ? "day" : days <= 120 ? "week" : "month";
    if (!["day", "week", "month"].includes(granularity)) granularity = "day";

    // Immediately preceding window of the same length (for the delta chip).
    const prevEnd = new Date(start);
    prevEnd.setDate(prevEnd.getDate() - 1);
    const prevStart = new Date(prevEnd);
    prevStart.setDate(prevStart.getDate() - (days - 1));

    // ---- snapshot (every record in scope) ----
    const snapRows = await queryPromise(
      `SELECT COUNT(*) AS total,
              SUM(record_origin = 'Internal') AS internal,
              SUM(record_origin = 'External') AS external,
              SUM(qrcode_path IS NULL OR qrcode_path = '') AS awaitingQr,
              SUM(qrcode_path IS NOT NULL AND qrcode_path <> '') AS qrTagged,
              SUM(priority IN ('Urgent', 'Immediate')) AS highPriority,
              SUM(priority = 'Normal') AS normalPriority,
              SUM(retention_period IS NOT NULL) AS retentionTracked,
              SUM(classification IS NOT NULL AND classification <> '') AS classificationSet,
              SUM(destination_office IS NOT NULL AND destination_office <> '') AS destinationSet,
              SUM(record_origin IS NOT NULL) AS originSet,
              SUM(CASE WHEN retention_period IS NOT NULL
                       AND DATE_ADD(created_at, INTERVAL retention_period YEAR) <= NOW()
                       THEN 1 ELSE 0 END) AS retentionDue,
              SUM(CASE WHEN retention_period IS NOT NULL
                       AND DATE_ADD(created_at, INTERVAL retention_period YEAR) > NOW()
                       AND DATE_ADD(created_at, INTERVAL retention_period YEAR) <= DATE_ADD(NOW(), INTERVAL 90 DAY)
                       THEN 1 ELSE 0 END) AS retentionDueSoon
       FROM records`
    );
    const sr = snapRows[0] || {};
    const snapshot = {
      total: anNum(sr.total),
      internal: anNum(sr.internal),
      external: anNum(sr.external),
      awaitingQr: anNum(sr.awaitingQr),
      qrTagged: anNum(sr.qrTagged),
      highPriority: anNum(sr.highPriority),
      normalPriority: anNum(sr.normalPriority),
      retentionTracked: anNum(sr.retentionTracked),
      retentionDue: anNum(sr.retentionDue),
      retentionDueSoon: anNum(sr.retentionDueSoon),
    };

    // ---- range rows (everything the window figures need) ----
    const rangeRows = await queryPromise(
      `SELECT id, control_number, description AS title, created_at, record_origin,
              priority, classification, current_office, destination_office, qrcode_path,
              retention_period
       FROM records
       WHERE created_at >= ? AND created_at <= ?`,
      [start, end]
    );

    const windowRow = { total: rangeRows.length, internal: 0, external: 0, awaitingQr: 0 };
    for (const r of rangeRows) {
      const origin = (r.record_origin || "").toLowerCase();
      if (origin === "internal") windowRow.internal += 1;
      else if (origin === "external") windowRow.external += 1;
      if (!r.qrcode_path || r.qrcode_path === "") windowRow.awaitingQr += 1;
    }
    const prevRows = await queryPromise(
      "SELECT COUNT(*) AS n FROM records WHERE created_at >= ? AND created_at <= ?",
      [new Date(anDayKey(prevStart) + "T00:00:00"), new Date(anDayKey(prevEnd) + "T23:59:59")]
    );
    const previousTotal = anNum(prevRows[0] && prevRows[0].n);
    windowRow.previousTotal = previousTotal;
    windowRow.avgPerDay = Math.round((windowRow.total / days) * 10) / 10;
    windowRow.deltaPct =
      previousTotal > 0
        ? Math.round(((windowRow.total - previousTotal) / previousTotal) * 1000) / 10
        : null;

    // ---- volume buckets (zero-filled so gaps stay visible) ----
    const bucketKeys = anEnumerateBuckets(fromKey, toKey, granularity);
    const bucketMap = new Map(
      bucketKeys.map((k) => [k, { key: k, internal: 0, external: 0, total: 0 }])
    );
    for (const r of rangeRows) {
      const b = bucketMap.get(anBucketKey(r.created_at, granularity));
      if (!b) continue;
      b.total += 1;
      if ((r.record_origin || "").toLowerCase() === "internal") b.internal += 1;
      else b.external += 1;
    }
    const volume = bucketKeys.map((k) => bucketMap.get(k));

    // ---- breakdowns ----
    const tally = (rows, pick) => {
      const m = new Map();
      for (const r of rows) {
        const name = pick(r) || "Unspecified";
        m.set(name, (m.get(name) || 0) + 1);
      }
      const total = rows.length;
      return [...m.entries()]
        .map(([name, value]) => ({
          name,
          value,
          pct: total > 0 ? Math.round((value / total) * 1000) / 10 : 0,
        }))
        .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    };

    const byPriority = tally(rangeRows, (r) => r.priority);
    const byCurrentOffice = tally(rangeRows, (r) => r.current_office);
    const byDestinationOffice = tally(rangeRows, (r) => r.destination_office);

    const classMap = new Map();
    for (const r of rangeRows) {
      const raw = r.classification || "Unspecified";
      const canonical = AN_CLASS_ALIASES[raw.trim().toLowerCase()] || raw;
      if (!classMap.has(canonical)) {
        classMap.set(canonical, { name: canonical, value: 0, sources: new Set() });
      }
      const entry = classMap.get(canonical);
      entry.value += 1;
      entry.sources.add(raw);
    }
    const byClassification = [...classMap.values()]
      .map((c) => ({
        name: c.name,
        value: c.value,
        pct: rangeRows.length > 0 ? Math.round((c.value / rangeRows.length) * 1000) / 10 : 0,
        sources: [...c.sources].sort(),
      }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const classificationMapping = [];
    for (const c of byClassification) {
      for (const src of c.sources) {
        if (src !== c.name) classificationMapping.push({ raw: src, canonical: c.name });
      }
    }

    // ---- aging buckets (days since creation, as of now) ----
    const ageDefs = [
      { key: "0", label: "0-6 days", min: 0, max: 6 },
      { key: "7", label: "7-29 days", min: 7, max: 29 },
      { key: "30", label: "30-89 days", min: 30, max: 89 },
      { key: "90", label: "90+ days", min: 90, max: Infinity },
    ];
    const now = Date.now();
    const aging = ageDefs.map((d) => ({ key: d.key, label: d.label, value: 0, pct: 0 }));
    for (const r of rangeRows) {
      const ageDays = Math.max(0, Math.floor((now - new Date(r.created_at).getTime()) / 86400000));
      const idx = ageDefs.findIndex((d) => ageDays >= d.min && ageDays <= d.max);
      if (idx >= 0) aging[idx].value += 1;
    }
    for (const b of aging) {
      b.pct = rangeRows.length > 0 ? Math.round((b.value / rangeRows.length) * 1000) / 10 : 0;
    }

    // ---- 12-month trend (sparkline) ----
    const trendRows = await queryPromise(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month_key, COUNT(*) AS total
       FROM records
       WHERE created_at >= DATE_SUB(DATE_FORMAT(NOW(), '%Y-%m-01'), INTERVAL 11 MONTH)
       GROUP BY month_key`
    );
    const trendMap = new Map(trendRows.map((r) => [r.month_key, anNum(r.total)]));
    const trend12m = [];
    const tmStart = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    for (let i = 0; i < 12; i += 1) {
      const d = new Date(tmStart.getFullYear(), tmStart.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${anPad(d.getMonth() + 1)}`;
      trend12m.push({ key, total: trendMap.get(key) || 0 });
    }

    // ---- handoffs between offices ----
    const moveRows = await queryPromise(
      `SELECT rm.action, rm.from_office, rm.to_office
       FROM record_movements rm
       WHERE rm.timestamp >= ? AND rm.timestamp <= ?`,
      [start, end]
    );
    const officeMap = new Map();
    const touch = (name) => {
      if (!officeMap.has(name)) officeMap.set(name, { name, sent: 0, received: 0, total: 0 });
      return officeMap.get(name);
    };
    let transferTotal = 0;
    for (const m of moveRows) {
      const from = m.from_office;
      const to = m.to_office;
      if (from && from !== "Unknown") {
        touch(from).sent += 1;
        transferTotal += 1;
      }
      if (to) {
        touch(to).received += 1;
        transferTotal += 1;
      }
    }
    const transferOffices = [...officeMap.values()]
      .map((o) => ({ ...o, total: o.sent + o.received }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const transfers = {
      total: transferTotal,
      officeCount: transferOffices.length,
      offices: transferOffices,
    };

    // ---- watchlists ----
    const awaitingRows = await queryPromise(
      `SELECT id, control_number, description AS title, current_office, priority,
              record_origin, created_at
       FROM records
       WHERE qrcode_path IS NULL OR qrcode_path = ''
       ORDER BY created_at ASC
       LIMIT 8`
    );
    const oldestAwaitingQr = awaitingRows.map((r) => ({
      ...r,
      ageDays: Math.max(0, Math.floor((now - new Date(r.created_at).getTime()) / 86400000)),
    }));

    const retentionRows = await queryPromise(
      `SELECT id, control_number, description AS title, current_office,
              retention_period, created_at,
              DATE_ADD(created_at, INTERVAL retention_period YEAR) AS due_at
       FROM records
       WHERE retention_period IS NOT NULL
       ORDER BY due_at ASC`
    );
    const soonLimit = now + 90 * 86400000;
    const retention = retentionRows.map((r) => {
      const due = new Date(r.due_at).getTime();
      const state = due <= now ? "overdue" : due <= soonLimit ? "soon" : "ok";
      return {
        id: r.id,
        control_number: r.control_number,
        title: r.title,
        current_office: r.current_office,
        retentionYears: anNum(r.retention_period),
        created_at: r.created_at,
        dueAt: r.due_at,
        daysLeft: Math.ceil((due - now) / 86400000),
        state,
      };
    });

    // ---- attachments ----
    const attRows = await queryPromise(
      `SELECT COUNT(*) AS files, COALESCE(SUM(rf.file_size), 0) AS bytes,
              COUNT(DISTINCT rf.record_id) AS docsWithFiles
       FROM record_files rf
       JOIN records r ON r.id = rf.record_id`
    );
    const orphanRows = await queryPromise(
      `SELECT COUNT(*) AS files, COUNT(DISTINCT rf.record_id) AS docs
       FROM record_files rf
       LEFT JOIN records r ON r.id = rf.record_id
       WHERE r.id IS NULL`
    );
    const ar = attRows[0] || {};
    const attachments = {
      files: anNum(ar.files),
      bytes: anNum(ar.bytes),
      docsWithFiles: anNum(ar.docsWithFiles),
      avgPerDocument:
        anNum(ar.docsWithFiles) > 0
          ? Math.round((anNum(ar.files) / anNum(ar.docsWithFiles)) * 10) / 10
          : 0,
      orphanFiles: anNum(orphanRows[0] && orphanRows[0].files),
      orphanDocs: anNum(orphanRows[0] && orphanRows[0].docs),
    };

    // ---- data quality ----
    const totalSnap = snapshot.total;
    const coverage = (key, label, ok, note) => ({
      key,
      label,
      ok,
      total: totalSnap,
      missing: Math.max(0, totalSnap - ok),
      pct: totalSnap > 0 ? Math.round((ok / totalSnap) * 1000) / 10 : 0,
      note: note || "",
    });
    const dataQuality = [
      coverage(
        "retention",
        "Retention period on file",
        snapshot.retentionTracked,
        "Records without one cannot be scheduled for disposal."
      ),
      coverage(
        "qr",
        "QR-tagged",
        snapshot.qrTagged,
        "A missing QR code is what marks a record as awaiting action."
      ),
      coverage("classification", "Classification recorded", anNum(sr.classificationSet), ""),
      coverage(
        "destination",
        "Destination office recorded",
        anNum(sr.destinationSet),
        "External documents may legitimately have none."
      ),
      coverage("origin", "Record origin recorded", anNum(sr.originSet), ""),
    ];

    res.json({
      scope: { all: true, office: null },
      generatedAt: new Date().toISOString(),
      range: { from: fromKey, to: toKey, days, granularity },
      snapshot,
      window: windowRow,
      trend12m,
      volume,
      byCurrentOffice,
      byDestinationOffice,
      byPriority,
      byClassification,
      aging,
      transfers,
      watchlists: { oldestAwaitingQr, retention },
      attachments,
      classificationMapping,
      dataQuality,
    });
  } catch (err) {
    console.error("Analytics error:", err.message);
    res.status(500).json({ error: "Failed to build analytics", detail: err.message });
  }
});

// ====== OPERATIONS STREAM ======
// Full activity feed for the Operations Stream card: every logged record
// movement (created / released / received), newest first, plus the task queue
// of records that have not yet been updated (no QR code generated).
// Admin-only, matching the /dashboard route that renders the card.
app.get("/api/activity", verifyToken, verifyAdmin, (req, res) => {
  const feedSql = `
    SELECT rm.id, rm.record_id, r.control_number, rm.action,
           rm.from_office, rm.to_office, rm.actor, rm.timestamp,
           EXISTS(SELECT 1 FROM users u
                  WHERE u.name = rm.actor
                    AND u.role IN ('admin', 'super_admin')) AS actor_is_admin
    FROM record_movements rm
    LEFT JOIN records r ON r.id = rm.record_id
    ORDER BY rm.timestamp DESC, rm.id DESC
  `;
  const queueSql = `
    SELECT id, control_number, description AS title, priority,
           office_requestor, created_at
    FROM records
    WHERE qrcode_path IS NULL OR qrcode_path = ''
    ORDER BY created_at DESC
  `;

  db.query(feedSql, (feedErr, feed) => {
    if (feedErr) return res.status(500).json({ error: feedErr.message });
    db.query(queueSql, (queueErr, queue) => {
      if (queueErr) return res.status(500).json({ error: queueErr.message });
      res.json({ feed: feed || [], queue: queue || [] });
    });
  });
});

app.post("/api/tracking/release", verifyToken, async (req, res) => {
  const { record_id, to_office, slip } = req.body;
  if (!record_id || !to_office) {
    return res.status(400).json({ error: "record_id and to_office are required" });
  }
  try {
    // Releasing puts the document in transit: destined for to_office but still
    // physically with the releasing office until the destination receives it.
    const result = await queryPromise(
      "UPDATE records SET destination_office = ?, current_office = ? WHERE id = ?",
      [to_office, req.user.office || "Office of the President", record_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    await logRecordMovement(
      record_id,
      "RELEASED",
      req.user.office,
      to_office,
      req.user.name
    );

    let slipAttached = false;
    let slipError = null;
    try {
      const recRows = await queryPromise(
        "SELECT control_number, routing_slip_data FROM records WHERE id = ?",
        [record_id]
      );
      const controlNum = recRows?.[0]?.control_number;

      // Find existing routing slip PDF
      const existingSlipFiles = await queryPromise(
        "SELECT file_path, file_name FROM record_files WHERE record_id = ? AND LOWER(file_name) LIKE 'routing%' LIMIT 1",
        [record_id]
      );
      let slipPdfBuffer = null;

      if (existingSlipFiles && existingSlipFiles.length > 0 && existingSlipFiles[0].file_path) {
        const slipPdfPath = path.join(uploadDir, path.basename(existingSlipFiles[0].file_path));
        if (fs.existsSync(slipPdfPath)) {
          slipPdfBuffer = fs.readFileSync(slipPdfPath);
          console.log(`Release: Found existing routing slip PDF for record ${record_id}`);
        }
      }

      // If no existing slip PDF, create one
      if (!slipPdfBuffer) {
        let slipToUse = slip && typeof slip === "object" ? { ...slip, to: to_office } : null;
        if (!slipToUse) {
          const savedData = recRows?.[0]?.routing_slip_data;
          if (savedData) {
            const parsed = typeof savedData === "string" ? JSON.parse(savedData) : savedData;
            slipToUse = { ...parsed, to: to_office };
          }
        }
        if (slipToUse) {
          const settings = await getRoutingSlipSettings(db);
          const slipResult = await attachRoutingSlipToRecord({
            db, uploadDir, recordId: record_id, controlNumber: controlNum,
            slip: slipToUse, settings,
          });
          if (slipResult && slipResult.filePath) {
            const slipPdfPath = path.join(uploadDir, path.basename(slipResult.filePath));
            if (fs.existsSync(slipPdfPath)) {
              slipPdfBuffer = fs.readFileSync(slipPdfPath);
            }
          }
          await queryPromise(
            "UPDATE records SET routing_slip_data = ? WHERE id = ?",
            [JSON.stringify(slipToUse), record_id]
          );
        }
      }

      // Check if merged PDF already exists (from instant merge in /slip endpoint)
      const existingMerged = await queryPromise(
        "SELECT id FROM record_files WHERE record_id = ? AND LOWER(file_name) LIKE 'merged%' LIMIT 1",
        [record_id]
      );
      if (existingMerged && existingMerged.length > 0) {
        console.log(`Release: Merged PDF already exists for record ${record_id} — skipping re-merge.`);
      } else if (slipPdfBuffer) {
        try {
          const docFiles = await queryPromise(
            "SELECT file_path FROM record_files WHERE record_id = ? AND LOWER(file_name) NOT LIKE 'routing%' AND LOWER(file_name) NOT LIKE 'merged%' LIMIT 1",
            [record_id]
          );
          if (docFiles && docFiles[0] && docFiles[0].file_path) {
            console.log(`Release: Merging routing slip with document for record ${record_id}...`);
            await mergeRoutingSlipWithDocument({
              db, uploadDir, recordId: record_id, controlNumber: controlNum,
              slipPdfBuffer, documentFilePath: docFiles[0].file_path,
            });
            console.log(`Release: Merge SUCCESS for record ${record_id}`);
          }
        } catch (mergeErr) {
          console.error("Release merge error:", mergeErr.message);
        }
      }
      slipAttached = !!slipPdfBuffer;
    } catch (slipErr) {
      slipError = slipErr.message || "Failed to attach routing slip";
      console.error("Release slip error:", slipErr);
    }

    io.emit("recordUpdated", {
      record_id,
      to_office,
      from_office: req.user.office,
    });
    res.json({ message: "Document released successfully", slipAttached, ...(slipError ? { slipError } : {}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/tracking/receive", verifyToken, async (req, res) => {
  const { record_id, from_office } = req.body;
  if (!record_id) {
    return res.status(400).json({ error: "record_id is required" });
  }
  const actor = req.user.name;
  try {
    const result = await queryPromise(
      "UPDATE records SET status = 'IN_OFFICE', destination_office = ?, current_office = ?, received_at = NOW() WHERE id = ?",
      [req.user.office, req.user.office, record_id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Record not found" });
    }
    await logRecordMovement(
      record_id,
      "RECEIVED",
      from_office || req.user.office,
      req.user.office,
      actor
    );
    io.emit("recordUpdated", {
      record_id,
      to_office: req.user.office,
      from_office,
      actor,
    });
    res.json({ message: "Document received successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/records/move", verifyToken, async (req, res) => {
  try {
    const { record_id, from_office, to_office, actor } = req.body;
    if (!record_id || !from_office || !to_office || !actor) {
      return res.status(400).json({ error: "All fields are required." });
    }

    await logRecordMovement(record_id, "RELEASED", from_office, to_office, actor);
    await queryPromise("UPDATE records SET current_office = ? WHERE id = ?", [
      to_office,
      record_id,
    ]);

    io.emit("recordUpdated", { record_id, to_office });
    res.status(200).json({
      message: "Record movement logged and current office updated.",
    });
  } catch (error) {
    console.error("Error handling record movement:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to process record movement." });
  }
});

app.get("/records/total-per-office", verifyToken, (req, res) => {
  let sql;
  let params = [];

  if (req.user.role === "admin" || req.user.role === "super_admin") {
    sql = `
      SELECT r.destination_office, COUNT(*) AS total_records
      FROM records r
      GROUP BY r.destination_office
    `;
  } else {
    sql = `
      SELECT r.destination_office, COUNT(*) AS total_records
      FROM records r
      WHERE r.destination_office = ?
      GROUP BY r.destination_office
    `;
    params = [req.user.office];
  }

  db.query(sql, params, (err, rows) => {
    if (err) {
      console.error("Error in SQL query:", err);
      return res.status(500).json({ message: "Database error", error: err });
    }
    res.json(rows);
  });
});

// Search records by control number, description, or office requestor
app.get("/records/search", verifyToken, async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) return res.json([]);
  try {
    const rows = await queryPromise(
      `SELECT id, control_number, description, office_requestor,
              destination_office, current_office, classification, priority,
              record_origin, status, created_at
       FROM records
       WHERE control_number LIKE ?
          OR description LIKE ?
          OR office_requestor LIKE ?
       ORDER BY created_at DESC
       LIMIT 20`,
      [`%${q}%`, `%${q}%`, `%${q}%`]
    );
    res.json(rows);
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Track a record's current location + full history by control number.
app.get("/records/track/:control_number", verifyToken, async (req, res) => {
  const { control_number } = req.params;

  try {
    const recRows = await queryPromise(
      "SELECT id FROM records WHERE control_number = ? LIMIT 1",
      [control_number]
    );
    if (recRows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    const history = await queryPromise(
      `SELECT rm.action, rm.from_office, rm.to_office,
              COALESCE(u.name, rm.actor) AS actor, rm.timestamp
       FROM record_movements rm
       LEFT JOIN users u ON u.name = rm.actor
       WHERE rm.record_id = ?
       ORDER BY rm.timestamp ASC`,
      [recRows[0].id]
    );

    if (history.length === 0) {
      return res
        .status(404)
        .json({ error: "Record not found or no movements found" });
    }

    const latest = history[history.length - 1];
    res.json({
      control_number,
      current_office: latest.to_office,
      history,
    });
  } catch (err) {
    console.error("Error while tracking record:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ====== INCOMING DOCUMENTS (Office → Records Management Unit) ======
// Upload a document from an office account to the Records Management Unit
app.post("/api/incoming-documents", verifyToken, upload.single("file"), async (req, res) => {
  try {
    const userOffice = req.user.office || "";
    const description = req.body.description || "";
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const filePath = `/uploads/${req.file.filename}`;
    const result = await queryPromise(
      `INSERT INTO incoming_documents (office_from, description, file_path, file_name, file_size)
       VALUES (?, ?, ?, ?, ?)`,
      [userOffice, description, filePath, req.file.originalname, req.file.size]
    );
    // Notify the Records Management Unit
    try {
      await queryPromise(
        `INSERT INTO notifications (record_id, target_office, title, message, from_office)
         VALUES (?, ?, ?, ?, ?)`,
        [0, "Records Management Unit",
         `New Incoming Document from ${userOffice}`,
         `${userOffice} sent a document: "${description || req.file.originalname}". Check Incoming Documents.`,
         userOffice]
      );
    } catch (notifErr) {
      console.error("Notification error on incoming doc:", notifErr);
    }
    io.emit("incomingDocument", { office_from: userOffice, id: result.insertId });
    res.status(201).json({ success: true, id: result.insertId, message: "Document sent to Records Management Unit" });
  } catch (err) {
    console.error("Upload incoming document error:", err);
    res.status(500).json({ error: "Failed to upload document" });
  }
});

// List incoming documents (Records Management Unit only)
app.get("/api/incoming-documents", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const rows = await queryPromise(
      `SELECT * FROM incoming_documents WHERE status = ? ORDER BY created_at DESC`,
      [status]
    );
    res.json(rows);
  } catch (err) {
    console.error("List incoming documents error:", err);
    res.status(500).json({ error: "Failed to list incoming documents" });
  }
});

// Count pending incoming documents (for badge/notification)
app.get("/api/incoming-documents/count", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const rows = await queryPromise(
      `SELECT COUNT(*) AS count FROM incoming_documents WHERE status = 'pending'`
    );
    res.json({ count: rows[0].count });
  } catch (err) {
    res.json({ count: 0 });
  }
});

// Mark incoming document as processed (when creating a record from it)
app.put("/api/incoming-documents/:id/process", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await queryPromise(
      `UPDATE incoming_documents SET status = 'processed' WHERE id = ?`,
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to process incoming document" });
  }
});

// Delete incoming document
app.delete("/api/incoming-documents/:id", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const rows = await queryPromise(`SELECT file_path FROM incoming_documents WHERE id = ?`, [id]);
    if (rows.length > 0 && rows[0].file_path) {
      const absPath = path.join(uploadDir, path.basename(rows[0].file_path));
      fs.unlink(absPath, () => {});
    }
    await queryPromise(`DELETE FROM incoming_documents WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete incoming document" });
  }
});

// ====== Notifications ======
// Get notifications for the current user's office
app.get("/api/notifications", verifyToken, async (req, res) => {
  try {
    const userOffice = req.user.office || "";
    const rows = await queryPromise(
      `SELECT n.*, r.control_number, r.description
       FROM notifications n
       LEFT JOIN records r ON r.id = n.record_id
       WHERE LOWER(TRIM(n.target_office)) = LOWER(TRIM(?))
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [userOffice]
    );
    res.json(rows);
  } catch (err) {
    console.error("GET notifications error:", err);
    res.status(500).json({ error: "Failed to load notifications" });
  }
});

// Get unread count
app.get("/api/notifications/unread-count", verifyToken, async (req, res) => {
  try {
    const userOffice = req.user.office || "";
    const rows = await queryPromise(
      `SELECT COUNT(*) AS count FROM notifications
       WHERE LOWER(TRIM(target_office)) = LOWER(TRIM(?)) AND is_read = 0`,
      [userOffice]
    );
    res.json({ count: rows[0]?.count || 0 });
  } catch (err) {
    res.status(500).json({ error: "Failed to load count" });
  }
});

// Mark notifications as read
app.put("/api/notifications/mark-read", verifyToken, async (req, res) => {
  try {
    const userOffice = req.user.office || "";
    await queryPromise(
      `UPDATE notifications SET is_read = 1
       WHERE LOWER(TRIM(target_office)) = LOWER(TRIM(?))`,
      [userOffice]
    );
    res.json({ message: "Marked as read" });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark as read" });
  }
});

// ====== Routing slip settings ======
// Ensure the settings table exists (created on first boot).
queryPromise(
  `CREATE TABLE IF NOT EXISTS app_settings (
    setting_key VARCHAR(100) NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
).catch((err) => console.error("Create app_settings table:", err.message));

// Read routing-slip template settings (any authenticated user — the forward
// modal needs them to pre-fill the slip).
app.get("/api/settings/routing-slip", verifyToken, async (req, res) => {
  try {
    res.json(await getRoutingSlipSettings(db));
  } catch (err) {
    console.error("GET routing-slip settings:", err.message);
    res.status(500).json({ error: "Failed to load routing slip settings" });
  }
});

// Update routing-slip template settings (admin only).
app.put("/api/settings/routing-slip", verifyToken, verifyAdmin, async (req, res) => {
  try {
    const saved = await saveRoutingSlipSettings(db, req.body);
    res.json(saved);
  } catch (err) {
    console.error("PUT routing-slip settings:", err.message);
    res.status(500).json({ error: "Failed to save routing slip settings" });
  }
});

// ====== Start ======
// Listening is more than a one-line listen() here because the usual cause of
// EADDRINUSE on the dev port is an earlier copy of this very backend: a
// terminal closed with the X button, a killed nodemon child, or a leftover
// background process. Instead of dying with a stack trace, startup clears a
// stale copy of *this* backend out of the way and binds the port. A watcher
// (nodemon) or a genuinely different program is never killed — it is reported
// with a way forward.
const PORT = Number(process.env.PORT) || 8081;
const SELF = path.resolve(__filename);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Command line of a PID plus its parent's, or null when it can't be read. */
function processInfo(pid) {
  try {
    if (process.platform === "win32") {
      // Get-CimInstance is the supported replacement for the removed wmic.
      const script = [
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"`,
        `if ($p) { Write-Output $p.CommandLine; ` +
          `$pp = Get-CimInstance Win32_Process -Filter "ProcessId=$($p.ParentProcessId)"; ` +
          `Write-Output $pp.CommandLine }`,
      ].join("; ");
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", timeout: 10000, windowsHide: true }
      );
      const [args = "", parentArgs = ""] = out.split(/\r?\n/);
      return { args: args.trim(), parentArgs: parentArgs.trim() };
    }
    const args = execFileSync("ps", ["-p", String(pid), "-o", "args="], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    let parentArgs = "";
    try {
      const ppid = execFileSync("ps", ["-p", String(pid), "-o", "ppid="], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
      parentArgs = execFileSync("ps", ["-p", ppid, "-o", "args="], {
        encoding: "utf8",
        timeout: 5000,
      }).trim();
    } catch {
      /* parent already gone */
    }
    return { args, parentArgs };
  } catch {
    return null; // process gone, or no way to ask — treated as "not identified"
  }
}

/** PID listening on `port`, or null when nothing is (or it can't be read). */
function portOwner(port) {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("netstat", ["-ano", "-p", "TCP"], {
        encoding: "utf8",
        timeout: 10000,
        windowsHide: true,
      });
      for (const line of out.split(/\r?\n/)) {
        // proto   local address        foreign address      state       pid
        const cols = line.trim().split(/\s+/);
        if (cols.length < 5) continue;
        if (cols[3] !== "LISTENING") continue;
        if (!cols[1].endsWith(`:${port}`)) continue;
        const pid = Number(cols[4]);
        if (Number.isInteger(pid) && pid > 0) return pid;
      }
      return null;
    }
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8", timeout: 10000 }
    );
    const pid = Number(out.split(/\s+/).filter(Boolean)[0]);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null; // lsof missing, or nothing is listening
  }
}

/** Is `cmd` an invocation of this very backend file? */
function isThisBackend(cmd) {
  if (!cmd) return false;
  const invoked = (cmd.match(/(?:^|[\s"'])([^\s"']*server\.js)/) || [])[1];
  if (!invoked) return false;
  // Started as `node server.js` (relative) or by an absolute path to this file.
  return !path.isAbsolute(invoked) || path.resolve(invoked) === SELF;
}

/** Free the port from a stale copy of this backend. false = cannot start. */
async function clearStaleBackend() {
  const pid = portOwner(PORT);
  if (!pid || pid === process.pid) return true;

  const info = processInfo(pid);
  if (!info) {
    console.error(`\n✖ Port ${PORT} is already in use (PID ${pid}) and that process could not`);
    console.error(`  be identified. Stop it, then run this again.\n`);
    return false;
  }

  if (/nodemon/.test(info.args) || /nodemon/.test(info.parentArgs)) {
    console.error(`\n✖ Port ${PORT} is already served by a nodemon watcher (PID ${pid}).`);
    console.error(`  It reloads this backend whenever a file changes, so there is nothing to`);
    console.error(`  start here — use that terminal, or press Ctrl+C in it and try again.\n`);
    return false;
  }

  if (!isThisBackend(info.args)) {
    console.error(`\n✖ Port ${PORT} is held by another program, not by this backend.`);
    console.error(`  PID ${pid}: ${info.args.slice(0, 160)}`);
    console.error(`  Stop that program, or give this backend a different PORT in server/.env`);
    console.error(`  (and update the proxy targets in client/src/setupProxy.js).\n`);
    return false;
  }

  console.log(
    `↻ Port ${PORT} was still held by an earlier run of this backend (PID ${pid}) — closing it.`
  );
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    try {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } catch {
      /* already gone */
    }
  }
  for (let i = 0; i < 40 && portOwner(PORT) !== null; i++) await sleep(250);
  if (portOwner(PORT) === null) return true;

  console.error(`\n✖ PID ${pid} did not release port ${PORT}. Stop it manually and try again.\n`);
  return false;
}

// Graceful, non-crashing report for a port taken between the check and the bind.
server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n✖ Port ${PORT} is in use — something grabbed it while this backend started.`);
    console.error(`  Just run this again: an earlier copy is closed automatically.\n`);
  } else {
    console.error("✖ Server error:", err);
  }
  process.exit(1);
});

// Ctrl+C / kill now releases the port immediately, which is what stops stale
// instances from piling up in the first place.
let closing = false;
function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`\n${signal} received — closing backend on port ${PORT}…`);
  const finish = () => process.exit(0);
  const timer = setTimeout(finish, 3000);
  if (typeof timer.unref === "function") timer.unref();
  try {
    io.close();
  } catch {
    /* socket layer already down */
  }
  try {
    db.end(finish);
  } catch {
    finish();
  }
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

(async () => {
  if (!(await clearStaleBackend())) process.exit(1);
  try {
    await activityLogger.ensureTable();
  } catch (err) {
    console.error("Activity log table:", err.message);
  }
  server.listen(PORT, () => {
    console.log(`✅ Backend + Socket.IO on ${PORT}`);
  });
})();
