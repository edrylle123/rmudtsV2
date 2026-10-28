// client/src/login.js
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import axios from "./Components/axios";
import "./login.css";

// Appearance choice is remembered per browser. "glass" = new frosted look,
// "original" = the previous flat/light auth UI.
const UI_KEY = "rmu.loginUi";

const TAGLINES = [
  "Centralized document tracking for RMU offices.",
  "Every movement logged. Every record accounted for.",
  "From intake to archive — one system of record.",
];

const EyeIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
    <path
      d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle
      cx="12"
      cy="12"
      r="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    />
    {off && (
      <path
        d="M4 20 20 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    )}
  </svg>
);

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [form, setForm] = useState({ idNumber: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(location.state?.idleLogout || "");

  // ---- appearance toggle -------------------------------------------------
  const [ui, setUi] = useState(() => {
    try {
      return localStorage.getItem(UI_KEY) === "original" ? "original" : "glass";
    } catch {
      return "glass";
    }
  });
  const chooseUi = (next) => {
    setUi(next);
    try {
      localStorage.setItem(UI_KEY, next);
    } catch {
      /* storage unavailable — choice just won't persist */
    }
  };

  // ---- small interactive touches ----------------------------------------
  const [showPass, setShowPass] = useState(false);
  const [capsOn, setCapsOn] = useState(false);
  const [tIdx, setTIdx] = useState(0);

  const pageRef = useRef(null);
  const btnRef = useRef(null);
  const rafRef = useRef(0);

  // Rotate the tagline so the brand panel is never static.
  useEffect(() => {
    const t = setInterval(() => setTIdx((i) => (i + 1) % TAGLINES.length), 4200);
    return () => clearInterval(t);
  }, []);

  // Cursor spotlight: publish pointer position as CSS vars (rAF-throttled).
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const onPointerMove = (e) => {
    const el = pageRef.current;
    if (!el || rafRef.current) return;
    const { clientX: x, clientY: y } = e;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      el.style.setProperty("--mx", `${x}px`);
      el.style.setProperty("--my", `${y}px`);
    });
  };

  const onRipple = (e) => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const span = document.createElement("span");
    span.className = "auth-ripple";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.appendChild(span);
    span.addEventListener("animationend", () => span.remove(), { once: true });
  };

  const readCaps = (e) => {
    if (typeof e.getModifierState === "function") {
      setCapsOn(e.getModifierState("CapsLock"));
    }
  };

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
    <div
      key={ui}
      ref={pageRef}
      className={`auth-page auth-page--${ui}`}
      onMouseMove={onPointerMove}
    >
      {/* Animated backdrop + cursor spotlight (glass look only) */}
      {ui === "glass" && (
        <div className="auth-glass-bg" aria-hidden="true">
          <span className="auth-orb auth-orb--1" />
          <span className="auth-orb auth-orb--2" />
          <span className="auth-orb auth-orb--3" />
          <div className="auth-grid" />
        </div>
      )}
      <div className="auth-spotlight" aria-hidden="true" />

      {/* Appearance switcher */}
      <div className="auth-ui-toggle" role="group" aria-label="Login appearance">
        <span className={`auth-ui-thumb auth-ui-thumb--${ui}`} aria-hidden="true" />
        <button
          type="button"
          className={ui === "original" ? "is-active" : ""}
          aria-pressed={ui === "original"}
          onClick={() => chooseUi("original")}
        >
          Original
        </button>
        <button
          type="button"
          className={ui === "glass" ? "is-active" : ""}
          aria-pressed={ui === "glass"}
          onClick={() => chooseUi("glass")}
        >
          Glass
        </button>
      </div>

      <div className="auth-brand">
        <div className="auth-brand-inner">
          <img
            src="/rtms.png"
            alt="RMU logo"
            className="auth-logo auth-anim"
            style={{ animationDelay: "0ms" }}
          />
          <h1 className="auth-anim" style={{ animationDelay: "90ms" }}>
            Records Management Unit
          </h1>
          <p className="auth-tagline auth-anim" style={{ animationDelay: "160ms" }}>
            <span key={tIdx} className="auth-tagline-swap">
              {TAGLINES[tIdx]}
            </span>
          </p>
          <ul className="auth-features">
            {[
              "Track documents across offices",
              "Secure role-based access",
              "Automatic control numbers & QR codes",
            ].map((f, i) => (
              <li
                key={f}
                className="auth-anim"
                style={{ animationDelay: `${240 + i * 90}ms` }}
              >
                <span className="feat-dot" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="auth-form-side">
        <div className="auth-card auth-anim" style={{ animationDelay: "140ms" }}>
          <h2>Welcome back</h2>
          <p className="auth-sub">Sign in to your account to continue.</p>

          {err && (
            <div className="auth-error-box" role="alert">
              {err}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className={`auth-field ${form.idNumber.trim() ? "is-filled" : ""}`}>
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

            <div className={`auth-field ${form.password ? "is-filled" : ""}`}>
              <label htmlFor="auth-pass">Password</label>
              <div className="auth-pass-wrap">
                <input
                  id="auth-pass"
                  type={showPass ? "text" : "password"}
                  name="password"
                  value={form.password}
                  onChange={onChange}
                  onKeyDown={readCaps}
                  onKeyUp={readCaps}
                  onBlur={() => setCapsOn(false)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="auth-pass-toggle"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  title={showPass ? "Hide password" : "Show password"}
                >
                  <EyeIcon off={showPass} />
                </button>
              </div>
              {capsOn && (
                <div className="auth-hint auth-hint--caps">
                  Caps Lock is on.
                </div>
              )}
            </div>

            <button
              ref={btnRef}
              className="auth-btn"
              type="submit"
              disabled={loading}
              onMouseDown={onRipple}
            >
              {loading ? (
                <>
                  <span className="auth-spinner" aria-hidden="true" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <span className="auth-btn-arrow" aria-hidden="true">
                    →
                  </span>
                </>
              )}
            </button>
          </form>

          <p className="auth-foot">
            {/* <Link to="/signup">Forgotten username or password?</Link> */}
          </p>
        </div>
      </div>
    </div>
  );
}
