import React, { useState, useEffect } from "react";
import axios from "./axios";
import { socket } from "../socket";
import {
  FaHistory,
  FaExclamationCircle,
  FaArrowRight,
} from "react-icons/fa";

// OperationsStream — live activity feed + task queue for admin/super admin.
// Feed  = latest record movements (created / forwarded / received).
// Queue = records not yet updated (no QR code) — documents awaiting action.
//
// The activity feed is always visible; the task queue is stacked underneath it
// so both are shown at once (the card scrolls as a single column).
function OperationsStream({ onOpenRecord }) {
  const [feed, setFeed] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await axios.get("/api/activity");
      setFeed(Array.isArray(res.data.feed) ? res.data.feed : []);
      setQueue(Array.isArray(res.data.queue) ? res.data.queue : []);
    } catch (e) {
      console.error("Operations stream load error:", e?.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const onUpdated = () => load();
    socket.on("recordUpdated", onUpdated);
    return () => socket.off("recordUpdated", onUpdated);
  }, []);

  const fmtTime = (v) => {
    const d = v ? new Date(v) : null;
    if (!d || isNaN(d)) return "—";
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const describeEvent = (e) => {
    // "System" is the placeholder older installs wrote for creations that were
    // not tied to an account — it names nobody, so it is dropped.
    const actor = e.actor ? String(e.actor).trim() : "";
    const creator = actor && actor !== "System" ? actor : "";
    const cn = e.control_number || "record";
    // Creation events have no meaningful origin: from_office is NULL (new rows)
    // or "Unknown" (legacy rows). Normalize so they never read as a forward.
    const isCreation =
      e.action === "CREATED" ||
      !e.from_office ||
      e.from_office === "Unknown";

    if (!isCreation && e.from_office && e.to_office) {
      return (
        <>
          <strong>{cn}</strong> forwarded from {e.from_office} to {e.to_office}
          {creator && <> by {creator}</>}
        </>
      );
    }

    if (isCreation) {
      // Name the account that created the document, e.g.
      // "261001-2490 Francis Klause E. Imperio created and delivered to <office>".
      // Legacy rows carry no account, so they keep the old, name-free wording.
      return (
        <>
          <strong>{cn}</strong>
          {creator && <> {creator}</>} created
          {e.to_office && (
            <>
              {" "}and delivered to <strong>{e.to_office}</strong>
            </>
          )}
        </>
      );
    }

    if (e.to_office) {
      return (
        <>
          <strong>{cn}</strong> delivered to <strong>{e.to_office}</strong>
          {creator && <> by {creator}</>}
        </>
      );
    }

    return (
      <>
        Activity on <strong>{cn}</strong>
      </>
    );
  };

  const priorityColor = (p) => {
    const v = String(p || "").toLowerCase();
    if (v.includes("urgent")) return "#dc3545";
    if (v.includes("high")) return "#fd7e14";
    return "#6c757d";
  };

  const sectionLabel = {
    fontSize: "0.68rem",
    fontWeight: 700,
    letterSpacing: "0.6px",
    textTransform: "uppercase",
    color: "#6c757d",
  };

  return (
    <div
      className="border rounded-3 p-3 h-100"
      style={{
        background: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div className="d-flex align-items-center gap-2 mb-2">
        <FaHistory style={{ color: "#35804eff" }} size={15} />
        <h6 className="mb-0" style={{ fontWeight: 700, fontSize: "0.9rem" }}>
          Operations Stream
        </h6>
      </div>

      {/* Body: activity feed always shown, task queue stacked below */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loading ? (
          <div className="text-muted small text-center py-4">Loading…</div>
        ) : (
          <>
            {/* Activity Feed */}
            <div className="mb-1" style={sectionLabel}>
              Activity Feed
            </div>
            {feed.length === 0 ? (
              <div className="text-muted small text-center py-3">
                No recent activity.
              </div>
            ) : (
              feed.map((e) => (
                <div
                  key={e.id}
                  onClick={() => onOpenRecord && onOpenRecord(e.record_id)}
                  className="py-1 border-bottom"
                  style={{ cursor: onOpenRecord ? "pointer" : "default" }}
                  title="Click to view this record"
                >
                  <div
                    className="small"
                    style={{ color: "#212529", lineHeight: 1.3 }}
                  >
                    {describeEvent(e)}
                  </div>
                  <div className="text-muted" style={{ fontSize: "0.7rem" }}>
                    {fmtTime(e.timestamp)}
                  </div>
                </div>
              ))
            )}

            {/* Task Queue */}
            <div
              className="d-flex align-items-center gap-2 mt-3 mb-1"
              style={sectionLabel}
            >
              <span>Task Queue</span>
              {queue.length > 0 && (
                <span
                  className="badge rounded-pill"
                  style={{ background: "#dc3545", fontSize: "0.6rem" }}
                >
                  {queue.length}
                </span>
              )}
            </div>
            {queue.length === 0 ? (
              <div className="text-muted small text-center py-3">
                🎉 All caught up — no documents awaiting update.
              </div>
            ) : (
              queue.map((r) => (
                <div
                  key={r.id}
                  onClick={() => onOpenRecord && onOpenRecord(r.id)}
                  className="py-1 border-bottom d-flex align-items-center gap-2"
                  style={{ cursor: onOpenRecord ? "pointer" : "default" }}
                  title="Click to view this record"
                >
                  <FaExclamationCircle
                    style={{ color: "#ffc107", flexShrink: 0 }}
                    size={13}
                  />
                  <div className="grow-col">
                    <div className="small">
                      <strong>{r.control_number}</strong>
                      {r.title && (
                        <span className="text-muted">
                          {" "}
                          — {String(r.title).slice(0, 40)}
                        </span>
                      )}
                    </div>
                    <div
                      className="text-muted d-flex align-items-center gap-2"
                      style={{ fontSize: "0.7rem" }}
                    >
                      <span
                        style={{
                          color: priorityColor(r.priority),
                          fontWeight: 600,
                        }}
                      >
                        {r.priority || "Normal"}
                      </span>
                      <span>·</span>
                      <span>{r.office_requestor || "—"}</span>
                      <span>·</span>
                      <span>{fmtTime(r.created_at)}</span>
                    </div>
                  </div>
                  <FaArrowRight
                    style={{ color: "#adb5bd", flexShrink: 0 }}
                    size={11}
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default OperationsStream;
