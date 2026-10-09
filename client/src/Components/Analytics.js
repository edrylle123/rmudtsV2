// client/src/Components/Analytics.js
//
// Records Management analytics. Every figure on this page comes from the
// server's /api/analytics aggregation (SQL over the real columns), so the
// numbers here always reconcile with the database. The layout separates
// *snapshot* facts (as of now, every record in scope) from *range* facts
// (the selected window), because mixing the two is what usually makes a
// records dashboard lie.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import {
  FaArrowDown,
  FaArrowUp,
  FaBolt,
  FaChartBar,
  FaCheckCircle,
  FaClipboardCheck,
  FaClock,
  FaDatabase,
  FaExchangeAlt,
  FaExclamationTriangle,
  FaMinus,
  FaPaperclip,
  FaPrint,
  FaSyncAlt,
} from "react-icons/fa";
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
  AreaChart,
  Area,
} from "recharts";
import "./Analytics.css";

const PALETTE = {
  brand: "#15803d",
  brandSoft: "#22c55e",
  blue: "#2563eb",
  blueSoft: "#60a5fa",
  teal: "#0d9488",
  amber: "#d97706",
  red: "#dc2626",
  violet: "#7c3aed",
  slate: "#64748b",
};

const RANGES = [
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "all", label: "All time" },
];

const GRANULARITIES = [
  { key: "auto", label: "Auto" },
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Resolve a range preset into inclusive from/to date keys.
const rangeBounds = (key) => {
  const today = new Date();
  const to = dateKey(today);
  if (key === "ytd") return { from: `${today.getFullYear()}-01-01`, to };
  // "All time" asks the server for the whole archive (first record → today)
  // instead of inventing a start year.
  if (key === "all") return { from: "earliest", to };
  const days = Number(key) || 30;
  const start = new Date(today);
  start.setDate(start.getDate() - (days - 1));
  return { from: dateKey(start), to };
};

const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtPct = (n) => `${Number(n || 0)}%`;
const fmtDate = (v) =>
  v
    ? new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "—";
const fmtBytes = (bytes) => {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};
const fmtDays = (n) => {
  const d = Number(n || 0);
  if (d < 1) return "same day";
  if (d < 45) return `${d} day${d === 1 ? "" : "s"}`;
  const months = Math.round(d / 30.44);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"}`;
  return `${(d / 365.25).toFixed(1)} years`;
};

// Turn a bucket key from the API into a readable label.
const bucketLabel = (key, granularity) => {
  if (!key) return "—";
  if (granularity === "month") {
    const [y, m] = String(key).split("-").map(Number);
    if (!y || !m) return String(key);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  const [y, m, d] = String(key).split("-").map(Number);
  if (!y) return String(key);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (granularity === "week") {
    return `Week of ${dt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const PRIORITY_TONE = {
  Immediate: PALETTE.red,
  Urgent: PALETTE.amber,
  Normal: PALETTE.blue,
};
const AGING_TONE = [PALETTE.brandSoft, PALETTE.blueSoft, PALETTE.amber, PALETTE.red];

// ---------------------------------------------------------------- components

function DeltaChip({ value, suffix = "vs previous period" }) {
  if (value === null || value === undefined) {
    return <span className="an-chip an-chip-muted"><FaMinus /> no prior data</span>;
  }
  const up = Number(value) > 0;
  const flat = Number(value) === 0;
  return (
    <span
      className={`an-chip ${flat ? "an-chip-muted" : up ? "an-chip-up" : "an-chip-down"}`}
      title={`${value}% ${suffix}`}
    >
      {flat ? <FaMinus /> : up ? <FaArrowUp /> : <FaArrowDown />} {Math.abs(value)}%
      <span className="an-chip-note">{suffix}</span>
    </span>
  );
}

function Tile({ icon, label, value, unit, caption, tone = PALETTE.brand, children, wide }) {
  return (
    <div className={`an-tile${wide ? " an-tile-wide" : ""}`}>
      <div className="an-tile-top">
        <span className="an-tile-icon" style={{ color: tone, background: `${tone}14` }}>
          {icon}
        </span>
        <span className="an-tile-label">{label}</span>
      </div>
      <div className="an-tile-value" style={{ color: tone }}>
        {value}
        {unit ? <span className="an-tile-unit">{unit}</span> : null}
      </div>
      {caption ? <div className="an-tile-caption">{caption}</div> : null}
      {children}
    </div>
  );
}

function BarRow({ name, value, pct, max, tone = PALETTE.blue, meta, title }) {
  const width = max > 0 ? Math.max(3, (value / max) * 100) : 0;
  return (
    <li className="an-bar-row" title={title || name}>
      <div className="an-bar-head">
        <span className="an-bar-name">{name}</span>
        <span className="an-bar-value">
          {fmtInt(value)}
          {pct !== undefined ? <em>{fmtPct(pct)}</em> : null}
          {meta ? <em className="an-bar-meta">{meta}</em> : null}
        </span>
      </div>
      <div className="an-bar-track">
        <div className="an-bar-fill" style={{ width: `${width}%`, background: tone }} />
      </div>
    </li>
  );
}

function CoverageBar({ item }) {
  const pct = item.total > 0 ? Math.round((item.ok / item.total) * 1000) / 10 : 0;
  const tone = item.missing === 0 ? PALETTE.brand : pct >= 80 ? PALETTE.amber : PALETTE.red;
  return (
    <li className="an-coverage">
      <div className="an-coverage-head">
        <span className="an-coverage-label">{item.label}</span>
        <span className="an-coverage-value" style={{ color: tone }}>
          {fmtInt(item.ok)}/{fmtInt(item.total)} <em>{fmtPct(pct)}</em>
        </span>
      </div>
      <div className="an-bar-track">
        <div className="an-bar-fill" style={{ width: `${Math.max(2, pct)}%`, background: tone }} />
      </div>
      {item.note ? <div className="an-coverage-note">{item.note}</div> : null}
    </li>
  );
}

function ChartTooltip({ active, payload, label, granularity, labelPrefix }) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((a, p) => a + Number(p.value || 0), 0);
  return (
    <div className="an-tooltip">
      <div className="an-tooltip-title">
        {labelPrefix ? `${labelPrefix} ` : ""}
        {granularity ? bucketLabel(label, granularity) : label}
      </div>
      {payload.map((p) => (
        <div key={p.dataKey} className="an-tooltip-row">
          <span className="an-dot" style={{ background: p.color || p.fill }} />
          <span className="an-tooltip-name">{p.name}</span>
          <strong>{fmtInt(p.value)}</strong>
        </div>
      ))}
      {payload.length > 1 ? (
        <div className="an-tooltip-total">
          <span>Total</span>
          <strong>{fmtInt(total)}</strong>
        </div>
      ) : null}
    </div>
  );
}

const Empty = ({ children }) => <div className="an-empty-row">{children}</div>;

// ------------------------------------------------------------------- page

export default function Analytics() {
  const [range, setRange] = useState("30");
  const [granularity, setGranularity] = useState("auto");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { from, to } = rangeBounds(range);
      const res = await axios.get(
        `/api/analytics?from=${from}&to=${to}&granularity=${granularity}`
      );
      setData(res.data);
      setRefreshedAt(new Date());
    } catch (e) {
      console.error("Analytics load failed:", e?.response?.data || e.message);
      setError(
        e?.response?.data?.error ||
          e?.response?.data?.detail ||
          e?.message ||
          "Failed to load analytics"
      );
    } finally {
      setLoading(false);
    }
  }, [range, granularity]);

  useEffect(() => {
    load();
  }, [load]);

  const derived = useMemo(() => {
    if (!data) return null;
    const s = data.snapshot || {};
    const w = data.window || {};
    const maxOffice = Math.max(1, ...(data.byCurrentOffice || []).map((o) => o.value));
    const maxDest = Math.max(1, ...(data.byDestinationOffice || []).map((o) => o.value));
    const maxPriority = Math.max(1, ...(data.byPriority || []).map((o) => o.value));
    const maxClass = Math.max(1, ...(data.byClassification || []).map((o) => o.value));
    const maxAging = Math.max(1, ...(data.aging || []).map((o) => o.value));
    const busiest = (data.volume || []).reduce(
      (best, b) => (b.total > (best?.total || 0) ? b : best),
      null
    );
    const originTotal = (w.internal || 0) + (w.external || 0);
    const originPie = [
      { name: "Internal", value: w.internal || 0, color: PALETTE.brand },
      { name: "External", value: w.external || 0, color: PALETTE.violet },
    ];
    const qrTotal = (s.qrTagged || 0) + (s.awaitingQr || 0);
    const retentionCoverage =
      s.total > 0 ? Math.round(((s.retentionTracked || 0) / s.total) * 1000) / 10 : 0;
    return {
      s,
      w,
      maxOffice,
      maxDest,
      maxPriority,
      maxClass,
      maxAging,
      busiest,
      originTotal,
      originPie,
      qrTotal,
      retentionCoverage,
      generatedLabel: data.generatedAt ? new Date(data.generatedAt).toLocaleString() : "—",
    };
  }, [data]);

  const scopeLabel = data?.scope?.all
    ? "All offices"
    : data?.scope?.office
      ? `Office: ${data.scope.office}`
      : "—";
  const granularityUsed = data?.range?.granularity || granularity;
  const noRangeData = data ? (data.window.total || 0) === 0 : false;

  return (
    <div className="d-flex align-items-stretch">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        {/* .content-area is the app's scroll container (flex:1 + overflow-y:auto).
            Without it .flex-grow-1 clips tall pages and nothing can scroll. */}
        <div className="content-area analytics-content">
        <div className="analytics">
          <header className="an-toolbar">
            <div className="an-toolbar-head">
              <div>
                <h1 className="an-title">Records Analytics</h1>
                <p className="an-subtitle">
                  Volume, workload and retention readiness across the records system.
                  Snapshot figures cover every record in scope; range figures cover the
                  window you pick below.
                </p>
              </div>
              <div className="an-toolbar-actions">
                <button
                  type="button"
                  className="an-btn an-btn-ghost"
                  onClick={load}
                  disabled={loading}
                  title="Reload from the database"
                >
                  <FaSyncAlt className={loading ? "an-spin" : ""} /> Refresh
                </button>
                <button type="button" className="an-btn an-btn-primary" onClick={() => window.print()}>
                  <FaPrint /> Print / PDF
                </button>
              </div>
            </div>

            <div className="an-controls">
              <div className="an-control-group">
                <span className="an-control-label">Range</span>
                <div className="an-seg">
                  {RANGES.map((r) => (
                    <button
                      key={r.key}
                      type="button"
                      className={`an-seg-btn${range === r.key ? " is-active" : ""}`}
                      onClick={() => setRange(r.key)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="an-control-group">
                <span className="an-control-label">
                  Group by{granularity === "auto" ? ` (${granularityUsed})` : ""}
                </span>
                <div className="an-seg">
                  {GRANULARITIES.map((g) => (
                    <button
                      key={g.key}
                      type="button"
                      className={`an-seg-btn${granularity === g.key ? " is-active" : ""}`}
                      onClick={() => setGranularity(g.key)}
                    >
                      {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="an-control-group an-control-group-right">
                <span className="an-scope-chip" title="Records included in these figures">
                  <FaDatabase /> {scopeLabel}
                </span>
                {data ? (
                  <span className="an-scope-chip an-scope-muted">
                    {fmtDate(data.range.from)} – {fmtDate(data.range.to)} ·{" "}
                    {fmtInt(data.range.days)} days
                  </span>
                ) : null}
              </div>
            </div>
          </header>

          {error ? (
            <div className="an-error">
              <FaExclamationTriangle />
              <div>
                <strong>Analytics could not be loaded.</strong>
                <div className="an-error-detail">{error}</div>
              </div>
              <button type="button" className="an-btn an-btn-ghost" onClick={load}>
                Retry
              </button>
            </div>
          ) : null}

          {!data && loading ? (
            <div className="an-skeleton-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="an-skeleton" />
              ))}
            </div>
          ) : null}

          {data && derived ? (
            <>
              {/* ---------------------------------------------- snapshot */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Snapshot — as of now</h2>
                  <span className="an-section-note">
                    Every record in scope, ignoring the range filter.
                  </span>
                </div>
                <div className="an-tile-grid">
                  <Tile
                    icon={<FaChartBar />}
                    label="Total records in scope"
                    value={fmtInt(derived.s.total)}
                    caption={`${fmtInt(derived.s.internal)} internal · ${fmtInt(
                      derived.s.external
                    )} external`}
                    tone={PALETTE.brand}
                  >
                    <div className="an-spark">
                      <ResponsiveContainer width="100%" height={38}>
                        <AreaChart data={data.trend12m} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="anSpark" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor={PALETTE.brand} stopOpacity={0.35} />
                              <stop offset="100%" stopColor={PALETTE.brand} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <Tooltip content={<ChartTooltip granularity="month" />} />
                          <Area
                            type="monotone"
                            dataKey="total"
                            name="Added"
                            stroke={PALETTE.brand}
                            strokeWidth={2}
                            fill="url(#anSpark)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Tile>

                  <Tile
                    icon={<FaClipboardCheck />}
                    label="Awaiting action (no QR)"
                    value={fmtInt(derived.s.awaitingQr)}
                    caption={`${
                      derived.s.total > 0
                        ? Math.round((derived.s.awaitingQr / derived.s.total) * 100)
                        : 0
                    }% of all records`}
                    tone={PALETTE.amber}
                  />

                  <Tile
                    icon={<FaCheckCircle />}
                    label="QR-tagged & filed"
                    value={fmtInt(derived.s.qrTagged)}
                    caption={`${
                      derived.qrTotal > 0
                        ? Math.round((derived.s.qrTagged / derived.qrTotal) * 100)
                        : 0
                    }% of all records`}
                    tone={PALETTE.brand}
                  />

                  <Tile
                    icon={<FaBolt />}
                    label="Urgent or immediate"
                    value={fmtInt(derived.s.highPriority)}
                    caption={`${fmtInt(derived.s.normalPriority)} normal priority`}
                    tone={PALETTE.red}
                  />

                  <Tile
                    icon={<FaExclamationTriangle />}
                    label="Past retention period"
                    value={fmtInt(derived.s.retentionDue)}
                    caption={`${fmtInt(derived.s.retentionDueSoon)} more within 90 days · retention on file for ${fmtInt(
                      derived.s.retentionTracked
                    )} of ${fmtInt(derived.s.total)}`}
                    tone={PALETTE.red}
                  />

                  <Tile
                    icon={<FaPaperclip />}
                    label="Attachments stored"
                    value={fmtInt(data.attachments.files)}
                    caption={`${fmtBytes(data.attachments.bytes)} · on ${fmtInt(
                      data.attachments.docsWithFiles
                    )} document(s) · ${data.attachments.avgPerDocument} per record`}
                    tone={PALETTE.teal}
                  />
                </div>
              </section>

              {/* ------------------------------------------------- range */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Selected range</h2>
                  <span className="an-section-note">
                    Records created between {fmtDate(data.range.from)} and {fmtDate(data.range.to)}.
                  </span>
                </div>
                <div className="an-tile-grid an-tile-grid-4">
                  <Tile
                    icon={<FaChartBar />}
                    label="Records added"
                    value={fmtInt(derived.w.total)}
                    caption={`${derived.w.avgPerDay} per day on average · ${fmtInt(
                      derived.w.internal
                    )} internal / ${fmtInt(derived.w.external)} external`}
                    tone={PALETTE.blue}
                  >
                    <DeltaChip value={derived.w.deltaPct} />
                  </Tile>
                  <Tile
                    icon={<FaClock />}
                    label="Busiest period"
                    value={derived.busiest ? fmtInt(derived.busiest.total) : "0"}
                    caption={
                      derived.busiest && derived.busiest.total > 0
                        ? `on ${bucketLabel(derived.busiest.key, granularityUsed)}`
                        : "no records in range"
                    }
                    tone={PALETTE.violet}
                  />
                  <Tile
                    icon={<FaClipboardCheck />}
                    label="Still awaiting action"
                    value={fmtInt(derived.w.awaitingQr)}
                    caption="of the records added in this range"
                    tone={PALETTE.amber}
                  />
                  <Tile
                    icon={<FaExchangeAlt />}
                    label="Office handoffs"
                    value={fmtInt(data.transfers.total)}
                    caption={`${fmtInt(data.transfers.officeCount)} office(s) involved · received and released`}
                    tone={PALETTE.teal}
                  />
                </div>

                <div className="an-card an-card-chart">
                  <div className="an-card-head">
                    <h3>
                      Intake volume ·{" "}
                      <span className="an-card-head-accent">
                        {granularityUsed === "day"
                          ? "daily"
                          : granularityUsed === "week"
                            ? "weekly"
                            : "monthly"}
                      </span>
                    </h3>
                    <span className="an-card-note">
                      Empty periods are plotted as zero, so gaps in intake are visible.
                    </span>
                  </div>
                  {noRangeData ? (
                    <Empty>
                      No records were created in this range. Snapshot figures above still
                      cover all {fmtInt(derived.s.total)} records.
                    </Empty>
                  ) : (
                    <div className="an-chart">
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart
                          data={data.volume}
                          margin={{ top: 8, right: 16, left: -8, bottom: 0 }}
                          barCategoryGap={granularityUsed === "day" ? "10%" : "25%"}
                        >
                          <CartesianGrid strokeDasharray="3 3" stroke="#e8edf3" vertical={false} />
                          <XAxis
                            dataKey="key"
                            tick={{ fontSize: 11, fill: PALETTE.slate }}
                            tickFormatter={(k) => bucketLabel(k, granularityUsed)}
                            interval={Math.max(0, Math.ceil(data.volume.length / 12) - 1)}
                            minTickGap={12}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: PALETTE.slate }}
                            allowDecimals={false}
                            width={44}
                          />
                          <Tooltip
                            content={<ChartTooltip granularity={granularityUsed} />}
                            cursor={{ fill: "rgba(21,128,61,0.06)" }}
                          />
                          <Legend
                            iconType="circle"
                            wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
                            formatter={(v) => <span style={{ color: "#475569" }}>{v}</span>}
                          />
                          <Bar
                            dataKey="internal"
                            name="Internal"
                            stackId="v"
                            fill={PALETTE.brand}
                            radius={[0, 0, 0, 0]}
                          />
                          <Bar
                            dataKey="external"
                            name="External"
                            stackId="v"
                            fill={PALETTE.violet}
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </section>

              {/* ------------------------------------------- composition */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Composition of the range</h2>
                  <span className="an-section-note">
                    Every breakdown below adds up to the {fmtInt(derived.w.total)} record(s)
                    added in the selected window.
                  </span>
                </div>
                <div className="an-grid-3">
                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Origin</h3>
                      <span className="an-card-note">Internal vs external requests</span>
                    </div>
                    {derived.originTotal === 0 ? (
                      <Empty>Nothing in range.</Empty>
                    ) : (
                      <div className="an-donut-wrap">
                        <ResponsiveContainer width="48%" height={168}>
                          <PieChart>
                            <Pie
                              data={derived.originPie}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={46}
                              outerRadius={70}
                              paddingAngle={2}
                              stroke="none"
                            >
                              {derived.originPie.map((e) => (
                                <Cell key={e.name} fill={e.color} />
                              ))}
                            </Pie>
                            <Tooltip content={<ChartTooltip />} />
                          </PieChart>
                        </ResponsiveContainer>
                        <ul className="an-legend">
                          {derived.originPie.map((o) => (
                            <li key={o.name}>
                              <span className="an-dot" style={{ background: o.color }} />
                              <span className="an-legend-name">{o.name}</span>
                              <strong>{fmtInt(o.value)}</strong>
                              <em>
                                {derived.originTotal > 0
                                  ? fmtPct(Math.round((o.value / derived.originTotal) * 1000) / 10)
                                  : "0%"}
                              </em>
                            </li>
                          ))}
                          <li className="an-legend-total">
                            <span className="an-legend-name">In range</span>
                            <strong>{fmtInt(derived.originTotal)}</strong>
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>

                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Priority</h3>
                      <span className="an-card-note">As recorded on the record</span>
                    </div>
                    <ul className="an-bars">
                      {data.byPriority.length === 0 ? (
                        <Empty>Nothing in range.</Empty>
                      ) : (
                        data.byPriority.map((p) => (
                          <BarRow
                            key={p.name}
                            name={p.name}
                            value={p.value}
                            pct={p.pct}
                            max={derived.maxPriority}
                            tone={PRIORITY_TONE[p.name] || PALETTE.slate}
                          />
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Age of records in range</h3>
                      <span className="an-card-note">Days since creation, now</span>
                    </div>
                    <ul className="an-bars">
                      {data.aging.reduce((a, b) => a + b.value, 0) === 0 ? (
                        <Empty>Nothing in range.</Empty>
                      ) : (
                        data.aging.map((b, i) => (
                          <BarRow
                            key={b.key}
                            name={b.label}
                            value={b.value}
                            pct={b.pct}
                            max={derived.maxAging}
                            tone={AGING_TONE[i % AGING_TONE.length]}
                          />
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* ---------------------------------------------- workload */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Where the work sits</h2>
                  <span className="an-section-note">
                    Current office = where the document physically is; destination = where it
                    was sent. Both cover the selected range.
                  </span>
                </div>
                <div className="an-grid-3">
                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Documents currently held</h3>
                      <span className="an-card-note">{data.byCurrentOffice.length} office(s)</span>
                    </div>
                    <ul className="an-bars">
                      {data.byCurrentOffice.length === 0 ? (
                        <Empty>Nothing in range.</Empty>
                      ) : (
                        data.byCurrentOffice.map((o) => (
                          <BarRow
                            key={o.name}
                            name={o.name}
                            value={o.value}
                            pct={o.pct}
                            max={derived.maxOffice}
                            tone={PALETTE.brand}
                          />
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Destination offices</h3>
                      <span className="an-card-note">External documents may have none</span>
                    </div>
                    <ul className="an-bars">
                      {data.byDestinationOffice.length === 0 ? (
                        <Empty>Nothing in range.</Empty>
                      ) : (
                        data.byDestinationOffice.map((o) => (
                          <BarRow
                            key={o.name}
                            name={o.name}
                            value={o.value}
                            pct={o.pct}
                            max={derived.maxDest}
                            tone={PALETTE.blue}
                          />
                        ))
                      )}
                    </ul>
                  </div>

                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Classification</h3>
                      <span className="an-card-note">
                        Legacy labels folded into their current equivalent
                      </span>
                    </div>
                    <ul className="an-bars">
                      {data.byClassification.length === 0 ? (
                        <Empty>Nothing in range.</Empty>
                      ) : (
                        data.byClassification.map((c) => (
                          <BarRow
                            key={c.name}
                            name={c.name}
                            value={c.value}
                            pct={c.pct}
                            max={derived.maxClass}
                            tone={PALETTE.teal}
                            meta={
                              c.sources && c.sources.length > 1
                                ? `incl. "${c.sources.filter((s) => s !== c.name).join('", "')}"`
                                : null
                            }
                            title={
                              c.sources && c.sources.length > 1
                                ? `Includes the stored label(s): ${c.sources.join(", ")}`
                                : c.name
                            }
                          />
                        ))
                      )}
                    </ul>
                  </div>
                </div>
              </section>

              {/* --------------------------------------------- transfer */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Handoffs between offices</h2>
                  <span className="an-section-note">
                    Derived from tracked movements. One handoff counts once as released and
                    once as received, so a row's total is roughly twice the number of events.
                  </span>
                </div>
                <div className="an-card an-card-table">
                  {data.transfers.offices.length === 0 ? (
                    <Empty>No handoffs recorded in this range.</Empty>
                  ) : (
                    <table className="an-table">
                      <thead>
                        <tr>
                          <th>Office</th>
                          <th className="an-num">Released</th>
                          <th className="an-num">Received</th>
                          <th className="an-num">Total touches</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.transfers.offices.map((o) => (
                          <tr key={o.name}>
                            <td>{o.name}</td>
                            <td className="an-num">{fmtInt(o.sent)}</td>
                            <td className="an-num">{fmtInt(o.received)}</td>
                            <td className="an-num">
                              <strong>{fmtInt(o.total)}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </section>

              {/* ------------------------------------------- watchlists */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Action lists</h2>
                  <span className="an-section-note">
                    Built from all records in scope, not just the selected range — these are
                    the ones that need attention.
                  </span>
                </div>
                <div className="an-grid-2">
                  <div className="an-card an-card-table">
                    <div className="an-card-head">
                      <h3>Oldest documents still awaiting action</h3>
                      <span className="an-card-note">
                        No QR code yet · showing the 8 oldest
                      </span>
                    </div>
                    {data.watchlists.oldestAwaitingQr.length === 0 ? (
                      <Empty>Every record in scope has been QR-tagged.</Empty>
                    ) : (
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th>Control no.</th>
                            <th>Held by</th>
                            <th className="an-num">Age</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.watchlists.oldestAwaitingQr.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <div className="an-cell-strong">{r.control_number}</div>
                                <div className="an-cell-sub" title={r.title || ""}>
                                  {r.title || "—"}
                                </div>
                              </td>
                              <td>
                                <div>{r.current_office || "Unknown office"}</div>
                                <div className="an-cell-sub">
                                  {r.priority}
                                  {r.record_origin ? ` · ${r.record_origin}` : ""}
                                </div>
                              </td>
                              <td className="an-num">
                                <span
                                  className={`an-age-chip${
                                    r.ageDays >= 30
                                      ? " an-age-hot"
                                      : r.ageDays >= 7
                                        ? " an-age-warm"
                                        : ""
                                  }`}
                                >
                                  {fmtDays(r.ageDays)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  <div className="an-card an-card-table">
                    <div className="an-card-head">
                      <h3>Retention watchlist</h3>
                      <span className="an-card-note">
                        Records with a retention period set · soonest due first
                      </span>
                    </div>
                    {data.watchlists.retention.length === 0 ? (
                      <Empty>
                        No record in scope has a retention period recorded, so nothing can be
                        scheduled for disposal yet.
                      </Empty>
                    ) : (
                      <table className="an-table">
                        <thead>
                          <tr>
                            <th>Control no.</th>
                            <th>Retention</th>
                            <th className="an-num">Due</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.watchlists.retention.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <div className="an-cell-strong">{r.control_number}</div>
                                <div className="an-cell-sub" title={r.title || ""}>
                                  {r.current_office || "Unknown office"}
                                </div>
                              </td>
                              <td>
                                {r.retentionYears} yr{r.retentionYears === 1 ? "" : "s"}
                                <div className="an-cell-sub">filed {fmtDate(r.created_at)}</div>
                              </td>
                              <td className="an-num">
                                <span
                                  className={`an-age-chip${
                                    r.state === "overdue"
                                      ? " an-age-hot"
                                      : r.state === "soon"
                                        ? " an-age-warm"
                                        : ""
                                  }`}
                                >
                                  {r.state === "overdue"
                                    ? `overdue by ${fmtDays(Math.abs(r.daysLeft))}`
                                    : `${fmtDays(r.daysLeft)} left`}
                                </span>
                                <div className="an-cell-sub">{fmtDate(r.dueAt)}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              </section>

              {/* --------------------------------------- data quality */}
              <section className="an-section">
                <div className="an-section-head">
                  <h2>Data quality</h2>
                  <span className="an-section-note">
                    What the system can and cannot measure, so a low number is never mistaken
                    for good performance.
                  </span>
                </div>
                <div className="an-grid-2">
                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>Completeness</h3>
                      <span className="an-card-note">
                        Retention is on file for {derived.retentionCoverage}% of records
                      </span>
                    </div>
                    <ul className="an-bars">
                      {data.dataQuality.map((item) => (
                        <CoverageBar key={item.key} item={item} />
                      ))}
                    </ul>
                  </div>

                  <div className="an-card">
                    <div className="an-card-head">
                      <h3>How these numbers are calculated</h3>
                      <span className="an-card-note">Definitions used on this page</span>
                    </div>
                    <dl className="an-defs">
                      <div>
                        <dt>Snapshot vs range</dt>
                        <dd>
                          Snapshot figures count every record in scope regardless of the date
                          filter; range figures count records created inside the window only.
                        </dd>
                      </div>
                      <div>
                        <dt>Awaiting action</dt>
                        <dd>
                          A record with no QR code yet — the same rule used by the Operations
                          Stream queue.
                        </dd>
                      </div>
                      <div>
                        <dt>Past retention period</dt>
                        <dd>
                          created_at + retention_period years ≤ today. Records without a
                          retention period cannot be evaluated and are excluded from that count.
                        </dd>
                      </div>
                      <div>
                        <dt>Intake volume</dt>
                        <dd>
                          Records grouped by their created_at date, with empty periods filled
                          as zero so discontinuities stay visible.
                        </dd>
                      </div>
                      <div>
                        <dt>Previous-period change</dt>
                        <dd>
                          Compares the window with the immediately preceding window of the same
                          length ({fmtInt(derived.w.previousTotal)} record(s) before this one).
                        </dd>
                      </div>
                      <div>
                        <dt>Classification folding</dt>
                        <dd>
                          {data.classificationMapping.length === 0
                            ? "No legacy labels needed folding in the current range."
                            : data.classificationMapping
                                .map((m) => `"${m.raw}" → "${m.canonical}"`)
                                .join("; ")}
                        </dd>
                      </div>
                      <div>
                        <dt>Attachments</dt>
                        <dd>
                          Counted from stored file rows joined to existing records.
                          {data.attachments.orphanFiles > 0
                            ? ` ${fmtInt(data.attachments.orphanFiles)} row(s) still reference ${fmtInt(
                                data.attachments.orphanDocs
                              )} deleted record(s) and are excluded from the totals.`
                            : ""}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </section>

              <footer className="an-footer">
                Generated {derived.generatedLabel}
                {refreshedAt ? ` · refreshed ${refreshedAt.toLocaleTimeString()}` : ""} · source:
                live database ({scopeLabel})
              </footer>
            </>
          ) : null}
        </div>
        </div>
      </div>
    </div>
  );
}
