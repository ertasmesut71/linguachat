import { useNavigate } from "react-router-dom";

export default function PaymentCancel() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "var(--bg-primary)", color: "var(--text-primary)" }}>
      <div style={{ maxWidth: 420, width: "100%", textAlign: "center", padding: 32, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)" }}>
        <div style={{ fontSize: 44, marginBottom: 12 }} aria-hidden="true">↩️</div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Ödeme iptal edildi.</h2>
        <button className="btn btn-primary" onClick={() => navigate("/", { replace: true })}>
          Ana sayfaya dön
        </button>
      </div>
    </div>
  );
}
