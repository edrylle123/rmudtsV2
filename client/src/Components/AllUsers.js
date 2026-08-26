// client/src/Components/AllUsers.js
import React, { useEffect, useMemo, useState, useCallback } from "react";
import axios from "./axios";
import "./AllUsers.css";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { useAuth } from "../AuthContext";
import useOffices from "../utils/useOffices";

export default function AllUsers() {
  const { offices: OFFICE_OPTIONS } = useOffices();
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [officesMap, setOfficesMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [form, setForm] = useState({
    id: "",
    name: "",
    email: "",
    role: "user",
    office: "",
    idnumber: "",
    password: "",
  });

  // ----- helpers -----
  const officeFromUser = useCallback((u) => {
    if (!u) return "—";
    if (typeof u.office === "string" && u.office.trim()) return u.office.trim();
    if (u.office && typeof u.office === "object") {
      const nested =
        u.office.name ||
        u.office.title ||
        u.office.office_name ||
        
        u.office.officeTitle;
      if (nested) return nested;
    }
    const alt =
      u.office_name ||
      u.officeName ||
      u.office_title ||
      u.officeTitle ||
      u.department ||
      u.department_name ||
      u.departmentName;
    if (alt) return alt;

    const oid =
      u.office_id || u.officeId || u.officeID || u.officeid ||
      u.department_id || u.departmentId;
    if (oid != null && officesMap && officesMap[oid]) return officesMap[oid];

    return "—";
  }, [officesMap]);

  const normalizeUserForRow = useCallback((u, idx) => {
    const primaryName = u && typeof u.name === "string" ? u.name.trim() : "";
    const first = (u && u.first_name) ? u.first_name : "";
    const last = (u && u.last_name) ? u.last_name : "";
    const altName = (first + " " + last).trim();
    const displayName = primaryName || altName || "—";

    const displayEmail =
      (u && typeof u.email === "string" && u.email) ||
      (u && u.username) ||
      "—";

    const displayRole = (u && (u.role || u.user_role || u.type)) || "—";

    return {
      key: (u && (u.id || u._id || u.email || u.name)) || String(idx),
      id: u.id || u._id,
      name: displayName,
      email: displayEmail,
      role: displayRole,
      office: officeFromUser(u),
      idnumber: u.idnumber || "",
      raw: u,
    };
  }, [officeFromUser]);

  const rows = useMemo(
    () => (Array.isArray(users) ? users : []).map(normalizeUserForRow),
    [users, normalizeUserForRow]
  );

  // ----- load data -----
  const maybeLoadOffices = async () => {
    try {
      const res = await axios.get("/offices");
      const raw = res && res.data;
      const list = Array.isArray(raw && raw.data) ? raw.data : (Array.isArray(raw) ? raw : []);
      if (!Array.isArray(list)) return;
      const map = {};
      for (const o of list) {
        const id = (o && (o.id || o._id || o.office_id || o.officeId || o.officeID));
        const name = (o && (o.name || o.office_name || o.title || o.officeTitle));
        if (id != null && name) map[id] = name;
      }
      if (Object.keys(map).length) setOfficesMap(map);
    } catch {
      // ignore if endpoint not present
    }
  };

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await axios.get("/users");
      const raw = res && res.data;
      const list = Array.isArray(raw && raw.data)
        ? raw.data
        : Array.isArray(raw)
        ? raw
        : (raw && Array.isArray(raw.users) ? raw.users : []);
      setUsers(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error(e);
      setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers().then(maybeLoadOffices);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- edit / delete -----
  const openEditor = (r) => {
    setForm({
      id: r.id,
      name: r.name === "—" ? "" : r.name,
      email: r.email === "—" ? "" : r.email,
      role: r.role === "—" ? "user" : r.role,
      office: r.office === "—" ? "" : r.office,
      idnumber: r.idnumber || "",
      password: "",
    });
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setForm({
      id: "",
      name: "",
      email: "",
      role: "user",
      office: "",
      idnumber: "",
      password: "",
    });
  };

  const saveUser = async (e) => {
    e?.preventDefault?.();
    if (!form.id || !form.name || !form.email || !form.role) {
      alert("Name, email, and role are required.");
      return;
    }
    try {
      setSaving(true);
      const payload = {
        name: form.name,
        email: form.email,
        role: form.role,
        idnumber: form.idnumber || "",
        office: form.office || "",
      };
      if (form.password && form.password.trim() !== "") {
        payload.password = form.password;
      }
      await axios.put(`/users/${form.id}`, payload);
      setUsers((prev) =>
        prev.map((u) =>
          (u.id === form.id || u._id === form.id) ? { ...u, ...payload } : u
        )
      );
      closeEditor();
    } catch (err) {
      console.error(err);
      alert("Failed to save user");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (r) => {
    if (!r?.id) return;
    const myId = me?.id;
    if (myId && String(myId) === String(r.id)) {
      alert("You cannot delete your own account while logged in.");
      return;
    }
    if (!window.confirm(`Delete user "${r.name}"? This cannot be undone.`)) return;
    try {
      setDeletingId(r.id);
      await axios.delete(`/users/${r.id}`);
      setUsers((prev) => prev.filter((u) => (u.id || u._id) !== r.id));
    } catch (err) {
      console.error(err);
      alert("Failed to delete user");
    } finally {
      setDeletingId(null);
    }
  };

  // ----- search/filter state (if you added them) -----
  // keep your existing search/filter code above the table if present

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2 className="mb-3">All Users</h2>
          {error && <div className="alert alert-danger">{error}</div>}

          {loading ? (
            <div>Loading users…</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-striped align-middle">
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Name</th>
                    <th style={{ minWidth: 220 }}>Email</th>
                    <th style={{ minWidth: 220 }}>ID Number</th>


                    <th>Role</th>
                    <th style={{ minWidth: 220 }}>Office</th>
                    <th style={{ width: 160 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>{r.name}</td>
                      <td>{r.email}</td>
                      <td>{r.idnumber}</td>
                      <td>{r.role}</td>
                      <td>{r.office}</td>
                      <td className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => openEditor(r)}>
                          Edit
                        </button>
                        <button
                          className="btn btn-sm btn-outline-danger"
                          disabled={deletingId === r.id || (me?.id && String(me.id) === String(r.id))}
                          title={me?.id && String(me.id) === String(r.id) ? "You cannot delete your own account" : undefined}
                          onClick={() => deleteUser(r)}
                        >
                          {deletingId === r.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))}

                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted">
                        No users found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Editor modal (unchanged) */}
      {showEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1050,
          }}
          onClick={closeEditor}
        >
          <div className="card shadow" style={{ width: "min(720px, 96%)" }} onClick={(e) => e.stopPropagation()}>
            <div className="card-body">
              <h5 className="card-title mb-3">Edit User</h5>
              <form onSubmit={saveUser} className="row g-3">
                <div className="col-md-6">
                  <label className="form-label">Full Name *</label>
                  <input className="form-control" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} required />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Email *</label>
                  <input type="email" className="form-control" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} required />
                </div>

                <div className="col-md-6">
                  <label className="form-label">Role *</label>
                  <select className="form-select" value={form.role} onChange={(e) => setForm((s) => ({ ...s, role: e.target.value }))}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label">ID Number</label>
                  <input className="form-control" value={form.idnumber} onChange={(e) => setForm((s) => ({ ...s, idnumber: e.target.value }))} />
                </div>

                <div className="col-md-12">
                  <label className="form-label">Office</label>
                  <select className="form-select" value={form.office} onChange={(e) => setForm((s) => ({ ...s, office: e.target.value }))}>
                    <option value="">—</option>
                    {OFFICE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                <div className="col-md-12">
                  <label className="form-label">New Password (optional)</label>
                  <input type="password" className="form-control" placeholder="Leave blank to keep current password" value={form.password} onChange={(e) => setForm((s) => ({ ...s, password: e.target.value }))} />
                </div>

                <div className="col-12 d-flex gap-2 justify-content-end">
                  <button type="button" className="btn btn-secondary" onClick={closeEditor}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
