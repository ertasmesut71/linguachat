import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useForm } from "../hooks/useForm";
import Spinner from "../components/ui/Spinner";
import api, { setAccessToken } from "../api/client";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, error: authError, clearError } = useAuthStore();
  const from = location.state?.from?.pathname || "/";

  // OTP flow state
  const [otpMode, setOtpMode] = useState(false);    // false = password, true = OTP
  const [otpStep, setOtpStep] = useState("phone");  // "phone" | "code"
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpDevCode, setOtpDevCode] = useState(null); // shown only in test mode
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState(null);

  // ─── Password login form ───
  const {
    values, errors, isSubmitting, submitError,
    handleChange, handleBlur, handleSubmit,
  } = useForm({
    initialValues: { identifier: "", password: "" },
    validate: (vals) => {
      const errs = {};
      if (!vals.identifier.trim()) errs.identifier = "Email or phone number is required";
      if (!vals.password) errs.password = "Password is required";
      return errs;
    },
    onSubmit: async (vals) => {
      clearError();
      await login({ identifier: vals.identifier.trim(), password: vals.password });
      navigate(from, { replace: true });
    },
  });

  // ─── OTP: request code ───
  const handleOtpRequest = async () => {
    if (!otpPhone.trim()) { setOtpError("Phone number is required"); return; }
    setOtpLoading(true);
    setOtpError(null);
    setOtpDevCode(null);
    try {
      const res = await api.post("/auth/otp/request", { phone: otpPhone.trim(), purpose: "login" });
      setOtpStep("code");
      // In dev/test mode, the server returns the code for convenience
      if (res.data?.dev?.code) setOtpDevCode(res.data.dev.code);
    } catch (err) {
      setOtpError(err?.message || "Failed to send verification code");
    }
    setOtpLoading(false);
  };

  // ─── OTP: verify code ───
  const handleOtpVerify = async () => {
    if (otpCode.length !== 6) { setOtpError("Enter the 6-digit code"); return; }
    setOtpLoading(true);
    setOtpError(null);
    try {
      const res = await api.post("/auth/otp/verify", { phone: otpPhone.trim(), code: otpCode, purpose: "login" });
      if (res.data?.accessToken) {
        setAccessToken(res.data.accessToken);
        useAuthStore.setState({ user: res.data.user, error: null });
        navigate(from, { replace: true });
      } else {
        setOtpError("Verification succeeded but no login token received");
      }
    } catch (err) {
      setOtpError(err?.message || "Verification failed");
    }
    setOtpLoading(false);
  };

  const displayError = otpMode ? otpError : (submitError || authError);

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />

      <div className="auth-card">
        <div className="auth-logo">L</div>
        <h1 className="auth-title">Welcome Back</h1>
        <p className="auth-desc">
          Sign in to continue your multilingual conversations
        </p>

        {displayError && (
          <div style={{
            padding: "10px 14px", background: "var(--red-soft)",
            border: "1px solid var(--red)", borderRadius: "var(--radius-md)",
            color: "var(--red)", fontSize: 13, marginBottom: 20,
          }}>
            {displayError}
          </div>
        )}

        {/* ═══ PASSWORD LOGIN ═══ */}
        {!otpMode && (
          <>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="identifier">Email or Phone Number</label>
                <input
                  id="identifier" name="identifier" type="text" className="form-input"
                  placeholder="you@example.com or +90 555 1234567"
                  value={values.identifier} onChange={handleChange} onBlur={handleBlur}
                  autoComplete="username" autoFocus
                />
                {errors.identifier && <div className="form-error">{errors.identifier}</div>}
              </div>

              <div className="form-group">
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                  <label className="form-label" htmlFor="password" style={{ marginBottom: 0 }}>Password</label>
                  <Link to="/forgot-password" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
                    Forgot password?
                  </Link>
                </div>
                <input
                  id="password" name="password" type="password" className="form-input"
                  placeholder="••••••••" value={values.password}
                  onChange={handleChange} onBlur={handleBlur} autoComplete="current-password"
                />
                {errors.password && <div className="form-error">{errors.password}</div>}
              </div>

              <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={isSubmitting} style={{ marginTop: 8 }}>
                {isSubmitting ? <><Spinner size="sm" /> Signing in...</> : "Sign In"}
              </button>
            </form>

            <div style={{ textAlign: "center", margin: "14px 0 0", fontSize: 13 }}>
              <button
                onClick={() => { setOtpMode(true); setOtpStep("phone"); setOtpError(null); clearError(); }}
                style={{
                  background: "none", border: "none", color: "var(--accent)",
                  cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13, fontWeight: 500,
                }}
              >
                Login with SMS code instead →
              </button>
            </div>
          </>
        )}

        {/* ═══ OTP LOGIN ═══ */}
        {otpMode && otpStep === "phone" && (
          <div>
            <div className="form-group">
              <label className="form-label" htmlFor="otpPhone">Phone Number</label>
              <input
                id="otpPhone" type="tel" className="form-input"
                placeholder="+90 555 123 4567"
                value={otpPhone} onChange={(e) => setOtpPhone(e.target.value)}
                autoComplete="tel" autoFocus
              />
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                We'll send a 6-digit verification code to this number.
              </div>
            </div>

            <button
              onClick={handleOtpRequest} disabled={otpLoading}
              className="btn btn-primary btn-block btn-lg" style={{ marginTop: 8 }}
            >
              {otpLoading ? <><Spinner size="sm" /> Sending code...</> : "Send Verification Code"}
            </button>

            <div style={{ textAlign: "center", margin: "14px 0 0", fontSize: 13 }}>
              <button
                onClick={() => { setOtpMode(false); setOtpError(null); }}
                style={{
                  background: "none", border: "none", color: "var(--text-tertiary)",
                  cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 13,
                }}
              >
                ← Back to password login
              </button>
            </div>
          </div>
        )}

        {otpMode && otpStep === "code" && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>
              Enter the 6-digit code sent to <strong>{otpPhone}</strong>
            </div>

            {/* Dev mode: show the code for testing */}
            {otpDevCode && (
              <div style={{
                padding: "8px 12px", background: "var(--accent-soft)",
                border: "1px solid var(--accent)", borderRadius: "var(--radius-md)",
                fontSize: 12, color: "var(--accent)", marginBottom: 12, textAlign: "center",
              }}>
                Test mode — your code is: <strong style={{ fontSize: 16, letterSpacing: 2 }}>{otpDevCode}</strong>
              </div>
            )}

            <div className="form-group">
              <input
                type="text" className="form-input"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                autoComplete="one-time-code"
                inputMode="numeric"
                autoFocus
                style={{ textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: 700 }}
              />
            </div>

            <button
              onClick={handleOtpVerify} disabled={otpLoading || otpCode.length !== 6}
              className="btn btn-primary btn-block btn-lg" style={{ marginTop: 8 }}
            >
              {otpLoading ? <><Spinner size="sm" /> Verifying...</> : "Verify & Sign In"}
            </button>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button
                onClick={() => { setOtpStep("phone"); setOtpCode(""); setOtpDevCode(null); setOtpError(null); }}
                style={{
                  background: "none", border: "none", color: "var(--text-tertiary)",
                  cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12,
                }}
              >
                ← Change number
              </button>
              <button
                onClick={() => { setOtpCode(""); setOtpDevCode(null); handleOtpRequest(); }}
                disabled={otpLoading}
                style={{
                  background: "none", border: "none", color: "var(--accent)",
                  cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12,
                }}
              >
                Resend code
              </button>
            </div>
          </div>
        )}

        <div className="auth-footer">
          Don't have an account?{" "}
          <Link to="/register">Create one</Link>
        </div>

        {/* D8 — QR-based desktop sign-in */}
        <div style={{
          marginTop: 14, paddingTop: 14,
          borderTop: "1px solid var(--border-subtle)",
          textAlign: "center", fontSize: 13, color: "var(--text-tertiary)",
        }}>
          On a desktop?{" "}
          <Link to="/qr-login" style={{ color: "var(--accent)", fontWeight: 500 }}>
            Sign in via QR code →
          </Link>
        </div>

        {/* Demo credentials hint */}
        {!otpMode && (
          <div style={{
            marginTop: 20, padding: "12px 14px",
            background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)",
            fontSize: 12, color: "var(--text-tertiary)", lineHeight: 1.6,
          }}>
            <strong style={{ color: "var(--text-secondary)" }}>Demo accounts:</strong><br />
            alex@linguachat.io / password123 (English)<br />
            elif@linguachat.io / password123 (Türkçe)<br />
            ayumi@linguachat.io / password123 (日本語)
          </div>
        )}
      </div>
    </div>
  );
}
