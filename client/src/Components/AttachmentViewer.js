import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Navbar from "./Navbar";
import axios from "./axios";
import RoutingSlipPane from "./RoutingSlipPane";

// PDF pages are rasterized on the SERVER (server.js /preview-pdf endpoint)
// and displayed here as plain <img> tags. That works in every browser with
// zero dependence on the browser's PDF viewer, plugins, pdf.js workers, or
// HTTP cache state — all of which caused blank pages before.
const PREVIEW_VERSION = "3";

// In development the frontend (:3000) and backend (:8081) are separate
// origins; the backend's CORS config already allows :3000. In production

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
const PDF_EXT = /\.pdf$/i;
// A file whose name mentions "routing" is a routing slip.
const SLIP_RE = /routing[-_ ]/i;
// Merged files contain routing slip + document in one PDF;
// those are treated as the document itself, not a standalone slip.
const MERGED_RE = /^merged[-_ ]|merged[-_ ]\.pdf$/i;

const basename = (p) => {
  const raw = String(p || "").split("?")[0].split("/").pop() || "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

// ---------------------------------------------------------------------------
// PdfPane — one self-contained PDF viewer (page controls, zoom, server-side
// rasterization). Used for both the document pane and the routing-slip pane.
// ---------------------------------------------------------------------------
function PdfPane({ fileName, prettyName, maxHeight }) {
  const [numPages, setNumPages] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [infoError, setInfoError] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgLoading, setImgLoading] = useState(true);
  const [containerWidth, setContainerWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef(null);
  const imgRef = useRef(null);

  const previewBase = useMemo(
    () =>
      `/preview-pdf?file=${encodeURIComponent(
        fileName
      )}&v=${PREVIEW_VERSION}`,
    [fileName]
  );

  const pageImageUrl = useMemo(
    () => (previewBase ? `${previewBase}&page=${pageNumber}` : null),
    [previewBase, pageNumber]
  );

  // Measure the available width so pages fit nicely.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(Math.max(320, el.clientWidth - 48));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch the page count when a PDF loads.
  useEffect(() => {
    if (!previewBase) return;
    let cancelled = false;
    setNumPages(0);
    setPageNumber(1);
    setInfoError(false);
    setImgError(false);
    setImgLoading(true);
    fetch(`${previewBase}&info=1`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`status ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setNumPages(data.numPages || 0);
      })
      .catch(() => {
        if (!cancelled) setInfoError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [previewBase]);

  // Reset the per-image state whenever the page changes. The browser may
  // serve the page image from cache before React attaches the onLoad handler
  // (StrictMode double-mount + ETag revalidation), which would leave the pane
  // stuck on "Rendering…". The complete check below settles it deterministically.
  useEffect(() => {
    setImgError(false);
    setImgLoading(true);
    const t = setTimeout(() => {
      const el = imgRef.current;
      if (el && el.complete) {
        setImgLoading(false);
        if (!el.naturalWidth) setImgError(true);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [pageImageUrl]);

  const onImgLoad = useCallback(() => setImgLoading(false), []);
  const onImgError = useCallback(() => {
    setImgLoading(false);
    setImgError(true);
  }, []);

  const goPrev = () => setPageNumber((p) => Math.max(1, p - 1));
  const goNext = () => setPageNumber((p) => Math.min(numPages, p + 1));
  const zoomBy = (f) =>
    setZoom((z) => Math.min(4, Math.max(0.4, +(z * f).toFixed(2))));

  const controlsDisabled = !numPages || infoError;

  return (
    <div ref={frameRef}>
      {infoError ? (
        <div className="alert alert-danger mb-0">
          This PDF could not be opened on the server. Use the Download button
          to view it in your PDF reader.
        </div>
      ) : (
        <>
          <div className="mb-2 d-flex align-items-center gap-2 flex-wrap">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goPrev}
              disabled={controlsDisabled || pageNumber <= 1}
            >
              ‹ Prev
            </button>
            <span className="text-muted">
              Page {numPages ? pageNumber : "—"} of {numPages || "—"}
            </span>
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={goNext}
              disabled={controlsDisabled || pageNumber >= numPages}
            >
              Next ›
            </button>
            <span className="ms-auto d-flex align-items-center gap-2">
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => zoomBy(0.75)}
                disabled={controlsDisabled}
                title="Zoom out"
              >
                −
              </button>
              <span className="text-muted" style={{ minWidth: 40 }}>
                {Math.round(zoom * 100)}%
              </span>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => zoomBy(1.25)}
                disabled={controlsDisabled}
                title="Zoom in"
              >
                +
              </button>
              <button
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setZoom(1)}
                disabled={controlsDisabled}
                title="Fit width"
              >
                Fit
              </button>
            </span>
          </div>
          <div
            className="p-3 border rounded bg-light overflow-auto"
            style={{ maxHeight: maxHeight || "78vh" }}
          >
            {imgError ? (
              <div className="alert alert-danger m-0">
                Failed to render this page. Use the Download button to view it
                in your PDF reader.
              </div>
            ) : (
              <div
                className="position-relative mx-auto"
                style={{ width: containerWidth * zoom, minHeight: 400 }}
              >
                <img
                  ref={imgRef}
                  src={pageImageUrl}
                  alt={`${prettyName} — page ${pageNumber}`}
                  onLoad={onImgLoad}
                  onError={onImgError}
                  style={{ width: "100%", display: "block" }}
                />
                {imgLoading && (
                  <div
                    className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center text-muted"
                    style={{ backgroundColor: "rgba(255,255,255,0.85)" }}
                  >
                    Rendering page {pageNumber}…
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function AttachmentViewer() {
  const [search] = useSearchParams();
  const navigate = useNavigate();

  const fileParam = search.get("file");
  const nameParam = search.get("name") || "";

  const prettyName = useMemo(
    () =>
      nameParam ||
      (fileParam
        ? decodeURIComponent(fileParam.split("/").pop() || "")
        : "attachment"),
    [fileParam, nameParam]
  );

  // The stored file name (basename) is what the server preview endpoint wants.
  const fileName = useMemo(() => {
    if (!fileParam) return null;
    return fileParam.startsWith("http")
      ? decodeURIComponent(fileParam.split("/").pop() || "")
      : decodeURIComponent(fileParam.replace(/^\/+/, "").split("/").pop() || "");
  }, [fileParam]);

  const fileUrl = useMemo(() => {
    if (!fileParam) return null;
    const base = fileParam.startsWith("http")
      ? fileParam
      : fileParam.replace(/^\/+/, "/");
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}v=${PREVIEW_VERSION}`;
  }, [fileParam]);

  const isPdf =
    PDF_EXT.test(prettyName) || (fileUrl && /\.pdf($|\?)/i.test(fileUrl));
  const isImage = !isPdf && IMAGE_EXT.test(prettyName);

  // Every file that belongs to the same record (the document, its routing
  // slip, any older attachments) plus the record's control number. The split
  // view shows the document and the slip side by side.
  const [siblings, setSiblings] = useState([]);
  const [controlNumber, setControlNumber] = useState(null);
  const [recordId, setRecordId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!fileParam) return;
    let cancelled = false;
    setSiblings([]);
    setControlNumber(null);
    setRecordId(null);
    axios
      .get(`/api/files/siblings?file=${encodeURIComponent(fileParam)}`)
      .then(({ data }) => {
        if (cancelled) return;
        setSiblings(data.files || []);
        setControlNumber(data.control_number || null);
        setRecordId(data.record_id || null);
      })
      .catch(() => {
        // Non-fatal: the viewer falls back to a single pane.
      });
    return () => {
      cancelled = true;
    };
  }, [fileParam, reloadKey]);

  // The standalone routing slip belonging to this record (if any).
  const slipFile = useMemo(() => {
    if (!isPdf) return null;
    const standalone = (siblings || []).filter(
      (f) => SLIP_RE.test(f.file_name || "") && !MERGED_RE.test(f.file_name || "")
    );
    const openedIsSlip = SLIP_RE.test(prettyName);
    if (openedIsSlip) {
      return (
        standalone.find((f) => f.file_path === fileParam) ||
        standalone[0] ||
        null
      );
    }
    return standalone[0] || null;
  }, [siblings, isPdf, prettyName, fileParam]);

  // The document PDF to show next to the slip. If the user opened the slip
  // itself, find the sibling document; otherwise the opened file is the doc.
  const docFile = useMemo(() => {
    if (!isPdf) return null;
    const openedIsSlip = SLIP_RE.test(prettyName);
    if (!openedIsSlip) {
      return { fileName, prettyName };
    }
    const doc = (siblings || []).find(
      (f) =>
        !SLIP_RE.test(f.file_name || "") &&
        /\.[a-z0-9]+$/i.test(f.file_name || "") &&
        f.file_path !== fileParam
    );
    return doc
      ? { fileName: basename(doc.file_path), prettyName: doc.file_name }
      : null;
  }, [siblings, isPdf, prettyName, fileName, fileParam]);

  // When the document has no saved routing slip yet, show an interactive slip
  // (check the "( )" boxes, type comments, then save) prefilled with the
  // document's control number, so every PDF opens with its routing slip
  // visible. Once the slip is saved or the document is forwarded, the saved
  // slip file takes over.
  const canEditSlip = isPdf && controlNumber && recordId;

  const slipLabel = useMemo(() => {
    if (slipFile) return slipFile.file_name;
    if (controlNumber) return `Routing Slip - ${controlNumber}.pdf (not yet attached)`;
    return null;
  }, [slipFile, controlNumber]);

  // Don't show routing slip pane if the opened file is already a merged PDF
  const openedIsMerged = MERGED_RE.test(prettyName);
  const split = isPdf && docFile && (slipFile || canEditSlip) && !openedIsMerged;

  return (
    <div className="d-flex">
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
            <h2 className="mb-0">Attachment Viewer</h2>
            <div className="d-flex gap-2">
              {fileUrl && (
                <a
                  className="btn btn-outline-primary"
                  href={fileUrl}
                  download={prettyName}
                >
                  Download
                </a>
              )}
              <button
                className="btn btn-outline-secondary"
                onClick={() =>
                  window.history.length > 1
                    ? navigate(-1)
                    : navigate("/all-records")
                }
              >
                Back
              </button>
            </div>
          </div>

          <div className="mb-3 text-muted">{prettyName}</div>

          {!fileUrl ? (
            <div className="alert alert-danger">Missing file path.</div>
          ) : split ? (
            <div className="row g-3">
              <div className="col-lg-6">
                <div className="border rounded bg-white p-2 mb-2">
                  <strong>Document</strong>
                  <div className="text-muted small text-truncate">
                    {docFile.prettyName}
                  </div>
                </div>
                <PdfPane
                  fileName={docFile.fileName}
                  prettyName={docFile.prettyName}
                  maxHeight="62vh"
                />
              </div>
              <div className="col-lg-6">
                <div className="border rounded bg-white p-2 mb-2">
                  <strong>Routing Slip</strong>
                  <div className="text-muted small text-truncate">
                    {slipLabel}
                  </div>
                </div>
                {slipFile ? (
                  <PdfPane
                    fileName={basename(slipFile.file_path)}
                    prettyName={slipFile.file_name}
                    maxHeight="62vh"
                  />
                ) : (
                  <RoutingSlipPane
                    controlNumber={controlNumber}
                    recordId={recordId}
                    onSaved={() => setReloadKey((k) => k + 1)}
                  />
                )}
              </div>
            </div>
          ) : isPdf ? (
            <PdfPane fileName={fileName} prettyName={prettyName} />
          ) : isImage ? (
            <div className="text-center">
              <img
                src={fileUrl}
                alt={prettyName}
                style={{ maxWidth: "100%", maxHeight: "80vh" }}
              />
            </div>
          ) : (
            <div className="alert alert-info">
              Preview is not available for this file type — use the Download
              button to open it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
