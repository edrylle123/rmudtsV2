// client/src/utils/auth.js
import { jwtDecode } from "jwt-decode";

const API_BASE =
  process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || "";

/** Safely read the user from localStorage using the JWT for validation. */
export function getStoredUser() {
  const token = localStorage.getItem("token");
  const userStr = localStorage.getItem("user");
  if (!token || !userStr) return null;

  try {
    const decoded = jwtDecode(token);
    if (decoded?.exp && decoded.exp * 1000 < Date.now()) {
      // Token expired
      return null;
    }
    return JSON.parse(userStr);
  } catch (err) {
    console.error("JWT decode error:", err);
    return null;
  }
}

/** Try to refresh the access token using the refresh token. */
export async function refreshToken() {
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) return null;

  try {
    const response = await fetch(`${API_BASE}/refresh-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      clearAuth();
      return null;
    }

    const data = await response.json();
    if (data?.token) {
      localStorage.setItem("token", data.token);
    }
    if (data?.user) {
      localStorage.setItem("user", JSON.stringify(data.user));
      localStorage.setItem("userEmail", data.user.email || "");
      localStorage.setItem("userRole", data.user.role || "");
      localStorage.setItem("userName", data.user.name || "");
      localStorage.setItem("userIdNumber", data.user.idnumber || "");
      localStorage.setItem("userOffice", data.user.office || "");
    }
    return data?.user ?? null;
  } catch (error) {
    console.error("Token refresh failed:", error);
    clearAuth();
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  localStorage.removeItem("refreshToken");
}

export function isTokenExpired() {
  const token = localStorage.getItem("token");
  if (!token) return true;
  try {
    const decoded = jwtDecode(token);
    return Boolean(decoded?.exp && decoded.exp * 1000 < Date.now());
  } catch {
    return true;
  }
}
