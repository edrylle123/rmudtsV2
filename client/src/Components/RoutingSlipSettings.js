import React, { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import "./RoutingSlipSettings.css";

const DEFAULTS = {
  header: "OFFICE OF THE UNIVERSITY PRESIDENT",
  address: "Diffun, Quirino",
  signer_name: "HERMENEGILDO F. SAMOY, JR., PhD",
  signer_title: "University President",
  footer_ref: "QSU-REC-F007",
  footer_rev: "Rev. 01 (Jul. 07, 2025)",
  actions: [
    "URGENT",
    "For your information & appropriate action",
    "For your review/comments",
    "Please hold",
    "Please disseminate",
    "Please draft reply",
    "Let us discuss",
    "Please attend",
    "Please represent the office",
    "For your recommendation",
    "For file/reference",
    "Others: ____________",
  ],
};

export default function RoutingSlipSettings() {
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    axios
      .get("/api/settings/routing-slip")
      .then((res) => setForm(res.data || { ...DEFAULTS }))
      .catch(() => setForm({ ...DEFAULTS }))
      .finally(() => setLoading(false));
  }, []);

  const change = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  const changeAction = (idx, value) =>
    setForm((prev) => ({
      ...prev,
      actions: (prev.actions || []).map((a, i) => (i === idx ? value : a)),
    }));

  const addAction = () =>
    setForm((prev) => ({ ...prev, actions: [...(prev.actions || []), ""] }));

  const removeAction = (idx) =>
    setForm((prev) => ({
      ...prev,
      actions: (prev.actions || []).filter((_, i) => i !== idx),
    }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const res = await axios.put("/api/settings/routing-slip", form);
      setForm(res.data);
      setMessage("Routing slip settings saved. New slips will use these values.");
    } catch (err) {
      console.error(err);
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm("Reset the routing slip template to the original defaults?"))
      return;
    setSaving(true);
    setMessage("");
    try {
      const res = await axios.put("/api/settings/routing-slip", DEFAULTS);
      setForm(res.data);
      setMessage("Routing slip template reset to defaults.");
    } catch (err) {
      console.error(err);
      setMessage("Failed to reset settings.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="d-flex main-layout">
        <Sidebar />
        <div className="content-wrapper">
          <Navbar />
          <div className="container-fluid">
            <div className="status">Loading…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid">
          <div className="rss-card">
            <div className="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-3">
              <div>
                <h4 className="mb-1">Routing Slip Settings</h4>
                <p className="text-muted small mb-0">
                  Edit the routing slip template that is attached when a document
                  is forwarded to another office.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={handleReset}
                disabled={saving}
              >
                Reset to defaults
              </button>
            </div>

            {message && (
              <div className="alert alert-success py-2 small">{message}</div>
            )}

            <form onSubmit={handleSave}>
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Office header (shown on the slip)</label>
                  <input
                    className="form-control"
                    value={form.header || ""}
                    onChange={(e) => change("header", e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Address line</label>
                  <input
                    className="form-control"
                    value={form.address || ""}
                    onChange={(e) => change("address", e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Signer name ("From")</label>
                  <input
                    className="form-control"
                    value={form.signer_name || ""}
                    onChange={(e) => change("signer_name", e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Signer title</label>
                  <input
                    className="form-control"
                    value={form.signer_title || ""}
                    onChange={(e) => change("signer_title", e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Footer reference</label>
                  <input
                    className="form-control"
                    value={form.footer_ref || ""}
                    onChange={(e) => change("footer_ref", e.target.value)}
                  />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Footer revision</label>
                  <input
                    className="form-control"
                    value={form.footer_rev || ""}
                    onChange={(e) => change("footer_rev", e.target.value)}
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="form-label fw-semibold">Action checklist items</label>
                <p className="text-muted small">
                  These appear as checkboxes on the routing slip. The item containing
                  “Others” becomes the fill-in “Others” line.
                </p>
                {(form.actions || []).map((action, idx) => (
                  <div key={idx} className="input-group mb-2">
                    <input
                      className="form-control"
                      value={action}
                      onChange={(e) => changeAction(idx, e.target.value)}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-danger"
                      onClick={() => removeAction(idx)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="btn btn-outline-primary btn-sm"
                  onClick={addAction}
                >
                  + Add action item
                </button>
              </div>

              <div className="mt-4 d-flex gap-2">
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Save Settings"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
