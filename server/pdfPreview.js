// pdfPreview.js
// Server-side PDF page rendering for the attachment viewer.
//
// PDFs are rasterized to PNG images with pdf.js (pdfjs-dist) + @napi-rs/canvas,
// so the browser only ever displays plain <img> tags. This works in every
// browser regardless of its built-in PDF viewer, plugins, webview quirks,
// worker availability, or HTTP cache state — all the things that made the
// earlier iframe / client-side approaches show a blank page.
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const uploadDir = path.join(__dirname, "uploads");

// ---- globals needed by pdf.js in Node (from @napi-rs/canvas) ------------
let pdfjsPromise = null;
function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const { createCanvas, DOMMatrix, Path2D, ImageData } = require("@napi-rs/canvas");
      if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
      if (!globalThis.Path2D) globalThis.Path2D = Path2D;
      if (!globalThis.ImageData) globalThis.ImageData = ImageData;
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      return { pdfjs, createCanvas };
    })();
  }
  return pdfjsPromise;
}

// ---- caches ---------------------------------------------------------------
// Parsed documents (keep a handful; they're the expensive part).
const DOC_CACHE = new Map();
const DOC_CACHE_MAX = 10;
// Rendered page PNGs, keyed "resolvedPath::pageNum".
const PAGE_CACHE = new Map();
const PAGE_CACHE_MAX = 500;

function cachePut(map, max, key, value) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  if (map.size > max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// ---- path safety -----------------------------------------------------------
// Resolve a client-supplied file name to an absolute path inside the uploads
// directory. Returns null when the name is invalid or outside the directory.
function resolvePdfPath(fileName) {
  if (!fileName || typeof fileName !== "string") return null;
  const base = path.basename(fileName);
  if (base !== fileName) return null; // no path separators / traversal allowed
  if (!/\.pdf$/i.test(base)) return null;
  const resolved = path.resolve(uploadDir, base);
  if (!resolved.startsWith(uploadDir + path.sep) && resolved !== uploadDir) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}

// ---- document loading --------------------------------------------------------
function getDocument(filePath) {
  const key = filePath;
  if (DOC_CACHE.has(key)) {
    const entry = DOC_CACHE.get(key);
    DOC_CACHE.delete(key);
    DOC_CACHE.set(key, entry);
    return entry;
  }
  const promise = (async () => {
    const { pdfjs } = await getPdfjs();
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
    return doc;
  })();
  cachePut(DOC_CACHE, DOC_CACHE_MAX, key, promise);
  return promise;
}

// ---- page count --------------------------------------------------------------
async function getNumPages(fileName) {
  const filePath = resolvePdfPath(fileName);
  if (!filePath) return null;
  const doc = await getDocument(filePath);
  return doc.numPages;
}

// ---- page rendering ------------------------------------------------------------
async function renderPagePng(fileName, pageNumber, etag) {
  const filePath = resolvePdfPath(fileName);
  if (!filePath) return null;
  if (!Number.isInteger(pageNumber) || pageNumber < 1) return null;

  const cacheKey = `${filePath}::${pageNumber}::${etag}`;
  if (PAGE_CACHE.has(cacheKey)) {
    const buf = PAGE_CACHE.get(cacheKey);
    PAGE_CACHE.delete(cacheKey);
    PAGE_CACHE.set(cacheKey, buf);
    return buf;
  }

  const doc = await getDocument(filePath);
  if (pageNumber > doc.numPages) return null;

  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // Reasonable fixed quality; cap huge pages so a single PNG stays small.
  const scale = Math.min(1.4, 1600 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });

  const { createCanvas } = await getPdfjs();
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const png = canvas.toBuffer("image/png");

  cachePut(PAGE_CACHE, PAGE_CACHE_MAX, cacheKey, png);
  return png;
}

// ETag derived from the file so clients can revalidate cheaply.
function fileEtag(fileName) {
  const filePath = resolvePdfPath(fileName);
  if (!filePath) return null;
  const stat = fs.statSync(filePath);
  return `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

module.exports = { getNumPages, renderPagePng, fileEtag, resolvePdfPath };
