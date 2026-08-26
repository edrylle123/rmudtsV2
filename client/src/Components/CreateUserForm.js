// src/Components/CreateUserForm.js
import React, { useState } from "react";
import "./CreateUserForm.css";
import axios from "./axios";
import useOffices from "../utils/useOffices";

export default function CreateUserForm() {
  const { offices: OFFICES } = useOffices();
  const [formData, setFormData] = useState({
    name: "",
    // email: "",
    idnumber: "", 
    password: "",
    role: "user",
    office: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((s) => ({ ...s, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await axios.post("/signup", formData);
      alert("User created successfully!");
      setFormData({ name: "", password: "", role: "user", office: "" , idnumber: ""});
    } catch (err) {
      console.error(err);
      const msg = err.response?.data?.message || "Error creating user";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () =>
    setFormData({ name: "", password: "", role: "user", office: "" , idnumber: ""});

  return (
    <form onSubmit={handleSubmit} className="row g-3">
      {error && <div className="alert alert-danger">{error}</div>}

      <div className="col-md-6">
        <label className="form-label">Full Name *</label>
        <input
          type="text"
          name="name"
          className="form-control"
          value={formData.name}
          onChange={handleChange}
          required
        />
      </div>

      <div className="col-md-6">
        <label className="form-label">ID Number *</label>
        <input
          type="text"
          name="idnumber"
          className="form-control"
          value={formData.idnumber}
          onChange={handleChange}
          required
        />
      </div>

      <div className="col-md-6">
        <label className="form-label">Password *</label>
        <input
          type="password"
          name="password"
          className="form-control"
          value={formData.password}
          onChange={handleChange}
          required
        />
      </div>

      <div className="col-md-6">
        <label className="form-label">Role *</label>
        <select
          name="role"
          className="form-select"
          value={formData.role}
          onChange={handleChange}
        >
          <option value="user">Office Secretary</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      <div className="col-md-12">
        <label className="form-label">Office *</label>
        <select
          name="office"
          className="form-select"
          value={formData.office}
          onChange={handleChange}
          required
        >
          <option value="">-- Choose an Office --</option>
          {OFFICES.map((office) => (
            <option key={office} value={office}>
              {office}
            </option>
          ))}
        </select>
      </div>

      <div className="col-12 d-flex gap-2">
        <button type="button" className="btn btn-secondary" onClick={resetForm}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Creating…" : "Create User"}
        </button>
      </div>
    </form>
  );
}
