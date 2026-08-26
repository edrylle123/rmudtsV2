import React, { useCallback, useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { useAuth } from "../AuthContext";
import { BsCalendarDateFill } from "react-icons/bs";
import "./UserDashboard.css";

const norm = (s) => String(s || "").trim().toLowerCase();

export default function FinishedDocuments() {
  const { user } = useAuth();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [originFilter, setOriginFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const API_BASE =
    process.env.REACT_APP_API_BASE?.replace(/\/$/, "") ||
    "";

  const myOffice = user?.office || "";

  const reloadRecords = useCallback(async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      if (!token) return;

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
            created_at: r.created_at || null,
            qrcode_path: r.qrcode_path || null,
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
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    reloadRecords();
  }, [reloadRecords]);

  // Finished = documents that are NOT on the main dashboard
  // (not in our office, not destined for our office)
  const finished = useMemo(
    () =>
      records.filter((r) => {
        const isHere = norm(r.current_office) === norm(myOffice);
        const destIsHere = norm(r.destination_office) === norm(myOffice);
        // If it's not in our office AND not destined for us, it's finished
        return !isHere && !destIsHere;
      }),
    [records, myOffice]
  );

  const filtered = useMemo(() => {
    const fromT = fromDate ? new Date(fromDate).setHours(0, 0, 0, 0) : null;
    const toT = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : null;

    return finished.filter((r) => {
      if (originFilter !== "All" && norm(r.record_origin) !== norm(originFilter)) return false;
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        const searchable = `${r.control_number} ${r.description} ${r.office_requestor} ${r.destination_office} ${r.current_office}`.toLowerCase();
        if (!searchable.includes(s)) return false;
      }
      // Date range filter (based on forwarded_at)
      const ft = r.forwarded_at ? new Date(r.forwarded_at).getTime() : null;
      if (fromT && ft != null && ft < fromT) return false;
      if (toT && ft != null && ft > toT) return false;
      return true;
    });
  }, [finished, originFilter, searchTerm, fromDate, toDate]);

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

  return (
    <div className="d-flex align-items-stretch">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="content-area">
          <div className="text-muted small mb-2">
            Documents processed and forwarded from{" "}
            <strong className="text-primary">{myOffice}</strong>
          </div>

          {/* Summary */}
          <div className="dashboard-widgets">
            <div className="widget">
              <div className="widget-title">Finished Documents</div>
              <div className="widget-value">{finished.length}</div>
            </div>
          </div>

          {/* Filters */}
          <div className="filter-bar">
            <div className="filter-bar-inner" style={{ flexWrap: 'wrap', gap: '8px' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Search by control number, description, or office..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ minWidth: '200px' }}
              />
              <select
                className="form-select"
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
                style={{ width: 'auto' }}
              >
                <option value="All">All Types</option>
                <option value="Internal">Internal</option>
                <option value="External">External</option>
              </select>
              <div className="d-flex align-items-center gap-1">
                <BsCalendarDateFill className="text-muted" />
                <input
                  type="date"
                  className="form-control"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  title="From date"
                  style={{ width: 'auto' }}
                />
                <span className="text-muted small">to</span>
                <input
                  type="date"
                  className="form-control"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  title="To date"
                  style={{ width: 'auto' }}
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="status">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="status">No finished documents.</div>
          ) : (
            <div className="records-cards">
              {filtered.map((r) => (
                <div key={r.id} className="card card-finished">
                  <div className="card-header">
                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                      <div>
                        <h3 className="mb-1">{r.control_number || "—"}</h3>
                        <p className="mb-0">{r.description || "Untitled"}</p>
                      </div>
                      <div className="d-flex gap-1 align-items-center flex-wrap">
                        <span className="badge text-bg-secondary">Finished</span>
                        <span className="badge text-bg-secondary">
                          {r.record_origin || "Internal"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="card-body">
                    <div className="card-meta">
                      <p><strong>From:</strong> {r.office_requestor || "—"}</p>
                      <p><strong>Sent To:</strong> {r.destination_office || "—"}</p>
                      <p><strong>Currently At:</strong> {r.current_office || "—"}</p>
                      <p><strong>Forwarded:</strong> {formatDateTime(r.forwarded_at)}</p>
                    </div>
                    <div className="card-files">
                      <strong>Files:</strong>
                      {r.files && r.files.length > 0 ? (
                        r.files.map((file, index) => (
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
                      )}
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
