import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import api from "../api/client";

const REDIRECT_MS = 3000;

export default function PaymentSuccess() {
  const navigate = useNavigate();

  useEffect(() => {
    // Reload the profile so the new subscription status shows up (webhook may still be in flight).
    api.get("/auth/me").then((d) => { if (d?.data?.user) useAuthStore.getState().setUser(d.data.user); }).catch(() => {});
    const t = setTimeout(() => navigate("/", { replace: true }), REDIRECT_MS);
    return () => clearTimeout(t);
  }, [navigate]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center", padding: 32, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">✅</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Ödeme başarılı! Premium üyeliğiniz aktif edildi.</h2>
        <p style={{ fontSize: 13, color: "var(--text-tertiary)" }}>3 saniye içinde ana sayfaya yönlendiriliyorsunuz…</p>
      </div>
    </div>
  );
}
