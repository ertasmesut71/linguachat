import { useEffect, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import api, { setAccessToken } from "../api/client";
import { useAuthStore } from "../store/authStore";

const POLL_INTERVAL_MS = 2000;

/**
 * D8 — Desktop QR login page.
 *
 * Flow:
 *  1. On mount, POST /api/auth/pairing/create with this device's user-agent
 *     as deviceLabel. Server returns { code, nonce, expiresAt }.
 *  2. Render a QR encoding `{origin}/scan?code={code}` so a logged-in mobile
 *     can hit the approval page in one tap.
 *  3. Also display the 8-character code in plain text below the QR so the
 *     user can manually type it on the mobile if their camera fails.
 *  4. Poll POST /api/auth/pairing/poll every 2 seconds with { code, nonce }.
 *  5. On { status: "approved" }, save tokens, set user in the auth store,
 *     and navigate to "/".
 *  6. On expiry/error, surface a refresh prompt.
 *
 * Cleanup: clears the poll interval on unmount.
 */
export default function QRLoginPage() {
  const navigate = useNavigate();
  const [pairing, setPairing] = useState(null);     // { code, nonce, expiresAt }
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | waiting | approved | expired | error
  const pollRef = useRef(null);
  const cancelledRef = useRef(false);

  // Build the QR payload — a URL the mobile can open in one tap.
  const qrUrl = pairing
    ? `${window.location.origin}/scan?code=${encodeURIComponent(pairing.code)}`
    : "";

  // ─── Create pairing request on mount ───
  useEffect(() => {
    cancelledRef.current = false;
    let mounted = true;

    const startPairing = async () => {
      try {
        const res = await api.post("/auth/pairing/create", {
          deviceLabel: navigator.userAgent.slice(0, 120),
        });
        if (!mounted) return;
        setPairing(res.data);
        setStatus("waiting");
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || "Could not start QR login session");
        setStatus("error");
      }
    };
    startPairing();

    return () => {
      mounted = false;
      cancelledRef.current = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // ─── Polling ───
  useEffect(() => {
    if (!pairing || status !== "waiting") return;

    const poll = async () => {
      if (cancelledRef.current) return;
      try {
        const res = await api.post("/auth/pairing/poll", {
          code: pairing.code,
          nonce: pairing.nonce,
        });
        if (cancelledRef.current) return;

        if (res.data?.status === "approved") {
          // Stop polling immediately
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setStatus("approved");
          // Persist tokens & user — same shape as a normal login
          setAccessToken(res.data.accessToken);
          useAuthStore.setState({ user: res.data.user, error: null });
          // Brief pause so the user sees the success state, then go home
          setTimeout(() => { navigate("/", { replace: true }); }, 600);
        }
        // status === "pending" → keep polling
      } catch (err) {
        if (cancelledRef.current) return;
        // Stop polling on terminal errors (expired, consumed, etc).
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        const msg = err?.message || "QR session error";
        if (/expired|completed|consumed/i.test(msg)) {
          setStatus("expired");
        } else {
          setError(msg);
          setStatus("error");
        }
      }
    };

    // Kick off immediately + then every POLL_INTERVAL_MS
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [pairing, status, navigate]);

  const handleRefresh = useCallback(() => {
    // Trigger a full re-mount by reloading. Simpler than redoing all state.
    window.location.reload();
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 420 }}>
        <div className="auth-header" style={{ textAlign: "center" }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>
            🌐 LinguaChat
          </h1>
          <p style={{ color: "var(--text-tertiary)", fontSize: 13, marginTop: 4 }}>
            Sign in with QR code
          </p>
        </div>

        {status === "loading" && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div className="spinner spinner-md" style={{ margin: "0 auto" }} />
            <p style={{ marginTop: 12, fontSize: 13, color: "var(--text-secondary)" }}>
              Generating secure QR code…
            </p>
          </div>
        )}

        {(status === "waiting" || status === "approved") && pairing && (
          <>
            <div style={{
              background: "white",
              borderRadius: "var(--radius-lg)",
              padding: 16,
              margin: "12px auto",
              width: "fit-content",
            }}>
              <QRCodeSVG value={qrUrl} size={224} level="M" includeMargin={false} />
            </div>

            <div style={{ textAlign: "center", marginTop: 8 }}>
              <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginBottom: 4 }}>
                Or enter this code manually on your phone
              </div>
              <div style={{
                fontFamily: "var(--font-mono)",
                fontSize: 24,
                fontWeight: 700,
                letterSpacing: 4,
                color: "var(--accent)",
                background: "var(--surface-raised)",
                border: "1px solid var(--border)",
                padding: "8px 16px",
                borderRadius: "var(--radius-md)",
                display: "inline-block",
              }}>
                {pairing.code}
              </div>
            </div>

            <ol style={{
              fontSize: 12, color: "var(--text-secondary)",
              marginTop: 18, paddingLeft: 22, lineHeight: 1.7,
            }}>
              <li>Open LinguaChat on your phone (already signed in).</li>
              <li>Tap <strong>Sign in via QR code</strong> on the login screen, or scan this QR with your camera.</li>
              <li>On your phone, confirm the code matches and tap <strong>Approve</strong>.</li>
            </ol>

            {status === "approved" && (
              <div style={{
                marginTop: 12, padding: 12, textAlign: "center",
                background: "var(--green-soft)", color: "var(--green)",
                borderRadius: "var(--radius-md)", fontSize: 13, fontWeight: 600,
              }}>
                ✓ Approved — signing you in…
              </div>
            )}
          </>
        )}

        {status === "expired" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>⌛</div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>
              This QR code has expired or was already used.
            </p>
            <button
              onClick={handleRefresh}
              className="btn btn-primary"
              style={{ marginTop: 12 }}
            >
              Generate new QR code
            </button>
          </div>
        )}

        {status === "error" && (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{
              padding: 12, marginBottom: 12,
              background: "var(--red-soft)", border: "1px solid var(--red)",
              borderRadius: "var(--radius-md)", color: "var(--red)", fontSize: 13,
            }}>
              {error || "Something went wrong"}
            </div>
            <button onClick={handleRefresh} className="btn btn-primary">
              Try again
            </button>
          </div>
        )}

        <div style={{ textAlign: "center", marginTop: 18, fontSize: 13 }}>
          <Link to="/login" style={{ color: "var(--accent)" }}>← Back to login</Link>
        </div>
      </div>
    </div>
  );
}
