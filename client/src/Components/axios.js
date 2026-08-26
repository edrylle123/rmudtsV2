// client/src/Components/axios.js
import Axios from "axios";
import { clearAuth } from "../utils/auth";

const baseURL =
  process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || "";

const axios = Axios.create({
  baseURL,
  withCredentials: false, // not using cookies for auth
});

const isPublicUrl = (url) =>
  url &&
  (url.includes("/login") ||
    url.includes("/refresh-token") ||
    url.includes("/uploads/"));

// Attach Authorization header for protected routes
axios.interceptors.request.use((config) => {
  if (!isPublicUrl(config.url)) {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  // All requests go through CRA proxy (relative paths)
  // No need to rewrite URLs — proxy handles forwarding to backend
  return config;
});

// Silent refresh on 401 (except auth endpoints) instead of reloading the page.
let isRefreshing = false;
let pendingQueue = [];

const flushQueue = (error) => {
  pendingQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve()
  );
  pendingQueue = [];
};

axios.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;

    // Only attempt a refresh for 401s on protected endpoints, once per request.
    if (
      !response ||
      response.status !== 401 ||
      !config ||
      isPublicUrl(config.url) ||
      config._retry
    ) {
      return Promise.reject(error);
    }

    const refreshToken = localStorage.getItem("refreshToken");
    if (!refreshToken) {
      clearAuth();
      return Promise.reject(error);
    }

    config._retry = true;

    if (isRefreshing) {
      // Wait for the in-flight refresh, then retry this request.
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve, reject });
      }).then(() => {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${localStorage.getItem("token")}`;
        return axios(config);
      });
    }

    isRefreshing = true;
    try {
      const r = await Axios.post(`${baseURL}/refresh-token`, { refreshToken });
      const token = r.data?.token;
      if (!token) throw new Error("Refresh failed");
      localStorage.setItem("token", token);
      if (r.data?.user) {
        localStorage.setItem("user", JSON.stringify(r.data.user));
        localStorage.setItem("userRole", r.data.user.role || "");
        localStorage.setItem("userOffice", r.data.user.office || "");
        localStorage.setItem("userName", r.data.user.name || "");
      }
      flushQueue(null);
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
      return axios(config);
    } catch (refreshError) {
      flushQueue(refreshError);
      clearAuth();
      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
    }
  }
);

export default axios;
