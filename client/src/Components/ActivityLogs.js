// client/src/Components/ActivityLogs.js
// Super-admin view of the audit trail written by server/activityLog.js:
// every sign-in, record/user/office change and page a user opened.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaHistory,
  FaSearch,
  FaSyncAlt,
  FaChevronLeft,
  FaChevronRight,
  FaExclamationCircle,
  FaUserCircle,
} from "react-icons/fa";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import "./ActivityLogs.css";

const ROLE_LABELS = {
  super_admin: "Super Admin",
  admin: "Admin",
  user: "User",
};

const fmtDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function ActivityLogs() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [limit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [users, setUsers] = useState([]);
  const inFlight = useRef(false);

  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Debounce the free-text search so typing does not fire a request per key.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    axios
      .get("/api/admin/activity/users")
      .then((res) => setUsers(Array.isArray(res.data) ? res.data : []))
      .catch(() => setUsers([]));
  }, []);

  // `silent` is used by the 5-second auto-refresh: it updates the rows in place
  // without flashing the loading state or clearing the error banner.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (inFlight.current) return;
    inFlight.current = true;
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const params = { page, limit };
      if (query) params.q = query;
      if (userId) params.userId = userId;
      if (role) params.role = role;
      if (from) params.from = from;
      if (to) params.to = to;
      const res = await axios.get("/api/admin/activity", { params });
      setRows(Array.isArray(res.data?.rows) ? res.data.rows : []);
      setTotal(res.data?.total || 0);
      setPages(res.data?.pages || 1);
      setError("");
    } catch (err) {
      setError(
        err.response?.data?.error || "Could not load the activity log."
      );
      setRows([]);
      setTotal(0);
      setPages(1);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [page, limit, query, userId, role, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll for new entries every 5 seconds. Paused while the tab is hidden so a
  // background tab does not keep hitting the server.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      load({ silent: true });
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);

  const hasFilters = Boolean(search || userId || role || from || to);
  const clearFilters = () => {
    setSearch("");
    setQuery("");
    setUserId("");
    setRole("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const rangeLabel = useMemo(() => {
    if (!total) return "No entries";
    const first = (page - 1) * limit + 1;
    const last = Math.min(page * limit, total);
    return `${first}–${last} of ${total}`;
  }, [page, limit, total]);

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="al-page container-fluid p-3 p-md-4">
          <div className="al-header">
            <FaHistory className="al-header-icon" />
            <div>
              <h2 className="al-title">Activity Logs</h2>
              <p className="al-subtitle">
                Every sign-in, change and page opened in the system, newest first.
              </p>
            </div>
          </div>

          <div className="al-filters">
            <div className="al-filter al-filter-search">
              <label className="al-label">Search</label>
              <div className="al-search">
                <FaSearch className="al-search-icon" />
                <input
                  type="text"
                  className="al-input"
                  placeholder="Action, details, user…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="al-filter">
              <label className="al-label">User</label>
              <select
                className="al-input"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All users</option>
                {users.map((u) => (
                  <option key={u.user_id} value={u.user_id}>
                    {u.name || `User #${u.user_id}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="al-filter">
              <label className="al-label">Role</label>
              <select
                className="al-input"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All roles</option>
                <option value="super_admin">Super Admin</option>
                <option value="admin">Admin</option>
                <option value="user">User</option>
              </select>
            </div>

            <div className="al-filter">
              <label className="al-label">From</label>
              <input
                type="date"
                className="al-input"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="al-filter">
              <label className="al-label">To</label>
              <input
                type="date"
                className="al-input"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  setPage(1);
                }}
              />
            </div>

            <div className="al-filter al-filter-actions">
              <button
                className="al-btn al-btn-ghost"
                onClick={() => load()}
                title="Refresh"
                disabled={loading}
              >
                <FaSyncAlt /> Refresh
              </button>
              {hasFilters && (
                <button className="al-btn al-btn-clear" onClick={clearFilters}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="al-summary">
            <span>{rangeLabel}</span>
            {loading && <span className="al-loading">Loading…</span>}
            <span className="al-auto">
              <span className="al-auto-dot" /> Auto-refresh every 5s
            </span>
          </div>

          {error && (
            <div className="al-error">
              <FaExclamationCircle />
              <span>{error}</span>
            </div>
          )}

          <div className="al-table-wrap rs-stack">
            <table className="al-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && !loading && (
                  <tr>
                    <td colSpan={5} data-label="" className="al-empty">
                      {hasFilters
                        ? "No activity matches these filters."
                        : "No activity has been recorded yet."}
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <tr key={row.id} className={row.status_code >= 400 ? "al-failed" : ""}>
                    <td data-label="When" className="al-when">
                      {fmtDateTime(row.created_at)}
                    </td>
                    <td data-label="User">
                      <div className="al-user">
                        <FaUserCircle className="al-user-icon" />
                        <div className="al-user-text">
                          <span className="al-user-name">
                            {row.user_name || "Unknown"}
                          </span>
                          <span className="al-user-meta">
                            {ROLE_LABELS[row.user_role] || row.user_role || "—"}
                            {row.office ? ` · ${row.office}` : ""}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td data-label="Action">
                      <span className="al-action">{row.action}</span>
                      {row.status_code >= 400 && (
                        <span className="al-badge-failed">{row.status_code}</span>
                      )}
                    </td>
                    <td data-label="Details" className="al-details">
                      {row.details || "—"}
                    </td>
                    <td data-label="IP" className="al-ip">
                      {row.ip || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="al-pager">
            <button
              className="al-btn al-btn-ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <FaChevronLeft /> Previous
            </button>
            <span className="al-pager-label">
              Page {page} of {pages}
            </span>
            <button
              className="al-btn al-btn-ghost"
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
              disabled={page >= pages || loading}
            >
              Next <FaChevronRight />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
