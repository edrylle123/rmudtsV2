// src/AuthContext.js
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  getStoredUser,
  refreshToken,
  clearAuth,
  isTokenExpired,
} from "./utils/auth";

const AuthContext = createContext(null);

// ===== Auto-logout on inactivity =====
const INACTIVITY_TIMEOUT_MIN = 15; // minutes of inactivity before auto-logout
const INACTIVITY_WARNING_SEC = 60; // show countdown warning N seconds before logout
const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "scroll",
  "touchstart",
  "click",
  "wheel",
];

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  // ===== Inactivity auto-logout state =====
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(null); // null = hidden
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    if (!user) return undefined; // only track while a user is logged in

    lastActivityRef.current = Date.now();
    setIdleSecondsLeft(null);

    const markActivity = () => {
      lastActivityRef.current = Date.now();
      setIdleSecondsLeft((prev) => (prev === null ? prev : null)); // dismiss warning
    };

    ACTIVITY_EVENTS.forEach((evt) =>
      window.addEventListener(evt, markActivity, { passive: true })
    );

    const limitMs = INACTIVITY_TIMEOUT_MIN * 60 * 1000;
    const idleChecker = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      const remainingSec = Math.max(0, Math.ceil((limitMs - idleMs) / 1000));

      if (remainingSec <= 0) {
        // Inactive too long — force logout
        clearInterval(idleChecker);
        clearAuth();
        setUser(null);
        setIdleSecondsLeft(null);
        navigate("/", {
          replace: true,
          state: { idleLogout: "You were logged out due to inactivity." },
        });
      } else if (remainingSec <= INACTIVITY_WARNING_SEC) {
        setIdleSecondsLeft(remainingSec);
      } else {
        setIdleSecondsLeft((prev) => (prev !== null ? null : prev));
      }
    }, 1000);

    return () => {
      clearInterval(idleChecker);
      ACTIVITY_EVENTS.forEach((evt) =>
        window.removeEventListener(evt, markActivity)
      );
    };
  }, [user, navigate]);

const syncUserKeys = (userData) => {
  if (!userData) return;
  localStorage.setItem("user", JSON.stringify(userData));
  localStorage.setItem("userEmail", userData.email || "");
  localStorage.setItem("userRole", userData.role || "");
  localStorage.setItem("userName", userData.name || "");
  localStorage.setItem("userIdNumber", userData.idnumber || "");
  localStorage.setItem("userOffice", userData.office || "");
};

useEffect(() => {
  (async () => {
    const storedUser = getStoredUser();
    if (storedUser) {
      setUser(storedUser);
      // keep LS convenience keys in sync for UI that still reads them
      syncUserKeys(storedUser);
      setLoading(false);
      return;
    }
    if (isTokenExpired()) {
      const refreshed = await refreshToken();
      if (refreshed) {
        setUser(refreshed);
        syncUserKeys(refreshed);
      } else {
        clearAuth();
      }
    }
    setLoading(false);
  })();
}, []);

 const login = useCallback((userData, accessToken, refreshTok) => {
  if (accessToken) localStorage.setItem("token", accessToken);
  if (refreshTok) localStorage.setItem("refreshToken", refreshTok);
  if (userData) {
    syncUserKeys(userData);
  }
  setUser(userData ?? null);
}, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
    navigate("/", { replace: true });
  }, [navigate]);

  const value = useMemo(
    () => ({ user, login, logout, loading }),
    [user, loading, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
      {idleSecondsLeft !== null && (
        <div className="idle-warning-overlay">
          <div className="idle-warning-box">
            <div className="idle-warning-icon">⏳</div>
            <h5 className="idle-warning-title">Are you still there?</h5>
            <p className="idle-warning-text">
              You have been inactive. You will be logged out in{" "}
              <strong>{idleSecondsLeft}</strong> second
              {idleSecondsLeft === 1 ? "" : "s"}.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-sm idle-warning-btn"
              onClick={() => {
                lastActivityRef.current = Date.now();
                setIdleSecondsLeft(null);
              }}
            >
              Stay logged in
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}
