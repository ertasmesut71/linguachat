import { useState, useCallback } from "react";
import { X, Search } from "lucide-react";
import api from "../../api/client";
import SidePanel from "../ui/SidePanel";

function highlight(text, query) {
  if (!query?.trim()) return text;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
  return parts.map((p, i) =>
    p.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "var(--accent-soft)", color: "var(--accent)", borderRadius: 2, padding: "0 2px" }}>{p}</mark>
      : p
  );
}

export default function SearchPanel({ chatId, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const doSearch = useCallback(async (q) => {
    if (!q || q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const endpoint = chatId ? `/search?q=${encodeURIComponent(q)}&chatId=${chatId}` : `/search?q=${encodeURIComponent(q)}`;
      const data = await api.get(endpoint);
      setResults(data.data.results || []);
    } catch { setResults([]); }
    setLoading(false);
  }, [chatId]);

  const handleChange = (e) => {
    setQuery(e.target.value);
    clearTimeout(handleChange._t);
    handleChange._t = setTimeout(() => doSearch(e.target.value), 300);
  };

  return (
    <SidePanel onClose={onClose}>
      <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600 }}>Search Messages</h3>
        <button className="icon-btn" onClick={onClose}><X size={18} /></button>
      </div>
      <div style={{ padding: "12px 20px" }}>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
          <input className="form-input" placeholder="Search..." value={query} onChange={handleChange} autoFocus style={{ paddingLeft: 36, borderRadius: "var(--radius-full)", fontSize: 13 }} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
        {loading && <div style={{ display: "flex", justifyContent: "center", padding: 20 }}><div className="spinner spinner-sm" /></div>}
        {!loading && query.trim().length >= 2 && results.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-tertiary)", fontSize: 13, padding: 20 }}>No results found</div>
        )}
        {results.map((msg) => (
          <div key={msg.id} onClick={() => onNavigate?.(msg)}
            style={{ padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", marginBottom: 2, transition: "background 0.15s" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
            <div style={{ fontSize: 13, lineHeight: 1.5 }}>{highlight((msg.matchedText || msg.content)?.slice(0, 120) || "", query)}</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 3, display: "flex", gap: 8, alignItems: "center" }}>
              <span>{msg.sender?.displayName || "Unknown"}</span>
              <span>{new Date(msg.createdAt).toLocaleDateString()}</span>
              {msg.type === "voice" && <span>🎤 Voice</span>}
              {msg.matchSource === "translation" && (
                <span style={{ fontSize: 10, background: "var(--bg-hover)", borderRadius: 4, padding: "1px 5px", color: "var(--text-tertiary)" }}>Translation</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </SidePanel>
  );
}
