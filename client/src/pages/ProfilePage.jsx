import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useUserStore } from "../store/userStore";
import { useForm } from "../hooks/useForm";
import { getLanguage, getAvatarGradient, getInitials, USER_STATUSES } from "../lib/constants";
import LanguageSelect from "../components/ui/LanguageSelect";
import Avatar from "../components/ui/Avatar";
import Spinner from "../components/ui/Spinner";
import { ArrowLeft, Check, Globe, Shield, Bell, Camera } from "lucide-react";
import { isPushSupported, getExistingSubscription, subscribeToPush, unsubscribeFromPush, fetchVapidPublicKey } from "../lib/push";
import api, { mediaUrl } from "../api/client";

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();
  const { updateProfile, updateLanguage, updateStatus } = useUserStore();
  const [saved, setSaved] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  // Avatar upload
  const avatarInputRef = useRef(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState(null);

  // Billing: start Stripe Checkout (api client adds the Bearer token from localStorage)
  const [premiumLoading, setPremiumLoading] = useState(false);
  const [premiumError, setPremiumError] = useState(null);
  const handleGoPremium = async () => {
    setPremiumLoading(true);
    setPremiumError(null);
    try {
      const res = await api.post("/billing/create-checkout-session");
      const url = res?.data?.url;
      if (!url) throw new Error("Ödeme sayfası açılamadı.");
      window.location.href = url;
    } catch (err) {
      setPremiumError(err?.message || "Ödeme sayfası açılamadı. Lütfen tekrar deneyin.");
      setPremiumLoading(false);
    }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError(null);
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) {
      setAvatarError("Please choose a JPEG, PNG, WebP or GIF image.");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Avatar must be under 5 MB.");
      if (avatarInputRef.current) avatarInputRef.current.value = "";
      return;
    }

    setAvatarUploading(true);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read the selected file"));
        reader.readAsDataURL(file);
      });
      const res = await api.post("/users/me/avatar", { data: base64, mimeType: file.type });
      setUser({ avatarUrl: res.data.avatarUrl });
    } catch (err) {
      console.error("Avatar upload failed:", err);
      setAvatarError(err?.message || "Avatar upload failed. Please try again.");
    }
    setAvatarUploading(false);
    // Reset input so re-selecting the same file triggers onChange
    if (avatarInputRef.current) avatarInputRef.current.value = "";
  };

  // E2 — Push notifications
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushServerReady, setPushServerReady] = useState(true); // assume yes until 503
  const [pushError, setPushError] = useState(null);

  useEffect(() => {
    if (!isPushSupported()) return;
    setPushSupported(true);
    // Check existing subscription
    getExistingSubscription().then((sub) => setPushEnabled(!!sub));
    // Check server VAPID
    fetchVapidPublicKey().then((key) => setPushServerReady(!!key));
  }, []);

  const {
    values,
    errors,
    isSubmitting,
    submitError,
    handleChange,
    handleBlur,
    handleSubmit,
    setValue,
  } = useForm({
    initialValues: {
      displayName: user?.displayName || "",
      bio: user?.bio || "",
      primaryLang: user?.primaryLang || "en",
    },
    validate: (vals) => {
      const errs = {};
      if (!vals.displayName.trim()) {
        errs.displayName = "Display name is required";
      } else if (vals.displayName.trim().length > 100) {
        errs.displayName = "Must be under 100 characters";
      }
      if (vals.bio && vals.bio.length > 500) {
        errs.bio = "Must be under 500 characters";
      }
      return errs;
    },
    onSubmit: async (vals) => {
      const profileUpdates = {
        displayName: vals.displayName.trim(),
        bio: vals.bio.trim(),
      };

      // Update profile fields
      const updatedUser = await updateProfile(profileUpdates);

      // Update language separately if changed
      if (vals.primaryLang !== user.primaryLang) {
        await updateLanguage(vals.primaryLang);
        updatedUser.primaryLang = vals.primaryLang;
      }

      // Sync auth store
      setUser(updatedUser);

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const handleStatusChange = async (newStatus) => {
    setStatusLoading(true);
    try {
      const updated = await updateStatus(newStatus);
      setUser({ status: updated.status });
    } catch {
      // toast handles error
    }
    setStatusLoading(false);
  };

  const currentLang = getLanguage(values.primaryLang);

  return (
    <div
      style={{
        height: "100vh",
        background: "var(--bg-primary)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          padding: "14px 24px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-secondary)",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          className="icon-btn"
          onClick={() => navigate("/")}
          title="Back to chats"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>Profile Settings</h2>
        <div style={{ flex: 1 }} />
        {saved && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: "var(--green)",
              fontSize: 13,
              fontWeight: 500,
              animation: "toastIn 0.3s ease",
            }}
          >
            <Check size={16} />
            Saved
          </div>
        )}
      </div>

      {/* Content */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          justifyContent: "center",
          padding: "32px 24px",
        }}
      >
        <div style={{ width: "100%", maxWidth: 540 }}>
          {/* Avatar section */}
          <div className="profile-section">
            <div
              style={{ position: "relative", cursor: "pointer", display: "inline-block" }}
              onClick={() => avatarInputRef.current?.click()}
              title="Change avatar"
            >
              {user?.avatarUrl ? (
                <img
                  src={mediaUrl(user.avatarUrl)}
                  alt="Avatar"
                  style={{ width: 80, height: 80, borderRadius: "50%", objectFit: "cover", display: "block" }}
                />
              ) : (
                <div
                  className={`profile-avatar-large ${getAvatarGradient(user?.id)}`}
                >
                  {getInitials(values.displayName || user?.displayName)}
                </div>
              )}
              <div style={{
                position: "absolute", bottom: 0, right: 0,
                width: 28, height: 28, borderRadius: "50%",
                background: "var(--accent)", border: "2px solid var(--bg-primary)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {avatarUploading ? <Spinner size="xs" /> : <Camera size={13} color="white" />}
              </div>
            </div>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarChange}
              style={{ display: "none" }}
            />
            <div className="profile-name">
              {values.displayName || user?.displayName}
            </div>
            <div className="profile-email">{user?.email}</div>
            {avatarError && (
              <div role="alert" style={{ marginTop: 8, fontSize: 12, color: "var(--red)", maxWidth: 320, textAlign: "center" }}>
                {avatarError}
              </div>
            )}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              <Globe size={14} />
              {currentLang.flag} {currentLang.name}
            </div>
          </div>

          {/* Profile form */}
          <form onSubmit={handleSubmit}>
            {submitError && (
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--red-soft)",
                  border: "1px solid var(--red)",
                  borderRadius: "var(--radius-md)",
                  color: "var(--red)",
                  fontSize: 13,
                  marginBottom: 20,
                }}
              >
                {submitError}
              </div>
            )}

            {/* Display Name */}
            <div className="form-group">
              <label className="form-label" htmlFor="displayName">
                Display Name
              </label>
              <input
                id="displayName"
                name="displayName"
                type="text"
                className="form-input"
                placeholder="Your display name"
                value={values.displayName}
                onChange={handleChange}
                onBlur={handleBlur}
                autoComplete="name"
              />
              {errors.displayName && (
                <div className="form-error">{errors.displayName}</div>
              )}
            </div>

            {/* Bio */}
            <div className="form-group">
              <label className="form-label" htmlFor="bio">
                Bio
              </label>
              <textarea
                id="bio"
                name="bio"
                className="form-input"
                placeholder="Tell others about yourself..."
                value={values.bio}
                onChange={handleChange}
                onBlur={handleBlur}
                rows={3}
                style={{ resize: "vertical", minHeight: 72 }}
              />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}
              >
                {errors.bio ? (
                  <div className="form-error">{errors.bio}</div>
                ) : (
                  <span />
                )}
                <span
                  style={{
                    fontSize: 11,
                    color:
                      values.bio.length > 450
                        ? "var(--red)"
                        : "var(--text-tertiary)",
                  }}
                >
                  {values.bio.length}/500
                </span>
              </div>
            </div>

            {/* Language */}
            <div className="form-group">
              <label className="form-label" htmlFor="primaryLang">
                Primary Language
              </label>
              <LanguageSelect
                value={values.primaryLang}
                onChange={(e) => setValue("primaryLang", e.target.value)}
                name="primaryLang"
              />
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-tertiary)",
                  marginTop: 4,
                }}
              >
                Incoming messages will be auto-translated to this language
              </div>
            </div>

            {/* Save button — placed prominently after core profile fields */}
            <button
              type="submit"
              className="btn btn-primary btn-block btn-lg"
              disabled={isSubmitting}
              style={{ marginTop: 8, marginBottom: 16 }}
            >
              {isSubmitting ? (
                <>
                  <Spinner size="sm" /> Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </button>

            {/* Online Status */}
            <div className="form-group">
              <label className="form-label">Online Status</label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                {Object.entries(USER_STATUSES).map(([key, config]) => {
                  const isActive = user?.status === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleStatusChange(key)}
                      disabled={statusLoading}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "10px 14px",
                        background: isActive
                          ? "var(--accent-soft)"
                          : "var(--bg-tertiary)",
                        border: `1px solid ${
                          isActive ? "var(--accent)" : "var(--border)"
                        }`,
                        borderRadius: "var(--radius-md)",
                        color: isActive
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                        fontSize: 13,
                        fontWeight: isActive ? 600 : 400,
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                        transition: "all var(--duration) var(--ease)",
                      }}
                    >
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: config.color,
                          flexShrink: 0,
                        }}
                      />
                      {config.label}
                    </button>
                  );
                })}
              </div>
            </div>

          </form>

          {/* E2 — Push Notifications */}
          {pushSupported && (
            <div
              style={{
                marginTop: 24,
                padding: "16px",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.8px",
                  marginBottom: 12,
                }}
              >
                <Bell size={14} />
                Push Notifications
              </div>

              {!pushServerReady ? (
                <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5 }}>
                  Push notifications are not configured on this server.
                  <br />
                  <span style={{ fontSize: 11 }}>
                    The server operator can enable them by setting <code>VAPID_PUBLIC_KEY</code>,{" "}
                    <code>VAPID_PRIVATE_KEY</code>, and <code>VAPID_SUBJECT</code> environment variables.
                  </span>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 500 }}>
                        {pushEnabled ? "Notifications enabled" : "Notifications disabled"}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>
                        {pushEnabled
                          ? "You'll be notified when you receive messages while offline."
                          : "Enable to get notified even when the app is closed."}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pushLoading}
                      onClick={async () => {
                        setPushLoading(true);
                        setPushError(null);
                        try {
                          if (pushEnabled) {
                            const result = await unsubscribeFromPush();
                            if (result.ok) setPushEnabled(false);
                            else setPushError(result.reason);
                          } else {
                            const result = await subscribeToPush();
                            if (result.ok) setPushEnabled(true);
                            else setPushError(result.reason);
                          }
                        } catch (err) {
                          setPushError(err?.message || "Failed");
                        }
                        setPushLoading(false);
                      }}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "var(--radius-md)",
                        border: "1px solid var(--border)",
                        background: pushEnabled ? "var(--red-soft)" : "var(--accent-soft)",
                        color: pushEnabled ? "var(--red)" : "var(--accent)",
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                        minWidth: 90,
                      }}
                    >
                      {pushLoading ? "…" : pushEnabled ? "Disable" : "Enable"}
                    </button>
                  </div>
                  {pushError && (
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>
                      {pushError}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Premium (Stripe billing) */}
          <div
            style={{
              marginTop: 32,
              padding: "16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 12 }}>
              Premium
            </div>
            {user?.subscriptionStatus === "active" ? (
              <div style={{ fontSize: 13, color: "var(--green)" }}>Premium üyeliğiniz aktif.</div>
            ) : (
              <>
                <button className="btn btn-primary" onClick={handleGoPremium} disabled={premiumLoading}>
                  {premiumLoading ? <Spinner size="sm" /> : "Premium'a Geç"}
                </button>
                {premiumError && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--red)" }}>{premiumError}</div>
                )}
              </>
            )}
          </div>

          {/* Account info */}
          <div
            style={{
              marginTop: 32,
              padding: "16px",
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--text-secondary)",
                textTransform: "uppercase",
                letterSpacing: "0.8px",
                marginBottom: 12,
              }}
            >
              <Shield size={14} />
              Account
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "8px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ color: "var(--text-tertiary)" }}>Email</span>
              <span>{user?.email}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "8px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span style={{ color: "var(--text-tertiary)" }}>Role</span>
              <span style={{ textTransform: "capitalize" }}>
                {user?.role || "user"}
              </span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "8px 0",
              }}
            >
              <span style={{ color: "var(--text-tertiary)" }}>
                Member since
              </span>
              <span>
                {user?.createdAt
                  ? new Date(user.createdAt).toLocaleDateString("en-US", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })
                  : "—"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
