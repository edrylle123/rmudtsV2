import React, { useEffect, useState, useCallback } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { FaPlus, FaEdit, FaTrashAlt, FaSave, FaTimes } from "react-icons/fa";
import "./Dashboard.css";

const CATEGORIES = [
  { key: "classification", label: "Classification", icon: "📁" },
  { key: "priority", label: "Priority", icon: "⚡" },
  { key: "office_requestor", label: "Office/Requestor", icon: "🏢" },
  { key: "concerned_personnel", label: "Concerned Personnel", icon: "👤" },
];

export default function DropdownManagement() {
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("classification");
  const [newValues, setNewValues] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
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

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  const filtered = options.filter((o) => o.category === activeCategory);

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

  const handleUpdate = async (id) => {
    if (!editValue.trim()) return alert("Value cannot be empty.");
    try {
      await axios.put(`/api/admin/dropdown-options/${id}`, { value: editValue.trim() });
      setEditingId(null);
      setEditValue("");
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

  const activeCat = CATEGORIES.find((c) => c.key === activeCategory);

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid p-3">
          <h4 className="mb-3">⚙️ Dropdown Options Management</h4>
          <p className="text-muted mb-3">
            Manage the options that appear in record creation forms across the system.
            Changes apply to all users immediately.
          </p>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="d-flex gap-3">
            {/* Category tabs */}
            <div style={{ minWidth: '220px' }}>
              {CATEGORIES.map((cat) => {
                const count = options.filter((o) => o.category === cat.key).length;
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
            <div className="flex-grow-1">
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
                  placeholder={`Add new ${activeCat?.label} option...`}
                  value={newValues[activeCategory] || ""}
                  onChange={(e) =>
                    setNewValues((prev) => ({
                      ...prev,
                      [activeCategory]: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd(activeCategory);
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => handleAdd(activeCategory)}
                >
                  <FaPlus className="me-1" /> Add
                </button>
              </div>

              {loading ? (
                <div className="status">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="text-muted p-3">No options for this category yet.</div>
              ) : (
                <div className="list-group">
                  {filtered.map((opt) => (
                    <div
                      key={opt.id}
                      className="list-group-item d-flex justify-content-between align-items-center"
                    >
                      {editingId === opt.id ? (
                        <div className="d-flex gap-2 flex-grow-1">
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleUpdate(opt.id);
                              if (e.key === "Escape") {
                                setEditingId(null);
                                setEditValue("");
                              }
                            }}
                            autoFocus
                          />
                          <button
                            className="btn btn-sm btn-success"
                            onClick={() => handleUpdate(opt.id)}
                            title="Save"
                          >
                            <FaSave />
                          </button>
                          <button
                            className="btn btn-sm btn-secondary"
                            onClick={() => {
                              setEditingId(null);
                              setEditValue("");
                            }}
                            title="Cancel"
                          >
                            <FaTimes />
                          </button>
                        </div>
                      ) : (
                        <>
                          <span>{opt.value}</span>
                          <div className="d-flex gap-1">
                            <button
                              className="btn btn-sm btn-outline-primary"
                              title="Edit"
                              onClick={() => {
                                setEditingId(opt.id);
                                setEditValue(opt.value);
                              }}
                            >
                              <FaEdit />
                            </button>
                            <button
                              className="btn btn-sm btn-outline-danger"
                              title="Delete"
                              onClick={() => handleDelete(opt.id, opt.value)}
                            >
                              <FaTrashAlt />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
