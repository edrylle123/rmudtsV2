// ErrorBoundary.js — catches render errors so the app shows a readable
// message instead of a silent blank page.
import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f5f5f5",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
          }}
        >
          <div
            style={{
              maxWidth: 560,
              background: "#fff",
              border: "1px solid #e3e3e3",
              borderRadius: 12,
              padding: 28,
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
            }}
          >
            <h2 style={{ marginTop: 0, color: "#b3261e" }}>
              Something went wrong
            </h2>
            <p style={{ color: "#333", lineHeight: 1.5 }}>
              The page hit an unexpected error. Please{" "}
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "#1b6b3a",
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontWeight: 600,
                  cursor: "pointer",
                  margin: "0 4px",
                }}
              >
                Reload the page
              </button>{" "}
              and try again. If it keeps happening, sign out and sign back in.
            </p>
            {this.state.error && (
              <pre
                style={{
                  background: "#f8f8f8",
                  border: "1px solid #eee",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 12,
                  overflow: "auto",
                  color: "#a33",
                }}
              >
                {String(this.state.error?.message || this.state.error)}
              </pre>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
