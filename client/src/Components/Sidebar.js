import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  FaBars,
  FaChartLine,
  FaFileAlt,
  FaFolderPlus,
  FaHome,
  FaSignOutAlt,
  FaUserPlus,
  FaUsers,
  FaBuilding,
  FaCheckCircle,
  FaListAlt,
  FaInbox,
} from "react-icons/fa";
import { FaLocationCrosshairs } from "react-icons/fa6";
import { MdDashboard } from "react-icons/md";
import { useAuth } from "../AuthContext";
import "./Sidebar.css";

export default function Sidebar() {
  const [isOpen, setIsOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const { user, logout } = useAuth();
  const role = user?.role || localStorage.getItem("userRole") || "user";
  const name = user?.name || localStorage.getItem("userName") || "User";

  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => (part[0] || "").toUpperCase())
      .join("") || "U";

  const toggleSidebar = () => setIsOpen((open) => !open);
  const toggleMobile = () => setMobileOpen((open) => !open);

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 992) setMobileOpen(false);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Listen for hamburger toggle from Navbar
  useEffect(() => {
    const handler = () => setMobileOpen((open) => !open);
    window.addEventListener("toggle-mobile-sidebar", handler);
    return () => window.removeEventListener("toggle-mobile-sidebar", handler);
  }, []);

  const Item = ({ to, icon, children }) => {
    const active = location.pathname === to;
    return (
      <li className={`sidebar-item${active ? " active" : ""}`}>
        <Link
          to={to}
          className="sidebar-link"
          title={isOpen ? undefined : children}
        >
          <span className="sidebar-icon">{icon}</span>
          <span className="sidebar-text">{children}</span>
        </Link>
      </li>
    );
  };

  const isSuperAdmin = role === "super_admin";

  const adminMenu = (
    <>
      <div className="sidebar-section-label">Main Menu</div>
      <Item to="/dashboard" icon={<MdDashboard />}>
        Dashboard
      </Item>
      <Item to="/createrecord" icon={<FaFolderPlus />}>
        Create Record
      </Item>
      <Item to="/all" icon={<FaFileAlt />}>
        All Records
      </Item>
      <Item to="/analytics" icon={<FaChartLine />}>
        Analytics
      </Item>
      <div className="sidebar-section-label">Management</div>
      <Item to="/trackrecord" icon={<FaLocationCrosshairs />}>
        Tracking
      </Item>
      <Item to="/createuser" icon={<FaUserPlus />}>
        Create User
      </Item>
      <Item to="/incoming-documents" icon={<FaInbox />}>
        Incoming Documents
      </Item>
      {isSuperAdmin && (
        <>
          <Item to="/dashboard/all-users" icon={<FaUsers />}>
            All Users
          </Item>
          <Item to="/office-management" icon={<FaBuilding />}>
            Office Management
          </Item>
          <Item to="/dropdown-management" icon={<FaListAlt />}>
            Dropdown Options
          </Item>
        </>
      )}
    </>
  );

  const userMenu = (
    <>
      <div className="sidebar-section-label">Main Menu</div>
      <Item to="/user-dashboard" icon={<FaHome />}>
        Dashboard
      </Item>
      <Item to="/all" icon={<FaFileAlt />}>
        My Office Records
      </Item>
      <Item to="/finished-documents" icon={<FaCheckCircle />}>
        Finished Documents
      </Item>
      <Item to="/trackrecord" icon={<FaLocationCrosshairs />}>
        Tracking
      </Item>
    </>
  );

  return (
    <>
      {/* Mobile overlay backdrop */}
      <div
        className={`sidebar-overlay ${mobileOpen ? "visible" : ""}`}
        onClick={() => setMobileOpen(false)}
      />

      <div
        className={`sidebar ${isOpen ? "expanded" : "collapsed"} ${
          mobileOpen ? "mobile-open" : ""
        }`}
      >
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <img src="/rtms.png" alt="RMU logo" className="sidebar-logo" />
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-title">Records System</span>
              <span className="sidebar-brand-sub">Document Tracking</span>
            </div>
          </div>
          <button
            className="sidebar-toggle"
            onClick={() => {
              if (window.innerWidth <= 992) {
                toggleMobile();
              } else {
                toggleSidebar();
              }
            }}
            title={isOpen ? "Collapse menu" : "Expand menu"}
            aria-label="Toggle sidebar"
          >
            <FaBars />
          </button>
        </div>

        <nav className="sidebar-nav">
          <ul className="sidebar-menu">
            {(role === "admin" || role === "super_admin") ? adminMenu : userMenu}
          </ul>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <span className="sidebar-avatar">{initials}</span>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{name}</span>
              <span className="sidebar-user-role">
                {user?.office ||
                  (role === "super_admin"
                    ? "Super Administrator"
                    : role === "admin"
                    ? "Administrator"
                    : "Office Secretary")}
              </span>
            </div>
            <button
              className="sidebar-logout"
              title="Log out"
              aria-label="Log out"
              onClick={() => logout()}
            >
              <FaSignOutAlt />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
