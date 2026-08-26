// src/Components/CreateUserPage.js
import React from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import CreateUserForm from "./CreateUserForm"; // ✅ make sure this is the USER form

export default function CreateUserPage() {
  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2 className="mb-3">Create New User</h2>
          <CreateUserForm /> {/* ✅ renders the USER form */}
        </div>
      </div>
    </div>
  );
}
