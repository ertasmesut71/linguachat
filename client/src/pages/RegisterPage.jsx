import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useForm } from "../hooks/useForm";
import LanguageSelect from "../components/ui/LanguageSelect";
import Spinner from "../components/ui/Spinner";
import api, { setAccessToken } from "../api/client";

export default function RegisterPage() {
  const navigate = useNavigate();
  const { register, error: authError, clearError } = useAuthStore();
  const [mode, setMode] = useState("sms"); // "email" | "phone" | "sms"

  // ─── SMS passwordless state ───
  const [smsStep, setSmsStep] = useState("phone"); // "phone" | "code" | "profile"
  const [smsPhone, setSmsPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [smsDevCode, setSmsDevCode] = useState(null);
  const [smsName, setSmsName] = useState("");
  const [smsLang, setSmsLang] = useState("en");
  const [smsLoading, setSmsLoading] = useState(false);
  const [smsError, setSmsError] = useState(null);

  // ─── Password form (email + phone modes) ───
  const {
    values, errors, isSubmitting, submitError,
    handleChange, handleBlur, handleSubmit, setValue,
  } = useForm({
    initialValues: {
      displayName: "", email: "", phoneNumber: "",
      password: "", confirmPassword: "", primaryLang: "en",
    },
    validate: (vals) => {
      const errs = {};
      if (!vals.displayName.trim()) errs.displayName = "Display name is required";
      else if (vals.displayName.trim().length > 100) errs.displayName = "Display name is too long";
      if (mode === "email") {
        if (!vals.email.trim()) errs.email = "Email is required";
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(vals.email)) errs.email = "Invalid email address";
      } else {
        if (!vals.phoneNumber.trim()) errs.phoneNumber = "Phone number is required";
        else if (vals.phoneNumber.replace(/[^\d]/g, "").length < 7) errs.phoneNumber = "Phone number too short";
        else if (vals.phoneNumber.replace(/[^\d]/g, "").length > 15) errs.phoneNumber = "Phone number too long";
      }
      if (!vals.password) errs.password = "Password is required";
      else if (vals.password.length < 8) errs.password = "Password must be at least 8 characters";
      if (vals.password && vals.confirmPassword !== vals.password) errs.confirmPassword = "Passwords do not match";
      return errs;
    },
    onSubmit: async (vals) => {
      clearError();
      await register({
        email: mode === "email" ? vals.email : undefined,
        phoneNumber: mode === "phone" ? vals.phoneNumber : undefined,
        password: vals.password,
        displayName: vals.displayName.trim(),
        primaryLang: vals.primaryLang,
      });
      navigate("/", { replace: true });
    },
  });

  // ─── SMS: request OTP ───
  const handleSmsRequest = async () => {
    const digits = smsPhone.replace(/[^\d]/g, "");
    if (digits.length < 7) { setSmsError("Enter a valid phone number with country code"); return; }
    setSmsLoading(true); setSmsError(null); setSmsDevCode(null);
    try {
      const res = await api.post("/auth/otp/request", { phone: smsPhone.trim(), purpose: "signup" });
      if (res.data?.dev?.code) setSmsDevCode(res.data.dev.code);
      setSmsStep("code");
    } catch (err) {
      setSmsError(err?.message || "Failed to send verification code");
    }
    setSmsLoading(false);
  };

  // ─── SMS: verify OTP + create account ───
  const handleSmsVerify = async () => {
    if (smsCode.length !== 6) { setSmsError("Enter the 6-digit code"); return; }
    if (!smsName.trim()) { setSmsError("Display name is required"); return; }
    setSmsLoading(true); setSmsError(null);
    try {
      const res = await api.post("/auth/otp/verify", {
        phone: smsPhone.trim(), code: smsCode, purpose: "signup",
        displayName: smsName.trim(), primaryLang: smsLang,
      });
      if (res.data?.accessToken) {
        setAccessToken(res.data.accessToken);
        useAuthStore.setState({ user: res.data.user, error: null });
        navigate("/", { replace: true });
      } else {
        setSmsError("Account created but no login token received");
      }
    } catch (err) {
      setSmsError(err?.message || "Verification failed");
    }
    setSmsLoading(false);
  };

  const displayError = mode === "sms" ? smsError : (submitError || authError);

  const modeBtn = (key, label) => (
    <button type="button" onClick={() => { setMode(key); clearError(); setSmsError(null); }} style={{
      flex: 1, padding: "7px 0", borderRadius: "var(--radius-md)",
      border: `1.5px solid ${mode === key ? "var(--accent)" : "var(--border)"}`,
      background: mode === key ? "var(--accent-soft)" : "transparent",
      color: mode === key ? "var(--accent)" : "var(--text-secondary)",
      fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
    }}>
      {label}
    </button>
  );

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-card">
        <div className="auth-logo">L</div>
        <h1 className="auth-title">Join LinguaChat</h1>
        <p className="auth-desc">Break language barriers, one chat at a time</p>

        {displayError && (
          <div style={{
            padding: "10px 14px", background: "var(--red-soft)",
            border: "1px solid var(--red)", borderRadius: "var(--radius-md)",
            color: "var(--red)", fontSize: 13, marginBottom: 20,
          }}>{displayError}</div>
        )}

        {/* Mode toggle */}
        <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
          {modeBtn("sms", "SMS Signup")}
          {modeBtn("email", "Email")}
          {modeBtn("phone", "Phone + Password")}
        </div>

        {/* ═══ SMS PASSWORDLESS ═══ */}
        {mode === "sms" && smsStep === "phone" && (
          <div>
            <div className="form-group">
              <label className="form-label" htmlFor="smsPhone">Phone Number</label>
              <input id="smsPhone" type="tel" className="form-input"
                placeholder="+90 555 123 4567" value={smsPhone}
                onChange={(e) => setSmsPhone(e.target.value)}
                autoComplete="tel" autoFocus />
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                Include country code. We'll send a 6-digit verification code.
              </div>
            </div>
            <button onClick={handleSmsRequest} disabled={smsLoading}
              className="btn btn-primary btn-block btn-lg" style={{ marginTop: 8 }}>
              {smsLoading ? <><Spinner size="sm" /> Sending code...</> : "Send Verification Code"}
            </button>
          </div>
        )}

        {mode === "sms" && smsStep === "code" && (
          <div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>
              Enter the 6-digit code sent to <strong>{smsPhone}</strong>
            </div>

            {smsDevCode && (
              <div style={{
                padding: "8px 12px", background: "var(--accent-soft)",
                border: "1px solid var(--accent)", borderRadius: "var(--radius-md)",
                fontSize: 12, color: "var(--accent)", marginBottom: 12, textAlign: "center",
              }}>
                Test mode — your code is: <strong style={{ fontSize: 16, letterSpacing: 2 }}>{smsDevCode}</strong>
              </div>
            )}

            <div className="form-group">
              <input type="text" className="form-input" placeholder="000000"
                value={smsCode} maxLength={6} autoComplete="one-time-code" inputMode="numeric" autoFocus
                onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{ textAlign: "center", fontSize: 24, letterSpacing: 8, fontWeight: 700 }} />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="smsName">Display Name</label>
              <input id="smsName" type="text" className="form-input" placeholder="Your name"
                value={smsName} onChange={(e) => setSmsName(e.target.value)} autoComplete="name" />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="smsLang">Primary Language</label>
              <LanguageSelect value={smsLang} onChange={(e) => setSmsLang(e.target.value)} name="smsLang" />
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                Messages will be translated into this language
              </div>
            </div>

            <button onClick={handleSmsVerify}
              disabled={smsLoading || smsCode.length !== 6 || !smsName.trim()}
              className="btn btn-primary btn-block btn-lg" style={{ marginTop: 8 }}>
              {smsLoading ? <><Spinner size="sm" /> Creating account...</> : "Verify & Create Account"}
            </button>

            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
              <button onClick={() => { setSmsStep("phone"); setSmsCode(""); setSmsDevCode(null); setSmsError(null); }}
                style={{ background: "none", border: "none", color: "var(--text-tertiary)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12 }}>
                ← Change number
              </button>
              <button onClick={() => { setSmsCode(""); setSmsDevCode(null); handleSmsRequest(); }} disabled={smsLoading}
                style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontFamily: "var(--font-sans)", fontSize: 12 }}>
                Resend code
              </button>
            </div>
          </div>
        )}

        {/* ═══ EMAIL / PHONE+PASSWORD ═══ */}
        {(mode === "email" || mode === "phone") && (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="displayName">Display Name</label>
              <input id="displayName" name="displayName" type="text" className="form-input"
                placeholder="Your name" value={values.displayName}
                onChange={handleChange} onBlur={handleBlur} autoComplete="name" autoFocus />
              {errors.displayName && <div className="form-error">{errors.displayName}</div>}
            </div>

            {mode === "email" ? (
              <div className="form-group">
                <label className="form-label" htmlFor="email">Email</label>
                <input id="email" name="email" type="email" className="form-input"
                  placeholder="you@example.com" value={values.email}
                  onChange={handleChange} onBlur={handleBlur} autoComplete="email" />
                {errors.email && <div className="form-error">{errors.email}</div>}
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label" htmlFor="phoneNumber">Phone Number</label>
                <input id="phoneNumber" name="phoneNumber" type="tel" className="form-input"
                  placeholder="+90 555 123 4567" value={values.phoneNumber}
                  onChange={handleChange} onBlur={handleBlur} autoComplete="tel" />
                {errors.phoneNumber && <div className="form-error">{errors.phoneNumber}</div>}
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="password">Password</label>
              <input id="password" name="password" type="password" className="form-input"
                placeholder="Min. 8 characters" value={values.password}
                onChange={handleChange} onBlur={handleBlur} autoComplete="new-password" />
              {errors.password && <div className="form-error">{errors.password}</div>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" name="confirmPassword" type="password" className="form-input"
                placeholder="Repeat your password" value={values.confirmPassword}
                onChange={handleChange} onBlur={handleBlur} autoComplete="new-password" />
              {errors.confirmPassword && <div className="form-error">{errors.confirmPassword}</div>}
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="primaryLang">Primary Language</label>
              <LanguageSelect value={values.primaryLang} onChange={(e) => setValue("primaryLang", e.target.value)} name="primaryLang" />
              <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
                Messages from other languages will be translated into this language
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={isSubmitting} style={{ marginTop: 8 }}>
              {isSubmitting ? <><Spinner size="sm" /> Creating account...</> : "Create Account"}
            </button>
          </form>
        )}

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign In</Link>
        </div>
      </div>
    </div>
  );
}
