import { useEffect, useState } from "react";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import api from "../api/client";
import { useAuthStore } from "../store/authStore";

/**
 * D8 — Mobile QR approval page.
 *
 * Flow:
 *  - Reads `?code=ABCDEFGH` from URL, or accepts manual code entry.
 *  - Requires the user to be logged in (route is wrapped in ProtectedRoute).
 *  - On Approve: POST /api/auth/pairing/approve { code } with the user's
 *    bearer token (already attached by api/client).
 *  - Shows success: "Desktop login approved. Return to your computer."
 *  - Shows clear errors for expired / invalid / already-approved codes.
 */
export default function ScanQRPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const initialCode = (searchParams.get("code") || "").toUpperCase();
  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState("ready"); // ready | submitting | success | error
  const [error, setError] = useState(null);

  // ProtectedRoute should keep unauthenticated users out, but double-guard.
  useEffect(() => {
    if (!user) navigate("/login", { replace: true });
  }, [user, navigate]);

  const handleApprove = async (e) => {
    e?.preventDefault?.();
    const trimmed = (code || "").trim().toUpperCase();
    if (trimmed.length < 8) {
      setError("Please enter the 8-character code shown on your computer.");
      return;
    }
    setError(null);
    setStatus("submitting");
    try {
      await api.post("/auth/pairing/approve", { code: trimmed });
      setStatus("success");
    } catch (err) {
      const msg = err?.message || "Approval failed";
      setError(msg);
      setStatus("error");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 420 }}>
        <div className="auth-header" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>
            🌐 LinguaChat
          </h1>
          <p style={{ color: "var(--text-tertiary)", fontSize: 13, marginTop: 4 }}>
            Approve desktop login
          </p>
        </div>

        {status === "success" ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✓</div>
            <p style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 600 }}>
              Desktop login approved.
            </p>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8, lineHeight: 1.6 }}>
              You can return to your computer — it's signing in now.
            </p>
            <Link to="/" className="btn btn-primary" style={{ marginTop: 18, display: "inline-block" }}>
              Back to chats
            </Link>
          </div>
        ) : (
          <form onSubmit={handleApprove}>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 14 }}>
              You're about to sign in to LinguaChat on another device.
              Confirm the 8-character code shown on that device matches the code below,
              then tap <strong>Approve</strong>.
            </p>

            <label className="form-label">Pairing code</label>
            <input
              className="form-input"
              type="text"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={16}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD1234"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 22,
                letterSpacing: 4,
                textAlign: "center",
                fontWeight: 700,
              }}
              autoFocus
              required
            />

            {error && <div className="form-error">{error}</div>}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 14 }}
              disabled={status === "submitting"}
            >
              {status === "submitting" ? "Approving…" : "Approve sign-in"}
            </button>

            <p style={{
              fontSize: 11, color: "var(--text-tertiary)",
              marginTop: 14, textAlign: "center", lineHeight: 1.6,
            }}>
              Only approve if you are actively trying to sign in on another
              device right now. Never share or approve codes from someone else.
            </p>

            <div style={{ textAlign: "center", marginTop: 16, fontSize: 13 }}>
              <Link to="/" style={{ color: "var(--accent)" }}>Cancel</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
