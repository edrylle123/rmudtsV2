import React, { useState, useEffect, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import "./Navbar.css";
import { useAuth } from "../AuthContext";
import axios from "./axios";
import { socket } from "../socket";
import { FaBell } from "react-icons/fa";

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showConfirm, setShowConfirm] = useState(false);

  // Notification state
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingCount, setIncomingCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);

  const pageTitles = {
    "/dashboard": "Dashboard",
    "/createrecord": "Create New Record",
    "/all": "All Records",
    "/analytics": "Analytics",
    "/createuser": "Create New User",
    "/dashboard/all-users": "All Users",
    "/user-dashboard": "My Dashboard",
    "/trackrecord": "Track Record",
    "/tracking": "Document Tracking",
    "/office-management": "Office Management",
    "/routing-slip-settings": "Routing Slip Settings",
    "/finished-documents": "Finished Documents",
    "/incoming-documents": "Incoming Documents",
  };

  const title = pageTitles[location.pathname] || "Records System";

  const userName = user?.name || localStorage.getItem("userName") || "Guest";
  const role = user?.role || localStorage.getItem("userRole") || "";
  const office = user?.office || localStorage.getItem("userOffice") || "";
  // Show office name instead of role
  const roleLabel = office || (
    role === "super_admin"
      ? "Super Administrator"
      : role === "admin"
        ? "Administrator"
        : role
          ? "Office Secretary"
          : ""
  );
  // Override navbar text colors for dark background
  const navTextStyle = { color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.3)' };
  const navSubStyle = { color: 'rgba(255,255,255,0.75)' };

  const initials = userName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => (part[0] || "").toUpperCase())
    .join("") || "U";

  // ---- Notifications ----
  const fetchNotifications = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || ""}/api/notifications`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setNotifications(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      // silent
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || ""}/api/notifications/unread-count`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setUnreadCount(res.data?.count || 0);
    } catch (e) {
      // silent
    }
  }, []);

  const fetchIncomingCount = useCallback(async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      const role = user?.role || localStorage.getItem("userRole") || "";
      if (role !== "admin" && role !== "super_admin") return;
      const res = await axios.get(
        `${process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || ""}/api/incoming-documents/count`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setIncomingCount(res.data?.count || 0);
    } catch (e) {
      // silent
    }
  }, [user]);

  useEffect(() => {
    fetchNotifications();
    fetchUnreadCount();
    fetchIncomingCount();
  }, [fetchNotifications, fetchUnreadCount, fetchIncomingCount]);

  useEffect(() => {
    const onNotif = () => {
      fetchNotifications();
      fetchUnreadCount();
    };
    const onIncoming = () => {
      fetchIncomingCount();
      fetchNotifications();
      fetchUnreadCount();
    };
    socket.on("recordUpdated", onNotif);
    socket.on("incomingDocument", onIncoming);
    return () => {
      socket.off("recordUpdated", onNotif);
      socket.off("incomingDocument", onIncoming);
    };
  }, [fetchNotifications, fetchUnreadCount, fetchIncomingCount]);

  const markAllRead = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      await axios.put(
        `${process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || ""}/api/notifications/mark-read`,
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: 1 })));
    } catch (e) {
      // silent
    }
  };

  const formatNotifTime = (ts) => {
    if (!ts) return "";
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  const openConfirm = () => setShowConfirm(true);
  const closeConfirm = () => setShowConfirm(false);

  const confirmLogout = () => {
    if (typeof logout === "function") {
      logout();
    } else {
      localStorage.clear();
      sessionStorage.clear();
      navigate("/", { replace: true });
    }
    setShowConfirm(false);
  };

  return (
    <>
      <header className="navbar" style={{
        backgroundImage: `url(${process.env.PUBLIC_URL || ''}/navbarbg.png)`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        // opacity: '60%',
      }}>
        <div className="navbar-header">
          <button
            className="navbar-hamburger"
            onClick={() => window.dispatchEvent(new Event('toggle-mobile-sidebar'))}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <h1 className="navbar-title" style={navTextStyle}>{title}</h1>
        </div>
        <div className="navbar-user">
          {/* Notification Bell */}
          <div className="notif-bell-wrapper">
            <button
              className="notif-bell"
              onClick={() => {
                setShowNotifs(!showNotifs);
                if (!showNotifs && unreadCount > 0) markAllRead();
              }}
              title="Notifications"
            >
              <FaBell style={{ color: '#fff' }} />
              {(unreadCount + incomingCount) > 0 && (
                <span className="notif-badge">{(unreadCount + incomingCount) > 99 ? "99+" : (unreadCount + incomingCount)}</span>
              )}
            </button>
            {showNotifs && (
              <div className="notif-dropdown">
                <div className="notif-dropdown-header">
                  <strong>Notifications</strong>
                  {unreadCount > 0 && (
                    <span className="badge text-bg-danger ms-2">{unreadCount} new</span>
                  )}
                </div>
                {incomingCount > 0 && (
                  <a
                    href="/incoming-documents"
                    className="d-block px-3 py-2 text-decoration-none"
                    style={{ background: '#fff3cd', borderBottom: '1px solid #dee2e6', fontSize: '0.85rem' }}
                    onClick={() => setShowNotifs(false)}
                  >
                    📥 <strong>{incomingCount} incoming document(s)</strong> — Click to view
                  </a>
                )}
                <div className="notif-dropdown-body">
                  {notifications.length === 0 ? (
                    <div className="notif-empty">No notifications yet</div>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`notif-item ${n.is_read ? "" : "unread"}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => {
                          setShowNotifs(false);
                          const isAdmin = role === 'admin' || role === 'super_admin';
                          navigate(isAdmin ? '/dashboard' : '/user-dashboard');
                        }}
                      >
                        <div className="notif-item-title">{n.title}</div>
                        <div className="notif-item-msg">{n.message}</div>
                        <div className="notif-item-time">
                          {n.from_office && <span>From: {n.from_office} · </span>}
                          {formatNotifTime(n.created_at)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="navbar-user-chip">
            <span className="navbar-avatar">{initials}</span>
            <div className="navbar-user-meta">
              <span className="navbar-user-name" style={navTextStyle}>{userName}</span>
              {roleLabel && <span className="navbar-user-role" style={navSubStyle}>{roleLabel}</span>}
            </div>
          </div>
          <button className="btn-logout" style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }} onClick={openConfirm}>
            Logout
          </button>
        </div>
      </header>

      {showConfirm && (
        <div className="confirm-overlay" onClick={closeConfirm}>
          <div className="confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-title">Log out?</div>
            <div className="confirm-body">
              You're about to log out of your session.
            </div>
            <div className="confirm-actions">
              <button
                className="btn btn-outline-secondary"
                onClick={closeConfirm}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmLogout}>
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
