import React, { useState, useEffect } from "react";
import axios from "./axios"; // Assuming you have an axios instance for API requests
import "./RoutingSlip.css"; // Import the CSS file
import { useNavigate } from "react-router-dom";

export default function RoutingSlip({ user }) {
  const [formData, setFormData] = useState({
    controlNumber: "",
    from: "Office of the President", // Logged-in user's office
    office: "",
    date: "",
    urgent: false,
    reviewComments: false,
    pleaseHold: false,
    comments: "",
    to: "",
    receivedBy: "",
    signature: "",
  });
const navigate = useNavigate();

  // Fetch data from the database when the component mounts
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetching record data and populating the form
        const res = await axios.get("/next-control-number"); // Get the next control number from the backend
        setFormData((prevData) => ({
          ...prevData,
          controlNumber: res.data.control_number,
          date: new Date().toISOString().split("T")[0], // Setting today's date in YYYY-MM-DD format
        }));
      } catch (error) {
        console.error("Error fetching data: ", error);
      }
    };
    fetchData();
  }, []);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log("Form Submitted", formData);
    // You can add your form submission logic here
  };

  return (
    <div className="form-container">
      <div className="header">
        <h1>OFFICE OF THE UNIVERSITY PRESIDENT</h1>
        <div className="sub-header">
          <p>Diffun, Quirino</p>
          <p>CTRL: {formData.controlNumber || "250001-001"}</p>
        </div>
        <h2>ROUTING SLIP</h2>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-fields">
          {/* From */}
          <div className="input-field">
            <label htmlFor="from">From</label>
            <input
              type="text"
              id="from"
              name="from"
              value={formData.from}
              onChange={handleChange}
              placeholder="Enter name of sender"
              readOnly
            />
          </div>

          {/* Office */}
          <div className="input-field">
            <label htmlFor="office">Office</label>
            <input
              type="text"
              id="office"
              name="office"
              value={formData.office}
              onChange={handleChange}
              placeholder="Enter sender's office"
            />
          </div>

          {/* Date */}
          <div className="input-field">
            <label htmlFor="date">Date</label>
            <input
              type="date"
              id="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
            />
          </div>

          {/* URGENT checkbox */}
          <div className="checkbox">
            <input
              type="checkbox"
              id="urgent"
              name="urgent"
              checked={formData.urgent}
              onChange={handleChange}
            />
            <label htmlFor="urgent">URGENT</label>
          </div>

          {/* Review Comments checkbox */}
          <div className="checkbox">
            <input
              type="checkbox"
              id="reviewComments"
              name="reviewComments"
              checked={formData.reviewComments}
              onChange={handleChange}
            />
            <label htmlFor="reviewComments">For your review/comments</label>
          </div>

          {/* Please Hold checkbox */}
          <div className="checkbox">
            <input
              type="checkbox"
              id="pleaseHold"
              name="pleaseHold"
              checked={formData.pleaseHold}
              onChange={handleChange}
            />
            <label htmlFor="pleaseHold">Please hold</label>
          </div>

          {/* Comments */}
          <div className="textarea">
            <label htmlFor="comments">Comments</label>
            <textarea
              id="comments"
              name="comments"
              value={formData.comments}
              onChange={handleChange}
              placeholder="Enter your comments"
            />
          </div>

          {/* Add QSU-REC-F007 Rev.01 */}
          <div className="qsu-rec-f007">
            <p>QSU-REC-F007 Rev. 01 (Jul. 07, 2025)</p>
          </div>

          <div className="separator"></div>

          <div className="form-fields">
            {/* Receiving Office */}
            <div className="input-field">
              <label htmlFor="to">RECEIVING & FOLLOW-UP SLIP</label>
              <input
                type="text"
                id="to"
                name="to"
                value={formData.to}
                onChange={handleChange}
                placeholder="To Receiving Office"
              />
            </div>

            {/* Received By */}
            <div className="input-field">
              <label htmlFor="receivedBy">Received by</label>
              <input
                type="text"
                id="receivedBy"
                name="receivedBy"
                value={formData.receivedBy}
                onChange={handleChange}
                placeholder="Name of Person Receiving"
              />
            </div>

            {/* Signature */}
            <div className="input-field">
              <label htmlFor="signature">Signature over printed name/Date</label>
              <input
                type="text"
                id="signature"
                name="signature"
                value={formData.signature}
                onChange={handleChange}
                placeholder="Signature"
              />
            </div>
          </div>
        </div>

        <div className="button-group">
          <button type="submit" className="btn-approve">
            Return to Records Office
          </button>
          {/* <button type="button" className="btn-notation">
            Add Notation
          </button> */}
           <button type="button" className="btn-notation" onClick={() => navigate("/user-dashboard")}>
            Back
          </button>
        </div>
      </form>
    </div>
  );
}
