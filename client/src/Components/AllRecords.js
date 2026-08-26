
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { socket } from "../socket";
import { useAuth } from "../AuthContext";
import "./PriorityBadges.css";
import "./AllRecords.css";

const API_BASE =
  process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || "";

const normalizeQrPath = (p) =>
  String(p || "")
    .split("\\")
    .join("/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "/");

function priorityClass(p) {
  const v = String(p || "Normal")
    .toLowerCase()
    .trim();
  if (["high", "urgent", "critical"].includes(v)) return "prio prio-high";
  if (["low", "minor"].includes(v)) return "prio prio-low";
  return "prio prio-normal";
}

function statusBadge(s) {
  const v = String(s || "").toUpperCase().trim();
  const label =
    v === "RECEIVED" || v === "COMPLETED"
      ? "Received"
      : v === "IN_OFFICE" || v === "IN_PROCESS"
      ? "In Process"
      : v || "In Process";
  const cls =
    v === "RECEIVED" || v === "COMPLETED"
      ? "text-bg-success"
      : v === "IN_OFFICE" || v === "IN_PROCESS"
      ? "text-bg-warning"
      : "text-bg-secondary";
  return <span className={`badge ${cls}`}>{label}</span>;
}

export default function AllRecords() {
  const { user } = useAuth();
  const [rowsRaw, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState({});
  const [q, setQ] = useState("");

  const isAdmin = user?.role === "admin";

  // Function to load records
  const load = async () => {
    try {
      setLoading(true);
      const res = await axios.get("/records/my-office");
      setRowsRaw(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      console.error("Load records error:", e?.response?.data || e.message);
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        setError("Session expired or unauthorized. Please log in again.");
      } else {
        setError("Failed to load records");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const onUpdated = () => load();
    socket.on("recordUpdated", onUpdated);
    load();
    return () => socket.off("recordUpdated", onUpdated);
  }, []);

  // Format date function
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");

  // Clear search filter
  const clearFilters = () => setQ("");

  // Handle delete (admin only)
  const handleDelete = async (r) => {
    if (!isAdmin) return alert("Only admins can delete records.");
    if (!r.id) return alert("Cannot delete this record.");
    if (!window.confirm(`Delete "${r.control_number}"? This cannot be undone.`)) return;
    try {
      setDeletingId(r.id);
      await axios.delete(`/records/${r.id}`);
      setRowsRaw((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete record.");
    } finally {
      setDeletingId(null);
    }
  };

  // Transform rows into records with files grouped
  const records = useMemo(() => {
    const map = new Map();
    for (const r of rowsRaw) {
      const recId =
        r.id ?? r.control_number ?? Math.random().toString(36).slice(2);
      if (!map.has(recId)) {
        map.set(recId, {
          id: recId,
          control_number: r.control_number || "",
          title: r.title || "",
          classification: r.classification || "",
          priority: r.priority || "Normal",
          office_requestor: r.office_requestor || "",
          destination_office: r.destination_office || "",
          record_origin: r.record_origin || "Unknown",
          created_at: r.created_at || null,
          description: r.description || "",
          status: r.status || "IN_OFFICE",
          files: [],
          qrcode_path: r.qrcode_path || "",
        });
      }
      if (r.file_path) {
        map.get(recId).files.push({
          name: r.file_name || r.file_path.split("/").pop(),
          path: r.file_path,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        (new Date(b.created_at).getTime() || 0) -
        (new Date(a.created_at).getTime() || 0)
    );
  }, [rowsRaw]);

  // Filter records by search term
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return records;
    return records.filter((r) =>
      [
        r.control_number,
        r.description,
        r.classification,
        r.destination_office,
        r.record_origin,
      ]
        .join(" ")
        .toLowerCase()
        .includes(ql)
    );
  }, [records, q]);

  // Handle QR code view
  const handleViewQR = (r) => {
    if (!r.qrcode_path) return alert("QR code not available for this record.");
    setQrData({
      control_number: r.control_number,
      title: r.title || r.description,
      url: `${API_BASE}${normalizeQrPath(r.qrcode_path)}`,
    });
    setShowQR(true);
  };

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-1">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div>
              <h2 className="mb-0">
                {isAdmin ? "All Records" : "Records for My Office"}
              </h2>
              {!isAdmin && user?.office ? (
                <div className="text-muted small">
                  Documents destined for{" "}
                  <strong className="text-primary">{user.office}</strong>
                </div>
              ) : null}
            </div>
            <div className="text-muted small">
              Showing <strong>{filtered.length}</strong> of {records.length}
            </div>
          </div>

          {!isAdmin && !user?.office ? (
            <div className="alert alert-warning py-2 small">
              <strong>No office assigned to your account.</strong> Records destined
              for your office won’t appear here until an administrator sets your
              office. Please contact the Records Unit.
            </div>
          ) : null}

          <div className="filter-toolbar border rounded-3 bg-white p-3 mb-3">
            <div className="row g-2 align-items-center">
              <div className="col-12 col-lg-5">
                <input
                  className="form-control"
                  placeholder="Search by control #, title…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div className="col-12 col-lg-auto ms-auto text-end">
                <button
                  className="btn btn-outline-secondary btn-sm"
                  onClick={clearFilters}
                >
                  Clear filters
                </button>
              </div>
            </div>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
          {loading ? (
            <div>Loading…</div>
          ) : (
            <div className="table-responsive" style={{ width: "100%" }}>
              <table className="table table-striped align-middle">
                <thead>
                  <tr>
                    <th>Control No.</th>
                    <th>Classification</th>
                    <th>Priority</th>
                    <th>Office Requestor</th>

                    <th>Destination Office</th>
                    <th>Record Origin</th>
                    <th>Created At</th>
                    <th>Status</th>
                    <th>Attachments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="text-center text-muted">
                        No records match your filters.
                      </td>
                    </tr>
                  )}
                  {filtered.map((r) => (
                    <tr key={r.id}>
                      <td>{r.control_number || "—"}</td>
                      <td>{r.classification || "—"}</td>
                      <td>
                        <span className={priorityClass(r.priority)}>
                          {r.priority || "-"}
                        </span>
                      </td>
                      <td>{r.office_requestor || "—"}</td>

                      <td>{r.destination_office || "—"}</td>
                      <td>{r.record_origin || "Unknown"}</td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td>{statusBadge(r.status)}</td>
                      <td>
                        {r.files.length > 0 ? (
                          <ul className="mb-0 small">
                            {r.files.map((f, i) => (
                              <li key={`${r.id}-f-${i}`}>
                                <Link
                                  to={`/attachment-viewer?file=${encodeURIComponent(
                                    f.path
                                  )}&name=${encodeURIComponent(f.name)}`}
                                  title="Preview"
                                >
                                  {f.name}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          "No attachments"
                        )}
                      </td>
                      <td>
                        <div className="d-flex gap-1 flex-wrap">
                          {isAdmin && (
                            <Link
                              className="btn btn-sm btn-outline-primary"
                              to={`/records/${r.id}/edit`}
                            >
                              Edit
                            </Link>
                          )}
                          {isAdmin && (
                            <button
                              className="btn btn-sm btn-outline-danger"
                              disabled={!r.id || deletingId === r.id}
                              onClick={() => handleDelete(r)}
                            >
                              {deletingId === r.id ? "Deleting…" : "Delete"}
                            </button>
                          )}
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => handleViewQR(r)}
                          >
                            View QR
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showQR && (
            <div className="qr-modal-backdrop" onClick={() => setShowQR(false)}>
              <div className="qr-modal-dialog">
                <h5>QR Code for {qrData.control_number}</h5>
                <img
                  src={qrData.url}
                  alt={`QR Code for ${qrData.control_number}`}
                  style={{ width: 200, height: 200 }}
                />
                <br></br>
                <button
                  className="btn btn-sm btn-outline-secondary mt-2"
                  onClick={() => setShowQR(false)}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
