// client/src/login.js
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "./AuthContext";
import axios from "./Components/axios";
import "./login.css";

export default function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [form, setForm] = useState({ idNumber: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const onChange = (e) => {
    const { name, value } = e.target;
    setForm((s) => ({ ...s, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr("");

    if (!form.idNumber.trim() || !form.password.trim()) {
      setErr("ID Number and password are required.");
      return;
    }

    try {
      setLoading(true);
      const res = await axios.post("/login", {
        idnumber: form.idNumber,
        password: form.password,
      });

      // Expected server response:
      // { success:true, token, refreshToken, user: { id, name, email, role, office, idnumber? } }
      const { token, refreshToken, user } = res.data || {};

      if (!token || !user) {
        throw new Error("Malformed server response.");
      }

      // Store tokens & user (AuthContext will also persist)
      login(user, token, refreshToken);

      // extra convenience keys for Navbar, etc.
      localStorage.setItem("userIdNumber", user.idnumber || "");
      localStorage.setItem("userRole", user.role || "");
      localStorage.setItem("userOffice", user.office || "");

      // redirect based on role
      const role = (user.role || "").toLowerCase();
      if (role === "admin" || role === "super_admin") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/user-dashboard", { replace: true });
      }
    } catch (error) {
      // Helpful error messages
      if (error.response) {
        // Server responded with a status code
        const msg =
          error.response.data?.message ||
          error.response.data?.error ||
          `Login failed (HTTP ${error.response.status}).`;
        setErr(msg);
        console.error("Login error (response):", error.response);
      } else if (error.request) {
        // No response received
        setErr(
          "Cannot reach the server. Is the backend running on http://localhost:8081?"
        );
        console.error("Login error (no response):", error.request);
      } else {
        // Something else
        setErr(error.message || "Unexpected error during login.");
        console.error("Login error:", error);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <div className="auth-brand-inner">
          <img src="/rtms.png" alt="RMU logo" className="auth-logo" />
          <h1>Records Management Unit</h1>
          <p className="auth-tagline">
            Centralized document tracking for RMU offices.
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
          <h2>Welcome back</h2>
          <p className="auth-sub">Sign in to your account to continue.</p>

          {err && <div className="auth-error-box">{err}</div>}

          <form onSubmit={handleSubmit}>
            <div className="auth-field">
              <label htmlFor="auth-id">ID Number</label>
              <input
                id="auth-id"
                type="text"
                name="idNumber"
                value={form.idNumber}
                onChange={onChange}
                placeholder="Enter your ID number"
                autoComplete="username"
                required
              />
            </div>

            <div className="auth-field">
              <label htmlFor="auth-pass">Password</label>
              <input
                id="auth-pass"
                type="password"
                name="password"
                value={form.password}
                onChange={onChange}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
            </div>

            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="auth-foot">
            <Link to="/signup">Forgotten username or password?</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
