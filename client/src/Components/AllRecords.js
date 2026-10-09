
import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { socket } from "../socket";
import { FaPencilAlt, FaTrashAlt, FaQrcode } from "react-icons/fa";
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

// Parse control numbers like "260824-001" (YYMMDD-seq) so the newest
// document always sorts first regardless of created_at quirks.
function cnKey(cn) {
  const m = String(cn || "").trim().match(/^(\d{2})(\d{2})(\d{2})-(\d+)$/);
  if (!m) return null;
  return { y: +m[1], mo: +m[2], d: +m[3], seq: +m[4] };
}

function sortByNewest(a, b) {
  // Primary: newest created_at always first, regardless of control number
  const ta = new Date(a.created_at).getTime() || 0;
  const tb = new Date(b.created_at).getTime() || 0;
  if (ta !== tb) return tb - ta;
  // Tiebreak: higher control-number sequence first
  const ka = cnKey(a.control_number);
  const kb = cnKey(b.control_number);
  if (ka && kb) {
    const d = kb.y - ka.y || kb.mo - ka.mo || kb.d - ka.d || kb.seq - ka.seq;
    if (d !== 0) return d;
  }
  return 0;
}

export default function AllRecords() {
  const { user } = useAuth();
  const [rowsRaw, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState({});
  const [q, setQ] = useState("");
  const [filterPriority, setFilterPriority] = useState("All");
  const [filterClassification, setFilterClassification] = useState("All");
  const [filterOfficeRequestor, setFilterOfficeRequestor] = useState("All");
  const [filterDestOffice, setFilterDestOffice] = useState("All");
  const [filterOrigin, setFilterOrigin] = useState("All");
  const [classificationOptions, setClassificationOptions] = useState([]);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const PAGE_SIZE = 10;

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
    // Fetch classification options from database (same as Create Record)
    const fetchClassOpts = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) return;
        const headers = { Authorization: `Bearer ${token}` };
        const res = await axios.get("/api/dropdown-options?category=classification", { headers });
        if (res.data && res.data.length > 0) {
          setClassificationOptions(res.data.map(o => o.value));
        }
      } catch (e) {
        // fallback: use classifications found in records
      }
    };
    fetchClassOpts();
    return () => socket.off("recordUpdated", onUpdated);
  }, []);

  // Format date function
  const fmtDate = (d) => (d ? new Date(d).toLocaleString() : "—");



  // Handle delete — opens the password confirmation modal
  const handleDelete = (r) => {
    if (!isAdmin) return alert("Only admins can delete records.");
    if (!r.id) return alert("Cannot delete this record.");
    setDeleteTarget(r);
    setDeletePassword("");
    setDeleteError("");
  };

  // Confirm deletion — server verifies the password before removing the record
  const confirmDelete = async () => {
    if (!deletePassword.trim()) {
      setDeleteError("Please enter your password.");
      return;
    }
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await axios.delete(`/records/${deleteTarget.id}`, {
        data: { password: deletePassword },
      });
      setRowsRaw((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        "Failed to delete record.";
      setDeleteError(msg);
    } finally {
      setDeleteBusy(false);
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
          title: r.title || r.description || "",
          classification: r.classification || "",
          priority: r.priority || "Normal",
          office_requestor: r.office_requestor || "",
          destination_office: r.destination_office || "",
          record_origin: r.record_origin || "Unknown",
          created_at: r.created_at || null,
          received_at: r.received_at || null,
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
    return Array.from(map.values()).sort(sortByNewest);
  }, [rowsRaw]);

  // Get unique values for filter dropdowns
  const uniquePriorities = useMemo(() => [...new Set(records.map(r => r.priority).filter(Boolean))].sort(), [records]);
  const uniqueClassifications = useMemo(() => {
    // Use database options first (same as Create Record), fallback to records
    if (classificationOptions.length > 0) return classificationOptions;
    return [...new Set(records.map(r => r.classification).filter(Boolean))].sort();
  }, [classificationOptions, records]);
  const uniqueOfficeRequestors = useMemo(() => [...new Set(records.map(r => r.office_requestor).filter(Boolean))].sort(), [records]);
  const uniqueDestOffices = useMemo(() => [...new Set(records.map(r => r.destination_office).filter(Boolean))].sort(), [records]);
  const uniqueOrigins = useMemo(() => [...new Set(records.map(r => r.record_origin).filter(Boolean))].sort(), [records]);

  // Filter records by search term and dropdown filters
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return records.filter((r) => {
      // Text search
      if (ql) {
        const searchable = [r.control_number, r.title, r.description, r.classification, r.destination_office, r.record_origin, r.office_requestor].join(" ").toLowerCase();
        if (!searchable.includes(ql)) return false;
      }
      // Dropdown filters
      if (filterPriority !== "All" && r.priority !== filterPriority) return false;
      if (filterClassification !== "All" && r.classification !== filterClassification) return false;
      if (filterOfficeRequestor !== "All" && r.office_requestor !== filterOfficeRequestor) return false;
      if (filterDestOffice !== "All" && r.destination_office !== filterDestOffice) return false;
      if (filterOrigin !== "All" && r.record_origin !== filterOrigin) return false;
      return true;
    });
  }, [records, q, filterPriority, filterClassification, filterOfficeRequestor, filterDestOffice, filterOrigin]);

  const clearFilters = () => {
    setQ("");
    setFilterPriority("All");
    setFilterClassification("All");
    setFilterOfficeRequestor("All");
    setFilterDestOffice("All");
    setFilterOrigin("All");
  };

  // Reset to page 1 whenever filters change
  useEffect(() => {
    setPage(1);
  }, [q, filterPriority, filterClassification, filterOfficeRequestor, filterDestOffice, filterOrigin]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage]
  );
  const startIdx = filtered.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1;
  const endIdx = Math.min(safePage * PAGE_SIZE, filtered.length);
  const pageNumbers = useMemo(() => {
    const span = 2; // pages shown on each side of the current one
    let from = Math.max(1, safePage - span);
    let to = Math.min(totalPages, safePage + span);
    if (to - from < span * 2) {
      from = Math.max(1, to - span * 2);
      to = Math.min(totalPages, from + span * 2);
    }
    const arr = [];
    for (let i = from; i <= to; i++) arr.push(i);
    return arr;
  }, [safePage, totalPages]);

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
        <div className="container-fluid px-3 py-2">
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
            <div className="row g-2 align-items-end">
              {/* Search */}
              <div className="col-12 col-md-3">
                <label className="form-label small fw-semibold">Search</label>
                <input
                  className="form-control form-control-sm"
                  placeholder="Control #, title, description…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              {/* Priority */}
              <div className="col-6 col-md">
                <label className="form-label small fw-semibold">Priority</label>
                <select className="form-select form-select-sm" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
                  <option value="All">All</option>
                  {uniquePriorities.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              {/* Classification */}
              <div className="col-6 col-md">
                <label className="form-label small fw-semibold">Classification</label>
                <select className="form-select form-select-sm" value={filterClassification} onChange={(e) => setFilterClassification(e.target.value)}>
                  <option value="All">All</option>
                  {uniqueClassifications.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              {/* Office Requestor */}
              <div className="col-6 col-md">
                <label className="form-label small fw-semibold">Office Requestor</label>
                <select className="form-select form-select-sm" value={filterOfficeRequestor} onChange={(e) => setFilterOfficeRequestor(e.target.value)}>
                  <option value="All">All</option>
                  {uniqueOfficeRequestors.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {/* Destination Office */}
              <div className="col-6 col-md">
                <label className="form-label small fw-semibold">Dest. Office</label>
                <select className="form-select form-select-sm" value={filterDestOffice} onChange={(e) => setFilterDestOffice(e.target.value)}>
                  <option value="All">All</option>
                  {uniqueDestOffices.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {/* Record Origin */}
              <div className="col-6 col-md">
                <label className="form-label small fw-semibold">Origin</label>
                <select className="form-select form-select-sm" value={filterOrigin} onChange={(e) => setFilterOrigin(e.target.value)}>
                  <option value="All">All</option>
                  {uniqueOrigins.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              {/* Clear */}
              <div className="col-12 col-md-auto">
                <button className="btn btn-outline-secondary btn-sm w-100" onClick={clearFilters}>Clear filters</button>
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
                    <th>Title / Description</th>
                    <th>Classification</th>
                    {/* <th>Priority</th> */}
                    <th>Office Requestor</th>
                    <th>Destination Office</th>
                    <th>Record Origin</th>
                    <th>Created At</th>
                    <th>Received At</th>
                    <th>Attachments</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={11} className="text-center text-muted">
                        No records match your filters.
                      </td>
                    </tr>
                  )}
                  {pageRows.map((r) => (
                    <tr key={r.id}>
                      <td>{r.control_number || "—"}</td>
                      <td>
                        <div className="small fw-semibold">{r.title }</div>
                        <div className="text-muted" style={{ fontSize: '0.78rem', maxWidth: '250px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.description || "—"}</div>
                      </td>
                      <td>{r.classification || "—"}</td>
                      {/* <td>
                        <span className={priorityClass(r.priority)}>
                          {r.priority || "-"}
                        </span>
                      </td> */}
                      <td>{r.office_requestor || "—"}</td>

                      <td>{r.destination_office || "—"}</td>
                      <td>{r.record_origin || "Unknown"}</td>
                      <td>{fmtDate(r.created_at)}</td>
                      <td>{fmtDate(r.received_at)}</td>
                      <td>
                        {(() => {
                          // Only show merged documents (routing slip + document combined)
                          const mergedFiles = r.files.filter(f =>
                            String(f.name || '').toLowerCase().includes('merged')
                          );
                          if (mergedFiles.length > 0) {
                            return (
                              <ul className="mb-0 small">
                                {mergedFiles.map((f, i) => (
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
                            );
                          }
                          return <span className="text-muted">No merged document</span>;
                        })()}
                      </td>
                      <td>
                        <div className="d-flex gap-1 justify-content-center">
                          <button
                            className="ar-icon-btn ar-icon-view"
                            title="View QR"
                            onClick={() => handleViewQR(r)}
                          >
                            <FaQrcode />
                          </button>
                          {isAdmin && (
                            <Link
                              className="ar-icon-btn ar-icon-edit"
                              title="Edit"
                              to={`/records/${r.id}/edit`}
                            >
                              <FaPencilAlt />
                            </Link>
                          )}
                          {isAdmin && (
                            <button
                              className="ar-icon-btn ar-icon-delete"
                              title="Delete"
                              disabled={!r.id}
                              onClick={() => handleDelete(r)}
                            >
                              <FaTrashAlt />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination footer */}
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-2">
            <span className="text-muted small">
              Showing {startIdx}–{endIdx} of {filtered.length} record
              {filtered.length === 1 ? "" : "s"}
            </span>
            <div className="btn-group btn-group-sm">
              <button
                className="btn btn-outline-secondary"
                disabled={safePage <= 1}
                onClick={() => setPage(safePage - 1)}
              >
                ‹ Prev
              </button>
              {pageNumbers.map((p) => (
                <button
                  key={p}
                  className={
                    "btn " + (p === safePage ? "btn-success" : "btn-outline-secondary")
                  }
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                className="btn btn-outline-secondary"
                disabled={safePage >= totalPages}
                onClick={() => setPage(safePage + 1)}
              >
                Next ›
              </button>
            </div>
          </div>

          {/* Delete password confirmation modal */}
          {deleteTarget && (
            <div
              className="qr-modal-backdrop"
              onClick={() => !deleteBusy && setDeleteTarget(null)}
            >
              <div className="qr-modal-dialog" onClick={(e) => e.stopPropagation()}>
                <h5>Delete {deleteTarget.control_number}</h5>
                <p className="text-muted small mb-3">
                  This will permanently remove the record and its files. Enter
                  your password to confirm.
                </p>
                <input
                  type="password"
                  className="form-control"
                  placeholder="Your password"
                  value={deletePassword}
                  autoFocus
                  disabled={deleteBusy}
                  onChange={(e) => {
                    setDeletePassword(e.target.value);
                    setDeleteError("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && confirmDelete()}
                />
                {deleteError && (
                  <div className="alert alert-danger py-2 small mt-2 mb-0">
                    {deleteError}
                  </div>
                )}
                <div className="d-flex gap-2 justify-content-end mt-3">
                  <button
                    className="btn btn-sm btn-outline-secondary"
                    disabled={deleteBusy}
                    onClick={() => setDeleteTarget(null)}
                  >
                    Cancel
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    disabled={deleteBusy || !deletePassword.trim()}
                    onClick={confirmDelete}
                  >
                    {deleteBusy ? "Deleting…" : "Confirm Delete"}
                  </button>
                </div>
              </div>
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
