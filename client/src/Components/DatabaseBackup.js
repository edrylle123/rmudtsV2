// client/src/Components/DatabaseBackup.js
// Super-admin only: download a full .sql dump of the records database, or
// restore one by uploading it back. Both routes live under
// /api/admin/database/* and are protected by verifyToken + verifySuperAdmin.
import React, { useRef, useState } from "react";
import {
  FaDatabase,
  FaDownload,
  FaUpload,
  FaCheckCircle,
  FaExclamationCircle,
  FaExclamationTriangle,
  FaSpinner,
  FaSyncAlt,
} from "react-icons/fa";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import "./DatabaseBackup.css";

const fmtBytes = (bytes) => {
  if (!bytes && bytes !== 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

// Error bodies arrive as blobs because the backup request asks for a blob.
const readError = async (err, fallback) => {
  const data = err?.response?.data;
  try {
    if (data instanceof Blob) {
      const text = await data.text();
      const parsed = JSON.parse(text);
      return {
        message: parsed.error || fallback,
        detail: parsed.detail || "",
      };
    }
    if (data && typeof data === "object") {
      return { message: data.error || fallback, detail: data.detail || "" };
    }
  } catch {
    /* fall through */
  }
  return { message: err?.message || fallback, detail: "" };
};

export default function DatabaseBackup() {
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [file, setFile] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "", detail: "" });
  const fileInputRef = useRef(null);

  const downloadBackup = async () => {
    setMessage({ type: "", text: "", detail: "" });
    setBackingUp(true);
    try {
      const res = await axios.get("/api/admin/database/backup", {
        responseType: "blob",
        timeout: 5 * 60 * 1000,
      });
      const disposition = res.headers?.["content-disposition"] || "";
      const match = /filename="?([^";]+)"?/i.exec(disposition);
      const stamp = new Date()
        .toISOString()
        .replace(/[:T]/g, "-")
        .replace(/\..+$/, "");
      const name = match ? match[1] : `records-db-backup-${stamp}.sql`;

      const blob = new Blob([res.data], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      setMessage({
        type: "success",
        text: `Backup downloaded — ${name} (${fmtBytes(blob.size)}).`,
      });
    } catch (err) {
      const { message: msg, detail } = await readError(err, "Backup failed.");
      setMessage({ type: "error", text: msg, detail });
    } finally {
      setBackingUp(false);
    }
  };

  const pickFile = (event) => {
    const chosen = event.target.files?.[0] || null;
    setFile(chosen);
    setConfirmed(false);
    setMessage({ type: "", text: "", detail: "" });
  };

  const restore = async () => {
    if (!file) return;
    setMessage({ type: "", text: "", detail: "" });
    setRestoring(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await axios.post("/api/admin/database/restore", form, {
        timeout: 10 * 60 * 1000,
      });
      setMessage({
        type: "success",
        text: `${res.data?.message || "Database restored."} (${fmtBytes(
          res.data?.bytes
        )}) Reload the page to see the restored records.`,
      });
      setFile(null);
      setConfirmed(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      const { message: msg, detail } = await readError(err, "Restore failed.");
      setMessage({ type: "error", text: msg, detail });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="db-page container-fluid p-3 p-md-4">
          <div className="db-header">
            <FaDatabase className="db-header-icon" />
            <div>
              <h2 className="db-title">Database Backup</h2>
              <p className="db-subtitle">
                Download a complete copy of the records database, or restore one
                from a <code>.sql</code> file.
              </p>
            </div>
          </div>

          {message.text && (
            <div
              className={`db-alert ${
                message.type === "success" ? "db-alert-success" : "db-alert-error"
              }`}
            >
              {message.type === "success" ? <FaCheckCircle /> : <FaExclamationCircle />}
              <div className="db-alert-body">
                <div>{message.text}</div>
                {message.detail && <div className="db-alert-detail">{message.detail}</div>}
              </div>
              <button
                className="db-alert-close"
                onClick={() => setMessage({ type: "", text: "", detail: "" })}
                aria-label="Dismiss"
              >
                &times;
              </button>
            </div>
          )}

          <div className="db-grid">
            {/* ---------- Backup ---------- */}
            <section className="db-card">
              <div className="db-card-head">
                <span className="db-card-icon db-icon-backup">
                  <FaDownload />
                </span>
                <div>
                  <h3 className="db-card-title">Backup database</h3>
                  <p className="db-card-sub">
                    Saves every table, row and setting as a single SQL file.
                  </p>
                </div>
              </div>

              <ul className="db-list">
                <li>Includes all records, users, offices and attachments data.</li>
                <li>Keeps the schema, so the file can be imported into phpMyAdmin.</li>
                <li>Reads a consistent snapshot — nobody has to stop working.</li>
              </ul>

              <button
                type="button"
                className="db-btn db-btn-primary"
                onClick={downloadBackup}
                disabled={backingUp}
              >
                {backingUp ? <FaSpinner className="db-spin" /> : <FaDownload />}
                {backingUp ? "Preparing backup…" : "Download backup (.sql)"}
              </button>
              <p className="db-hint">
                Your browser saves the file to its downloads folder.
              </p>
            </section>

            {/* ---------- Restore ---------- */}
            <section className="db-card db-card-danger">
              <div className="db-card-head">
                <span className="db-card-icon db-icon-restore">
                  <FaUpload />
                </span>
                <div>
                  <h3 className="db-card-title">Restore from backup</h3>
                  <p className="db-card-sub">
                    Upload a backup file to replace the current data.
                  </p>
                </div>
              </div>

              <div className="db-warning">
                <FaExclamationTriangle />
                <div>
                  <strong>This overwrites live data.</strong> Everything currently
                  in the database is replaced by the contents of the uploaded
                  file. Download a fresh backup first if you are unsure.
                </div>
              </div>

              <input
                ref={fileInputRef}
                id="db-restore-file"
                type="file"
                accept=".sql,.txt,.dump"
                className="db-file-input"
                onChange={pickFile}
                disabled={restoring}
              />
              <label htmlFor="db-restore-file" className="db-file-label">
                <FaUpload />
                {file ? "Choose a different file" : "Choose a .sql backup file"}
              </label>

              {file && (
                <div className="db-file-chip">
                  <span className="db-file-name" title={file.name}>
                    {file.name}
                  </span>
                  <span className="db-file-size">{fmtBytes(file.size)}</span>
                </div>
              )}

              <label className={`db-confirm${file ? "" : " db-confirm-disabled"}`}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  disabled={!file || restoring}
                />
                <span>I understand this replaces all current data.</span>
              </label>

              <button
                type="button"
                className="db-btn db-btn-danger"
                onClick={restore}
                disabled={!file || !confirmed || restoring}
              >
                {restoring ? <FaSpinner className="db-spin" /> : <FaSyncAlt />}
                {restoring ? "Restoring…" : "Restore database"}
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
