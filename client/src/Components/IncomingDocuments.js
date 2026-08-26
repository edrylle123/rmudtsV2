import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { useAuth } from "../AuthContext";
import "./Dashboard.css";

// BlobPdf fetches PDF as base64 data URI to bypass IDM and CORS
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function BlobPdf({ filePath, title, style }) {
  const [dataUri, setDataUri] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    const proxyUrl = `/api/file-proxy?path=${encodeURIComponent(filePath)}`;
    fetch(proxyUrl)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((blob) => blobToBase64(blob))
      .then((b64) => { if (!cancelled) { setDataUri(b64); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError(err.message || 'load failed'); setLoading(false); } });
    return () => { cancelled = true; };
  }, [filePath]);
  if (error) return <div style={{ padding: 16, color: '#dc3545' }}>Failed to load PDF. {error}</div>;
  if (loading) return <div style={{ padding: 16, color: '#6c757d' }}>Loading PDF...</div>;
  return (
    <object data={dataUri} type="application/pdf" title={title || 'PDF'} style={style}>
      <div style={{ padding: 16, color: '#dc3545' }}>Your browser cannot display PDFs inline.</div>
    </object>
  );
}

export default function IncomingDocuments() {
  // eslint-disable-next-line no-unused-vars
  const { user } = useAuth();
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending"); // pending | processed | all

  const API_BASE =
    process.env.REACT_APP_API_BASE?.replace(/\/$/, "") ||
    "";

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const params = filter === "all" ? "" : `?status=${filter}`;
      const res = await axios.get(`${API_BASE}/api/incoming-documents${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDocs(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      console.error("Error fetching incoming documents:", err);
    } finally {
      setLoading(false);
    }
  }, [API_BASE, filter]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  // Handle "Create Record" — navigate to create record with pre-filled data
  const handleCreateRecord = (doc) => {
    // Store the incoming doc info in sessionStorage for CreateRecordForm to pick up
    sessionStorage.setItem(
      "incomingDoc",
      JSON.stringify({
        id: doc.id,
        file_path: doc.file_path,
        file_name: doc.file_name,
        description: doc.description || "",
        office_from: doc.office_from || "",
      })
    );
    navigate("/createrecord");
  };

  // Handle delete
  const handleDelete = async (id) => {
    if (!window.confirm("Delete this incoming document?")) return;
    try {
      const token = localStorage.getItem("token");
      await axios.delete(`${API_BASE}/api/incoming-documents/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchDocs();
    } catch (err) {
      alert("Failed to delete.");
    }
  };

  const formatDate = (d) => {
    if (!d) return "—";
    const dt = new Date(d);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="d-flex align-items-stretch">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="content-area">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h4 className="mb-0">📥 Incoming Documents</h4>
            <span className="badge text-bg-warning">
              {docs.filter((d) => d.status === "pending").length} pending
            </span>
          </div>

          {/* Filter Tabs */}
          <div className="d-flex gap-2 mb-3">
            {["pending", "processed", "all"].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${
                  filter === f ? "btn-success" : "btn-outline-secondary"
                }`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="status">Loading…</div>
          ) : docs.length === 0 ? (
            <div className="status text-muted">
              No {filter === "all" ? "" : filter} incoming documents.
            </div>
          ) : (
            <div className="records-cards">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="record-card"
                  style={{
                    borderLeft: doc.status === "pending" ? "4px solid #ffc107" : "4px solid #28a745",
                  }}
                >
                  <div className="card-body">
                    <div className="d-flex justify-content-between align-items-start mb-2">
                      <div>
                        <span className="badge text-bg-info mb-1">
                          {doc.office_from}
                        </span>
                        <h6 className="card-title mb-0" style={{ fontWeight: 600 }}>
                          {doc.file_name}
                        </h6>
                      </div>
                      <span
                        className={`badge ${
                          doc.status === "pending"
                            ? "text-bg-warning"
                            : "text-bg-success"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </div>

                    {doc.description && (
                      <p className="text-muted small mb-2">{doc.description}</p>
                    )}

                    <div className="small text-muted mb-2">
                      📅 {formatDate(doc.created_at)}
                      {doc.file_size
                        ? ` • ${(doc.file_size / 1024).toFixed(1)} KB`
                        : ""}
                    </div>

                    {/* Preview the PDF */}
                    {doc.file_path && (
                      <div
                        style={{
                          background: "#e9ecef",
                          borderRadius: "6px",
                          overflow: "hidden",
                          marginBottom: "10px",
                        }}
                      >
                        <BlobPdf
                          filePath={doc.file_path}
                          title={doc.file_name}
                          style={{ width: "100%", height: "300px", border: "none" }}
                        />
                      </div>
                    )}

                    {/* Actions */}
                    <div className="d-flex gap-2">
                      {doc.status === "pending" && (
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleCreateRecord(doc)}
                        >
                          ✅ Create Record
                        </button>
                      )}
                      <button
                        className="btn btn-outline-danger btn-sm"
                        onClick={() => handleDelete(doc.id)}
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
