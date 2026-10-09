import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";

// Normalize retention values like "3 Years" or "3" into the select's values.
const normalizeRetention = (v) => {
  const s = String(v || "").trim();
  if (s.toLowerCase().includes("permanent")) return "Permanent";
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s || "1" : String(n);
};

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

export default function EditRecord() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [record, setRecord] = useState(null);
  const [retentionPeriod, setRetentionPeriod] = useState("1");

  // Load record data for editing
  useEffect(() => {
    const loadRecord = async () => {
      setError(null);
      setLoading(true);
      try {
        const res = await axios.get(`/records/${id}`);
        const r = res.data;
        setRecord(r);
        setRetentionPeriod(normalizeRetention(r.retention_period));
      } catch (e) {
        console.error(e);
        setError("Failed to load record");
      } finally {
        setLoading(false);
      }
    };
    loadRecord();
  }, [id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!retentionPeriod) {
      setError("Retention Period is required.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const retentionValue =
        retentionPeriod === "Permanent"
          ? "Permanent"
          : `${retentionPeriod} Years`;
      const fd = new FormData();
      fd.append("retention_period", retentionValue);
      await axios.put(`/records/${id}`, fd);
      alert("Record updated successfully!");
      navigate(-1);
    } catch (err) {
      console.error(
        "Error during record update:",
        err.response?.data || err.message
      );
      setError(
        `Failed to update record: ${err.response?.data?.error || err.message}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2>Edit Record</h2>
          {error && <div className="alert alert-danger">{error}</div>}
          {loading && <div>Loading record…</div>}
          {!loading && record && (
            <form className="row g-3" onSubmit={handleSubmit}>
              {/* Read-only summary */}
              <div className="col-12">
                <div
                  style={{
                    background: "#f8f9fa",
                    border: "1px solid #e9ecef",
                    borderRadius: 8,
                    padding: "12px 16px",
                    fontSize: "0.92rem",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>
                    {record.control_number || "—"}
                  </div>
                  <div className="text-muted">
                    {record.description || "No title / description"}
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <strong>Office Requestor:</strong>{" "}
                    {record.office_requestor || "—"}
                  </div>
                  <div style={{ marginTop: 2 }}>
                    <strong>Status:</strong> {record.status || "—"}
                  </div>
                </div>
              </div>

              {/* Retention Period (editable) */}
              <div className="col-md-6">
                <label className="form-label">Retention Period *</label>
                <select
                  className="form-control"
                  value={retentionPeriod}
                  onChange={(e) => setRetentionPeriod(e.target.value)}
                  required
                >
                  {RETENTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-12 d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Changes"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => navigate(-1)}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
