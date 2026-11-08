import { useState } from "react";
import { useAuthStore } from "../../store/authStore";
import api from "../../api/client";
import { Sparkles, CheckCircle, MessageCircle, Briefcase, Zap, AlignLeft, Heart } from "lucide-react";

const TONES = [
  { key: "formal", label: "Formal", icon: Briefcase },
  { key: "casual", label: "Casual", icon: MessageCircle },
  { key: "professional", label: "Professional", icon: CheckCircle },
  { key: "enthusiastic", label: "Enthusiastic", icon: Zap },
  { key: "concise", label: "Concise", icon: AlignLeft },
  { key: "polite", label: "Polite", icon: Heart },
];

export default function AiToolbar({ text, onTextChange, disabled }) {
  const me = useAuthStore((s) => s.user);
  const [loading, setLoading] = useState(null); // 'grammar' | tone key | null

  const handleGrammar = async () => {
    if (!text?.trim() || loading) return;
    setLoading("grammar");
    try {
      const data = await api.post("/ai/grammar", { text, lang: me?.primaryLang || "en" });
      if (data.data.hasChanges) {
        onTextChange(data.data.corrected);
      }
    } catch {}
    setLoading(null);
  };

  const handleTone = async (tone) => {
    if (!text?.trim() || loading) return;
    setLoading(tone);
    try {
      const data = await api.post("/ai/rewrite", { text, tone, lang: me?.primaryLang || "en" });
      onTextChange(data.data.rewritten);
    } catch {}
    setLoading(null);
  };

  if (disabled || !text?.trim()) return null;

  return (
    <div style={{
      display: "flex", gap: 4, padding: "4px 0", flexWrap: "wrap", alignItems: "center",
    }}>
      <span style={{ fontSize: 10, color: "var(--text-tertiary)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginRight: 2 }}>
        <Sparkles size={10} style={{ verticalAlign: -1, marginRight: 3 }} />AI
      </span>

      {/* Grammar fix */}
      <button onClick={handleGrammar} disabled={!!loading} style={{
        padding: "3px 10px", borderRadius: "var(--radius-full)",
        border: "1px solid var(--border)", background: loading === "grammar" ? "var(--accent-soft)" : "var(--surface)",
        color: loading === "grammar" ? "var(--accent)" : "var(--text-tertiary)",
        fontSize: 11, fontWeight: 500, cursor: loading ? "wait" : "pointer",
        fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 4,
        transition: "all 0.15s ease", opacity: loading && loading !== "grammar" ? 0.4 : 1,
      }}
        onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = "var(--green)"; e.currentTarget.style.color = "var(--green)"; } }}
        onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-tertiary)"; } }}
      >
        {loading === "grammar" ? <div className="spinner spinner-sm" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : <CheckCircle size={11} />}
        Grammar
      </button>

      {/* Tone rewrite buttons */}
      {TONES.map(({ key, label, icon: Icon }) => (
        <button key={key} onClick={() => handleTone(key)} disabled={!!loading} style={{
          padding: "3px 10px", borderRadius: "var(--radius-full)",
          border: "1px solid var(--border)", background: loading === key ? "var(--accent-soft)" : "var(--surface)",
          color: loading === key ? "var(--accent)" : "var(--text-tertiary)",
          fontSize: 11, fontWeight: 500, cursor: loading ? "wait" : "pointer",
          fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", gap: 4,
          transition: "all 0.15s ease", opacity: loading && loading !== key ? 0.4 : 1,
        }}
          onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; } }}
          onMouseLeave={(e) => { if (!loading) { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-tertiary)"; } }}
        >
          {loading === key ? <div className="spinner spinner-sm" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : <Icon size={11} />}
          {label}
        </button>
      ))}
    </div>
  );
}
