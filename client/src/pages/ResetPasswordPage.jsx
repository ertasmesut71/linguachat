import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import api from "../api/client";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    if (!tokenFromUrl) { setError("Missing reset token. Please use the link from your email."); return; }

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token: tokenFromUrl, newPassword: password });
      setSuccess(true);
      setTimeout(() => navigate("/login"), 3000);
    } catch (err) {
      setError(err?.message || "Reset failed. The link may have expired.");
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
            Choose a new password
          </p>
        </div>

        {!success ? (
          <form onSubmit={handleSubmit}>
            <label className="form-label">New password</label>
            <input
              className="form-input"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
            <label className="form-label" style={{ marginTop: 10 }}>Confirm password</label>
            <input
              className="form-input"
              type="password"
              placeholder="Repeat your new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
            {error && <div className="form-error">{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: "100%", marginTop: 14 }}>
              {loading ? "Resetting…" : "Reset Password"}
            </button>
            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
              <Link to="/login" style={{ color: "var(--accent)" }}>Back to login</Link>
            </div>
          </form>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>✅</div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.6 }}>
              Your password has been reset successfully.
              You'll be redirected to login in a few seconds…
            </p>
            <Link to="/login" className="btn btn-primary" style={{ marginTop: 16, display: "inline-block" }}>
              Go to Login
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
