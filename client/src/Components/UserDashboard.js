import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { socket } from "../socket";
import useOffices from "../utils/useOffices";
import { useAuth } from "../AuthContext";
import "./UserDashboard.css";

const norm = (s) => String(s || "").trim().toLowerCase();

export default function UserDashboard() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const { offices } = useOffices();

  // Multi-office forwarding state
  const [selectedOffices, setSelectedOffices] = useState({});

  // Filter states
  const [originFilter, setOriginFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  // Send to Records Unit upload state
  const [showSendModal, setShowSendModal] = useState(false);
  const [sendFile, setSendFile] = useState(null);
  const [sendDescription, setSendDescription] = useState("");
  const [sendLoading, setSendLoading] = useState(false);

  const API_BASE =
    process.env.REACT_APP_API_BASE?.replace(/\/$/, "") ||
    "";

  const myOffice = user?.office || "";

  // -------------------- Load Records --------------------
  const reloadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      if (!token) {
        alert("You must be logged in to view records.");
        return;
      }
      const res = await axios.get(`${API_BASE}/records/my-office`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const rows = Array.isArray(res.data) ? res.data : [];
      const byId = new Map();
      for (const r of rows) {
        if (!byId.has(r.id)) {
          byId.set(r.id, {
            id: r.id,
            control_number: r.control_number,
            description: r.description || "",
            destination_office: r.destination_office || "",
            office_requestor: r.office_requestor || "",
            current_office: r.current_office || "",
            record_origin: r.record_origin || "Internal",
            status: r.status || "IN_OFFICE",
            forwarded_at: r.forwarded_at || null,
            received_at: r.received_at || null,
            created_at: r.created_at || null,
            updated_at: r.updated_at || null,
            qrcode_path: r.qrcode_path || null,
            classification: r.classification || "",
            priority: r.priority || "Normal",
            files: [],
          });
        }
        if (r.file_path) {
          byId.get(r.id).files.push({
            name: r.file_name || r.file_path.split("/").pop(),
            path: r.file_path,
          });
        }
      }
      setRecords(Array.from(byId.values()));
    } catch (error) {
      console.error("Error loading records:", error);
      alert("Failed to load records.");
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  // -------------------- Send to Records Unit --------------------
  const handleSendToRecords = async (e) => {
    e.preventDefault();
    if (!sendFile) {
      alert("Please select a file to upload.");
      return;
    }
    setSendLoading(true);
    try {
      const token = localStorage.getItem("token");
      const fd = new FormData();
      fd.append("file", sendFile);
      fd.append("description", sendDescription);
      await axios.post(`${API_BASE}/api/incoming-documents`, fd, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
      });
      alert("Document sent to Records Management Unit successfully!");
      setShowSendModal(false);
      setSendFile(null);
      setSendDescription("");
    } catch (err) {
      console.error("Send error:", err);
      alert(err?.response?.data?.error || "Failed to send document.");
    } finally {
      setSendLoading(false);
    }
  };

  useEffect(() => {
    reloadRecords();
    socket.on("recordUpdated", reloadRecords);
    return () => socket.off("recordUpdated", reloadRecords);
  }, [reloadRecords]);

  // -------------------- Record Classification --------------------
  // Documents physically in this office (can forward)
  const inOffice = useMemo(
    () => records.filter((r) => norm(r.current_office) === norm(myOffice)),
    [records, myOffice]
  );

  // Documents that are no longer in this office (forwarded away)
  const finished = useMemo(
    () =>
      records.filter(
        (r) =>
          norm(r.current_office) !== norm(myOffice) &&
          norm(r.destination_office) !== norm(myOffice)
      ),
    [records, myOffice]
  );

  // -------------------- Filtering --------------------
  const applyFilters = useCallback(
    (list) => {
      return list.filter((r) => {
        if (originFilter !== "All") {
          if (norm(r.record_origin) !== norm(originFilter)) return false;
        }
        if (statusFilter !== "All") {
          const isUpdated = !!r.qrcode_path;
          if (statusFilter === "Updated" && !isUpdated) return false;
          if (statusFilter === "Not Updated" && isUpdated) return false;
        }
        if (searchTerm) {
          const s = searchTerm.toLowerCase();
          const searchable = `${r.control_number} ${r.description} ${r.office_requestor} ${r.destination_office}`.toLowerCase();
          if (!searchable.includes(s)) return false;
        }
        return true;
      });
    },
    [originFilter, statusFilter, searchTerm]
  );

  const filteredInOffice = useMemo(() => applyFilters(inOffice), [inOffice, applyFilters]);

  // -------------------- Multi-Office Forward --------------------
  const [forwardingId, setForwardingId] = useState(null);
  const [officeSearch, setOfficeSearch] = useState({});
  const [showSuggestions, setShowSuggestions] = useState({});

  const addOffice = (recordId, office) => {
    setSelectedOffices((prev) => {
      const current = prev[recordId] || [];
      if (current.includes(office)) return prev;
      return { ...prev, [recordId]: [...current, office] };
    });
    setOfficeSearch((prev) => ({ ...prev, [recordId]: "" }));
    setShowSuggestions((prev) => ({ ...prev, [recordId]: false }));
  };

  const removeOffice = (recordId, office) => {
    setSelectedOffices((prev) => ({
      ...prev,
      [recordId]: (prev[recordId] || []).filter((o) => o !== office),
    }));
  };

  const getFilteredSuggestions = (recordId) => {
    const query = (officeSearch[recordId] || "").toLowerCase();
    const selected = selectedOffices[recordId] || [];
    return offices.filter(
      (o) =>
        o.toLowerCase().includes(query) &&
        !selected.includes(o) &&
        query.length > 0
    );
  };

  const handleForward = async (record) => {
    const selected = selectedOffices[record.id] || [];
    if (selected.length === 0)
      return alert("Please select at least one destination office.");
    if (
      !window.confirm(
        `Forward "${record.control_number}" to ${selected.join(", ")}?`
      )
    )
      return;

    setForwardingId(record.id);
    try {
      await axios.put(`/records/forward/${record.id}`, {
        destination_offices: selected,
      });
      alert(`Record forwarded to ${selected.join(", ")}.`);
      setSelectedOffices((prev) => ({ ...prev, [record.id]: [] }));
      reloadRecords();
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to forward record.";
      console.error("Forward error:", err);
      alert(msg);
    } finally {
      setForwardingId(null);
    }
  };

  // -------------------- Helpers --------------------
  const formatDateTime = (ts) => {
    if (!ts) return "—";
    return new Date(ts).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // -------------------- Render Card --------------------
  const renderCard = (r) => {
    const selected = selectedOffices[r.id] || [];
    const suggestions = getFilteredSuggestions(r.id);
    const showSugg = showSuggestions[r.id] && suggestions.length > 0;
    return (
      <div key={r.id} className="card">
        <div className="card-header">
          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
            <div>
              <h3 className="mb-1">{r.control_number || "—"}</h3>
              <p className="mb-0">{r.description || "Untitled"}</p>
            </div>
            <div className="d-flex gap-1 align-items-center flex-wrap">
              <span className="badge text-bg-success">In Office</span>
              <span className="badge text-bg-secondary">
                {r.record_origin || "Internal"}
              </span>
            </div>
          </div>
        </div>

        <div className="card-body">
          <div className="card-meta">
            <p><strong>From:</strong> {r.office_requestor || "—"}</p>
            <p><strong>Classification:</strong> {r.classification || "—"}</p>
            <p><strong>Priority:</strong> {r.priority || "Normal"}</p>
            <p><strong>Created:</strong> {formatDateTime(r.created_at)}</p>
          </div>

          <div className="card-files">
            <strong>Files:</strong>
            {(() => {
              const files = r.files || [];
              const mergedFile = files.find(f => String(f.name || '').toLowerCase().includes('merged'));
              const routingFile = files.find(f => String(f.name || '').toLowerCase().includes('routing') && !String(f.name || '').toLowerCase().includes('merged'));
              const docFiles = files.filter(f => !String(f.name || '').toLowerCase().includes('routing') && !String(f.name || '').toLowerCase().includes('merged'));
              const displayFiles = [];
              // Always show original document files
              docFiles.forEach(f => displayFiles.push(f));
              // If merged exists, show it (replaces standalone routing slip)
              if (mergedFile) {
                displayFiles.push(mergedFile);
              } else if (routingFile) {
                displayFiles.push(routingFile);
              }
              return displayFiles.length > 0 ? (
                displayFiles.map((file, index) => (
                  <div key={index} className="file-row">
                    <Link
                      to={`/attachment-viewer?file=${encodeURIComponent(
                        file.path
                      )}&name=${encodeURIComponent(file.name)}`}
                      className="text-primary"
                    >
                      {file.name}
                    </Link>
                  </div>
                ))
              ) : (
                <p className="text-muted mb-0">No attachments</p>
              );
            })()}
          </div>
        </div>

        <div className="card-footer">
          <div className="multi-office-select">
            <label className="form-label mb-1 small fw-semibold">
              Forward to offices:
            </label>
            {/* Selected offices as removable tags */}
            {selected.length > 0 && (
              <div className="selected-offices">
                {selected.map((o) => (
                  <span key={o} className="selected-office-tag">
                    {o}
                    <button
                      type="button"
                      className="remove-tag"
                      onClick={() => removeOffice(r.id, o)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Type-ahead input */}
            <div className="autocomplete-wrapper">
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Type to search office..."
                value={officeSearch[r.id] || ""}
                onChange={(e) => {
                  setOfficeSearch((prev) => ({ ...prev, [r.id]: e.target.value }));
                  setShowSuggestions((prev) => ({ ...prev, [r.id]: true }));
                }}
                onFocus={() => setShowSuggestions((prev) => ({ ...prev, [r.id]: true }))}
                onBlur={() => setTimeout(() => setShowSuggestions((prev) => ({ ...prev, [r.id]: false })), 200)}
              />
              {showSugg && (
                <div className="autocomplete-dropdown">
                  {suggestions.map((o) => (
                    <div
                      key={o}
                      className="autocomplete-item"
                      onMouseDown={() => addOffice(r.id, o)}
                    >
                      {o}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <button
            className="btn-release"
            disabled={selected.length === 0 || forwardingId === r.id}
            onClick={() => handleForward(r)}
          >
            {forwardingId === r.id
              ? "Forwarding…"
              : `Forward to ${selected.length || 0} Office(s)`}
          </button>
        </div>
      </div>
    );
  };

  // -------------------- Filter Bar --------------------
  const renderFilters = () => (
    <div className="filter-bar">
      <div className="filter-bar-inner">
        <input
          type="text"
          className="form-control"
          placeholder="Search by control number, description, or office..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <select
          className="form-select"
          value={originFilter}
          onChange={(e) => setOriginFilter(e.target.value)}
        >
          <option value="All">All Types</option>
          <option value="Internal">Internal</option>
          <option value="External">External</option>
        </select>
        <select
          className="form-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="All">All Status</option>
          <option value="Updated">Updated</option>
          <option value="Not Updated">Not Updated</option>
        </select>
      </div>
    </div>
  );

  // -------------------- Render --------------------
  return (
    <div className="d-flex align-items-stretch">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="content-area">
          {!myOffice ? (
            <div className="alert alert-warning py-2 small">
              <strong>No office assigned to your account.</strong> Documents
              destined for your office won't appear here until an administrator
              sets your office. Please contact the Records Unit.
            </div>
          ) : (
            <div className="text-muted small mb-2">
              Showing documents for{" "}
              <strong className="text-primary">{myOffice}</strong>
            </div>
          )}

          {/* Dashboard Summary */}
          <div className="dashboard-widgets">
            <div className="widget">
              <div className="widget-title">In Office</div>
              <div className="widget-value">{inOffice.length}</div>
            </div>
            <div className="widget">
              <div className="widget-title">Total Active</div>
              <div className="widget-value">{inOffice.length}</div>
            </div>
            <div className="widget" style={{ opacity: 0.7 }}>
              <div className="widget-title">Finished</div>
              <div className="widget-value" style={{ fontSize: "1.2rem" }}>
                <a href="/finished-documents" style={{ color: "inherit" }}>
                  {finished.length} →
                </a>
              </div>
            </div>
          </div>

          {/* Send to Records Unit Button */}
          <div className="mb-3">
            <button
              className="btn btn-success btn-sm"
              onClick={() => setShowSendModal(true)}
              style={{ borderRadius: '8px', padding: '6px 16px' }}
            >
              📤 Send Document to Records Unit
            </button>
          </div>

          {/* Send to Records Unit Modal */}
          {showSendModal && (
            <div className="modal-overlay" onClick={() => setShowSendModal(false)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '480px' }}>
                <div className="modal-header">
                  <h5 className="modal-title">Send Document to Records Management Unit</h5>
                  <button type="button" className="btn-close" onClick={() => setShowSendModal(false)} />
                </div>
                <form onSubmit={handleSendToRecords}>
                  <div className="modal-body">
                    <div className="mb-3">
                      <label className="form-label fw-bold">PDF File *</label>
                      <input
                        type="file"
                        className="form-control"
                        accept=".pdf"
                        onChange={(e) => setSendFile(e.target.files[0])}
                        required
                      />
                    </div>
                    <div className="mb-3">
                      <label className="form-label fw-bold">Description / Purpose</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        placeholder="Brief description of the document..."
                        value={sendDescription}
                        onChange={(e) => setSendDescription(e.target.value)}
                      />
                    </div>
                    <div className="text-muted small">
                      📁 From: <strong>{myOffice}</strong>
                    </div>
                  </div>
                  <div className="modal-footer">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowSendModal(false)}>Cancel</button>
                    <button type="submit" className="btn btn-success btn-sm" disabled={sendLoading}>
                      {sendLoading ? 'Sending...' : '📤 Send to Records Unit'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {renderFilters()}

          {loading ? (
            <div className="status">Loading…</div>
          ) : records.length === 0 ? (
            <div className="status">No documents assigned to your office.</div>
          ) : (
            <>
              {/* Documents in my office — only active section */}
              <div className="dashboard-section">
                <div className="dashboard-section-head">
                  <h4 className="mb-0">
                    Documents in My Office{" "}
                    <span className="badge text-bg-success">
                      {filteredInOffice.length}
                    </span>
                  </h4>
                  <span className="text-muted small">
                    Currently with {myOffice}
                  </span>
                </div>
                {filteredInOffice.length === 0 ? (
                  <div className="status">No documents in your office yet.</div>
                ) : (
                  <div className="records-cards">
                    {filteredInOffice.map((r) => renderCard(r))}
                  </div>
                )}
              </div>

              {filteredInOffice.length === 0 && (
                <div className="status">
                  No documents match your filters.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
