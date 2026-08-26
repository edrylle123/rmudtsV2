// src/Signup.js
import React, { useState } from "react";
import axios from "./Components/axios";
import { useNavigate, Link } from "react-router-dom";
import useOffices from "./utils/useOffices";
import "./login.css";

function validate(values) {
  const errors = {};
  if (!values.name) errors.name = "Full name is required";
  if (!values.idnumber) errors.idnumber = "ID number is required";
  if (!values.password) errors.password = "Password is required";
  if (!values.role || values.role === "Select Role")
    errors.role = "Please select a role";
  if (!values.office) errors.office = "Office is required";
  return errors;
}

export default function Signup() {
  const { offices: OFFICES } = useOffices();
  const [values, setValues] = useState({
    name: "",
    role: "user",
    idnumber: "",
    email: "",
    password: "",
    office: "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const handleInput = (e) => {
    const { name, value } = e.target;
    setValues((p) => ({ ...p, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const validationErrors = validate(values);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) return;

    try {
      setSaving(true);
      const res = await axios.post("/signup", values);
      if (res.data && res.data.success) {
        alert("Account Created Successfully");
        navigate("/");
      } else {
        setError(res.data?.message || "Signup failed");
      }
    } catch (err) {
      console.error("Signup error:", err.response || err);
      setError(err.response?.data?.message || "Error creating account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-inner">
          <img src="/rtms.png" alt="RMU logo" className="auth-logo" />
          <h1>Records Management Unit</h1>
          <p className="auth-tagline">
            Create an account to start tracking documents.
          </p>
          <ul className="auth-features">
            <li>
              <span className="feat-dot" /> Track documents across offices
            </li>
            <li>
              <span className="feat-dot" /> Secure role-based access
            </li>
            <li>
              <span className="feat-dot" /> Automatic control numbers &amp; QR
              codes
            </li>
          </ul>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card">
          <h2>Create account</h2>
          <p className="auth-sub">Fill in your details to get started.</p>

          {error && <div className="auth-error-box">{error}</div>}

          <form onSubmit={handleSubmit} noValidate>
            {/* Full Name */}
            <div className="auth-field">
              <label htmlFor="su-name">Full Name</label>
              <input
                id="su-name"
                type="text"
                name="name"
                value={values.name}
                onChange={handleInput}
                placeholder="Enter your full name"
              />
              {errors.name && (
                <div className="text-danger small mt-1">{errors.name}</div>
              )}
            </div>

            {/* Role */}
            <div className="auth-field">
              <label htmlFor="su-role">Role</label>
              <select
                id="su-role"
                name="role"
                value={values.role}
                onChange={handleInput}
              >
                <option value="user">Office Secretary</option>
                <option value="admin">Admin</option>
              </select>
              {errors.role && (
                <div className="text-danger small mt-1">{errors.role}</div>
              )}
            </div>

            {/* Office */}
            <div className="auth-field">
              <label htmlFor="su-office">Office</label>
              <select
                id="su-office"
                name="office"
                value={values.office}
                onChange={handleInput}
              >
                <option value="">-- Choose an Office --</option>
                {OFFICES.map((office) => (
                  <option key={office} value={office}>
                    {office}
                  </option>
                ))}
              </select>
              {errors.office && (
                <div className="text-danger small mt-1">{errors.office}</div>
              )}
            </div>

            {/* Email */}
            <div className="auth-field">
              <label htmlFor="su-email">Email</label>
              <input
                id="su-email"
                type="email"
                name="email"
                value={values.email}
                onChange={handleInput}
                placeholder="Enter your email"
              />
              {errors.email && (
                <div className="text-danger small mt-1">{errors.email}</div>
              )}
            </div>

            {/* Password */}
            <div className="auth-field">
              <label htmlFor="su-pass">Password</label>
              <input
                id="su-pass"
                type="password"
                name="password"
                value={values.password}
                onChange={handleInput}
                placeholder="Enter your password"
              />
              {errors.password && (
                <div className="text-danger small mt-1">{errors.password}</div>
              )}
            </div>

            {/* ID Number */}
            <div className="auth-field">
              <label htmlFor="su-id">ID Number</label>
              <input
                id="su-id"
                type="text"
                name="idnumber"
                value={values.idnumber}
                onChange={handleInput}
                placeholder="Enter your ID number"
              />
              {errors.idnumber && (
                <div className="text-danger small mt-1">{errors.idnumber}</div>
              )}
            </div>

            <button className="auth-btn" type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create Account"}
            </button>
          </form>

          <p className="auth-foot">
            Already have an account? <Link to="/">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
