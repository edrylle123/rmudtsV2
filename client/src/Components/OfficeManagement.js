import React, { useState, useEffect, useRef, useCallback } from "react";
import axios from "./axios";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import {
  FaBuilding,
  FaPlus,
  FaTrash,
  FaCheckCircle,
  FaExclamationCircle,
  FaEdit,
  FaSave,
  FaTimes,
  FaSearch,
  FaUsers,
  FaUserPlus,
  FaUserMinus,
  FaTimesCircle,
} from "react-icons/fa";
import "./OfficeManagement.css";

// Sentinel value — never matches any real office.id
const NONE = "__none__";

const OfficeManagement = () => {
  const [offices, setOffices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newOffice, setNewOffice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: "", text: "" });
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(NONE);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const editInputRef = useRef(null);

  // Member management state
  const [membersOffice, setMembersOffice] = useState(null);
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [unassignedUsers, setUnassignedUsers] = useState([]);
  const [assigningUserId, setAssigningUserId] = useState("");
  const [assigning, setAssigning] = useState(false);

  const fetchOffices = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get("/api/admin/offices");
      setOffices(res.data);
    } catch (err) {
      console.error("Failed to fetch offices:", err);
      setMessage({ type: "error", text: "Failed to load offices." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOffices();
  }, [fetchOffices]);

  useEffect(() => {
    if (editingId !== NONE && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // --- Add office ---
  const handleAdd = async (e) => {
    e.preventDefault();
    const trimmed = newOffice.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setMessage({ type: "", text: "" });
    try {
      const res = await axios.post("/api/admin/offices", { name: trimmed });
      if (res.data.success) {
        setNewOffice("");
        setMessage({ type: "success", text: `"${trimmed}" added successfully.` });
        fetchOffices();
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to add office.";
      setMessage({ type: "error", text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // --- Edit office ---
  const startEdit = (office) => {
    setEditingId(office.id);
    setEditName(office.name);
    setMessage({ type: "", text: "" });
  };

  const cancelEdit = () => {
    setEditingId(NONE);
    setEditName("");
  };

  const saveEdit = async (office) => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === office.name) {
      cancelEdit();
      return;
    }
    setSavingEdit(true);
    setMessage({ type: "", text: "" });
    try {
      const res = await axios.put(`/api/admin/offices/${office.id}`, { name: trimmed });
      if (res.data.success) {
        setMessage({ type: "success", text: `Office renamed to "${trimmed}".` });
        setEditingId(NONE);
        setEditName("");
        fetchOffices();
      }
    } catch (err) {
      const msg = err.response?.data?.message || "Failed to rename office.";
      setMessage({ type: "error", text: msg });
    } finally {
      setSavingEdit(false);
    }
  };

  const handleEditKeyDown = (e, office) => {
    if (e.key === "Enter") saveEdit(office);
    if (e.key === "Escape") cancelEdit();
  };

  // --- Delete office ---
  const handleDelete = async (office) => {
    if (!office.id) {
      setMessage({
        type: "error",
        text: "This office is assigned to users and cannot be deleted.",
      });
      return;
    }
    if (!window.confirm(`Delete office "${office.name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/admin/offices/${office.id}`);
      setMessage({ type: "success", text: `"${office.name}" deleted.` });
      fetchOffices();
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to delete." });
    }
  };

  // --- Member management ---
  const openMembers = async (office) => {
    setMembersOffice(office);
    setMembers([]);
    setUnassignedUsers([]);
    setAssigningUserId("");
    setMembersLoading(true);
    try {
      let officeId = office.id;
      if (!officeId) {
        const usersRes = await axios.get("/users");
        const allUsers = Array.isArray(usersRes.data) ? usersRes.data : [];
        const matched = allUsers.filter(
          (u) => (u.office || "").trim().toLowerCase() === office.name.trim().toLowerCase()
        );
        setMembers(matched);
        setMembersLoading(false);
        return;
      }
      const membersRes = await axios.get(`/api/admin/offices/${officeId}/users`);
      setMembers(Array.isArray(membersRes.data) ? membersRes.data : []);

      try {
        const unRes = await axios.get("/api/admin/users/unassigned");
        setUnassignedUsers(Array.isArray(unRes.data) ? unRes.data : []);
      } catch {
        const usersRes = await axios.get("/users");
        const allUsers = Array.isArray(usersRes.data) ? usersRes.data : [];
        const assignedIds = new Set((membersRes.data || []).map((u) => u.id));
        setUnassignedUsers(allUsers.filter((u) => !assignedIds.has(u.id)));
      }
    } catch (err) {
      console.error("Failed to load members:", err);
      setMessage({ type: "error", text: "Failed to load office members." });
    } finally {
      setMembersLoading(false);
    }
  };

  const closeMembers = () => {
    setMembersOffice(null);
    setMembers([]);
    setUnassignedUsers([]);
    setAssigningUserId("");
  };

  const assignUser = async () => {
    if (!assigningUserId || !membersOffice?.id) return;
    setAssigning(true);
    try {
      await axios.put(`/api/admin/offices/${membersOffice.id}/assign`, {
        userId: parseInt(assigningUserId, 10),
      });
      setAssigningUserId("");
      openMembers(membersOffice);
      fetchOffices();
      setMessage({ type: "success", text: "User assigned to office." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to assign user." });
    } finally {
      setAssigning(false);
    }
  };

  const unassignUser = async (userId) => {
    if (!membersOffice?.id) return;
    if (!window.confirm("Remove this user from the office?")) return;
    try {
      await axios.put(`/api/admin/offices/${membersOffice.id}/unassign`, { userId });
      openMembers(membersOffice);
      fetchOffices();
      setMessage({ type: "success", text: "User removed from office." });
    } catch (err) {
      setMessage({ type: "error", text: err.response?.data?.message || "Failed to remove user." });
    }
  };

  const filtered = offices.filter((o) => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="om-page container-fluid p-3 p-md-4">
          {/* Header */}
          <div className="om-header">
            <div className="om-header-left">
              <FaBuilding className="om-header-icon" />
              <div>
                <h2 className="om-title">Office Management</h2>
                <p className="om-subtitle">
                  Manage offices used for document routing. Click <FaEdit style={{ fontSize: "0.7rem", verticalAlign: "middle" }} /> to rename, <FaUsers style={{ fontSize: "0.7rem", verticalAlign: "middle" }} /> to manage members.
                </p>
              </div>
            </div>
          </div>

          {/* Alert */}
          {message.text && (
            <div className={`om-alert ${message.type === "success" ? "om-alert-success" : "om-alert-error"}`}>
              {message.type === "success" ? <FaCheckCircle /> : <FaExclamationCircle />}
              <span>{message.text}</span>
              <button className="om-alert-close" onClick={() => setMessage({ type: "", text: "" })}>
                &times;
              </button>
            </div>
          )}

          {/* Add form + search */}
          <div className="om-toolbar">
            <form onSubmit={handleAdd} className="om-add-form">
              <input
                type="text"
                className="om-input"
                placeholder="Enter new office name..."
                value={newOffice}
                onChange={(e) => setNewOffice(e.target.value)}
                disabled={submitting}
              />
              <button
                type="submit"
                className="om-btn om-btn-primary"
                disabled={submitting || !newOffice.trim()}
              >
                <FaPlus /> {submitting ? "Adding..." : "Add Office"}
              </button>
            </form>
            <div className="om-search-bar">
              <FaSearch className="om-search-icon" />
              <input
                type="text"
                className="om-search-input"
                placeholder="Search offices..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="om-search-clear" onClick={() => setSearch("")}>
                  &times;
                </button>
              )}
            </div>
          </div>

          {/* Office table */}
          <div className="om-office-list">
            {loading ? (
              <div className="om-loading">Loading offices...</div>
            ) : filtered.length === 0 ? (
              <div className="om-empty">
                <FaBuilding size={48} />
                <p>{search ? "No offices match your search." : "No offices found. Add one above."}</p>
              </div>
            ) : (
              <div className="om-table-wrap">
                <table className="om-table">
                  <thead>
                    <tr>
                      <th className="om-th-name">Office Name</th>
                      <th className="om-th-type">Type</th>
                      <th className="om-th-date">Date Added</th>
                      <th className="om-th-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((office) => (
                      <tr
                        key={office.name}
                        className={office.source === "user" ? "om-row-user" : ""}
                      >
                        <td className="om-td-name">
                          {editingId === office.id ? (
                            <input
                              ref={editInputRef}
                              type="text"
                              className="om-edit-input-inline"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              onKeyDown={(e) => handleEditKeyDown(e, office)}
                              disabled={savingEdit}
                            />
                          ) : (
                            <span className="om-office-name-text">{office.name}</span>
                          )}
                        </td>
                        <td>
                          {office.source === "user" ? (
                            <span className="om-badge om-badge-user">User-assigned</span>
                          ) : (
                            <span className="om-badge om-badge-db">Registered</span>
                          )}
                        </td>
                        <td className="om-td-date">
                          {office.created_at
                            ? new Date(office.created_at).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="om-td-actions">
                          {editingId === office.id ? (
                            <>
                              <button
                                className="om-btn om-btn-save om-btn-xs"
                                onClick={() => saveEdit(office)}
                                disabled={savingEdit || !editName.trim()}
                                title="Save"
                              >
                                <FaSave /> Save
                              </button>
                              <button
                                className="om-btn om-btn-cancel om-btn-xs"
                                onClick={cancelEdit}
                                disabled={savingEdit}
                              >
                                <FaTimes /> Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              {office.id && (
                                <>
                                  <button
                                    className="om-btn om-btn-members om-btn-xs"
                                    onClick={() => openMembers(office)}
                                    title="Manage members"
                                  >
                                    <FaUsers /> Members
                                  </button>
                                  <button
                                    className="om-btn om-btn-edit om-btn-xs"
                                    onClick={() => startEdit(office)}
                                    title="Rename"
                                  >
                                    <FaEdit />
                                  </button>
                                </>
                              )}
                              <button
                                className="om-btn om-btn-delete om-btn-xs"
                                onClick={() => handleDelete(office)}
                                title={office.id ? "Delete office" : "Cannot delete"}
                                disabled={!office.id}
                              >
                                <FaTrash />
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {!loading && (
              <div className="om-office-count">
                Showing <strong>{filtered.length}</strong> of <strong>{offices.length}</strong> offices
              </div>
            )}
          </div>
        </div>
      </div>

      {/* === Members Modal === */}
      {membersOffice && (
        <div className="om-modal-overlay" onClick={closeMembers}>
          <div className="om-modal" onClick={(e) => e.stopPropagation()}>
            <div className="om-modal-header">
              <div className="om-modal-title">
                <FaUsers />
                <h3>Members of {membersOffice.name}</h3>
              </div>
              <button className="om-modal-close" onClick={closeMembers}>
                <FaTimesCircle />
              </button>
            </div>

            <div className="om-modal-body">
              {/* Assign form */}
              {membersOffice.id && (
                <div className="om-assign-section">
                  <FaUserPlus className="om-assign-icon" />
                  <select
                    className="om-assign-select"
                    value={assigningUserId}
                    onChange={(e) => setAssigningUserId(e.target.value)}
                  >
                    <option value="">Select a user to add...</option>
                    {unassignedUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.idnumber})
                      </option>
                    ))}
                  </select>
                  <button
                    className="om-btn om-btn-primary om-btn-sm"
                    disabled={!assigningUserId || assigning}
                    onClick={assignUser}
                  >
                    {assigning ? "Assigning..." : "Add"}
                  </button>
                </div>
              )}

              {/* Members list */}
              {membersLoading ? (
                <div className="om-modal-loading">Loading members...</div>
              ) : members.length === 0 ? (
                <div className="om-modal-empty">
                  <FaUsers size={36} />
                  <p>No users are currently assigned to this office.</p>
                </div>
              ) : (
                <div className="om-members-list">
                  {members.map((u) => (
                    <div key={u.id} className="om-member-row">
                      <div className="om-member-avatar">
                        {(u.name || "U")
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="om-member-info">
                        <span className="om-member-name">{u.name}</span>
                        <span className="om-member-detail">
                          {u.idnumber} &middot; {u.role || "user"}
                        </span>
                      </div>
                      {membersOffice.id && (
                        <button
                          className="om-btn om-btn-unassign"
                          onClick={() => unassignUser(u.id)}
                          title="Remove from office"
                        >
                          <FaUserMinus /> Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="om-modal-footer">
              <button className="om-btn om-btn-cancel" onClick={closeMembers}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OfficeManagement;
