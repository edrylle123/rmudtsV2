import React, { useEffect, useState } from "react";
import axios from "./axios";
import "./RoutingSlipModal.css";

const FALLBACK_ACTIONS = [
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
];

export default function RoutingSlipModal({
  record,
  destinationOffice,
  onClose,
  onForwarded,
}) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({
    to: "",
    from: "",
    from_title: "",
    date: "",
    actions: {},
    others: "",
    comments: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    // First try to load existing slip data for this record
    const loadExisting = async () => {
      try {
        const slipRes = await axios.get(`/api/records/${record?.id}/slip-data`);
        if (alive && slipRes.data?.slip) {
          const existing = slipRes.data.slip;
          setForm((prev) => ({
            ...prev,
            to: destinationOffice || existing.to || "",
            from: existing.from || "",
            from_title: existing.from_title || "",
            date: new Date().toISOString().slice(0, 10),
            actions: existing.actions
              ? Object.fromEntries(existing.actions.map((a) => [a, true]))
              : {},
            others: existing.others || "",
            comments: existing.comments || "",
          }));
          // Still load settings for reference
          const sRes = await axios.get("/api/settings/routing-slip");
          if (alive) setSettings(sRes.data || {});
          return;
        }
      } catch {
        // No existing slip — fall through to defaults
      }
      // No existing slip data — load defaults from settings
      try {
        const sRes = await axios.get("/api/settings/routing-slip");
        if (!alive) return;
        const s = sRes.data || {};
        setSettings(s);
        setForm((prev) => ({
          ...prev,
          to: destinationOffice || "",
          from: s.signer_name || "",
          from_title: s.signer_title || "",
          date: new Date().toISOString().slice(0, 10),
        }));
      } catch {
        if (alive) setSettings({});
      }
    };
    loadExisting();
    return () => {
      alive = false;
    };
  }, [destinationOffice, record?.id]);

  // The settings list may include an "Others: ____" entry; it is rendered as
  // its own row below with the specify field, so skip it here.
  const actionItems = (settings?.actions || FALLBACK_ACTIONS).filter(
    (a) => String(a || "").trim().length && !/others/i.test(String(a || ""))
  );

  const toggleAction = (label) =>
    setForm((prev) => ({
      ...prev,
      actions: { ...prev.actions, [label]: !prev.actions[label] },
    }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.date) {
      alert("Please set the date on the routing slip.");
      return;
    }
    setSubmitting(true);
    try {
      const slip = {
        to: destinationOffice,
        from: form.from,
        from_title: form.from_title,
        date: form.date,
        actions: Object.keys(form.actions).filter((k) => form.actions[k]),
        others: form.others.trim(),
        comments: form.comments,
      };
      const res = await axios.put(`/records/forward/${record.id}`, {
        destination_office: destinationOffice,
        slip,
      });
      if (res.data?.slipError) {
        alert(
          `Record forwarded, but the routing slip could not be attached: ${res.data.slipError}`
        );
      } else {
        alert(`Record forwarded to ${destinationOffice} with routing slip.`);
      }
      onForwarded();
    } catch (err) {
      console.error("Error forwarding with routing slip:", err);
      alert("Failed to forward record.");
    } finally {
      setSubmitting(false);
    }
  };

  const change = (name, value) => setForm((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="rsm-backdrop" onClick={onClose}>
      <div
        className="rsm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Routing slip"
      >
        <div className="rsm-header">
          <div>
            <h3 className="mb-0">Routing Slip</h3>
            <span className="text-muted small">
              Attach a routing slip to the document you are forwarding
            </span>
          </div>
          <button type="button" className="rsm-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="rsm-form">
          <div className="rsm-slip">
            <div className="rsm-slip-top">
              <img src="/qsu-logo.png" alt="QSU logo" className="rsm-logo" />
              <div>
                <strong>{settings?.header || "OFFICE OF THE UNIVERSITY PRESIDENT"}</strong>
                <div className="small text-muted">
                  {settings?.address || "Diffun, Quirino"}
                </div>
              </div>
              <div className="text-end">
                <div className="small text-muted">CTRL</div>
                <strong>{record?.control_number || "—"}</strong>
              </div>
            </div>

            <div className="rsm-line" />

            <div className="row g-2">
              <div className="col-md-6">
                <label className="form-label small mb-0">To</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={form.to}
                  readOnly
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small mb-0">Date</label>
                <input
                  type="date"
                  className="form-control form-control-sm"
                  value={form.date}
                  onChange={(e) => change("date", e.target.value)}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small mb-0">From</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={form.from}
                  onChange={(e) => change("from", e.target.value)}
                />
              </div>
              <div className="col-md-6">
                <label className="form-label small mb-0">Title</label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={form.from_title}
                  onChange={(e) => change("from_title", e.target.value)}
                />
              </div>
            </div>

            <div className="rsm-actions">
              {actionItems.map((item) => (
                <label key={item} className="rsm-action">
                  <input
                    type="checkbox"
                    checked={!!form.actions[item]}
                    onChange={() => toggleAction(item)}
                  />
                  <span>{item}</span>
                </label>
              ))}
              <label className="rsm-action">
                <input
                  type="checkbox"
                  checked={form.others.trim() !== ""}
                  onChange={(e) => {
                    if (!e.target.checked) change("others", "");
                  }}
                />
                <span>
                  Others:{" "}
                  <input
                    type="text"
                    className="form-control form-control-sm d-inline-block"
                    style={{ width: "200px" }}
                    placeholder="specify"
                    value={form.others}
                    onChange={(e) => change("others", e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </span>
              </label>
            </div>

            <div>
              <label className="form-label small mb-0">Comments</label>
              <textarea
                className="form-control"
                rows={3}
                value={form.comments}
                onChange={(e) => change("comments", e.target.value)}
                placeholder="Enter comments…"
              />
            </div>

            <div className="small text-muted mt-1">
              {settings?.footer_ref || "QSU-REC-F007"} ·{" "}
              {settings?.footer_rev || "Rev. 01 (Jul. 07, 2025)"}
            </div>
          </div>

          <div className="rsm-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? "Forwarding…" : "Forward with Routing Slip"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
