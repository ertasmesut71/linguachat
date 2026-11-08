import { Sparkles } from "lucide-react";

export default function SmartReplies({ replies, onSelect, isLoading }) {
  if (isLoading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "6px 0",
        fontSize: 12, color: "var(--text-tertiary)",
      }}>
        <Sparkles size={12} style={{ color: "var(--accent)" }} />
        <span style={{ display: "inline-flex", gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span key={i} style={{
              width: 4, height: 4, borderRadius: "50%", background: "var(--accent)",
              animation: `typingBounce 1.4s infinite ease-in-out`,
              animationDelay: `${i * 0.2}s`,
            }} />
          ))}
        </span>
        Thinking of replies...
        <style>{`@keyframes typingBounce { 0%,80%,100% { transform:translateY(0); } 40% { transform:translateY(-4px); } }`}</style>
      </div>
    );
  }

  if (!replies || replies.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 0" }}>
      <Sparkles size={12} style={{ color: "var(--accent)", marginTop: 5, flexShrink: 0 }} />
      {replies.map((reply, i) => (
        <button key={i} onClick={() => onSelect(reply)} style={{
          padding: "5px 12px", borderRadius: "var(--radius-full)",
          border: "1px solid var(--border)", background: "var(--surface)",
          color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
          fontFamily: "var(--font-sans)", whiteSpace: "nowrap",
          transition: "all var(--duration) var(--ease)",
          maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
        }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "var(--surface)"; }}
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
