// client/src/Components/Reports.js
import React, { useEffect, useState, useMemo, useRef } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import jsPDF from "jspdf";
import "jspdf-autotable";
import * as XLSX from "xlsx";
import "./Reports.css";

export default function Reports() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const tableRef = useRef(null);

  // Individual column filters
  const [filterControl, setFilterControl] = useState("");
  const [filterTitle, setFilterTitle] = useState("");
  const [filterDivision, setFilterDivision] = useState("");
  const [filterType, setFilterType] = useState("All");
  const [filterOrigin, setFilterOrigin] = useState("All");
  const [filterRetention, setFilterRetention] = useState("All");
  const [filterDisposition, setFilterDisposition] = useState("All");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await axios.get("/records/my-office");
        setRecords(Array.isArray(res.data) ? res.data : []);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  // Build normalized rows — one row per record (the API join duplicates a
  // record once per attached file, so dedupe by id first)
  const rows = useMemo(() => {
    const seen = new Map();
    records.forEach((r) => {
      if (!seen.has(r.id)) seen.set(r.id, r);
    });
    return Array.from(seen.values()).map((r, idx) => ({
      id: r.id,
      control_number: r.control_number || "",
      rev: idx + 1,
      title: r.description || r.title || "",
      division: r.office_requestor || "",
      origin: r.record_origin || "",
      recordType:
        (r.record_origin || "").toLowerCase() === "paper" ||
        (r.record_origin || "").toLowerCase() === "external"
          ? "Paper"
          : "Electronic",
      retention: r.retention_period || "",
      dispose: "",
      retain: "",
      disposalMethod: "",
      created_at: r.created_at,
      _raw: r,
    }));
  }, [records]);

  // Unique values for dropdowns
  const uniqueDivisions = useMemo(
    () => [...new Set(rows.map((r) => r.division).filter(Boolean))].sort(),
    [rows]
  );
  const uniqueRetentions = useMemo(
    () => [...new Set(rows.map((r) => r.retention).filter(Boolean))].sort(),
    [rows]
  );

  // Apply all filters
  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterControl && !r.control_number.toLowerCase().includes(filterControl.toLowerCase()))
        return false;
      if (filterTitle && !r.title.toLowerCase().includes(filterTitle.toLowerCase()))
        return false;
      if (filterDivision && r.division !== filterDivision) return false;
      if (filterType !== "All" && r.recordType !== filterType) return false;
      if (filterOrigin !== "All" && r.origin !== filterOrigin) return false;
      if (filterRetention !== "All" && r.retention !== filterRetention) return false;
      if (filterDisposition !== "All") {
        if (filterDisposition === "Dispose" && r.dispose !== "Dispose") return false;
        if (filterDisposition === "Retain" && r.retain !== "Retain") return false;
      }
      return true;
    });
  }, [rows, filterControl, filterTitle, filterDivision, filterType, filterOrigin, filterRetention, filterDisposition]);

  const hasFilters =
    filterControl ||
    filterTitle ||
    filterDivision ||
    filterType !== "All" ||
    filterOrigin !== "All" ||
    filterRetention !== "All" ||
    filterDisposition !== "All";

  const clearAll = () => {
    setFilterControl("");
    setFilterTitle("");
    setFilterDivision("");
    setFilterType("All");
    setFilterOrigin("All");
    setFilterRetention("All");
    setFilterDisposition("All");
  };

  // ---- Export PDF ----
  const exportPdf = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("Records Management Report", 14, 15);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Generated: ${new Date().toLocaleDateString()}  |  ${filtered.length} record(s)`,
      14, 22
    );
    const head = [["Control #","Rev #","Title / Description","Division","Electronic","Paper","Retention","Dispose","Retain","Disposal Method"]];
    const body = filtered.map((r) => [
      r.control_number, r.rev, r.title, r.division,
      r.recordType === "Electronic" ? "Yes" : "",
      r.recordType === "Paper" ? "Yes" : "",
      r.retention, r.dispose || "—", r.retain || "—", r.disposalMethod || "—",
    ]);
    doc.autoTable({
      head, body, startY: 28, theme: "grid",
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [22, 63, 39], textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [242, 248, 244] },
      columnStyles: { 0: { cellWidth: 28 }, 2: { cellWidth: 50 }, 3: { cellWidth: 35 } },
      margin: { left: 14, right: 14 },
    });
    doc.save(`records-report-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ---- Export Excel ----
  const exportExcel = () => {
    const data = filtered.map((r) => ({
      "Control Number": r.control_number,
      "Rev #": r.rev,
      "Title / Description": r.title,
      "Division (Office Requestor)": r.division,
      "Type of Records": r.recordType,
      Retention: r.retention,
      Dispose: r.dispose || "—",
      Retain: r.retain || "—",
      "Disposal Method": r.disposalMethod || "—",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws["!cols"] = [
      { wch: 18 },{ wch: 6 },{ wch: 30 },{ wch: 25 },{ wch: 14 },{ wch: 14 },{ wch: 10 },{ wch: 10 },{ wch: 16 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Reports");
    XLSX.writeFile(wb, `records-report-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="reports container-fluid p-3 p-md-4">
          {/* Header */}
          <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
            <div>
              <h2 className="page-title mb-0">Reports</h2>
              <div className="text-muted small">Official records tracking and disposition report</div>
            </div>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              {!loading && (
                <span className="doc-chip">
                  {filtered.length} of {records.length} record{records.length === 1 ? "" : "s"}
                </span>
              )}
              <button className="btn btn-outline-primary" onClick={exportPdf}>📄 Export PDF</button>
              <button className="btn btn-outline-success" onClick={exportExcel}>📊 Export Excel</button>
            </div>
          </div>

          {/* Separate Column Filters */}
          <div className="reports-filters mb-3">
            <div className="reports-filter-row">
              <div className="reports-filter-group">
                <label className="reports-filter-label">Control Number</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Search..."
                  value={filterControl}
                  onChange={(e) => setFilterControl(e.target.value)}
                />
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Title / Description</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  placeholder="Search..."
                  value={filterTitle}
                  onChange={(e) => setFilterTitle(e.target.value)}
                />
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Division</label>
                <select
                  className="form-select form-select-sm"
                  value={filterDivision}
                  onChange={(e) => setFilterDivision(e.target.value)}
                >
                  <option value="">All Divisions</option>
                  {uniqueDivisions.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Type of Records</label>
                <select
                  className="form-select form-select-sm"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="All">All Types</option>
                  <option value="Electronic">Electronic</option>
                  <option value="Paper">Paper</option>
                </select>
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Origin</label>
                <select
                  className="form-select form-select-sm"
                  value={filterOrigin}
                  onChange={(e) => setFilterOrigin(e.target.value)}
                  title="Filter documents by Internal / External"
                >
                  <option value="All">All Documents</option>
                  <option value="Internal">Internal</option>
                  <option value="External">External</option>
                </select>
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Retention</label>
                <select
                  className="form-select form-select-sm"
                  value={filterRetention}
                  onChange={(e) => setFilterRetention(e.target.value)}
                >
                  <option value="All">All Retention</option>
                  {uniqueRetentions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="reports-filter-group">
                <label className="reports-filter-label">Disposition</label>
                <select
                  className="form-select form-select-sm"
                  value={filterDisposition}
                  onChange={(e) => setFilterDisposition(e.target.value)}
                >
                  <option value="All">All</option>
                  <option value="Dispose">Dispose</option>
                  <option value="Retain">Retain</option>
                </select>
              </div>
              {hasFilters && (
                <div className="reports-filter-group reports-filter-clear">
                  <label className="reports-filter-label">&nbsp;</label>
                  <button className="btn btn-sm btn-outline-danger" onClick={clearAll}>
                    ✕ Clear All
                  </button>
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div className="reports-loading">Loading reports...</div>
          ) : (
            <div className="reports-table-wrapper rs-stack">
              <table className="reports-table" ref={tableRef}>
                <thead>
                  <tr>
                    <th rowSpan={2}>Control Number</th>
                    <th rowSpan={2}>Rev #</th>
                    <th rowSpan={2}>Title / Description</th>
                    <th rowSpan={2}>Division (Office Requestor)</th>
                    <th colSpan={2}>Type of Records</th>
                    <th rowSpan={2}>Retention</th>
                    <th colSpan={2}>Disposition Upon Expiration of Retention</th>
                    <th rowSpan={2}>Disposal Method</th>
                  </tr>
                  <tr>
                    <th>Electronic</th>
                    <th>Paper</th>
                    <th>Dispose</th>
                    <th>Retain</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={10} data-label="" className="text-center text-muted py-4">
                        No records match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((r, idx) => (
                      <tr key={r.id || idx}>
                        <td data-label="Control Number" className="fw-semibold">{r.control_number || "—"}</td>
                        <td data-label="Rev #">{r.rev}</td>
                        <td data-label="Title / Description">{r.title || "—"}</td>
                        <td data-label="Division">{r.division || "—"}</td>
                        <td data-label="Electronic" className="text-center">{r.recordType === "Electronic" ? "✓" : "—"}</td>
                        <td data-label="Paper" className="text-center">{r.recordType === "Paper" ? "✓" : "—"}</td>
                        <td data-label="Retention">{r.retention || "—"}</td>
                        <td data-label="Dispose" className="text-center">{r.dispose || "—"}</td>
                        <td data-label="Retain" className="text-center">{r.retain || "—"}</td>
                        <td data-label="Disposal Method">{r.disposalMethod || "—"}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="reports-footer">
            All reports are based on the current records database. Data as of{" "}
            {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}
