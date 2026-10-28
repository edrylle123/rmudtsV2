// client/src/App.js
import React, { useEffect, useRef } from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "./AuthContext";
import AttachmentViewer from "./Components/AttachmentViewer";
import "bootstrap/dist/css/bootstrap.min.css";

// Public pages
import Login from "./login";     // <- ensure actual filename/casing matches (e.g. "./Login")
import Signup from "./Signup";   // <- ensure actual filename/casing matches
import RoutingSlip from "./Components/RoutingSlip"; // <- NEW import for RoutingSlip component
// Admin pages
import Dashboard from "./Components/Dashboard";
import CreateRecordForm from "./Components/CreateRecordForm";
import CreateRecordPage from "./Components/CreateRecordPage";
import CreateUserPage from "./Components/CreateUserPage";
import AllRecords from "./Components/AllRecords";
import Analytics from "./Components/Analytics";
import Reports from "./Components/Reports";
import AllUsers from "./Components/AllUsers";
import RoutingSlipSettings from "./Components/RoutingSlipSettings";
import OfficeManagement from "./Components/OfficeManagement";
import DropdownManagement from "./Components/DropdownManagement";
import DatabaseBackup from "./Components/DatabaseBackup";
import ActivityLogs from "./Components/ActivityLogs";
import axios from "./Components/axios";
import IncomingDocuments from "./Components/IncomingDocuments";
// import CreateUserForm from "./Components/CreateUserForm";
import EditRecords from "./Components/EditRecords"; // <- FIXED import (no trailing "s")
import DocumentTracking from "./Components/DocumentTracking";
// User pages
import UserDashboard from "./Components/UserDashboard";
import FinishedDocuments from "./Components/FinishedDocuments";
// Utils
import ProtectedRoute from "./Components/ProtectedRoute";
import TrackRecord from "./Components/TrackRecord";
 // <- ensure actual filename/casing matches

// Optional shared layout:
// import AppLayout from "./AppLayout";

// Reports each page the signed-in user opens to the activity log. Mounted
// inside the router so it sees every navigation; it never blocks rendering.
function ActivityTracker() {
  const location = useLocation();
  const lastSent = useRef("");

  useEffect(() => {
    const token = localStorage.getItem("token");
    const path = location.pathname;
    if (!token || !path || path === "/" || path === lastSent.current) return;
    lastSent.current = path;
    axios.post("/api/activity/page-view", { path }).catch(() => {
      // Tracking must never interrupt the UI.
    });
  }, [location.pathname]);

  return null;
}

export default function App() {
  
  return (
    <BrowserRouter>
      <ActivityTracker />
      <AuthProvider>


        <Routes>
          {/* Public Routes */}
          <Route path="/" element={<Login />} />
          <Route path="/signup" element={<Signup />} />

          {/* --------- Admin-only Routes --------- */}
          {/* With shared layout you could group these; keeping as-is for now */}
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/createrecord"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <CreateRecordForm />
              </ProtectedRoute>
            }
          />
          <Route
            path="/createrecordpage"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <CreateRecordPage />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/createuser"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <CreateUserPage />
              </ProtectedRoute>
            }
          />


          <Route
            path="/all"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin", "user"]}>
                <AllRecords />
              </ProtectedRoute>
            }
          />
          {/* Alias to avoid "No routes matched /all-records" */}
          <Route
            path="/all-records"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <AllRecords />
              </ProtectedRoute>
            }
          />

                    <Route
            path="/analytics"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <Analytics />
              </ProtectedRoute>
            }
          />
          <Route
            path="/reports"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <Reports />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard/all-users"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]}>
                <AllUsers />
              </ProtectedRoute>
            }
          />

          <Route
            path="/routing-slip-settings"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <RoutingSlipSettings />
              </ProtectedRoute>
            }
          />

          <Route
            path="/incoming-documents"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <IncomingDocuments />
              </ProtectedRoute>
            }
          />

          <Route
            path="/office-management"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]}>
                <OfficeManagement />
              </ProtectedRoute>
            }
          />

          <Route
            path="/dropdown-management"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]}>
                <DropdownManagement />
              </ProtectedRoute>
            }
          />

          <Route
            path="/database-backup"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]}>
                <DatabaseBackup />
              </ProtectedRoute>
            }
          />

          <Route
            path="/activity-logs"
            element={
              <ProtectedRoute allowedRoles={["super_admin"]}>
                <ActivityLogs />
              </ProtectedRoute>
            }
          />

          <Route
            path="/records/:id/edit"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
                <EditRecords />
              </ProtectedRoute>
            }
          />

          <Route
            path="/attachment-viewer"
            element={
              <ProtectedRoute>
                <AttachmentViewer />
              </ProtectedRoute>
            }
          />
          
             <Route
            path="/trackrecord"
            element={
              <ProtectedRoute allowedRoles={["admin", "super_admin", "user"]}>
                <TrackRecord />
              </ProtectedRoute>
            }
          />
          

          {/* --------- Normal User-only Route --------- */}
          <Route
            path="/user-dashboard"
            element={
              <ProtectedRoute allowedRoles={["user"]}>
                <UserDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/finished-documents"
            element={
              <ProtectedRoute allowedRoles={["user"]}>
                <FinishedDocuments />
              </ProtectedRoute>
            }
          />
          {/* Routing Slip Route */}
      <Route
        path="/routing-slip"  
        element={
          <ProtectedRoute allowedRoles={["admin", "super_admin"]}>
            <RoutingSlip /> {/* <- NEW Route for RoutingSlip component */}
          </ProtectedRoute>
        }
      />
           {/* Document Tracking Route */}
      <Route
        path="/tracking"
        element={
          <ProtectedRoute allowedRoles={["admin","super_admin","user"]}>
            <DocumentTracking />
          </ProtectedRoute>
        }
      />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
