// server/routingSlip.js
// Generates a standard routing slip (per the QSU-REC-F007 form) as a PDF page
// and merges it as the first page of a forwarded document's PDF.
//
// Drawing uses @napi-rs/canvas (already a dependency, used by pdfPreview.js);
// the PDF itself is assembled with pdf-lib (also already a dependency).

const fs = require("fs");
const path = require("path");
const { createCanvas, GlobalFonts, loadImage } = require("@napi-rs/canvas");
const { PDFDocument } = require("pdf-lib");

// Real Quirino State University seal (assets/qsu-logo.png). The source image
// has a solid black background; near-black pixels are stripped so the seal
// sits on the white slip like the printed form.
const LOGO_PATH = path.join(__dirname, "assets", "qsu-logo.png");
let QSU_LOGO = null; // cached processed canvas

// ---------------------------------------------------------------------------
// Defaults (matches the physical QSU-REC-F007 form). Admins can override all
// of these from the Routing Slip Settings page; overrides live in the
// `app_settings` table under the key "routing_slip".
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = {
  header: "OFFICE OF THE UNIVERSITY PRESIDENT",
  address: "Diffun, Quirino",
  signer_name: "HERMENEGILDO F. SAMOY, JR., PhD",
  signer_title: "University President",
  footer_ref: "QSU-REC-F007",
  footer_rev: "Rev. 01 (Jul. 07, 2025)",
  actions: [
    "URGENT",
    "For your information & appropriate action",
    "For your review/comments",
    "Please hold",
    "Please disseminate",
    "Please draft reply",
    "Let us discuss",
    "Please attend",
    "Please represent the office",
    "For your recommendation",
    "For file/reference",
    "Others: ____________",
  ],
};

const SETTINGS_KEY = "routing_slip";

// mysql2's default pool is callback-based; wrap it in a promise.
function q(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

async function getRoutingSlipSettings(db) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  try {
    const rows = await q(
      db,
      "SELECT value FROM app_settings WHERE setting_key = ?",
      [SETTINGS_KEY]
    );
    if (rows && rows[0] && rows[0].value) {
      const saved = JSON.parse(rows[0].value);
      // Merge over defaults so newly-added default fields still appear.
      return { ...defaults, ...saved };
    }
  } catch (err) {
    console.error("getRoutingSlipSettings:", err.message);
  }
  return defaults;
}

async function saveRoutingSlipSettings(db, settings) {
  const merged = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  await q(
    db,
    `INSERT INTO app_settings (setting_key, value)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [SETTINGS_KEY, JSON.stringify(merged)]
  );
  return merged;
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
let FONT_FAMILY = null;
function fontFamily() {
  if (FONT_FAMILY) return FONT_FAMILY;
  try {
    const families = (GlobalFonts.families || []).map((f) => f.family || "");
    if (families.includes("Times New Roman")) FONT_FAMILY = "Times New Roman";
    else if (families.includes("Arial")) FONT_FAMILY = "Arial";
    else FONT_FAMILY = "sans-serif";
  } catch {
    FONT_FAMILY = "sans-serif";
  }
  return FONT_FAMILY;
}

function ff(weight, size) {
  return `${weight} ${size}px "${fontFamily()}"`;
}

// Load the QSU seal once, strip the black background, and cache the result
// as a canvas. Returns null if the asset is missing (falls back to the
// placeholder circle).
async function getQsuLogo() {
  if (QSU_LOGO) return QSU_LOGO;
  try {
    if (!fs.existsSync(LOGO_PATH)) return null;
    const img = await loadImage(LOGO_PATH);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, img.width, img.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] < 42 && px[i + 1] < 42 && px[i + 2] < 42) px[i + 3] = 0;
    }
    ctx.putImageData(data, 0, 0);
    QSU_LOGO = c;
  } catch (err) {
    console.error("getQsuLogo:", err.message);
    QSU_LOGO = null;
  }
  return QSU_LOGO;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------
// Draw the routing slip page as a PNG (A4 at 2x scale for crisp embedding).
// ---------------------------------------------------------------------------
async function drawRoutingSlipPng(slip, settings) {
  const W = 1190; // A4 595pt x 2
  const H = 1684;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Paper background + thin outer border (like the printed form).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  const m = 80; // inner margin
  const cw = W - m * 2; // content width

  // ---- Header: QSU seal + institution name ----
  const sealCx = 175;
  const sealCy = 150;
  const sealR = 85;
  const logo = await getQsuLogo();
  if (logo) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sealCx, sealCy, sealR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(logo, sealCx - sealR, sealCy - sealR, sealR * 2, sealR * 2);
    ctx.restore();
    // Thin green ring around the seal (matches the university's branding).
    ctx.strokeStyle = "#1b6b3a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(sealCx, sealCy, sealR + 3, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Fallback placeholder (green circle with QSU).
    ctx.fillStyle = "#1b6b3a";
    ctx.beginPath();
    ctx.arc(sealCx, sealCy, sealR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sealCx, sealCy, sealR - 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = ff("bold", 44);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("QSU", sealCx, sealCy - 12);
    ctx.font = ff("normal", 22);
    ctx.fillText("Records", sealCx, sealCy + 32);
  }

  const headCx = sealCx + 150 + (W - (sealCx + 150) - m) / 2;
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.font = ff("bold", 40);
  ctx.fillText(settings.header || DEFAULT_SETTINGS.header, headCx, 112);
  ctx.font = ff("normal", 28);
  ctx.fillText(settings.address || DEFAULT_SETTINGS.address, headCx, 165);

  ctx.textAlign = "left";
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(m, 215);
  ctx.lineTo(W - m, 215);
  ctx.stroke();

  // ---- Routing slip ----
  ctx.textAlign = "center";
  ctx.font = ff("bold", 42);
  ctx.fillText("ROUTING SLIP", W / 2, 275);
  ctx.textAlign = "right";
  ctx.font = ff("bold", 26);
  ctx.fillText(`CTRL: ${slip.control_number || "____________"}`, W - m, 320);

  ctx.textAlign = "left";
  ctx.font = ff("bold", 28);
  const toText = slip.to || "________________________";
  ctx.fillText(`To: ${toText}`, m, 375);
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  const toUnderlineX = m + ctx.measureText("To: ").width;
  ctx.beginPath();
  ctx.moveTo(toUnderlineX, 385);
  ctx.lineTo(toUnderlineX + ctx.measureText(toText).width, 385);
  ctx.stroke();

  const fromName = slip.from || settings.signer_name || DEFAULT_SETTINGS.signer_name;
  const fromTitle = slip.from_title || settings.signer_title || DEFAULT_SETTINGS.signer_title;
  ctx.fillText(`From: ${fromName}`, m, 425);
  ctx.font = ff("normal", 26);
  ctx.fillText(`      ${fromTitle}`, m, 462);
  ctx.font = ff("normal", 28);
  ctx.fillText(`Date: ${slip.date || "____________"}`, m, 505);

  // ---- Action checklist ----
  const actions = Array.isArray(settings.actions) && settings.actions.length
    ? settings.actions
    : DEFAULT_SETTINGS.actions;
  const checked = new Set(
    (Array.isArray(slip.actions) ? slip.actions : []).map((a) =>
      String(a || "").trim().toLowerCase()
    )
  );
  const othersText = String(slip.others || "").trim();

  let y = 560;
  const lineH = actions.length > 15 ? 34 : 38;
  const drawAction = (label, isChecked, customText) => {
    const marker = isChecked ? "(X)" : "( )";
    ctx.font = ff(isChecked ? "bold" : "normal", 26);
    const text = customText != null ? `${marker} ${label} ${customText}` : `${marker} ${label}`;
    ctx.fillText(text, m, y);
    y += lineH;
  };

  for (const item of actions) {
    const isOthersItem = /others/i.test(String(item));
    if (isOthersItem) {
      drawAction("Others:", checked.has("others") || othersText !== "", othersText ? othersText : "____________");
    } else {
      drawAction(item, checked.has(String(item).trim().toLowerCase()));
    }
  }

  // ---- Comments box ----
  y += 8;
  ctx.font = ff("bold", 26);
  ctx.fillText("Comments:", m, y);
  y += 14;
  const commentsBox = { x: m, y, w: cw, h: 170 };
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.strokeRect(commentsBox.x, commentsBox.y, commentsBox.w, commentsBox.h);
  if (String(slip.comments || "").trim()) {
    ctx.font = ff("normal", 24);
    ctx.fillStyle = "#222222";
    let cy = commentsBox.y + 34;
    for (const line of wrapText(ctx, String(slip.comments), commentsBox.w - 40)) {
      ctx.fillText(line, commentsBox.x + 20, cy);
      cy += 32;
    }
    ctx.fillStyle = "#000000";
  }

  // ---- Footer ----
  const footerY = commentsBox.y + commentsBox.h + 55;
  ctx.font = ff("normal", 22);
  ctx.fillText(settings.footer_ref || DEFAULT_SETTINGS.footer_ref, m, footerY);
  ctx.fillText(settings.footer_rev || DEFAULT_SETTINGS.footer_rev, m, footerY + 28);

  // ---- Dashed divider ----
  const divY = footerY + 62;
  ctx.setLineDash([14, 12]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(m, divY);
  ctx.lineTo(W - m, divY);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- Receiving & follow-up slip ----
  let ry = divY + 60;
  ctx.textAlign = "center";
  ctx.font = ff("bold", 34);
  ctx.fillText("RECEIVING & FOLLOW-UP SLIP", W / 2, ry);
  ry += 55;
  ctx.textAlign = "left";
  ctx.font = ff("normal", 26);
  ctx.fillText(`CTRL: ${slip.control_number || "____________"}`, m, ry);
  ry += 40;
  ctx.fillText(`To: ${toText}`, m, ry);
  ry += 60;
  ctx.textAlign = "center";
  ctx.font = ff("bold", 26);
  ctx.fillText("Received by:", W / 2, ry);
  ry += 10;
  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W / 2 - 260, ry);
  ctx.lineTo(W / 2 + 260, ry);
  ctx.stroke();
  ry += 30;
  ctx.font = ff("normal", 22);
  ctx.fillText("Signature over printed name/Date", W / 2, ry);
  ry += 45;
  ctx.strokeRect(m, ry, cw, Math.min(230, H - ry - 40));
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// Build a single-page PDF from the drawn slip.
// ---------------------------------------------------------------------------
async function buildRoutingSlipPdf(slip, settings) {
  const png = await drawRoutingSlipPng(slip, settings);
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const img = await doc.embedPng(png);
  page.drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return Buffer.from(await doc.save());
}

// ---------------------------------------------------------------------------
// Attach a routing slip to a record:
//  - generates the slip as its OWN standalone PDF (it is never merged into the
//    document — the AttachmentViewer shows the document and the slip as two
//    separate panels side by side),
//  - the slip's CTRL is the record's control number, so it always matches the
//    document's control number,
//  - writes the slip into uploads and adds a record_files row.
// ---------------------------------------------------------------------------
async function attachRoutingSlipToRecord({
  db,
  uploadDir,
  recordId,
  controlNumber,
  slip,
  settings,
}) {
  const slipPdf = await buildRoutingSlipPdf(
    { ...slip, control_number: controlNumber || slip.control_number },
    settings
  );

  const outName = `Routing Slip - ${controlNumber || recordId}.pdf`;
  const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const filename = `routing_${String(controlNumber || recordId).replace(/[^A-Za-z0-9._-]/g, "_")}_${stamp}.pdf`;
  fs.writeFileSync(path.join(uploadDir, filename), slipPdf);

  await q(
    db,
    "INSERT INTO record_files (record_id, file_path, file_name, file_size, file_type, retention_period) VALUES (?, ?, ?, ?, ?, ?)",
    [recordId, `/uploads/${filename}`, outName, slipPdf.length, "application/pdf", ""]
  );

  return { filePath: `/uploads/${filename}`, fileName: outName, merged: false };
}

// ---------------------------------------------------------------------------
// Merge a routing slip PDF as the FIRST page of a document PDF.
// Returns the path of the merged file in record_files.
// ---------------------------------------------------------------------------
async function mergeRoutingSlipWithDocument({
  db,
  uploadDir,
  recordId,
  controlNumber,
  slipPdfBuffer,
  documentFilePath,
}) {
  try {
    // Load the document PDF
    const docPath = path.join(uploadDir, path.basename(documentFilePath));
    if (!fs.existsSync(docPath)) {
      console.error("mergeRoutingSlipWithDocument: document not found at", docPath);
      return null;
    }
    const docBytes = fs.readFileSync(docPath);
    const srcDoc = await PDFDocument.load(docBytes);

    // Load the routing slip PDF
    const slipDoc = await PDFDocument.load(slipPdfBuffer);
    const slipPage = await srcDoc.copyPages(slipDoc, [0]);

    // Insert the slip page as page 0 (first page)
    srcDoc.insertPage(0, slipPage[0]);

    const mergedBytes = await srcDoc.save();
    const outName = `Merged - ${controlNumber || recordId}.pdf`;
    const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const filename = `merged_${String(controlNumber || recordId).replace(/[^A-Za-z0-9._-]/g, "_")}_${stamp}.pdf`;
    fs.writeFileSync(path.join(uploadDir, filename), mergedBytes);

    // Add to record_files
    await q(
      db,
      "INSERT INTO record_files (record_id, file_path, file_name, file_size, file_type, retention_period) VALUES (?, ?, ?, ?, ?, ?)",
      [recordId, `/uploads/${filename}`, outName, mergedBytes.length, "application/pdf", ""]
    );

    return { filePath: `/uploads/${filename}`, fileName: outName };
  } catch (err) {
    console.error("mergeRoutingSlipWithDocument error:", err.message);
    return null;
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  getRoutingSlipSettings,
  saveRoutingSlipSettings,
  drawRoutingSlipPng,
  buildRoutingSlipPdf,
  attachRoutingSlipToRecord,
  mergeRoutingSlipWithDocument,
};
