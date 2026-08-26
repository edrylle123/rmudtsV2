import React, { useState } from "react";
import axios from "./axios";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import "./TrackRecord.css";

export default function TrackRecord() {
  const [searchType, setSearchType] = useState("control");
  const [searchValue, setSearchValue] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [trackingData, setTrackingData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async () => {
    if (!searchValue.trim()) {
      alert("Please enter a search term.");
      return;
    }

    setLoading(true);
    setError(null);
    setTrackingData(null);
    setSearchResults([]);

    try {
      if (searchType === "control") {
        const response = await axios.get(`/records/track/${searchValue.trim()}`);
        setTrackingData(response.data);
      } else {
        const response = await axios.get(
          `/records/search?q=${encodeURIComponent(searchValue.trim())}`
        );
        setSearchResults(response.data);
        if (response.data.length === 0) {
          setError("No records found matching your search.");
        }
      }
    } catch (err) {
      console.error("Error searching record:", err);
      setError(
        err.response?.data?.error || "Failed to fetch record data."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleTrackRecord = async (record) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        `/records/track/${record.control_number}`
      );
      setTrackingData(response.data);
    } catch (err) {
      setError(
        err.response?.data?.error || "No tracking data found for this record."
      );
      setTrackingData(null);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSearch();
  };

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid track-content">
          {/* Search Section */}
          <div className="track-search-card">
            <div className="track-search-header">
              <h2>🔍 Track Record</h2>
              <p className="track-subtitle">
                Search by control number or by document title, description, or
                office
              </p>
            </div>

            <div className="track-search-bar">
              <div className="track-search-tabs">
                <button
                  className={`track-tab ${
                    searchType === "control" ? "active" : ""
                  }`}
                  onClick={() => {
                    setSearchType("control");
                    setSearchValue("");
                    setSearchResults([]);
                    setTrackingData(null);
                    setError(null);
                  }}
                >
                  Control Number
                </button>
                <button
                  className={`track-tab ${
                    searchType === "title" ? "active" : ""
                  }`}
                  onClick={() => {
                    setSearchType("title");
                    setSearchValue("");
                    setSearchResults([]);
                    setTrackingData(null);
                    setError(null);
                  }}
                >
                  Title / Description
                </button>
              </div>

              <div className="track-input-row">
                <input
                  type="text"
                  className="track-input"
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    searchType === "control"
                      ? "e.g. 260826-14"
                      : "e.g. invitation, budget proposal, CITCS..."
                  }
                />
                <button
                  className="track-btn"
                  onClick={handleSearch}
                  disabled={loading}
                >
                  {loading ? "Searching..." : "Search"}
                </button>
              </div>
            </div>
          </div>

          {/* Error */}
          {error && !searchResults.length && !trackingData && (
            <div className="track-alert track-alert-error">{error}</div>
          )}

          {/* Search Results List (title/description search) */}
          {searchResults.length > 0 && !trackingData && (
            <div className="track-results-card">
              <h3>Search Results ({searchResults.length} found)</h3>
              <div className="track-results-list">
                {searchResults.map((rec) => (
                  <div
                    key={rec.id}
                    className="track-result-item"
                    onClick={() => handleTrackRecord(rec)}
                  >
                    <div className="track-result-main">
                      <span className="track-result-cn">
                        {rec.control_number}
                      </span>
                      <span className="track-result-desc">
                        {rec.description || "No description"}
                      </span>
                    </div>
                    <div className="track-result-meta">
                      <span className="track-result-badge">
                        {rec.office_requestor || "—"}
                      </span>
                      <span className="track-result-badge track-result-office">
                        {rec.current_office || "—"}
                      </span>
                      {rec.created_at && (
                        <span className="track-result-date">
                          {new Date(rec.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tracking Data */}
          {trackingData && (
            <div className="track-results-card">
              <div className="track-detail-header">
                <h3>📍 {trackingData.control_number}</h3>
                <button
                  className="track-btn-secondary"
                  onClick={() => {
                    setTrackingData(null);
                  }}
                >
                  ← Back to search
                </button>
              </div>

              <div className="track-current-location">
                <span className="track-loc-label">Current Location:</span>
                <span className="track-loc-value">
                  {trackingData.current_office}
                </span>
              </div>

              <h4 className="track-history-title">Movement History</h4>
              <div className="track-timeline">
                {trackingData.history.map((movement, index) => (
                  <div key={index} className="track-timeline-item">
                    <div className="track-timeline-dot" />
                    <div className="track-timeline-content">
                      <div className="track-timeline-action">
                        <span
                          className={`track-action-badge ${
                            movement.action === "RELEASED"
                              ? "released"
                              : "received"
                          }`}
                        >
                          {movement.action}
                        </span>
                        <span className="track-timeline-time">
                          {new Date(movement.timestamp).toLocaleString()}
                        </span>
                      </div>
                      <div className="track-timeline-details">
                        <span>
                          <strong>From:</strong> {movement.from_office}
                        </span>
                        <span>
                          <strong>To:</strong> {movement.to_office}
                        </span>
                        <span>
                          <strong>By:</strong> {movement.actor}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading &&
            !error &&
            !trackingData &&
            searchResults.length === 0 && (
              <div className="track-empty">
                Enter a control number or search term to track a document.
              </div>
            )}
        </div>
      </div>
    </div>
  );
}
