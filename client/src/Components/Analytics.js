// client/src/Components/Analytics.js
import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { useAuth } from "../AuthContext";
import {
  FaArchive,
  FaBolt,
  FaBuilding,
  FaChartBar,
  FaChartLine,
  FaChartPie,
  FaCheckCircle,
  FaClock,
  FaExclamationTriangle,
  FaTrophy,
  FaUsers,
} from "react-icons/fa";
import "./Analytics.css";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = {
  blue: "#3b82f6",
  green: "#22c55e",
  orange: "#f59e0b",
  red: "#ef4444",
  purple: "#a78bfa",
  slate: "#64748b",
};

const DAY = 86400000;

// Parse retention values like "3 Years", "10", "Permanent" into days.
const parseRetentionDays = (value) => {
  const v = String(value || "").toLowerCase().trim();
  if (!v || v.includes("permanent")) return Infinity;
  const years = parseInt(v, 10);
  return Number.isNaN(years) ? 365 : years * 365;
};

const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};

const weekKey = (d) => {
  const dt = new Date(d);
  const onejan = new Date(dt.getFullYear(), 0, 1);
  const week = Math.ceil(
    (dt - onejan) / DAY + onejan.getDay() + 1) / 7;
  return `${dt.getFullYear()}-W${String(week).padStart(2, "0")}`;
};

const monthKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};

const quarterKey = (d) => {
  const dt = new Date(d);
  return `${dt.getFullYear()}-Q${Math.floor(dt.getMonth() / 3) + 1}`;
};

const yearKey = (d) => String(new Date(d).getFullYear());

const computeStatus = (rec) => {
  const created = rec?.created_at ? new Date(rec.created_at) : null;
  if (!created) return "Pending";
  const ageDays = (Date.now() - created.getTime()) / DAY;
  const retentionDays = parseRetentionDays(rec?.retention_period);
  if (retentionDays !== Infinity) {
    const ratio = ageDays / retentionDays;
    if (ratio >= 1) return "Archived";
    if (ratio >= 0.8) return "Completed";
  }
  const pr = String(rec?.priority || "").toLowerCase();
  if (pr === "low") return "Approved";
  return "Pending";
};

// ---------------- CSV helpers ----------------
const csvEscape = (val) => {
  const s = val == null ? "" : String(val);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const makeCsv = (sections) => {
  let out = "";
  for (const sec of sections) {
    out += `# ${sec.title}\n`;
    if (sec.headers?.length) out += sec.headers.map(csvEscape).join(",") + "\n";
    if (sec.rows?.length)
      for (const row of sec.rows) out += row.map(csvEscape).join(",") + "\n";
    out += "\n";
  }
  return out;
};

const downloadCsv = (csv, filename) => {
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

// ---------------- Constants ----------------
const RANGE_OPTIONS = [
  { label: "Last 7 Days", days: 7 },
  { label: "Last 30 Days", days: 30 },
  { label: "Last 90 Days", days: 90 },
  { label: "Year to Date", days: "ytd" },
  { label: "All Time", days: 0 },
];

const SERIES_MODES = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Shared panel with an icon chip in the header.
function Panel({ icon, iconBg, iconColor, title, action, children }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-heading">
          {icon && (
            <span
              className="panel-icon"
              style={{ background: iconBg, color: iconColor }}
            >
              {icon}
            </span>
          )}
          <h5 className="mb-0">{title}</h5>
        </div>
        {action}
      </div>
      <div className="panel-body">{children}</div>
    </div>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const role = user?.role || "user";

  const [records, setRecords] = useState([]);
  const [usersCount, setUsersCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [rangeLabel, setRangeLabel] = useState("Last 30 Days");
  const [seriesMode, setSeriesMode] = useState("Daily");

  // Resolve the selected range into a number of days (0 = all time).
  const rangeDays = useMemo(() => {
    const opt =
      RANGE_OPTIONS.find((o) => o.label === rangeLabel) || RANGE_OPTIONS[1];
    if (opt.days === "ytd") {
      const now = new Date();
      const start = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.round((now - start) / DAY));
    }
    return opt.days;
  }, [rangeLabel]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const recRes = await axios.get("/records/my-office");
        if (!cancelled)
          setRecords(Array.isArray(recRes.data) ? recRes.data : []);
        if (role === "admin") {
          try {
            const u = await axios.get("/users");
            if (!cancelled)
              setUsersCount(Array.isArray(u.data) ? u.data.length : null);
          } catch {
            if (!cancelled) setUsersCount(null);
          }
        } else setUsersCount(null);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [role]);

  // Normalized records, filtered by the selected time range.
  const rec = useMemo(() => {
    const cutoff = rangeDays > 0 ? Date.now() - rangeDays * DAY : 0;
    return records
      .filter((r) => {
        if (!r?.created_at) return false;
        const t = new Date(r.created_at).getTime();
        if (Number.isNaN(t)) return false;
        return cutoff === 0 || t >= cutoff;
      })
      .map((r) => {
        const created = r.created_at ? new Date(r.created_at) : null;
        const hoursOld = created
          ? Math.max(0, (Date.now() - created.getTime()) / 36e5)
          : 0;
        return {
          id: r?.id ?? r?.record_id ?? r?.control_number,
          control_number: r?.control_number || "",
          title: r?.title || r?.description || "",
          created_at: r?.created_at,
          classification: r?.classification || "Others",
          priority: r?.priority || "Normal",
          destination_office: r?.destination_office || "—",
          retention_period: r?.retention_period || "1 Year",
          status: computeStatus(r),
          hoursOld,
        };
      });
  }, [records, rangeDays]);

  const avgProcessingTimeHrs = useMemo(() => {
    if (rec.length === 0) return 0;
    const sum = rec.reduce((a, b) => a + b.hoursOld, 0);
    return Math.round((sum / rec.length) * 10) / 10;
  }, [rec]);

  const statusCounts = useMemo(() => {
    const m = { Pending: 0, Approved: 0, Completed: 0, Archived: 0 };
    for (const r of rec) m[r.status] = (m[r.status] || 0) + 1;
    return m;
  }, [rec]);

  const totalForRate = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const approvalRate =
    totalForRate > 0
      ? Math.round(((statusCounts.Approved || 0) / totalForRate) * 1000) / 10
      : 0;
  const backlogItems = statusCounts.Pending || 0;

  // Documents received this week (for the alerts panel).
  const receivedThisWeek = useMemo(() => {
    const weekAgo = Date.now() - 7 * DAY;
    return rec.filter((r) => {
      const t = r.created_at ? new Date(r.created_at).getTime() : 0;
      return t >= weekAgo;
    }).length;
  }, [rec]);

  // ------- Volume trends -------
  const volumeData = useMemo(() => {
    const map = new Map();
    const add = (key) => map.set(key, (map.get(key) || 0) + 1);

    const keyFn =
      seriesMode === "Weekly"
        ? weekKey
        : seriesMode === "Monthly"
          ? monthKey
          : seriesMode === "Quarterly"
            ? quarterKey
            : seriesMode === "Yearly"
              ? yearKey
              : (d) => startOfDay(d).toISOString().slice(0, 10);

    for (const r of rec) {
      if (!r.created_at) continue;
      add(keyFn(r.created_at));
    }

    const toDateForSort = (bucket) => {
      if (bucket.includes("-W")) {
        const [y, w] = bucket.split("-W");
        return new Date(Number(y), 0, 1 + (Number(w) - 1) * 7).getTime();
      }
      if (bucket.includes("-Q")) {
        const [y, q] = bucket.split("-Q");
        return new Date(Number(y), (Number(q) - 1) * 3, 1).getTime();
      }
      if (/^\d{4}-\d{2}$/.test(bucket)) return new Date(bucket + "-01").getTime();
      if (/^\d{4}$/.test(bucket)) return new Date(bucket + "-01-01").getTime();
      return new Date(bucket).getTime();
    };

    return Array.from(map.entries())
      .sort((a, b) => toDateForSort(a[0]) - toDateForSort(b[0]))
      .map(([bucket, received]) => ({ bucket, received }));
  }, [rec, seriesMode]);

  // ---- Office workload (ranked bar list, top 6) ----
  const officeWorkload = useMemo(() => {
    const byOffice = new Map();
    for (const r of rec) {
      const key = r.destination_office || "—";
      byOffice.set(key, (byOffice.get(key) || 0) + 1);
    }
    return Array.from(byOffice.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({ name, count }));
  }, [rec]);

  const workloadMax = officeWorkload.length ? officeWorkload[0].count : 1;

  // ---- Avg processing (hours) by classification ----
  const proc = useMemo(() => {
    const sum = new Map();
    for (const r of rec) {
      const k = r.classification || "Others";
      const val = sum.get(k) || [0, 0];
      val[0] += r.hoursOld;
      val[1] += 1;
      sum.set(k, val);
    }
    const cls = ["Academic", "Administrative", "Financial", "HR", "Others"];
    return cls
      .map((name) => {
        const v = sum.get(name) || [0, 0];
        const hours = v[1] ? v[0] / v[1] : 0;
        return { name, hours: Math.round(hours * 10) / 10 };
      })
      .filter((x) => x.hours > 0);
  }, [rec]);

  const pieData = useMemo(
    () => [
      { name: "Pending", value: statusCounts.Pending || 0, color: COLORS.orange },
      { name: "Approved", value: statusCounts.Approved || 0, color: COLORS.green },
      { name: "Completed", value: statusCounts.Completed || 0, color: COLORS.blue },
      { name: "Archived", value: statusCounts.Archived || 0, color: COLORS.slate },
    ],
    [statusCounts]
  );

  // ---- Retention aging buckets ----
  const retention = useMemo(() => {
    const buckets = [
      { age: "0-6 months", min: 0, max: 182 },
      { age: "6-12 months", min: 182, max: 365 },
      { age: "1-2 years", min: 365, max: 730 },
      { age: "2+ years", min: 730, max: Infinity },
    ];
    const res = buckets.map((b) => ({
      age: b.age,
      within: 0,
      near: 0,
      overdue: 0,
    }));

    for (const r of rec) {
      const created = r.created_at ? new Date(r.created_at) : null;
      if (!created) continue;
      const ageDays = (Date.now() - created.getTime()) / DAY;
      const retentionDays = parseRetentionDays(r.retention_period);
      const ratio = retentionDays === Infinity ? 0 : ageDays / retentionDays;

      let idx = buckets.length - 1;
      for (let i = 0; i < buckets.length; i++) {
        if (ageDays >= buckets[i].min && ageDays < buckets[i].max) {
          idx = i;
          break;
        }
      }
      const row = res[idx];

      if (retentionDays !== Infinity) {
        if (ratio >= 1) row.overdue += 1;
        else if (ratio >= 0.8) row.near += 1;
        else row.within += 1;
      } else row.within += 1;
    }
    return res;
  }, [rec]);

  // ---- Top performing offices (completion rate) ----
  const topOffices = useMemo(() => {
    const byOffice = new Map();
    for (const r of rec) {
      const key = r.destination_office || "—";
      const v = byOffice.get(key) || { within: 0, near: 0, overdue: 0, total: 0 };
      const created = r.created_at ? new Date(r.created_at) : null;
      const ageDays = created ? (Date.now() - created.getTime()) / DAY : 0;
      const rd = parseRetentionDays(r.retention_period);
      const ratio = rd === Infinity ? 0 : ageDays / rd;
      if (rd !== Infinity) {
        if (ratio >= 1) v.overdue += 1;
        else if (ratio >= 0.8) v.near += 1;
        else v.within += 1;
      } else v.within += 1;
      v.total += 1;
      byOffice.set(key, v);
    }
    return Array.from(byOffice.entries())
      .map(([name, v]) => ({
        name,
        completion: v.total
          ? Math.round(((v.within + v.near) / v.total) * 1000) / 10
          : 0,
      }))
      .sort((a, b) => b.completion - a.completion)
      .slice(0, 3);
  }, [rec]);

  // ---------- Quick Action reports ----------
  const filterByPeriod = (recordsNorm, period) => {
    const now = new Date();
    const y = now.getFullYear();
    if (period === "yearly")
      return recordsNorm.filter(
        (r) => r.created_at && new Date(r.created_at).getFullYear() === y
      );
    const m = now.getMonth();
    return recordsNorm.filter((r) => {
      if (!r.created_at) return false;
      const d = new Date(r.created_at);
      return d.getFullYear() === y && d.getMonth() === m;
    });
  };

  const buildSummarySection = (rows, usersCountForCard) => {
    const localStatusCounts = rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {});
    const total = rows.length || 1;
    const avgHrs = rows.length
      ? Math.round((rows.reduce((a, b) => a + b.hoursOld, 0) / rows.length) * 10) / 10
      : 0;
    const approval = Math.round(((localStatusCounts.Approved || 0) / total) * 1000) / 10;
    return {
      title: "Summary",
      headers: ["Metric", "Value"],
      rows: [
        ["Total Records", rows.length],
        ["Avg Processing Time (hrs)", avgHrs],
        ["Approval Rate (%)", approval],
        ["Pending", localStatusCounts.Pending || 0],
        ["Completed (Nearing Disposal)", localStatusCounts.Completed || 0],
        ["Archived (Overdue)", localStatusCounts.Archived || 0],
        ["Active Users", usersCountForCard ?? ""],
      ],
    };
  };

  const buildClassificationSection = (rows) => {
    const map = new Map();
    for (const r of rows)
      map.set(r.classification, (map.get(r.classification) || 0) + 1);
    return {
      title: "By Classification",
      headers: ["Classification", "Count"],
      rows: Array.from(map.entries()),
    };
  };

  const buildOfficeWorkloadSection = (rows) => {
    const map = new Map();
    for (const r of rows)
      map.set(r.destination_office, (map.get(r.destination_office) || 0) + 1);
    return {
      title: "Office Workload",
      headers: ["Office", "Documents"],
      rows: Array.from(map.entries()).sort((a, b) => b[1] - a[1]),
    };
  };

  const buildStatusSection = (rows) => {
    const map = rows.reduce((m, r) => {
      m[r.status] = (m[r.status] || 0) + 1;
      return m;
    }, {});
    return {
      title: "Status Distribution",
      headers: ["Status", "Count"],
      rows: Object.entries(map),
    };
  };

  const buildVolumeSection = (rows, period) => {
    const map = new Map();
    if (period === "yearly") {
      for (const r of rows)
        map.set(monthKey(r.created_at), (map.get(monthKey(r.created_at)) || 0) + 1);
      return {
        title: "Volume by Month",
        headers: ["Bucket", "Documents Received"],
        rows: Array.from(map.entries()),
      };
    }
    for (const r of rows)
      map.set(
        startOfDay(r.created_at).toISOString().slice(0, 10),
        (map.get(startOfDay(r.created_at).toISOString().slice(0, 10)) || 0) + 1
      );
    return {
      title: "Volume by Day",
      headers: ["Bucket", "Documents Received"],
      rows: Array.from(map.entries()),
    };
  };

  const buildRetentionList = (rows) => {
    const out = [
      ["Control #", "Title", "Office", "Created At", "Retention", "Status"],
    ];
    for (const r of rows)
      if (r.status === "Completed" || r.status === "Archived")
        out.push([
          r.control_number,
          r.title,
          r.destination_office,
          r.created_at,
          r.retention_period,
          r.status,
        ]);
    return out;
  };

  const generatePeriodReport = (period) => {
    const filtered = filterByPeriod(rec, period);
    const sections = [
      buildSummarySection(filtered, usersCount),
      buildVolumeSection(filtered, period),
      buildClassificationSection(filtered),
      buildStatusSection(filtered),
      buildOfficeWorkloadSection(filtered),
    ];
    const csv = makeCsv(sections);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `${period}-report-${stamp}.csv`);
  };

  const exportAnalyticsCsv = () => {
    const headers = [
      "Control #",
      "Title",
      "Classification",
      "Priority",
      "Office",
      "Retention",
      "Status",
      "Created At",
    ];
    const rows = rec.map((r) => [
      r.control_number,
      r.title,
      r.classification,
      r.priority,
      r.destination_office,
      r.retention_period,
      r.status,
      r.created_at,
    ]);
    const csv = makeCsv([{ title: "All Records (Visible Scope)", headers, rows }]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `analytics-data-${stamp}.csv`);
  };

  const exportRetentionSchedule = () => {
    const rows = buildRetentionList(rec);
    const csv = makeCsv([
      {
        title: "Retention Schedule (Nearing & Overdue)",
        headers: rows[0],
        rows: rows.slice(1),
      },
    ]);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `retention-schedule-${stamp}.csv`);
  };

  const exportReport = () => window.print();

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />

        <div className="analytics container-fluid p-3 p-md-4">
          <div className="d-flex align-items-center justify-content-between mb-3 mb-md-4 flex-wrap gap-2">
            <div>
              <h2 className="page-title mb-0">Analytics Dashboard</h2>
              <div className="text-muted small">
                Comprehensive document tracking and performance metrics
              </div>
            </div>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              {!loading && (
                <span className="doc-chip">
                  {rec.length} document{rec.length === 1 ? "" : "s"} in range
                </span>
              )}
              <select
                className="form-select range-select"
                value={rangeLabel}
                onChange={(e) => setRangeLabel(e.target.value)}
                aria-label="Time range"
              >
                {RANGE_OPTIONS.map((o) => (
                  <option key={o.label} value={o.label}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button className="btn btn-primary" onClick={exportReport}>
                <span className="me-1">⬇️</span> Export Report
              </button>
            </div>
          </div>

          {loading ? (
            <div className="analytics-loading">Loading analytics…</div>
          ) : rec.length === 0 ? (
            <div className="empty-state">
              <FaChartBar className="empty-icon" />
              <div className="empty-title">No documents in this range</div>
              <div className="empty-text">
                Try a wider time range, or create a record first.
              </div>
            </div>
          ) : (
            <>
              {/* KPI Cards */}
              <div className="row g-3 g-lg-4 mb-3 mb-md-4">
                <div className="col-12 col-sm-6 col-lg-3">
                  <div className="stat-card">
                    <div
                      className="stat-icon"
                      style={{
                        background: "rgba(59,130,246,.12)",
                        color: COLORS.blue,
                      }}
                    >
                      <FaClock />
                    </div>
                    <div className="stat-body">
                      <div className="stat-value">
                        {avgProcessingTimeHrs || 0}hrs
                      </div>
                      <div className="stat-label">Avg Record Age</div>
                      <div className="stat-trend">
                        across {rec.length} document{rec.length === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-lg-3">
                  <div className="stat-card">
                    <div
                      className="stat-icon"
                      style={{
                        background: "rgba(34,197,94,.12)",
                        color: COLORS.green,
                      }}
                    >
                      <FaCheckCircle />
                    </div>
                    <div className="stat-body">
                      <div className="stat-value">{approvalRate.toFixed(1)}%</div>
                      <div className="stat-label">Approval Rate</div>
                      <div className="stat-trend">
                        {statusCounts.Approved || 0} approved in range
                      </div>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-lg-3">
                  <div className="stat-card">
                    <div
                      className="stat-icon"
                      style={{
                        background: "rgba(245,158,11,.12)",
                        color: COLORS.orange,
                      }}
                    >
                      <FaChartLine />
                    </div>
                    <div className="stat-body">
                      <div className="stat-value">{backlogItems}</div>
                      <div className="stat-label">Backlog Items</div>
                      <div className="stat-trend">awaiting action in range</div>
                    </div>
                  </div>
                </div>
                <div className="col-12 col-sm-6 col-lg-3">
                  <div className="stat-card">
                    <div
                      className="stat-icon"
                      style={{
                        background: "rgba(167,139,250,.12)",
                        color: COLORS.purple,
                      }}
                    >
                      <FaUsers />
                    </div>
                    <div className="stat-body">
                      <div className="stat-value">{usersCount ?? "—"}</div>
                      <div className="stat-label">Active Users</div>
                      <div className="stat-trend">
                        {role === "admin" ? "registered accounts" : "admin view only"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Volume + Workload */}
              <div className="row g-3 g-lg-4 mb-3 mb-md-4">
                <div className="col-12 col-lg-7">
                  <Panel
                    icon={<FaChartBar />}
                    iconBg="rgba(59,130,246,.12)"
                    iconColor={COLORS.blue}
                    title="Document Volume Trends"
                    action={
                      <div className="segmented">
                        {SERIES_MODES.map((m) => (
                          <button
                            key={m}
                            className={`seg-btn ${seriesMode === m ? "active" : ""}`}
                            onClick={() => setSeriesMode(m)}
                            type="button"
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    }
                  >
                    <div style={{ width: "100%", height: 280 }}>
                      <ResponsiveContainer>
                        <BarChart
                          data={volumeData}
                          margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="bucket" />
                          <YAxis />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="received"
                            name="Documents Received"
                            fill={COLORS.blue}
                            radius={[6, 6, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                </div>

                <div className="col-12 col-lg-5">
                  <Panel
                    icon={<FaBuilding />}
                    iconBg="rgba(34,197,94,.12)"
                    iconColor={COLORS.green}
                    title="Office Workload"
                    action={
                      <span className="link-muted small">
                        Top {officeWorkload.length || 0}
                      </span>
                    }
                  >
                    {officeWorkload.length === 0 ? (
                      <div className="empty-inline">No workload data in this range.</div>
                    ) : (
                      <ul className="workload-list">
                        {officeWorkload.map((o) => (
                          <li key={o.name} className="workload-item">
                            <div className="workload-meta">
                              <span className="workload-name" title={o.name}>
                                {o.name}
                              </span>
                              <span className="workload-count">{o.count}</span>
                            </div>
                            <div className="workload-track">
                              <div
                                className="workload-fill"
                                style={{
                                  width: `${Math.max(
                                    6,
                                    (o.count / workloadMax) * 100
                                  )}%`,
                                }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                </div>
              </div>

              {/* Processing vs Status */}
              <div className="row g-3 g-lg-4 mb-3 mb-md-4">
                <div className="col-12 col-lg-7">
                  <Panel
                    icon={<FaClock />}
                    iconBg="rgba(59,130,246,.12)"
                    iconColor={COLORS.blue}
                    title="Processing Time Analysis"
                  >
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <BarChart
                          data={proc}
                          layout="vertical"
                          margin={{ top: 4, right: 16, left: 16, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis type="number" />
                          <YAxis dataKey="name" type="category" />
                          <Tooltip />
                          <Legend />
                          <Bar
                            dataKey="hours"
                            name="Avg Processing Time (hours)"
                            fill={COLORS.blue}
                            radius={[0, 6, 6, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                </div>

                <div className="col-12 col-lg-5">
                  <Panel
                    icon={<FaChartPie />}
                    iconBg="rgba(167,139,250,.12)"
                    iconColor={COLORS.purple}
                    title="Document Status Distribution"
                  >
                    <div style={{ width: "100%", height: 260 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie
                            data={pieData}
                            cx="50%"
                            cy="50%"
                            outerRadius={85}
                            dataKey="value"
                            nameKey="name"
                            label
                          >
                            {pieData.map((e, i) => (
                              <Cell key={i} fill={e.color} />
                            ))}
                          </Pie>
                          <Legend verticalAlign="bottom" height={24} />
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </Panel>
                </div>
              </div>

              {/* Retention */}
              <div className="mb-3 mb-md-4">
                <Panel
                  icon={<FaArchive />}
                  iconBg="rgba(245,158,11,.12)"
                  iconColor={COLORS.orange}
                  title="Document Aging & Retention Analysis"
                  action={
                    <a
                      className="link-muted small"
                      href="#!"
                      onClick={(e) => {
                        e.preventDefault();
                        exportRetentionSchedule();
                      }}
                    >
                      Schedule Disposal
                    </a>
                  }
                >
                  <div style={{ width: "100%", height: 280 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={retention}
                        margin={{ top: 4, right: 16, left: -8, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="age" />
                        <YAxis />
                        <Tooltip />
                        <Legend />
                        <Bar
                          dataKey="within"
                          name="Within Retention"
                          stackId="a"
                          fill={COLORS.green}
                        />
                        <Bar
                          dataKey="near"
                          name="Nearing Disposal"
                          stackId="a"
                          fill={COLORS.orange}
                        />
                        <Bar
                          dataKey="overdue"
                          name="Overdue"
                          stackId="a"
                          fill={COLORS.red}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>

              {/* Bottom row */}
              <div className="row g-3 g-lg-4">
                <div className="col-12 col-lg-4">
                  <Panel
                    icon={<FaTrophy />}
                    iconBg="rgba(201,151,28,.14)"
                    iconColor="#a16207"
                    title="Top Performing Offices"
                  >
                    <ul className="list-unstyled mb-0">
                      {topOffices.length === 0 && (
                        <li className="text-muted small">No data in this range.</li>
                      )}
                      {topOffices.map((r, i) => (
                        <li key={r.name} className="top-item">
                          <div className="top-item-row">
                            <div>
                              <div className="fw-600">{r.name}</div>
                              <div className="text-muted small">
                                {r.completion}% completion rate
                              </div>
                            </div>
                            <div className={`rank rank-${i + 1}`}>
                              {ordinal(i + 1)}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                </div>

                <div className="col-12 col-lg-4">
                  <Panel
                    icon={<FaExclamationTriangle />}
                    iconBg="rgba(239,68,68,.12)"
                    iconColor={COLORS.red}
                    title="System Alerts"
                  >
                    <div className="alert-card alert-red">
                      <div className="fw-600">
                        ⚠️ {retention.reduce((a, b) => a + b.overdue, 0)} documents
                        past retention
                      </div>
                      <div className="small text-muted">
                        Overdue for disposal review
                      </div>
                    </div>
                    <div className="alert-card alert-yellow">
                      <div className="fw-600">
                        📝 {backlogItems} pending {backlogItems === 1 ? "document" : "documents"}
                      </div>
                      <div className="small text-muted">
                        Awaiting review in this range
                      </div>
                    </div>
                    <div className="alert-card alert-blue">
                      <div className="fw-600">
                        💾 {receivedThisWeek} received this week
                      </div>
                      <div className="small text-muted">
                        New documents in the last 7 days
                      </div>
                    </div>
                  </Panel>
                </div>

                <div className="col-12 col-lg-4">
                  <Panel
                    icon={<FaBolt />}
                    iconBg="rgba(100,116,139,.12)"
                    iconColor={COLORS.slate}
                    title="Quick Actions"
                  >
                    <button
                      className="qa-item btn btn-light w-100 text-start"
                      onClick={() => generatePeriodReport("monthly")}
                    >
                      🗓 Generate Monthly Report
                    </button>
                    <button
                      className="qa-item btn btn-light w-100 text-start"
                      onClick={() => generatePeriodReport("yearly")}
                    >
                      📅 Generate Yearly Report
                    </button>
                    <button
                      className="qa-item btn btn-light w-100 text-start"
                      onClick={exportAnalyticsCsv}
                    >
                      📥 Export Analytics Data
                    </button>
                    <button
                      className="qa-item btn btn-light w-100 text-start"
                      onClick={exportRetentionSchedule}
                    >
                      🗂 Manage Retention (CSV)
                    </button>
                  </Panel>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
