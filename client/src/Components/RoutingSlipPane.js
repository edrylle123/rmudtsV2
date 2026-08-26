import React, { useEffect, useMemo, useState } from "react";
import axios from "./axios";
import "./RoutingSlipPane.css";

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

// Interactive routing slip shown in the AttachmentViewer when the document has
// no saved slip yet: check the "( )" action boxes, type comments, then save —
// the slip is generated as a PDF and attached to the document.
export default function RoutingSlipPane({ controlNumber, recordId, onSaved }) {
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    axios
      .get("/api/settings/routing-slip")
      .then((res) => {
        if (!alive) return;
        const s = res.data || {};
        setSettings(s);
        setForm((prev) => ({
          ...prev,
          from: s.signer_name || "",
          from_title: s.signer_title || "",
          date: new Date().toISOString().slice(0, 10),
        }));
      })
      .catch(() => {
        if (alive) setSettings({});
      });
    return () => {
      alive = false;
    };
  }, []);

  // The settings list may include an "Others: ____" entry; it is rendered as
  // its own row below with the specify field, so skip it here.
  const actionItems = useMemo(
    () =>
      (settings?.actions?.length ? settings.actions : FALLBACK_ACTIONS).filter(
        (a) => String(a || "").trim().length && !/others/i.test(String(a))
      ),
    [settings]
  );

  const toggleAction = (label) =>
    setForm((prev) => ({
      ...prev,
      actions: { ...prev.actions, [label]: !prev.actions[label] },
    }));

  const selectedActions = Object.keys(form.actions).filter((k) => form.actions[k]);

  const handleSave = async () => {
    if (!recordId) return;
    setError("");
    setSaving(true);
    try {
      const slip = {
        to: form.to,
        from: form.from,
        from_title: form.from_title,
        date: form.date,
        actions: selectedActions,
        others: form.others.trim(),
        comments: form.comments,
      };
      const res = await axios.post(`/api/records/${recordId}/slip`, slip);
      if (res.data?.success) {
        onSaved && onSaved();
      } else {
        setError(res.data?.error || "Failed to save the routing slip.");
      }
    } catch (err) {
      console.error("Save routing slip error:", err);
      setError(err.response?.data?.error || "Failed to save the routing slip.");
    } finally {
      setSaving(false);
    }
  };

  const change = (name, value) =>
    setForm((prev) => ({ ...prev, [name]: value }));

  return (
    <div className="rsp-wrap">
      <div className="rsp-slip">
        <div className="rsp-header">
          <img src="/qsu-logo.png" alt="QSU logo" className="rsp-logo" />
          <div className="rsp-header-text">
            <strong>
              {settings?.header || "OFFICE OF THE UNIVERSITY PRESIDENT"}
            </strong>
            <div className="rsp-address">
              {settings?.address || "Diffun, Quirino"}
            </div>
          </div>
        </div>

        <div className="rsp-title">Routing Slip</div>

        <div className="rsp-ctrl">
          CTRL: <strong>{controlNumber || "____________"}</strong>
        </div>

        <div className="row g-2 rsp-fields">
          <div className="col-md-6">
            <label className="form-label small mb-0">To</label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={form.to}
              onChange={(e) => change("to", e.target.value)}
              placeholder="Destination office"
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
              disabled
            />
          </div>
          <div className="col-md-6">
            <label className="form-label small mb-0">Title</label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={form.from_title}
              onChange={(e) => change("from_title", e.target.value)}
              disabled
            />
          </div>
        </div>

        <div className="rsp-actions">
          {actionItems.map((item) => {
            const checked = !!form.actions[item];
            return (
              <label
                key={item}
                className={`rsp-action ${checked ? "checked" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAction(item)}
                />
                <span className="rsp-marker">{checked ? "(X)" : "( )"}</span>
                <span>{item}</span>
              </label>
            );
          })}
          <label
            className={`rsp-action ${form.others.trim() ? "checked" : ""}`}
          >
            <input
              type="checkbox"
              checked={form.others.trim() !== ""}
              onChange={(e) => {
                if (!e.target.checked) change("others", "");
              }}
            />
            <span className="rsp-marker">
              {form.others.trim() ? "(X)" : "( )"}
            </span>
            <span>
              Others:{" "}
              <input
                type="text"
                className="form-control form-control-sm d-inline-block"
                style={{ width: "180px" }}
                placeholder="specify"
                value={form.others}
                onChange={(e) => change("others", e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </span>
          </label>
        </div>

        <div>
          <label className="form-label small mb-1">Comments</label>
          <textarea
            className="form-control rsp-comments"
            rows={3}
            value={form.comments}
            onChange={(e) => change("comments", e.target.value)}
            placeholder="Type your comments here…"
          />
        </div>

        <div className="rsp-footer">
          {settings?.footer_ref || "QSU-REC-F007"} ·{" "}
          {settings?.footer_rev || "Rev. 01 (Jul. 07, 2025)"}
        </div>
      </div>

      {error && <div className="alert alert-danger py-2 mt-2 mb-0">{error}</div>}

      <div className="rsp-buttons">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={() =>
            setForm((prev) => ({
              ...prev,
              to: "",
              actions: {},
              others: "",
              comments: "",
            }))
          }
          disabled={saving}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={handleSave}
          disabled={saving || !recordId}
        >
          {saving ? "Saving…" : "Save Routing Slip"}
        </button>
      </div>
      <div className="text-muted small mt-1">
        Checking the boxes and saving attaches this routing slip to the
        document. It appears here (and for the receiving office) as its own
        PDF with the same control number.
      </div>
    </div>
  );
}
