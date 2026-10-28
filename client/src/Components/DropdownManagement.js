import React, { useEffect, useState, useCallback } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { FaPlus, FaEdit, FaTrashAlt } from "react-icons/fa";
import "./Dashboard.css";
import "./DropdownManagement.css";

const CATEGORIES = [
  { key: "classification", label: "Classification", icon: "📁" },
  { key: "priority", label: "Priority", icon: "⚡" },
  { key: "concerned_personnel", label: "Concerned Personnel", icon: "👤" },
  { key: "destination_office", label: "Destination Office", icon: "🏛", source: "offices" },
  { key: "office_requestor", label: "Office/Requestor", icon: "🏢" },
];

export default function DropdownManagement() {
  const [options, setOptions] = useState([]);
  const [offices, setOffices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("classification");
  const [newValues, setNewValues] = useState({});
  const [error, setError] = useState(null);

  const loadOptions = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get("/api/admin/dropdown-options");
      setOptions(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      console.error("Load options error:", e);
      setError("Failed to load options");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOffices = useCallback(async () => {
    try {
      const res = await axios.get("/api/admin/offices");
      setOffices(Array.isArray(res.data) ? res.data : []);
      setError(null);
    } catch (e) {
      console.error("Load offices error:", e);
      setError("Failed to load offices");
    }
  }, []);

  useEffect(() => {
    loadOptions();
    loadOffices();
  }, [loadOptions, loadOffices]);

  // Destination Office is not a free-text option list — it IS the offices table
  // (the same data the Office Management page edits), so both pages stay in sync
  // and the record form picks up new offices immediately.
  const isOfficeTab = activeCategory === "destination_office";

  const filtered = options.filter((o) => o.category === activeCategory);

  const countFor = (cat) =>
    cat.source === "offices"
      ? offices.length
      : options.filter((o) => o.category === cat.key).length;

  const handleAdd = async (category) => {
    const value = (newValues[category] || "").trim();
    if (!value) return alert("Please enter a value.");
    try {
      await axios.post("/api/admin/dropdown-options", { category, value });
      setNewValues((prev) => ({ ...prev, [category]: "" }));
      loadOptions();
    } catch (e) {
      const msg = e?.response?.data?.error || "Failed to add option";
      alert(msg);
    }
  };

  const handleUpdate = async (id, value) => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return alert("Value cannot be empty.");
    try {
      await axios.put(`/api/admin/dropdown-options/${id}`, { value: trimmed });
      loadOptions();
    } catch (e) {
      const msg = e?.response?.data?.error || "Failed to update option";
      alert(msg);
    }
  };

  const handleDelete = async (id, value) => {
    if (!window.confirm(`Delete "${value}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/admin/dropdown-options/${id}`);
      loadOptions();
    } catch (e) {
      alert("Failed to delete option");
    }
  };

  // --- Destination Office (offices table) ---
  const handleAddOffice = async (name) => {
    const value = (name || "").trim();
    if (!value) return alert("Please enter an office name.");
    try {
      await axios.post("/api/admin/offices", { name: value });
      setNewValues((prev) => ({ ...prev, destination_office: "" }));
      loadOffices();
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to add office");
    }
  };

  const handleUpdateOffice = async (id, name) => {
    const value = (name || "").trim();
    if (!value) return alert("Office name cannot be empty.");
    try {
      await axios.put(`/api/admin/offices/${id}`, { name: value });
      loadOffices();
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to update office");
    }
  };

  const handleDeleteOffice = async (id, name) => {
    if (!id) return alert("This office comes from a user account and cannot be deleted here.");
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      await axios.delete(`/api/admin/offices/${id}`);
      loadOffices();
    } catch (e) {
      alert(e?.response?.data?.message || "Failed to delete office");
    }
  };

  const submitNew = () =>
    isOfficeTab
      ? handleAddOffice(newValues.destination_office)
      : handleAdd(activeCategory);

  // Renaming happens in a small prompt — the list itself has no edit field.
  const promptRename = async (opt) => {
    const next = window.prompt("Rename to:", opt.value);
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    if (!trimmed || trimmed === String(opt.value || "").trim()) return;
    if (isOfficeTab) {
      await handleUpdateOffice(opt.id, trimmed);
    } else {
      await handleUpdate(opt.id, trimmed);
    }
  };

  const removeItem = (id, value) =>
    isOfficeTab ? handleDeleteOffice(id, value) : handleDelete(id, value);

  const activeCat = CATEGORIES.find((c) => c.key === activeCategory);

  // Unified list for both dropdown options and offices.
  const listItems = isOfficeTab
    ? offices.map((o) => ({ id: o.id, value: o.name, locked: !o.id }))
    : filtered.map((o) => ({ id: o.id, value: o.value, locked: false }));

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid p-3">
          <h4 className="mb-3">⚙️ Dropdown Options Management</h4>
          <p className="text-muted mb-3">
            Manage the options that appear in record creation forms across the system.
            Changes apply to all users immediately. Destination Office edits the same
            list as Office Management, so both stay in sync.
          </p>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="d-flex gap-3 dm-layout">
            {/* Category tabs */}
            <div className="dm-categories">
              {CATEGORIES.map((cat) => {
                const count = countFor(cat);
                return (
                  <button
                    key={cat.key}
                    className={`w-100 text-start mb-2 p-3 rounded border-0 ${
                      activeCategory === cat.key
                        ? "bg-primary text-white"
                        : "bg-light"
                    }`}
                    style={{ cursor: "pointer", transition: "all 0.15s" }}
                    onClick={() => setActiveCategory(cat.key)}
                  >
                    <span className="me-2">{cat.icon}</span>
                    <strong>{cat.label}</strong>
                    <span
                      className={`badge float-end ${
                        activeCategory === cat.key ? "bg-white text-primary" : "bg-secondary text-white"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Options list */}
            <div className="grow-col">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h5 className="mb-0">
                  {activeCat?.icon} {activeCat?.label} Options
                </h5>
              </div>

              {/* Add new option */}
              <div className="input-group mb-3">
                <input
                  type="text"
                  className="form-control"
                  placeholder={
                    activeCategory === "concerned_personnel"
                      ? "Add new person — Last Name, First Name M.I."
                      : `Add new ${activeCat?.label}${isOfficeTab ? "" : " option"}...`
                  }
                  value={newValues[activeCategory] || ""}
                  onChange={(e) =>
                    setNewValues((prev) => ({
                      ...prev,
                      [activeCategory]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNew();
                  }}
                />
                <button className="btn btn-primary" onClick={submitNew}>
                  <FaPlus className="me-1" /> Add
                </button>
              </div>

              {loading ? (
                <div className="status">Loading…</div>
              ) : listItems.length === 0 ? (
                <div className="text-muted p-3">No options for this category yet.</div>
              ) : (
                <div className="dropdown-list-scroll">
                <div className="list-group">
                  {listItems.map((opt) => (
                    <div
                      key={opt.id}
                      className="list-group-item d-flex justify-content-between align-items-center"
                    >
                      <span>
                        {opt.value}
                        {opt.locked && (
                          <span
                            className="badge bg-secondary ms-2"
                            title="This office is assigned to a user account — manage it from Office Management"
                          >
                            user-assigned
                          </span>
                        )}
                      </span>
                      <div className="d-flex gap-1">
                        {!opt.locked && (
                          <button
                            className="btn btn-sm btn-outline-primary"
                            title="Rename"
                            onClick={() => promptRename(opt)}
                          >
                            <FaEdit />
                          </button>
                        )}
                        <button
                          className="btn btn-sm btn-outline-danger"
                          title="Delete"
                          onClick={() => removeItem(opt.id, opt.value)}
                        >
                          <FaTrashAlt />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
