import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Link } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import Select from "react-select";
import useOffices from "../utils/useOffices";

// Normalize retention values like "3 Years" or "3" into the select's values.
const normalizeRetention = (v) => {
  const s = String(v || "").trim();
  if (s.toLowerCase().includes("permanent")) return "Permanent";
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s || "1" : String(n);
};

// Options for select fields
const CLASSIFICATION_OPTIONS = ["Academic", "Administrative", "Financial", "HR", "Others"];
const PRIORITY_OPTIONS = ["Normal", "Urgent", "Immediate"];
const STATUS_OPTIONS = [
  { label: "In Process", value: "IN_OFFICE" },
  { label: "Received (back at Records Unit)", value: "RECEIVED" },
];
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



const formatSize = (bytes) => {
  if (!bytes && bytes !== 0) return "";
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

// Autocomplete input component for options
function AutocompleteInput({ label, name, value, onChange, options, required = true, placeholder }) {
  const listId = `${name}-list`;

  const normalizeOnBlur = () => {
    if (!value) return;
    const hit = options.find((opt) => opt.toLowerCase() === value.trim().toLowerCase());
    if (hit && hit !== value) onChange({ target: { name, value: hit } });
  };

  return (
    <div className="col-md-6">
      <label className="form-label">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        className="form-control"
        name={name}
        list={listId}
        value={value ?? ""}
        onBlur={normalizeOnBlur}
        onChange={onChange}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
      {required && <div className="invalid-feedback">This field is required.</div>}
    </div>
  );
}

export default function EditRecord() {
  const { offices: DESTINATION_OFFICES } = useOffices();
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validated, setValidated] = useState(false);

  // Form text fields
  const [formData, setFormData] = useState({
    control_number: "",
    office_requestor: "",
    description: "",
    concerned_personnel: "",
    retention_period: "",
    destination_office: "",
    classification: "",
    priority: "",
    record_origin: "internal",
    status: "IN_OFFICE",
  });

  // Existing attachments on the record (kept unless explicitly removed)
  const [files, setFiles] = useState([]);
  // Ids of existing attachments the user chose to remove
  const [removedIds, setRemovedIds] = useState([]);
  // New files to attach on save (optional — existing files are kept)
  const [newFiles, setNewFiles] = useState([]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prevState) => ({ ...prevState, [name]: value }));
  };

  // Load record data for editing
  useEffect(() => {
    const loadRecord = async () => {
      setError(null);
      setLoading(true);
      try {
        const res = await axios.get(`/records/${id}`);
        const record = res.data;

        setFormData({
          control_number: record.control_number || "",
          office_requestor: record.office_requestor || "",
          description: record.description || "",
          concerned_personnel: record.concerned_personnel || "",
          retention_period: normalizeRetention(record.retention_period),
          destination_office: record.destination_office || "",
          classification: record.classification || "",
          priority: record.priority || "",
          record_origin: record.record_origin || "internal",
          status: record.status || "IN_OFFICE",
        });
        setFiles(record.files || []);
        setRemovedIds([]);
        setNewFiles([]);
      } catch (e) {
        console.error(e);
        setError("Failed to load record");
      } finally {
        setLoading(false);
      }
    };
    loadRecord();
  }, [id]);

  const handleRemoveFile = (file) => {
    if (!window.confirm(`Remove "${file.name}" from this record?`)) return;
    if (file.id) {
      setRemovedIds((prev) => [...prev, file.id]);
    }
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setValidated(true);
    const formEl = e.currentTarget;
    if (formEl.checkValidity() === false) return;

    const requiredFields = [
      "control_number",
      "office_requestor",
      "description",
      "concerned_personnel",
      "retention_period",
      "destination_office",
      "classification",
      "priority",
    ];
    for (const field of requiredFields) {
      if (!formData[field]) {
        setError(`${field} is required.`);
        return;
      }
    }

    const formattedRetentionPeriod =
      formData.retention_period === "Permanent"
        ? "Permanent"
        : `${formData.retention_period} Years`;

    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("control_number", formData.control_number);
      fd.append("office_requestor", formData.office_requestor);
      fd.append("description", formData.description);
      fd.append("concerned_personnel", formData.concerned_personnel);
      fd.append("retention_period", formattedRetentionPeriod);
      fd.append("destination_office", formData.destination_office);
      fd.append("classification", formData.classification);
      fd.append("priority", formData.priority);
      fd.append("record_origin", formData.record_origin || "internal");
      fd.append("status", formData.status || "IN_OFFICE");
      // Optional new attachments (existing ones are kept when none are added)
      newFiles.forEach((file) => fd.append("files", file));

      await axios.put(`/records/${id}`, fd);

      // Remove any attachments the user marked for deletion
      for (const fileId of removedIds) {
        await axios.delete(`/records/${id}/files/${fileId}`);
      }

      alert("Record updated.");
      navigate(-1);
    } catch (e) {
      console.error("Error during record update:", e.response?.data || e.message);
      setError(`Failed to update record: ${e.response?.data?.error || e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const visibleFiles = files.filter((f) => !removedIds.includes(f.id));

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2>Edit Record</h2>
          {error && <div className="alert alert-danger">{error}</div>}
          {loading && <div>Loading record…</div>}

          <form className={`row g-3 ${validated ? "was-validated" : ""}`} onSubmit={handleSubmit} noValidate>
            {/* Control No */}
            <div className="col-md-6">
              <label className="form-label">Control No. *</label>
              <input
                className="form-control"
                name="control_number"
                value={formData.control_number}
                onChange={handleChange}
                disabled
                required
                placeholder="e.g., 2025-09-001"
              />
              <div className="invalid-feedback">Control number is required.</div>
            </div>

            {/* Office / Requestor */}
            <div className="col-md-6">
              <label className="form-label">Office/ Requestor *</label>
              <input
                className="form-control"
                name="office_requestor"
                value={formData.office_requestor}
                onChange={handleChange}
                required
              />
              <div className="invalid-feedback">Office/Requestor is required.</div>
            </div>

            {/* Concerned Personnel */}
            <div className="col-md-6">
              <label className="form-label">Concerned Personnel *</label>
              <input
                className="form-control"
                name="concerned_personnel"
                value={formData.concerned_personnel}
                onChange={handleChange}
                required
              />
              <div className="invalid-feedback">Concerned Personnel is required.</div>
            </div>

            {/* Description */}
            <div className="col-12">
              <label className="form-label">Title and Description *</label>
              <textarea
                className="form-control"
                name="description"
                rows={3}
                value={formData.description}
                onChange={handleChange}
                required
                placeholder="Provide title and description"
              />
              <div className="invalid-feedback">Title and Description are required.</div>
            </div>

            {/* Destination Office */}
            <AutocompleteInput
              label="Destination Office"
              name="destination_office"
              value={formData.destination_office}
              onChange={handleChange}
              options={DESTINATION_OFFICES}
              placeholder="e.g., Accounting Office"
            />

            {/* Classification */}
            <AutocompleteInput
              label="Classification"
              name="classification"
              value={formData.classification}
              onChange={handleChange}
              options={CLASSIFICATION_OPTIONS}
              placeholder="e.g., Academic"
            />

            {/* Priority */}
            <AutocompleteInput
              label="Priority"
              name="priority"
              value={formData.priority}
              onChange={handleChange}
              options={PRIORITY_OPTIONS}
              placeholder="e.g., Normal"
            />

            {/* Retention Period */}
            <div className="col-md-6">
              <label className="form-label">Retention Period *</label>
              <Select
                options={RETENTION_OPTIONS}
                onChange={(option) =>
                  setFormData((prev) => ({ ...prev, retention_period: option?.value ?? "1" }))
                }
                value={RETENTION_OPTIONS.find((opt) => opt.value === formData.retention_period) || null}
                placeholder="Select Retention Period"
                isSearchable
              />
            </div>

            {/* Status — when the document returns to the Records Unit, mark it Received */}
            <div className="col-md-6">
              <label className="form-label">Status</label>
              <Select
                options={STATUS_OPTIONS}
                onChange={(option) =>
                  setFormData((prev) => ({ ...prev, status: option?.value ?? "IN_OFFICE" }))
                }
                value={STATUS_OPTIONS.find((opt) => opt.value === formData.status) || STATUS_OPTIONS[0]}
                isSearchable={false}
              />
              <div className="form-text">
                Mark as "Received" when the document is back at the Records Unit.
              </div>
            </div>

            {/* Record Origin (read-only display) */}
            <div className="col-md-6">
              <label className="form-label">Record Origin</label>
              <input className="form-control" value={formData.record_origin} disabled />
            </div>

            {/* ===== Attachments ===== */}
            <div className="col-12">
              <label className="form-label">Attachments</label>
              {visibleFiles.length === 0 ? (
                <p className="text-muted">No attachments on this record.</p>
              ) : (
                <ul className="list-group mb-2">
                  {visibleFiles.map((file, i) => (
                    <li
                      key={file.id || `${file.path}-${i}`}
                      className="list-group-item d-flex align-items-center justify-content-between gap-2 flex-wrap"
                    >
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Link
                          to={`/attachment-viewer?file=${encodeURIComponent(
                            file.path
                          )}&name=${encodeURIComponent(file.name)}`}
                          className="text-primary"
                          title="Preview"
                        >
                          {file.name}
                        </Link>
                        {formatSize(file.size) && (
                          <span className="text-muted small">{formatSize(file.size)}</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => handleRemoveFile(file)}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="form-text mb-2">
                Existing files are kept automatically — you only need to add files if you want to
                attach more. No need to re-upload the same document.
              </div>
              <input
                type="file"
                className="form-control"
                multiple
                onChange={(e) => setNewFiles(Array.from(e.target.files || []))}
              />
              {newFiles.length > 0 && (
                <div className="mt-2 text-muted small">
                  {newFiles.length} new file{newFiles.length === 1 ? "" : "s"} will be attached on
                  save.
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="col-12 d-flex gap-2">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving…" : "Save Changes"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
