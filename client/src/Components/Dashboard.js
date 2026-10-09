import React, { useState, useEffect, useMemo, useRef } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { socket } from "../socket";
import "./PriorityBadges.css";
import "./Dashboard.css"; // Assuming you have some CSS for styling
import { FaQrcode, FaPencilAlt, FaFileAlt, FaEye, FaPaperPlane, FaDownload, FaPrint, FaTrash } from "react-icons/fa";
import { RiHomeOfficeFill } from "react-icons/ri";
import { BsCalendarDateFill } from "react-icons/bs";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import useOffices from "../utils/useOffices";
import { useAuth } from "../AuthContext";
import OperationsStream from "./OperationsStream";


// PdfViewer renders PDFs inside an iframe that loads an HTML wrapper page.
// IDM cannot intercept this because the iframe loads HTML, not a direct PDF URL.

function PdfViewer({ filePath, title, style }) {
  const viewerUrl = `/api/pdf-viewer?path=${encodeURIComponent(filePath)}`;
  return (
    <iframe
      src={viewerUrl}
      title={title || 'PDF'}
      style={style || { width: '100%', height: '600px', border: 'none' }}
    />
  );
}

const API_BASE =
  process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || "";

const norm = (s) => String(s || "").trim().toLowerCase();

// Normalize retention values like "3 Years" or "3" into the select's values.
const normalizeRetention = (v) => {
  const s = String(v || "").trim();
  if (s.toLowerCase().includes("permanent")) return "Permanent";
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s || "1" : String(n);
};

// Turn any stored QR path (relative or Windows absolute) into a web path.
const normalizeQrPath = (p) =>
  String(p || "")
    .split("\\")
    .join("/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "/");

// Labeled input (+ optional datalist) used by the edit modal so every record
// field can be changed from the card, not just the retention period.
function EditField({
  col = "col-md-6",
  label,
  name,
  value,
  onChange,
  options = [],
  type = "text",
  rows,
  required = false,
  placeholder,
}) {
  const listId = `edit-${name}-list`;
  return (
    <div className={col}>
      <label className="form-label fw-semibold">
        {label}
        {required ? " *" : ""}
      </label>
      {type === "textarea" ? (
        <textarea
          className="form-control"
          name={name}
          rows={rows || 2}
          value={value ?? ""}
          onChange={onChange}
          required={required}
          placeholder={placeholder}
        />
      ) : (
        <>
          <input
            className="form-control"
            name={name}
            type="text"
            list={options.length ? listId : undefined}
            value={value ?? ""}
            onChange={onChange}
            required={required}
            placeholder={placeholder}
            autoComplete="off"
          />
          {options.length > 0 && (
            <datalist id={listId}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const { offices: OFFICES } = useOffices();
  const fmtDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const [rowsRaw, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // const [deletingId, setDeletingId] = useState(null);
  const { user } = useAuth();
  const myOffice = user?.office || '';
  // viewedRecords: object { [recordId]: [office1, office2, ...] }
  const [viewedRecords, setViewedRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_viewed_records') || '{}'); } catch { return {}; }
  });
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState({});
  const [office, setOffice] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");

  const [showModal, setShowModal] = useState(false); // State for showing the modal
  const [selectedRecord, setSelectedRecord] = useState(null); // Record selected for editing
  // Document detail view state
  const [viewRecord, setViewRecord] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailFiles, setDetailFiles] = useState([]);
  // Attachments inside the edit modal
  const [editFiles, setEditFiles] = useState([]); // files already stored on the record
  const [editNewFiles, setEditNewFiles] = useState([]); // files queued for upload
  const [editFilesError, setEditFilesError] = useState("");
  const [editDragActive, setEditDragActive] = useState(false);
  const editFileInputRef = useRef(null);
  // Forwarding state
  const [forwardingId, setForwardingId] = useState(null);
  const [officeSearch, setOfficeSearch] = useState({});
  const [showSuggestions, setShowSuggestions] = useState({});
  const [selectedOffices, setSelectedOffices] = useState({});
  // Routing slip toggle + signed document upload per record
  const [includeSlip, setIncludeSlip] = useState({}); // { [recordId]: true/false }
  const [signedFiles, setSignedFiles] = useState({}); // { [recordId]: File }
  const [formData, setFormData] = useState({
    control_number: "",
    office_requestor: "",
    description: "",
    classification: "",
    priority: "",
    record_origin: "",
    concerned_personnel: "",
    destination_office: "",
    retention_period: "",
  });
  const RETENTION_OPTIONS = [
    { label: "1 Year", value: "1" },
    { label: "2 Years", value: "2" },
    { label: "3 Years", value: "3" },
    { label: "4 Years", value: "4" },
    { label: "5 Years", value: "5" },
    { label: "6 Years", value: "6" },
    { label: "7 Years", value: "7" },
    { label: "8 Years", value: "8" },
    { label: "9 Years", value: "9" },
    { label: "10 Years", value: "10" },
    { label: "Permanent", value: "Permanent" },
  ];

  const DESTINATION_OFFICES = OFFICES;
  const [filterType, setFilterType] = useState("All"); // Track filter state

  // Dropdown lists for the edit modal (same sources as the create form).
  const [editOptions, setEditOptions] = useState({
    classification: [],
    priority: [],
    origin: ["Internal", "External"],
    concerned_personnel: [],
  });
  useEffect(() => {
    const loadEditOptions = async () => {
      try {
        const [classRes, prioRes, origRes, concernedRes] = await Promise.all([
          axios.get("/api/dropdown-options?category=classification"),
          axios.get("/api/dropdown-options?category=priority"),
          axios.get("/api/dropdown-options?category=origin"),
          axios.get("/api/dropdown-options?category=concerned_personnel"),
        ]);
        setEditOptions({
          classification: (classRes.data || []).map((o) => o.value),
          priority: (prioRes.data || []).map((o) => o.value),
          origin: (origRes.data || []).length
            ? origRes.data.map((o) => o.value)
            : ["Internal", "External"],
          concerned_personnel: (concernedRes.data || []).map((o) => o.value),
        });
      } catch (e) {
        console.error("Failed to load dropdown options for the edit modal:", e);
      }
    };
    loadEditOptions();
  }, []);

  // External documents may be saved without a destination office.
  const isExternalEdit =
    String(formData.record_origin || "").trim().toLowerCase() === "external";
    // Function to load records
  const load = async () => {
    try {
      setLoading(true);
      const res = await axios.get("/records/my-office");
      setRowsRaw(Array.isArray(res.data) ? res.data : []);
      console.log("Fetched Records:", res.data); // Log fetched records
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
    load(); // Fetch records initially
    return () => socket.off("recordUpdated", onUpdated);
  }, []);

  // -------------------- Attachments in the edit modal --------------------
  const editFileKey = (f) => `${f.name}__${f.size}__${f.lastModified}`;

  const addEditFiles = (incomingList) => {
    const incoming = Array.from(incomingList || []);
    if (!incoming.length) return;
    setEditNewFiles((prev) => {
      const cur = new Map(prev.map((f) => [editFileKey(f), f]));
      for (const f of incoming) cur.set(editFileKey(f), f);
      return Array.from(cur.values());
    });
    setEditFilesError("");
  };

  const onEditDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEditDragActive(true);
  };
  const onEditDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setEditDragActive(false);
  };
  const onEditDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setEditDragActive(false);
    addEditFiles(e.dataTransfer.files);
  };
  const openEditFileDialog = () => editFileInputRef.current?.click();
  const handleEditFilesChange = (e) => {
    addEditFiles(e.target.files);
    e.target.value = "";
  };
  const removeEditNewFile = (key) =>
    setEditNewFiles((prev) => prev.filter((f) => editFileKey(f) !== key));

  // Remove an attachment already stored on the record.
  const handleRemoveExistingFile = async (fileId) => {
    if (!fileId || !selectedRecord) return;
    if (!window.confirm("Remove this attachment? This cannot be undone."))
      return;
    try {
      await axios.delete(`/records/${selectedRecord.id}/files/${fileId}`);
      setEditFiles((prev) =>
        prev.filter((f) => String(f.id) !== String(fileId))
      );
    } catch (e) {
      alert(
        "Failed to remove attachment: " +
          (e?.response?.data?.error || e.message)
      );
    }
  };

  // Only PDF attachments are accepted, matching the create-record form.
  const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // matches the server's multer limit
  const validateEditFiles = () => {
    for (const file of editNewFiles) {
      const isPdf =
        file.type === "application/pdf" ||
        String(file.name || "").toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        setEditFilesError("Only PDF files are allowed.");
        return false;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setEditFilesError(`"${file.name}" is larger than the 10 MB limit.`);
        return false;
      }
    }
    setEditFilesError("");
    return true;
  };

  const editDropStyle = {
    border: `2px dashed ${editFilesError ? "#dc3545" : "#999"}`,
    borderRadius: 12,
    padding: 16,
    textAlign: "center",
    cursor: "pointer",
    background: editDragActive ? "rgba(0,123,255,0.08)" : "#fafafa",
    transition: "background 120ms ease",
  };

  // Handle edit — every record field is loaded into the modal.
  const handleEdit = async (record) => {
    setSelectedRecord(record); // Store the selected record
    setFormData({
      control_number: record.control_number || "",
      office_requestor: record.office_requestor || "",
      description: record.description || "",
      classification: record.classification || "",
      priority: record.priority || "",
      record_origin: record.record_origin || "",
      concerned_personnel: record.concerned_personnel || "",
      destination_office: record.destination_office || "",
      retention_period: normalizeRetention(record.retention_period),
    });
    setEditNewFiles([]);
    setEditFilesError("");
    setEditDragActive(false);
    setEditFiles(record.files || []);
    setShowModal(true); // Show the modal
    // Load the record's stored attachments (with file ids, so they can be removed).
    try {
      const res = await axios.get(`/records/${record.id}`);
      if (Array.isArray(res.data?.files)) setEditFiles(res.data.files);
    } catch (e) {
      console.error("Error loading record attachments:", e);
    }
  };
  // Handle update form field change
  const handleChange = (e) => {
    const { name, value } = e.target;

    console.log(`Updating ${name}:`, value); // Add this to track changes
    setFormData((prevState) => ({ ...prevState, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const requiredFields = {
      control_number: formData.control_number,
      office_requestor: formData.office_requestor,
      description: formData.description,
      classification: formData.classification,
      priority: formData.priority,
      record_origin: formData.record_origin,
      retention_period: formData.retention_period,
    };
    // Destination Office is optional for External documents.
    if (!isExternalEdit) {
      requiredFields.destination_office = formData.destination_office;
    }
    const missingFields = Object.entries(requiredFields)
      .filter(([, v]) => !v || String(v).trim() === "")
      .map(([k]) => k.replace(/_/g, " "));
    if (missingFields.length > 0) {
      alert(`Please fill in all required fields: ${missingFields.join(", ")}`);
      return;
    }
    const retentionValue =
      formData.retention_period === "Permanent"
        ? "Permanent"
        : formData.retention_period + " Years";
    const formDataToSend = new FormData();
    formDataToSend.append("retention_period", retentionValue);
    // Send the remaining editable fields so the server can update them too.
    const editableFields = [
      "control_number",
      "office_requestor",
      "description",
      "classification",
      "priority",
      "record_origin",
      "concerned_personnel",
      "destination_office",
    ];
    editableFields.forEach((key) => {
      const v = formData[key];
      if (v !== undefined && v !== null) formDataToSend.append(key, v);
    });
    // Attachments chosen in the modal are uploaded together with the update.
    if (!validateEditFiles()) return;
    editNewFiles.forEach((file) => formDataToSend.append("files", file));
    try {
      await axios.put("/records/" + selectedRecord.id, formDataToSend);
      alert("Record updated successfully!");
      setShowModal(false);
      load(); // Reload the records to reflect the updated data
    } catch (err) {
      console.error("Error response from backend:", err.response && err.response.data ? err.response.data : err.message);
      alert("Failed to update record: " + (err.response && err.response.data && err.response.data.message ? err.response.data.message : err.message));
    }
  };
  // Handle delete
  // const handleDelete = async (r) => {
  //   if (!r.id) return alert("Cannot delete this record.");
  //   if (!window.confirm(`Delete "${r.control_number}"? This cannot be undone.`))
  //     return;
  //   try {
  //     setDeletingId(r.id);
  //     await axios.delete(`/records/${r.id}`);
  //     setRowsRaw((prev) => prev.filter((x) => x.id !== r.id));
  //   } catch (e) {
  //     console.error(e);
  //     alert("Failed to delete record.");
  //   } finally {
  //     setDeletingId(null);
  //   }
  // };

 const records = useMemo(() => {
    const map = new Map();
    for (const [i, r] of rowsRaw.entries()) {
      const recId = r.id ?? r.control_number ?? `row-${i}`;
      if (!map.has(recId)) {
        map.set(recId, {
          id: recId,
          control_number: r.control_number || "",
          classification: r.classification || "",
          priority: r.priority || "Normal",
          office_requestor: r.office_requestor || "",
          concerned_personnel: r.concerned_personnel || "",
          destination_office: r.destination_office || "",
          record_origin: r.record_origin || "Unknown",
          created_at: r.created_at || null,
          updated_at: r.updated_at || r.created_at, // Keep track of both
          description: r.description || "",
          retention_period: r.retention_period || "",
          remarks: r.remarks || "",
          status: r.qrcode_path ? "Updated" : "Not Updated", // Check if QR code exists
          forwarded_at: r.forwarded_at || null,
          received_at: r.received_at || null,
          files: [],
          qrcode_path: r.qrcode_path || "",
          current_office: r.current_office || "Unknown Office",
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

  const filtered = useMemo(() => {
    const fromT = fromDate ? new Date(fromDate).setHours(0, 0, 0, 0) : null;
    const toT = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : null;

    return records.filter((r) => {
      // ADMIN DASHBOARD RULE: every record shows here — regardless of
      // destination office — until it has been UPDATED (QR code generated).
      // Once updated, the record leaves the dashboard (still visible in
      // All Records). A specific office filter narrows by current/dest office.
      const isUpdated = r.status === "Updated";
      if (isUpdated) return false;
      if (office !== "All") {
        const o = office.trim().toLowerCase();
        const dest = String(r.destination_office || "").trim().toLowerCase();
        const cur = String(r.current_office || "").trim().toLowerCase();
        if (o !== "" && o !== "all") {
          if (dest !== o && cur !== o) return false;
        }
      }

      // Filter by date range (from - to, inclusive)
      const ct = r.created_at ? new Date(r.created_at).getTime() : null;
      if (ct != null && fromT && ct < fromT) return false;
      if (ct != null && toT && ct > toT) return false;

      // Filter by internal or external records
      if (
        filterType !== "All" &&
        !String(r.record_origin || "")
          .toLowerCase()
          .includes(filterType.toLowerCase())
      )
        return false;

      // Filter by update status (Updated = has QR code)
      if (statusFilter !== "All" && r.status !== statusFilter) return false;

      // Search by control number, title, or description
      if (searchTerm.trim()) {
        const q = searchTerm.trim().toLowerCase();
        const cn = String(r.control_number || "").toLowerCase();
        const desc = String(r.description || "").toLowerCase();
        const origin = String(r.record_origin || "").toLowerCase();
        if (!cn.includes(q) && !desc.includes(q) && !origin.includes(q)) return false;
      }

      return true;
    });
  }, [records, office, fromDate, toDate, filterType, statusFilter, searchTerm]);

  const officeCount = useMemo(() => {
    const counts = {};
    // Count ALL records (not just filtered) for accurate Office Records Overview
    records.forEach((record) => {
      const off = record.current_office || record.destination_office || "Unknown Office";
      counts[off] = (counts[off] || 0) + 1;
    });
    return counts;
  }, [records]);

  // Total records + per-month trend for the overview visual
  const totalRecords = records.length;
  const internalCount = records.filter(
    (r) => String(r.record_origin || "").toLowerCase().includes("internal")
  ).length;
  const externalCount = totalRecords - internalCount;
  const internalPct =
    totalRecords > 0 ? Math.round((internalCount / totalRecords) * 100) : 0;
  const externalPct = totalRecords > 0 ? 100 - internalPct : 0;

  // Month-over-month growth (delta chip on the Total Records card)
  const monthKeyOf = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const nowDate = new Date();
  const thisMonthKey = monthKeyOf(nowDate);
  const prevMonthKey = monthKeyOf(
    new Date(nowDate.getFullYear(), nowDate.getMonth() - 1, 1)
  );
  let thisMonthCount = 0;
  let lastMonthCount = 0;
  records.forEach((r) => {
    const d = r.created_at ? new Date(r.created_at) : null;
    if (!d || isNaN(d)) return;
    const k = monthKeyOf(d);
    if (k === thisMonthKey) thisMonthCount += 1;
    else if (k === prevMonthKey) lastMonthCount += 1;
  });
  const trendDelta =
    lastMonthCount > 0
      ? Math.round(((thisMonthCount - lastMonthCount) / lastMonthCount) * 100)
      : null;

  // Last 6 months, zero-filled, so the sparkline always has a readable shape
  const recordsTrend = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
      );
    }
    const byMonth = Object.fromEntries(months.map((m) => [m, 0]));
    records.forEach((record) => {
      const d = record.created_at ? new Date(record.created_at) : null;
      if (!d || isNaN(d)) return;
      const key = monthKeyOf(d);
      if (key in byMonth) byMonth[key] += 1;
    });
    return months.map((m) => ({ month: m, count: byMonth[m] }));
  }, [records]);

  const handleViewQR = (r) => {
    if (!r.qrcode_path) return alert("QR code not available for this record.");

    setQrData({
      control_number: r.control_number,
      title: r.title || r.description,
      url: normalizeQrPath(r.qrcode_path),
    });
    setShowQR(true);
  };

  // Open document detail view showing PDF + routing slip
  const handleViewDocument = async (r) => {
    setViewRecord(r);
    setDetailFiles(r.files || []);
    setShowDetail(true);
    // Mark record as viewed in THIS office only — per-office NEW badge
    const viewedByOffices = viewedRecords[r.id] || [];
    if (!viewedByOffices.includes(myOffice)) {
      const updated = { ...viewedRecords, [r.id]: [...viewedByOffices, myOffice] };
      setViewedRecords(updated);
      localStorage.setItem('admin_viewed_records', JSON.stringify(updated));
    }
    // Enrich with full file data from server
    try {
      const res = await axios.get(`/records/${r.id}`);
      const data = res.data;
      if (data.files && data.files.length > 0) {
        setDetailFiles(data.files);
      }
    } catch (e) {
      console.error("Error loading record details:", e);
    }

  };

  // Open a record from the Operations Stream by id
  const handleOpenRecordById = (id) => {
    const rec = records.find((r) => r.id === id);
    if (rec) handleViewDocument(rec);
  };

  // -------------------- Multi-Office Forward (Admin) --------------------
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
    return OFFICES.filter(
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
      // Upload signed document first if present
      const signedFile = signedFiles[record.id];
      if (signedFile) {
        const fd = new FormData();
        fd.append("signed_file", signedFile);
        await axios.post(`/api/records/${record.id}/signed-doc`, fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }
      // Forward with include_slip flag
      await axios.put(`/records/forward/${record.id}`, {
        destination_offices: selected,
        include_slip: includeSlip[record.id] !== false, // default true
      });
      alert(`Record forwarded to ${selected.join(", ")}.`);
      setSelectedOffices((prev) => ({ ...prev, [record.id]: [] }));
      setSignedFiles((prev) => { const n = {...prev}; delete n[record.id]; return n; });
      load();
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to forward record.";
      console.error("Forward error:", err);
      alert(msg);
    } finally {
      setForwardingId(null);
    }
  };

  const chartData = useMemo(() => {
    const entries = Object.keys(officeCount).map((office) => ({
      office: office,
      records: officeCount[office],
    }));
    // Tallest office first so the line reads as a ranking, then shorten long names
    entries.sort((a, b) => b.records - a.records);
    const MAX_LABEL = 22;
    return entries.map((e) => ({
      ...e,
      office:
        e.office.length > MAX_LABEL ? e.office.slice(0, MAX_LABEL - 1) + "…" : e.office,
    }));
  }, [officeCount]);
  const closeModal = () => {
    setShowQR(false); // Hide the modal when closing it
  };
  const [currentPage, setCurrentPage] = useState(1);
  // const itemsPerPage = 9999; // Set the number of items per page

  const cardContainerRef = useRef(null);
  const cardRef = useRef(null);

  // 💡 FIX 1: Initialized itemsPerPage to a safe default (or 1)
  const [itemsPerPage, setItemsPerPage] = useState(12); // Start with a safe number

  // Calculate how many cards fit on screen (recomputed when data or layout changes)
  useEffect(() => {
    const calculateItemsPerPage = () => {
      if (!cardContainerRef.current || !cardRef.current || filtered.length === 0) {
        return;
      }

      const containerHeight = window.innerHeight;
      const navbarHeight = 60;
      const headerHeight = cardContainerRef.current.offsetTop;
      const availableHeight = containerHeight - headerHeight - navbarHeight - 70;

      const cardStyle = window.getComputedStyle(cardRef.current);
      const cardHeight =
        cardRef.current.offsetHeight +
        parseFloat(cardStyle.marginTop) +
        parseFloat(cardStyle.marginBottom);
      const rowsFit = Math.floor(availableHeight / cardHeight);

      const contentWidth = cardContainerRef.current.offsetWidth;
      const cardMinWidth = 150;
      const cardGap = 15;
      const colsFit = Math.floor(contentWidth / (cardMinWidth + cardGap));

      const calculatedItems = rowsFit * colsFit;

      if (calculatedItems > 0 && calculatedItems !== itemsPerPage) {
        setItemsPerPage(calculatedItems);
        setCurrentPage(1);
      }
    };

    calculateItemsPerPage();
    window.addEventListener("resize", calculateItemsPerPage);
    return () => window.removeEventListener("resize", calculateItemsPerPage);
  }, [filtered, itemsPerPage]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filtered.slice(startIndex, endIndex);
  }, [filtered, currentPage, itemsPerPage]);

  // Helper: is this document new in the current office (forwarded within the last 24 hours)?
  const isNew = (r) => {
    if (!r.forwarded_at) return false;
    const viewedByOffices = viewedRecords[r.id] || [];
    if (viewedByOffices.includes(myOffice)) return false; // Already viewed in this office
    const diff = Date.now() - new Date(r.forwarded_at).getTime();
    return diff < 24 * 60 * 60 * 1000; // 24 hours
  };

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid">
          {/* Sticky header: filters + chart */}
          <div className="dashboard-sticky-header">
          <div className="dashboard-grid">
{/* FILTER */}
          <div className="filter-container">
            {/* Search by control number / title / description */}
            <div className="d-flex align-items-center filter-item" style={{ gridColumn: '1 / -1', marginBottom: '4px' }}>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Search by control number, title, or description..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{ fontSize: '0.85rem' }}
              />
            </div>
            <div className="d-flex align-items-center filter-item">
              <label htmlFor="recordFilter" className="form-label filter-icon-label">
                <FaFileAlt className="filter-icon" />
              </label>
              <select
                id="recordFilter"
                className="form-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="All">All</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
              </select>
            </div>

            <div className="d-flex align-items-center">
              <label htmlFor="officeFilter" className="form-label filter-icon-label">
               <RiHomeOfficeFill className="filter-icon" />
              </label>
              <select
                id="officeFilter"
                className="form-select"
                value={office}
                onChange={(e) => setOffice(e.target.value)}
              >
                <option value="All">All Offices</option>
                {DESTINATION_OFFICES.map((office, index) => (
                  <option key={index} value={office}>
                    {office}
                  </option>
                ))}
              </select>
            </div>

            <div className="d-flex align-items-center filter-item">
              <label htmlFor="statusFilter" className="form-label filter-icon-label">
                <FaQrcode className="filter-icon" />
              </label>
              <select
                id="statusFilter"
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All Status</option>
                <option value="Updated">Updated</option>
                <option value="Not Updated">Not Updated</option>
              </select>
            </div>

            <div className="d-flex align-items-center">
              <label htmlFor="dateFilter" className="form-label filter-icon-label">
                <BsCalendarDateFill className="filter-icon" />
              </label>
              <input
                type="date"
                id="dateFilter"
                className="form-control"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span className="mx-1 text-muted small">to</span>
              <input
                type="date"
                id="toDateFilter"
                className="form-control"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="showing">
            {/* <div className="text-muted small">
              Showing <strong>{filtered.length}</strong> of {records.length}
            </div> */}
          </div>
          </div>


          {/* Records Overview Chart */}
          <div className="d-flex align-items-stretch gap-3 flex-wrap">
            {/* Total Records visual card */}
            <div
              className="border rounded-3 p-3"
              style={{
                background: "linear-gradient(135deg, #35804eff 0%, #1a3c24 100%)",
                color: "#fff",
                minWidth: "230px",
                flex: "0 0 230px",
                height: "250px",
                display: "flex",
                flexDirection: "column",
                boxShadow: "0 2px 12px rgba(26,60,36,0.35)",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* Soft glow accent */}
              <div
                style={{
                  position: "absolute",
                  top: -34,
                  right: -34,
                  width: 120,
                  height: 120,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,0.07)",
                  pointerEvents: "none",
                }}
              />
              {/* Header: icon chip + label + this-month pill */}
              <div
                className="d-flex align-items-center justify-content-between mb-1"
                style={{ position: "relative" }}
              >
                <div className="d-flex align-items-center gap-2">
                  <span
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: "rgba(255,255,255,0.15)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <RiHomeOfficeFill size={14} />
                  </span>
                  <span style={{ fontWeight: 600, fontSize: "0.78rem", opacity: 0.95 }}>
                    Total Records
                  </span>
                </div>
                {thisMonthCount > 0 && (
                  <span
                    style={{
                      fontSize: "0.6rem",
                      fontWeight: 700,
                      background: "rgba(255,255,255,0.18)",
                      padding: "2px 8px",
                      borderRadius: 999,
                      whiteSpace: "nowrap",
                    }}
                  >
                    +{thisMonthCount} this month
                  </span>
                )}
              </div>
              {/* Big count + month-over-month delta */}
              <div
                className="d-flex align-items-end gap-2"
                style={{ position: "relative" }}
              >
                <div style={{ fontWeight: 800, fontSize: "2.1rem", lineHeight: 1 }}>
                  {totalRecords.toLocaleString()}
                </div>
                {trendDelta !== null && (
                  <div
                    style={{
                      fontSize: "0.66rem",
                      fontWeight: 600,
                      color: trendDelta >= 0 ? "#7bf1a8" : "#ffb4b4",
                      paddingBottom: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {trendDelta >= 0 ? "▲" : "▼"} {Math.abs(trendDelta)}% vs last
                    month
                  </div>
                )}
              </div>
              {recordsTrend.length > 0 && (
                <div style={{ marginTop: 6, marginLeft: -12, marginRight: -12 }}>
                  <ResponsiveContainer width="100%" height={46}>
                    <AreaChart
                      data={recordsTrend}
                      margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                    >
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#a8e6c0" stopOpacity={0.85} />
                          <stop offset="100%" stopColor="#a8e6c0" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <Tooltip
                        formatter={(v) => [`${v} record(s)`, "Created"]}
                        labelFormatter={(m) => {
                          const [y, mo] = String(m).split("-");
                          return new Date(y, mo - 1, 1).toLocaleString(undefined, {
                            month: "short",
                            year: "numeric",
                          });
                        }}
                        contentStyle={{
                          background: "#fff",
                          color: "#1a3c24",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "0.75rem",
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="count"
                        stroke="#a8e6c0"
                        strokeWidth={2}
                        fill="url(#trendFill)"
                        dot={{ r: 2, fill: "#a8e6c0", strokeWidth: 0 }}
                        activeDot={{ r: 4 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Internal vs External share bar */}
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  overflow: "hidden",
                  display: "flex",
                  background: "rgba(255,255,255,0.15)",
                  marginTop: 4,
                  flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: `${internalPct}%`,
                    background: "#4ade80",
                    transition: "width 0.4s ease",
                  }}
                />
                <div
                  style={{
                    width: `${externalPct}%`,
                    background: "#a78bfa",
                    transition: "width 0.4s ease",
                  }}
                />
              </div>

              {/* Internal / External breakdown with dots + percentages */}
              <div
                className="d-flex justify-content-between gap-2 pt-2 mt-auto"
                style={{ borderTop: "1px solid rgba(255,255,255,0.25)" }}
              >
                <div className="d-flex align-items-center gap-2 flex-fill">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#4ade80",
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "0.62rem", opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      Internal
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.2 }}>
                      {internalCount.toLocaleString()}
                      <span style={{ fontSize: "0.62rem", fontWeight: 500, opacity: 0.8, marginLeft: 4 }}>
                        {internalPct}%
                      </span>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    width: "1px",
                    background: "rgba(255,255,255,0.25)",
                  }}
                />
                <div className="d-flex align-items-center gap-2 flex-fill">
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: "#a78bfa",
                      flexShrink: 0,
                    }}
                  />
                  <div>
                    <div style={{ fontSize: "0.62rem", opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                      External
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "0.95rem", lineHeight: 1.2 }}>
                      {externalCount.toLocaleString()}
                      <span style={{ fontSize: "0.62rem", fontWeight: 500, opacity: 0.8, marginLeft: 4 }}>
                        {externalPct}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Line Chart for Records Per Office */}
            <div className="chart-container" style={{ flex: "1 1 380px", minWidth: 0, height: "250px", overflow: "hidden" }}>
              <h5 className="mb-4">Office Records Overview</h5>
              <ResponsiveContainer width="100%" height={165}>
                <LineChart data={chartData} margin={{ top: 5, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.5} />
                  <XAxis dataKey="office" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={38} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={28} />
                  <Tooltip
                    formatter={(v) => [`${v} record(s)`, "Records"]}
                    contentStyle={{ borderRadius: "6px", fontSize: "0.75rem" }}
                  />
                  <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                  <Line
                    type="monotone"
                    dataKey="records"
                    stroke="#35804eff"
                    strokeWidth={2.5}
                    dot={{ r: 4, fill: "#35804eff", strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Operations Stream: live activity feed + task queue */}
            <div style={{ flex: "1 1 300px", minWidth: 0, height: "250px" }}>
              <OperationsStream onOpenRecord={handleOpenRecordById} />
            </div>
          </div>
          </div>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
          {loading && <div className="status">Loading…</div>}

          <div className="record-cards">
            {paginatedRecords.length > 0 ? (
              paginatedRecords.map((record) => (
                <div key={record.id} className={`card record-card ${isNew(record) ? 'record-card-new' : ''}`}>
                  <div className="card-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <p style={{ fontWeight: 700, fontSize: '1rem', margin: 0 }}>{record.control_number || "No Control Number"}</p>
                      <span className="badge" style={{ background: record.status === "Updated" ? '#28a745' : '#ffc107', color: record.status === "Updated" ? '#fff' : '#333', fontSize: '0.65rem', padding: '2px 7px', borderRadius: '12px', whiteSpace: 'nowrap' }}>
                        {record.status === "Updated" ? "✅ Updated" : "⏳ Not Updated"}
                      </span>
                      <span className="badge" style={{ background: (record.record_origin || '').toLowerCase().includes('internal') ? '#1a7a3a' : '#6c5ce7', color: '#fff', fontSize: '0.65rem', padding: '2px 7px', borderRadius: '12px', whiteSpace: 'nowrap' }}>
                        {record.record_origin || "Untitled"}
                      </span>
                      {isNew(record) && (
                        <span className="badge badge-new" style={{ marginLeft: '2px' }}>NEW</span>
                      )}
                    </div>
                    {(record.description || record.title) && (
                      <p style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1a3c24', marginBottom: '2px', marginTop: '4px' }}>
                        {record.description || record.title}
                      </p>
                    )}
                    <div className="d-flex gap-1 align-items-center">
                      {/* Returned-from-President badge: only show after a forward FROM the President */}
                      {(() => {
                        const hasForwardedFromPresident =
                          record.forwarded_at &&
                          String(record.forwarded_at).length > 0 &&
                          String(record.destination_office || '').toLowerCase().includes('records');
                        if (hasForwardedFromPresident) {
                          return <span className="badge" style={{ background: '#17a2b8', color: '#fff', marginLeft: '4px' }}>✅ Returned from President</span>;
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <div className="card-body">
                    <p>
                      <strong>Office Requestor:</strong> {record.office_requestor || "—"}
                    </p>
                    {/* <p>
                      <strong>Priority:</strong> {record.priority}
                    </p> */}
                    <p>
                      <strong>Date Created:</strong>{" "}
                      {fmtDateTime(record.created_at)}
                    </p>
                    <p>
                      <strong>Current Office:</strong>{" "}
                      {record.current_office || "Unknown Office"}
                    </p>
                    {record.received_at && (
                      <p>
                        <strong>Received:</strong>{" "}
                        {fmtDateTime(record.received_at)}
                      </p>
                    )}
                  </div>
                  <div className="card-footer">
                    <button
                      className="btn btn-outline-info"
                      title="View Document"
                      onClick={() => handleViewDocument(record)}
                    >
                      <FaEye />
                    </button>
                    <button
                      className="btn btn-outline-primary"
                      onClick={() => handleViewQR(record)}
                    >
                      <FaQrcode />
                    </button>
                    <button
                      className="btn btn-outline-success"
                      onClick={() => handleEdit(record)}
                      title="Edit Record"
                    >
                      <FaPencilAlt />
                    </button>
                    
                    {/* <button
                      className="btn btn-outline-danger"
                      disabled={deletingId === record.id}
                      onClick={() => handleDelete(record)}
                    >
                     <FaTrashAlt />
                    </button> */}
                  </div>
<br></br>
                  {/* Forward section — type-ahead office selector */}
                  <div style={{ padding: '8px 12px', borderTop: '1px solid #e9ecef', background: '#f8f9fa' }}>
                    <div className="d-flex flex-wrap gap-1 mb-1">
                      {(selectedOffices[record.id] || []).map((off) => (
                        <span key={off} className="badge bg-success d-flex align-items-center gap-1" style={{ fontSize: '0.78rem' }}>
                          {off}
                          <button type="button" className="btn-close btn-close-white" style={{ fontSize: '0.55rem' }} onClick={() => removeOffice(record.id, off)} />
                        </span>
                      ))}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Type to search office..."
                        value={officeSearch[record.id] || ''}
                        onChange={(e) => {
                          setOfficeSearch((prev) => ({ ...prev, [record.id]: e.target.value }));
                          setShowSuggestions((prev) => ({ ...prev, [record.id]: true }));
                        }}
                        onFocus={() => setShowSuggestions((prev) => ({ ...prev, [record.id]: true }))}
                        onBlur={() => setTimeout(() => setShowSuggestions((prev) => ({ ...prev, [record.id]: false })), 200)}
                      />
                      {showSuggestions[record.id] && getFilteredSuggestions(record.id).length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                          {getFilteredSuggestions(record.id).map((off) => (
                            <div
                              key={off}
                              style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                              onMouseDown={() => addOffice(record.id, off)}
                            >
                              {off}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {/* Routing slip toggle + signed doc upload — President only */}
                    {myOffice && myOffice.toLowerCase().includes('president') && (
                      <>
                        <div className="form-check form-switch mt-2" style={{ fontSize: '0.8rem' }}>
                          <input
                            className="form-check-input"
                            type="checkbox"
                            role="switch"
                            id={`slip-${record.id}`}
                            checked={includeSlip[record.id] !== false}
                            onChange={(e) => setIncludeSlip((prev) => ({ ...prev, [record.id]: e.target.checked }))}
                          />
                          <label className="form-check-label" htmlFor={`slip-${record.id}`}>📎 Attach Routing Slip</label>
                        </div>
                        {/* Signed document upload */}
                        <div className="mt-1" style={{ fontSize: '0.8rem' }}>
                          <label className="form-label text-muted mb-0">📝 Upload Signed Document (optional)</label>
                          <input
                            type="file"
                            className="form-control form-control-sm"
                            accept="application/pdf"
                            onChange={(e) => setSignedFiles((prev) => ({ ...prev, [record.id]: e.target.files[0] || null }))}
                          />
                          {signedFiles[record.id] && (
                            <div className="text-success small mt-1">✅ {signedFiles[record.id].name}</div>
                          )}
                        </div>
                      </>
                    )}
                    <button
                      className="btn btn-sm btn-primary mt-2 w-100"
                      disabled={(selectedOffices[record.id] || []).length === 0 || forwardingId === record.id}
                      onClick={() => handleForward(record)}
                    >
                      <FaPaperPlane className="me-1" />
                      {forwardingId === record.id ? 'Forwarding...' : `Forward to ${(selectedOffices[record.id] || []).length} Office(s)`}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="status">No records available.</div>
            )}
          </div>
          
          <div className="pagination">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              {"<<"} Previous
            </button>

            {/* Display Page Numbers */}
            {Array.from(
              { length: Math.ceil(filtered.length / itemsPerPage) },
              (_, index) => (
                <button
                  key={index + 1}
                  onClick={() => setCurrentPage(index + 1)}
                  className={currentPage === index + 1 ? "active" : ""}
                >
                  {index + 1}
                </button>
              )
            )}

            <button
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.min(prev + 1, Math.ceil(filtered.length / itemsPerPage))
                )
              }
              disabled={
                currentPage === Math.ceil(filtered.length / itemsPerPage)
              }
            >
              Next {">>"}
            </button>
          </div>

          {showQR && (
            <div className="qr-modal-backdrop" onClick={closeModal}>
              <div
                className="qr-modal-dialog"
                onClick={(e) => e.stopPropagation()}
              >
                <h5>QR Code for {qrData.control_number}</h5>
                {/* Ensure the correct URL is used to display the image */}
                <img
                  src={`${API_BASE}${qrData.url}`}
                  alt={`QR Code for ${qrData.control_number}`}
                />

                <button
                  className="btn btn-sm btn-outline-secondary mt-2"
                  onClick={closeModal} // Close the modal
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {/* Edit Modal */}
          {showModal && selectedRecord && (
            <div className="modal-overlay" onClick={() => setShowModal(false)}>
              <div
                className="modal-content edit-record-modal"
                onClick={(e) => e.stopPropagation()} // Prevents closing modal when clicking inside
              >
                <h2>Edit Record</h2>

                <div className="text-muted small mb-3 text-center">
                  Status: {selectedRecord.status || "—"} · Current office:{" "}
                  {selectedRecord.current_office || "—"}
                </div>

                <form onSubmit={handleSubmit}>
                  <div className="row g-3">
                    <EditField
                      label="Control No."
                      name="control_number"
                      value={formData.control_number}
                      onChange={handleChange}
                      placeholder="e.g., 261001-2487"
                      required
                    />
                    <EditField
                      label="Office/Requestor"
                      name="office_requestor"
                      value={formData.office_requestor}
                      onChange={handleChange}
                      options={DESTINATION_OFFICES}
                      placeholder="Office or requestor"
                      required
                    />
                    <EditField
                      col="col-12"
                      label="Title and Description"
                      name="description"
                      type="textarea"
                      rows={3}
                      value={formData.description}
                      onChange={handleChange}
                      required
                    />
                    <EditField
                      label="Classification"
                      name="classification"
                      value={formData.classification}
                      onChange={handleChange}
                      options={editOptions.classification}
                      required
                    />
                    <EditField
                      label="Priority"
                      name="priority"
                      value={formData.priority}
                      onChange={handleChange}
                      options={editOptions.priority}
                      required
                    />
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Record Origin *</label>
                      <select
                        className="form-control"
                        name="record_origin"
                        value={formData.record_origin || ""}
                        onChange={handleChange}
                        required
                      >
                        <option value="">Select origin…</option>
                        {editOptions.origin.map((origin) => (
                          <option key={origin} value={origin}>
                            {origin}
                          </option>
                        ))}
                      </select>
                    </div>
                    <EditField
                      label="Concerned Personnel"
                      name="concerned_personnel"
                      value={formData.concerned_personnel}
                      onChange={handleChange}
                      options={editOptions.concerned_personnel}
                      placeholder="Select Concerned Personnel"
                    />
                    <EditField
                      label={
                        isExternalEdit
                          ? "Destination Office (optional)"
                          : "Destination Office"
                      }
                      name="destination_office"
                      value={formData.destination_office}
                      onChange={handleChange}
                      options={DESTINATION_OFFICES}
                      placeholder={
                        isExternalEdit
                          ? "Optional — select or type an office"
                          : "Select Destination Office"
                      }
                      required={!isExternalEdit}
                    />
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">
                        Retention Period *
                      </label>
                      <select
                        className="form-control"
                        name="retention_period"
                        value={formData.retention_period || "1"}
                        onChange={handleChange}
                        required
                      >
                        {RETENTION_OPTIONS.map((option, index) => (
                          <option key={index} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Attachments — existing files can be removed, new PDFs uploaded */}
                    <div className="col-12">
                      <label className="form-label fw-semibold">Attachments</label>
                      {editFiles.length > 0 && (
                        <ul className="list-unstyled mt-1 mb-2">
                          {editFiles.map((f, idx) => (
                            <li
                              key={f.id || f.path || idx}
                              className="d-flex justify-content-between align-items-center border-bottom py-1"
                            >
                              <span className="text-truncate me-2" style={{ maxWidth: "78%" }}>
                                <FaFileAlt className="me-1" />
                                {f.name || String(f.path || "").split("/").pop()}
                              </span>
                              {f.id ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  title="Remove attachment"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveExistingFile(f.id);
                                  }}
                                >
                                  <FaTrash />
                                </button>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                      <input
                        ref={editFileInputRef}
                        type="file"
                        multiple
                        className="d-none"
                        onChange={handleEditFilesChange}
                        accept="application/pdf"
                      />
                      <div
                        style={editDropStyle}
                        onClick={openEditFileDialog}
                        onDragOver={onEditDragOver}
                        onDragEnter={onEditDragOver}
                        onDragLeave={onEditDragLeave}
                        onDrop={onEditDrop}
                      >
                        <div className="mb-1 fw-semibold">
                          Drag & drop files here or click to browse
                        </div>
                        <div className="text-muted small">
                          PDF attachments (optional) — files already attached stay
                          unless you remove them.
                        </div>
                      </div>
                      {editFilesError && (
                        <div className="invalid-feedback d-block">
                          {editFilesError}
                        </div>
                      )}
                      {editNewFiles.length > 0 && (
                        <ul className="list-unstyled mt-2 mb-0">
                          {editNewFiles.map((f) => (
                            <li
                              key={editFileKey(f)}
                              className="d-flex justify-content-between align-items-center"
                            >
                              <span className="text-truncate me-2" style={{ maxWidth: "78%" }}>
                                {f.name} ({Math.round(f.size / 1024)} KB)
                              </span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                title="Remove file"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeEditNewFile(editFileKey(f));
                                }}
                              >
                                <FaTrash />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="text-muted small mt-1">
                        Max 10 MB per file.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
                    <button
                      type="submit"
                      className="btn btn-primary"
                      onClick={(e) => e.stopPropagation()} // Prevent closing modal on form submit
                    >
                      Update Record
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowModal(false); // Close modal when close button is clicked
                      }}
                    >
                      Close
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
          {/* Document Detail Modal — PDF + Routing Slip */}
          {showDetail && viewRecord && (
            <div className="modal-overlay" onClick={() => setShowDetail(false)}>
              <div
                className="modal-content document-detail-modal"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '1100px', width: '95%', maxHeight: '90vh' }}
              >
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">
                    <FaFileAlt /> {viewRecord.control_number || "Document"}
                  </h5>
                  <div className="d-flex gap-2 align-items-center">
                    <span className={`badge ${viewRecord.status === 'Updated' ? 'badge-success' : 'badge-warning'}`}>
                      {viewRecord.status === 'Updated' ? '✅ Updated' : '⚠️ Not Updated'}
                    </span>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowDetail(false)}>✕ Close</button>
                  </div> 
                </div>

                <div className="document-detail-info mb-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.88rem', background: '#f8f9fa', padding: '12px', borderRadius: '8px' }}>
                  <div>
                    <strong>Classification:</strong> {viewRecord.classification || "—"}
                  </div>
                  <div>
                    <strong>Priority:</strong> {viewRecord.priority || "Normal"}
                  </div>
                  <div>
                    <strong>Office Requestor:</strong> {viewRecord.office_requestor || "—"}
                  </div>
                  <div>
                    <strong>Destination Office:</strong> {viewRecord.destination_office || "—"}
                  </div>
                  <div>
                    <strong>Current Office:</strong> {viewRecord.current_office || "—"}
                  </div>
                  <div>
                    <strong>Record Origin:</strong> {viewRecord.record_origin || "Internal"}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflow: 'auto' }}>
                  {(() => {
                    // Only show routing slip / merged files when the document has been forwarded
                    // back to the Records Management Unit. While the doc is still with another
                    // office (e.g. President), the slip must stay hidden from the admin.
                    const docIsHere = norm(viewRecord?.current_office || '') === norm(myOffice);
                    const mergedFile = docIsHere ? detailFiles.find(f => String(f.name || '').toLowerCase().includes('merged')) : null;
                    const slipFile = docIsHere ? detailFiles.find(f => String(f.name || '').toLowerCase().includes('routing') && String(f.name || '').toLowerCase().endsWith('.pdf')) : null;
                    const showRoutingSlip = mergedFile || slipFile;

                    // Helper: download + print buttons for a PDF file
                    const PdfActions = ({ file, label }) => {
                      const rawPath = file.path || '';
                      const viewUrl = `/api/file-proxy?path=${encodeURIComponent(rawPath)}`;
                      const downloadUrl = `/api/file-proxy?path=${encodeURIComponent(rawPath)}&download=1`;
                      return (
                        <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>{label}</span>
                          <div className="d-flex gap-1">
                            <button
                              className="btn btn-sm btn-outline-primary"
                              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                              title="Download PDF"
                              onClick={() => {
                                // Server returns Content-Type: application/octet-stream
                                // so IDM won't intercept it as a PDF
                                window.open(downloadUrl, '_blank');
                              }}
                            >
                              <FaDownload className="me-1" /> Download
                            </button>
                            <button
                              className="btn btn-sm btn-outline-secondary"
                              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                              title="Print PDF"
                              onClick={() => {
                                const printWindow = window.open(viewUrl, '_blank');
                                if (printWindow) {
                                  printWindow.addEventListener('load', () => {
                                    setTimeout(() => printWindow.print(), 500);
                                  });
                                }
                              }}
                            >
                              <FaPrint className="me-1" /> Print
                            </button>
                          </div>
                        </div>
                      );
                    };

                    // PRIORITY 1: If a merged PDF exists, show ONLY the merged file
                    if (mergedFile && showRoutingSlip) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <PdfActions file={mergedFile} label="📋📄 Routing Slip + Document (Combined PDF)" />
                          <PdfViewer
                            filePath={mergedFile.path}
                            title="Merged Document"
                            style={{ width: '100%', height: '600px', border: 'none' }}
                          />
                        </div>
                      );
                    }

                    // PRIORITY 2: Show routing slip separately if no merged file exists
                    if (slipFile && showRoutingSlip) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <PdfActions file={slipFile} label="📋 Routing Slip" />
                          <PdfViewer
                            filePath={slipFile.path}
                            title="Routing Slip"
                            style={{ width: '100%', height: '500px', border: 'none' }}
                          />
                        </div>
                      );
                    }

                    // PRIORITY 3: Show document files (no routing slip or merged file, or routing slip hidden)
                    const docFiles = detailFiles.filter(f => !String(f.name || '').toLowerCase().includes('routing') && !String(f.name || '').toLowerCase().includes('merged'));
                    if (docFiles.length === 0) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                            📄 Document PDF
                          </div>
                          <div style={{ padding: '40px', textAlign: 'center', color: '#6c757d' }}>No document files</div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                        {docFiles.length === 1 ? (
                          <PdfActions file={docFiles[0]} label="📄 Document PDF" />
                        ) : (
                          <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                            📄 Document PDF
                          </div>
                        )}
                        <div>
                          {docFiles.map((file, idx) => {
                            const filePath = file.path || '';
                            const fileName = file.name || '';
                            const isPdf = String(fileName).toLowerCase().endsWith('.pdf');
                            if (isPdf) {
                              return (
                                <PdfViewer
                                  key={idx}
                                  filePath={filePath}
                                  title={fileName}
                                  style={{ width: '100%', height: '500px', border: 'none' }}
                                />
                              );
                            }
                            return (
                              <div key={idx} style={{ padding: '16px' }}>
                                <a href={filePath.startsWith('/') ? filePath : '/' + filePath} target="_blank" rel="noopener noreferrer">
                                  📎 {fileName}
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
