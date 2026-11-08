import { useState, useMemo } from "react";
import { useUserStore } from "../../store/userStore";
import { useAuthStore } from "../../store/authStore";
import { useChatStore } from "../../store/chatStore";
import { getLanguage } from "../../lib/constants";
import Avatar from "../ui/Avatar";
import { X, Search, Check, Users, Plus } from "lucide-react";

export default function CreateGroupModal({ onClose, onCreated }) {
  const me = useAuthStore((s) => s.user);
  const { userList } = useUserStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState(new Set());
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return userList.filter((u) => u.id !== me?.id && (u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
  }, [userList, search, me]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError("Group name is required"); return; }
    if (selected.size === 0) { setError("Select at least one member"); return; }
    setCreating(true);
    setError(null);
    try {
      const { useChatStore: cs } = await import("../../store/chatStore");
      const data = await (await import("../../api/client")).default.post("/chats/group", {
        name: name.trim(),
        description: description.trim() || undefined,
        memberIds: [...selected],
      });
      // Refresh chats
      cs.getState().fetchChats();
      cs.getState().setActiveChat(data.data.chat.id);
      onCreated?.(data.data.chat);
      onClose();
    } catch (err) {
      setError(err?.message || "Failed to create group");
      setCreating(false);
    }
  };

  const selectedUsers = userList.filter((u) => selected.has(u.id));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", padding: 0, width: 480, maxWidth: "90vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={18} style={{ color: "var(--accent)" }} />
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>New Group Chat</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Group info */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border-subtle)" }}>
          <input className="form-input" placeholder="Group name *" value={name} onChange={(e) => setName(e.target.value)} style={{ marginBottom: 8 }} />
          <input className="form-input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {/* Selected chips */}
        {selectedUsers.length > 0 && (
          <div style={{ padding: "8px 24px", display: "flex", flexWrap: "wrap", gap: 6, borderBottom: "1px solid var(--border-subtle)" }}>
            {selectedUsers.map((u) => (
              <div key={u.id} onClick={() => toggle(u.id)} style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 8px 3px 3px",
                background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "var(--radius-full)",
                cursor: "pointer", fontSize: 11, color: "var(--accent)", fontWeight: 500,
              }}>
                <Avatar user={u} size={18} />
                {u.displayName.split(" ")[0]}
                <X size={10} />
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div style={{ padding: "12px 24px 8px" }}>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} />
            <input className="form-input" placeholder="Search contacts..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 36, borderRadius: "var(--radius-full)", fontSize: 13 }} />
          </div>
        </div>

        {/* Contact list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 16px" }}>
          {filtered.map((u) => {
            const isSelected = selected.has(u.id);
            const lang = getLanguage(u.primaryLang);
            return (
              <div key={u.id} onClick={() => toggle(u.id)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 8px",
                borderRadius: "var(--radius-md)", cursor: "pointer",
                background: isSelected ? "var(--accent-soft)" : "transparent",
                transition: "background 0.15s ease",
              }}
                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
              >
                <Avatar user={u} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{u.displayName}</div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{lang.flag} {lang.name}</div>
                </div>
                <div style={{
                  width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                  border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                  background: isSelected ? "var(--accent)" : "transparent", color: "white",
                  transition: "all 0.15s ease",
                }}>
                  {isSelected && <Check size={13} />}
                </div>
              </div>
            );
          })}
        </div>

        {/* Error + Create */}
        <div style={{ padding: "12px 24px 20px", borderTop: "1px solid var(--border)" }}>
          {error && <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{error}</div>}
          <button onClick={handleCreate} disabled={creating} className="btn btn-primary btn-block" style={{ gap: 8 }}>
            {creating ? <><div className="spinner spinner-sm" /> Creating...</> : <><Plus size={15} /> Create Group ({selected.size + 1} members)</>}
          </button>
        </div>
      </div>
    </div>
  );
}
