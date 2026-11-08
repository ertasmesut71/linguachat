import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            background: "#0a0a0f",
            color: "#e8e8f0",
            fontFamily: "'DM Sans', sans-serif",
          }}
        >
          <div
            style={{
              textAlign: "center",
              maxWidth: 420,
              padding: 40,
            }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Something went wrong
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "#8e8ea8",
                lineHeight: 1.6,
                marginBottom: 24,
              }}
            >
              LinguaChat encountered an unexpected error. Your messages are safe
              — try refreshing the page.
            </p>

            {this.state.error && (
              <pre
                style={{
                  fontSize: 11,
                  color: "#e17055",
                  background: "#1a1a24",
                  border: "1px solid #2a2a3a",
                  borderRadius: 10,
                  padding: 12,
                  textAlign: "left",
                  overflow: "auto",
                  maxHeight: 120,
                  marginBottom: 20,
                  fontFamily: "'JetBrains Mono', monospace",
                }}
              >
                {this.state.error.message}
              </pre>
            )}

            <div
              style={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
              }}
            >
              <button
                onClick={this.handleReset}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "1px solid #2a2a3a",
                  background: "#1a1a24",
                  color: "#8e8ea8",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Try Again
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: "10px 24px",
                  borderRadius: 10,
                  border: "none",
                  background: "#6c5ce7",
                  color: "white",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
