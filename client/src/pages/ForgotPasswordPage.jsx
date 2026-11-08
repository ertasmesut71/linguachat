import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [devToken, setDevToken] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/request-password-reset", { email });
      setSubmitted(true);
      // Dev convenience: the server returns the token in non-production env
      if (res.dev?.token) setDevToken(res.dev.token);
    } catch (err) {
      setError(err?.message || "Something went wrong");
    }
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-header">
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>
            🌐 LinguaChat
          </h1>
          <p style={{ color: "var(--text-tertiary)", fontSize: 13, marginTop: 4 }}>
            Reset your password
          </p>
        </div>

        {!submitted ? (
          <form onSubmit={handleSubmit}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
              Enter the email address you registered with. If an account exists,
              you'll receive a password reset link.
            </p>
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 14 }}>
              {loading ? "Sending…" : "Send Reset Link"}
            </button>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
              <Link to="/login" style={{ color: "var(--accent)" }}>Back to login</Link>
            </div>
          </form>
        ) : (
          <div>
            <div style={{ textAlign: "center", marginBottom: 16, fontSize: 36 }}>✉️</div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6, textAlign: "center" }}>
              If <strong>{email}</strong> is registered, a reset link has been
              sent. Check your inbox and follow the instructions.
            </p>

            {devToken && (
              <div style={{
                marginTop: 16, padding: 12, background: "var(--surface-raised)",
                border: "1px solid var(--border)", borderRadius: "var(--radius-md)",
                fontSize: 12, wordBreak: "break-all",
              }}>
                <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--accent)" }}>
                  Dev mode — reset link:
                </div>
                <Link to={`/reset-password?token=${encodeURIComponent(devToken)}`} style={{ color: "var(--accent)" }}>
                  Click here to reset your password
                </Link>
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 20, fontSize: 13 }}>
              <Link to="/login" style={{ color: "var(--accent)" }}>Back to login</Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
