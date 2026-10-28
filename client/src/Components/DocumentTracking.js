import React, { useState, useEffect, useCallback } from "react";
import axios from "./axios";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import { useAuth } from "../AuthContext";
import "./DocumentTracking.css";

export default function DocumentTracking() {
  const { user } = useAuth();
  const [office, setOffice] = useState(user?.office || "Records");
  const [documentsInOffice, setDocumentsInOffice] = useState([]);
  const [inTransit, setInTransit] = useState([]);
  const [recentMovements, setRecentMovements] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [destinationOffice, setDestinationOffice] = useState("");
  const [offices, setOffices] = useState([]);
  const [error, setError] = useState(null);

  const fetchTracking = useCallback(async () => {
    try {
      setError(null);
      const res = await axios.get(`/api/tracking/${encodeURIComponent(office)}`);
      setDocumentsInOffice(res.data.documentsInOffice || []);
      setInTransit(res.data.inTransit || []);
      setRecentMovements(res.data.recentMovements || []);
    } catch (err) {
      console.error(err);
      setError("Failed to load tracking data.");
    }
  }, [office]);

  const fetchOffices = useCallback(async () => {
    try {
      const res = await axios.get("/offices");
      setOffices(res.data);
      setDestinationOffice((prev) => prev || res.data[0] || "");
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    setOffice(user?.office || "Records");
  }, [user?.office]);

  useEffect(() => {
    fetchTracking();
    fetchOffices();
  }, [fetchTracking, fetchOffices]);

  const openModal = (doc) => {
    setSelectedDoc(doc);
    setShowModal(true);
  };
  const closeModal = () => {
    setSelectedDoc(null);
    setShowModal(false);
  };

  const handleRelease = async () => {
    if (!selectedDoc || !destinationOffice) return;
    try {
      await axios.post("/api/tracking/release", {
        record_id: selectedDoc.id,
        to_office: destinationOffice,
      });
      closeModal();
      fetchTracking();
    } catch (err) {
      console.error(err);
      alert("Failed to release document.");
    }
  };

  const handleReceive = async (doc) => {
    try {
      await axios.post("/api/tracking/receive", {
        record_id: doc.id,
        from_office: doc.from_office || "Unknown",
      });
      fetchTracking();
    } catch (err) {
      console.error(err);
      alert("Failed to receive document.");
    }
  };

  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2>Document Tracking ({office})</h2>

          <div className="mb-3">
            <label className="form-label">Office</label>
            <select
              className="form-select"
              value={office}
              onChange={(e) => setOffice(e.target.value)}
            >
              {offices.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}

          <div className="row g-3 mb-3">
            <div className="col-md-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="mb-0">Documents in Office</h3>
                </div>
                <ul className="list-group list-group-flush">
                  {documentsInOffice.length ? (
                    documentsInOffice.map((doc) => (
                      <li
                        key={doc.id}
                        className="list-group-item d-flex justify-content-between align-items-center"
                      >
                        <span>
                          {doc.control_number} - {doc.title || "Untitled"}
                        </span>
                        <button
                          className="btn btn-sm btn-outline-primary"
                          onClick={() => openModal(doc)}
                        >
                          Release
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="list-group-item text-muted">None</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="col-md-6">
              <div className="card">
                <div className="card-header">
                  <h3 className="mb-0">In Transit</h3>
                </div>
                <ul className="list-group list-group-flush">
                  {inTransit.length ? (
                    inTransit.map((doc) => (
                      <li
                        key={doc.id}
                        className="list-group-item d-flex justify-content-between align-items-center"
                      >
                        <span>
                          {doc.control_number} - {doc.title || "Untitled"}
                        </span>
                        <button
                          className="btn btn-sm btn-outline-success"
                          onClick={() => handleReceive(doc)}
                        >
                          Receive
                        </button>
                      </li>
                    ))
                  ) : (
                    <li className="list-group-item text-muted">None</li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h3 className="mb-0">Recent Movements</h3>
            </div>
            <div className="table-responsive rs-stack">
              <table className="table table-striped align-middle mb-0">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Title</th>
                    <th>Action</th>
                    <th>From</th>
                    <th>To</th>
                    <th>Actor</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {recentMovements.length ? (
                    recentMovements.map((mv) => (
                      <tr key={mv.id}>
                        <td data-label="Ref">{mv.record_id}</td>
                        <td data-label="Title">{mv.title || "—"}</td>
                        <td data-label="Action">
                          <span
                            className={`status-badge ${
                              mv.action === "RELEASED"
                                ? "status-released"
                                : "status-received"
                            }`}
                          >
                            {mv.action}
                          </span>
                        </td>
                        <td data-label="From">{mv.from_office}</td>
                        <td data-label="To">{mv.to_office}</td>
                        <td data-label="Actor">{mv.actor}</td>
                        <td data-label="Time">{new Date(mv.timestamp).toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="7" data-label="" className="text-center text-muted">
                        No recent movements
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {showModal && selectedDoc && (
            <div
              className="modal-overlay"
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.4)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1050,
              }}
              onClick={closeModal}
            >
              <div
                className="modal card shadow"
                style={{ width: "min(420px, 94%)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="card-body">
                  <h4 className="mb-3">Release {selectedDoc.control_number}</h4>
                  <label className="form-label">Destination Office:</label>
                  <select
                    className="form-select"
                    value={destinationOffice}
                    onChange={(e) => setDestinationOffice(e.target.value)}
                  >
                    {offices.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                  <div className="d-flex gap-2 mt-3 justify-content-end">
                    <button className="btn btn-primary" onClick={handleRelease}>
                      Confirm Release
                    </button>
                    <button className="btn btn-secondary" onClick={closeModal}>
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
