import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { useUserStore } from "../store/userStore";
import { useChatStore } from "../store/chatStore";
import { getLanguage } from "../lib/constants";
import { formatPhone } from "../lib/formatPhone";
import Avatar from "./ui/Avatar";
import Spinner from "./ui/Spinner";
import ChatList from "./chat/ChatList";
import ChatView from "./chat/ChatView";
import CreateGroupModal from "./chat/CreateGroupModal";
import ContactImportModal from "./ContactImportModal";
import { Settings, LogOut, Search, MessageSquarePlus, Users, Wifi, WifiOff, Plus, Phone, Upload, Bookmark, CheckCheck, Archive, ArrowLeft, List, Pencil, Trash2, PlusCircle, X } from "lucide-react";

export default function AppLayout() {
  const { user, logout } = useAuthStore();
  const { userList, isLoadingUsers, fetchUsers, searchUsers } = useUserStore();
  const { chats, archivedChats, activeChatId, isConnected, isLoadingChats, openDirectChat, onlineUsers, markAllChatsRead, openSavedMessages, fetchArchivedChats, customLists, fetchCustomLists, createCustomList, renameCustomList, deleteCustomList, addChatToList, removeChatFromList } = useChatStore();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState("chats");
  const [mobilePanel, setMobilePanel] = useState("sidebar");
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  // Fix G: Custom Lists UI state
  const [activeListId, setActiveListId] = useState(null);
  const [newListName, setNewListName] = useState("");
  const [editingListId, setEditingListId] = useState(null);
  const [editingListName, setEditingListName] = useState("");
  const [showContactImport, setShowContactImport] = useState(false);
  const [phoneSearchResults, setPhoneSearchResults] = useState([]);

  useEffect(() => { fetchUsers().catch(() => {}); }, [fetchUsers]);
  useEffect(() => { fetchCustomLists().catch(() => {}); }, [fetchCustomLists]);

  // D6 — On mobile, when no chat is open we should be looking at the sidebar.
  // This handles: initial load on mobile, returning from logout, and the case
  // where the active chat is cleared programmatically.
  useEffect(() => {
    if (!activeChatId) setMobilePanel("sidebar");
  }, [activeChatId]);

  const contacts = useMemo(() => {
    // Local filter — includes phone number matching
    let local = userList;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const digits = q.replace(/[^\d]/g, "");
      local = userList.filter((u) => {
        if (u.displayName.toLowerCase().includes(q)) return true;
        if (u.email && u.email.toLowerCase().includes(q)) return true;
        if (digits.length >= 4 && u.phoneNumber && u.phoneNumber.includes(digits)) return true;
        return false;
      });
    }
    // Merge server-side phone search results (dedup by ID)
    if (phoneSearchResults.length > 0) {
      const localIds = new Set(local.map((u) => u.id));
      const extras = phoneSearchResults.filter((u) => !localIds.has(u.id));
      if (extras.length > 0) return [...local, ...extras];
    }
    return local;
  }, [userList, searchQuery, phoneSearchResults]);

  // Server-side search when query looks like a phone number
  useEffect(() => {
    const digits = searchQuery.replace(/[^\d]/g, "");
    if (digits.length >= 4 && view === "contacts") {
      const timer = setTimeout(() => {
        searchUsers(searchQuery).then((r) => setPhoneSearchResults(r || [])).catch(() => setPhoneSearchResults([]));
      }, 300); // debounce
      return () => clearTimeout(timer);
    }
    setPhoneSearchResults([]);
  }, [searchQuery, view]);

  const userLang = getLanguage(user?.primaryLang);

  return (
    <div className="app-layout">
      <div className={`sidebar${mobilePanel !== "sidebar" ? " is-hidden" : ""}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <div className="sidebar-logo">L</div>
            <div className="sidebar-brand-text">
              <div className="sidebar-brand-name">LinguaChat</div>
              <div className="sidebar-brand-tag" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {isConnected ? <Wifi size={10} style={{ color: "var(--green)" }} /> : <WifiOff size={10} style={{ color: "var(--red)" }} />}
                {isConnected ? "Connected" : "Reconnecting..."}
              </div>
            </div>
            <div className="sidebar-actions">
              <button className="icon-btn" onClick={() => setShowCreateGroup(true)} title="New Group">
                <Plus size={18} />
              </button>
              <button className="icon-btn" onClick={() => navigate("/profile")} title="Profile">
                <Settings size={18} />
              </button>
              <button className="icon-btn" onClick={async () => { await logout(); navigate("/login"); }} title="Sign Out">
                <LogOut size={18} />
              </button>
            </div>
          </div>
          <div style={{ position: "relative" }}>
            <Search size={14} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
            <input className="form-input" placeholder={view === "chats" ? "Search conversations..." : "Search contacts..."} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} style={{ paddingLeft: 36, borderRadius: "var(--radius-full)", fontSize: 13 }} />
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", padding: "6px 16px 0", gap: 2, borderBottom: "1px solid var(--border-subtle)" }}>
          {["chats", "contacts", "lists"].map((tab) => (
            <button key={tab} onClick={() => { setView(tab); setSearchQuery(""); }} style={{
              flex: 1, padding: "8px 0", textAlign: "center", fontSize: 12, fontWeight: 600,
              color: view === tab ? "var(--accent)" : "var(--text-tertiary)",
              background: "none", border: "none", borderBottom: `2px solid ${view === tab ? "var(--accent)" : "transparent"}`,
              cursor: "pointer", fontFamily: "var(--font-sans)", transition: "color var(--duration) var(--ease)",
            }}>
              {tab === "contacts" && <Users size={12} style={{ verticalAlign: -1, marginRight: 4 }} />}
              {tab === "lists" && <List size={12} style={{ verticalAlign: -1, marginRight: 4 }} />}
              {tab === "chats" ? "Chats" : tab === "contacts" ? "Contacts" : "Lists"}
              {tab === "chats" && chats.filter((c) => c.unreadCount > 0).length > 0 && (
                <span style={{ marginLeft: 6, background: "var(--accent)", color: "white", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: "var(--radius-full)" }}>
                  {chats.filter((c) => c.unreadCount > 0).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "6px 8px" }}>
          {view === "archived" ? (
            <div>
              {/* Back button */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px 4px" }}>
                <button className="icon-btn" onClick={() => setView("chats")} title="Back to chats"><ArrowLeft size={16} /></button>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>Archived Chats</span>
              </div>
              {isLoadingArchived ? (
                <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner /></div>
              ) : archivedChats.length === 0 ? (
                <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>No archived chats</div>
              ) : (
                <ChatList searchQuery={searchQuery} onSelect={() => { setMobilePanel("chat"); }} chatList={archivedChats} />
              )}
            </div>
          ) : view === "lists" ? (
            // Fix G: Custom Lists view
            <div>
              {/* List of custom lists with filter */}
              {activeListId === null ? (
                <div>
                  {/* Create new list */}
                  <div style={{ display: "flex", gap: 6, padding: "8px 4px 4px" }}>
                    <input
                      className="form-input"
                      placeholder="New list name…"
                      value={newListName}
                      onChange={(e) => setNewListName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter" && newListName.trim()) {
                          await createCustomList(newListName.trim());
                          setNewListName("");
                        }
                      }}
                      style={{ flex: 1, fontSize: 12, padding: "6px 10px" }}
                    />
                    <button className="icon-btn" title="Create list" onClick={async () => {
                      if (newListName.trim()) { await createCustomList(newListName.trim()); setNewListName(""); }
                    }}><PlusCircle size={16} /></button>
                  </div>
                  {/* List entries */}
                  {customLists.length === 0 ? (
                    <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>No lists yet. Create one above.</div>
                  ) : customLists.map((lst) => (
                    <div key={lst.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: "var(--radius-md)" }}>
                      {editingListId === lst.id ? (
                        <>
                          <input className="form-input" value={editingListName} onChange={(e) => setEditingListName(e.target.value)}
                            onKeyDown={async (e) => {
                              if (e.key === "Enter" && editingListName.trim()) {
                                await renameCustomList(lst.id, editingListName.trim());
                                setEditingListId(null);
                              } else if (e.key === "Escape") setEditingListId(null);
                            }}
                            style={{ flex: 1, fontSize: 12, padding: "4px 8px" }} autoFocus />
                          <button className="icon-btn" onClick={() => setEditingListId(null)}><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <span onClick={() => setActiveListId(lst.id)} style={{ flex: 1, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--text-primary)" }}>{lst.name}</span>
                          <span style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{lst.chatIds?.length ?? 0}</span>
                          <button className="icon-btn" title="Rename" onClick={() => { setEditingListId(lst.id); setEditingListName(lst.name); }}><Pencil size={13} /></button>
                          <button className="icon-btn" title="Delete" onClick={async () => { if (confirm(`Delete list "${lst.name}"?`)) await deleteCustomList(lst.id); }}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // Filtered chat list for selected custom list
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 4px 4px" }}>
                    <button className="icon-btn" onClick={() => setActiveListId(null)} title="Back"><ArrowLeft size={16} /></button>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
                      {customLists.find((l) => l.id === activeListId)?.name || "List"}
                    </span>
                  </div>
                  {/* Show chats in this list */}
                  {(() => {
                    const lst = customLists.find((l) => l.id === activeListId);
                    const memberChatIds = new Set(lst?.chatIds || []);
                    const listChats = chats.filter((c) => memberChatIds.has(c.id));
                    if (!lst) return <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>List not found</div>;
                    if (listChats.length === 0) return <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>No chats in this list yet. Add chats from Chat Settings.</div>;
                    return <ChatList searchQuery={searchQuery} onSelect={() => setMobilePanel("chat")} chatList={listChats} />;
                  })()}
                  {/* Add chat to list via "current chat" shortcut */}
                  {activeChatId && !(() => { const lst = customLists.find((l) => l.id === activeListId); return (lst?.chatIds || []).includes(activeChatId); })() && (
                    <div style={{ padding: "4px 8px" }}>
                      <button onClick={() => addChatToList(activeListId, activeChatId)} style={{
                        width: "100%", padding: "7px", borderRadius: "var(--radius-md)", border: "1px dashed var(--border)",
                        background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      }}>
                        <PlusCircle size={13} /> Add current chat to this list
                      </button>
                    </div>
                  )}
                  {/* Remove current chat from list */}
                  {activeChatId && (() => { const lst = customLists.find((l) => l.id === activeListId); return (lst?.chatIds || []).includes(activeChatId); })() && (
                    <div style={{ padding: "4px 8px" }}>
                      <button onClick={() => removeChatFromList(activeListId, activeChatId)} style={{
                        width: "100%", padding: "7px", borderRadius: "var(--radius-md)", border: "1px dashed var(--border)",
                        background: "transparent", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      }}>
                        <X size={13} /> Remove current chat from list
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : view === "chats" ? (
            isLoadingChats ? <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner /></div>
              : <ChatList searchQuery={searchQuery} onSelect={() => setMobilePanel("chat")} />
          ) : (
            isLoadingUsers ? <div style={{ display: "flex", justifyContent: "center", padding: 32 }}><Spinner /></div>
              : contacts.length === 0 ? <div style={{ padding: 32, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>{searchQuery ? "No contacts found" : "No users yet"}</div>
              : contacts.map((c) => {
                const lang = getLanguage(c.primaryLang);
                const status = onlineUsers[c.id] || c.status;
                return (
                  <div key={c.id} onClick={async () => { await openDirectChat(c.id); setView("chats"); setMobilePanel("chat"); }}
                    style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: "var(--radius-md)", cursor: "pointer", transition: "background var(--duration) var(--ease)" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-hover)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <Avatar user={{ ...c, status }} size={42} showStatus />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.displayName}</span>
                        <span style={{ fontSize: 10, padding: "1px 6px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: "var(--radius-full)", fontWeight: 500, flexShrink: 0 }}>{lang.flag}</span>
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                        {c.bio || (c.phoneNumber ? formatPhone(c.phoneNumber) : c.email) || c.email}
                      </div>
                    </div>
                    <MessageSquarePlus size={16} style={{ color: "var(--text-tertiary)", flexShrink: 0 }} />
                  </div>
                );
              })
          )}
        </div>

        {/* Chat list action buttons */}
        {view === "chats" && (
          <div style={{ padding: "6px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
            {/* Pack H: Saved Messages */}
            <button onClick={async () => { await openSavedMessages(); setMobilePanel("chat"); }} style={{
              width: "100%", padding: "9px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6, transition: "all var(--duration) var(--ease)",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
            >
              <Bookmark size={14} /> Saved Messages
            </button>
            {/* Fix C: Archived entry point */}
            <button onClick={async () => {
              setIsLoadingArchived(true);
              await fetchArchivedChats();
              setIsLoadingArchived(false);
              setView("archived");
            }} style={{
              width: "100%", padding: "9px", borderRadius: "var(--radius-md)",
              border: "1px solid var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6, transition: "all var(--duration) var(--ease)",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
            >
              <Archive size={14} /> Archived
            </button>
            {/* Pack G: Mark All Read */}
            {chats.some((c) => c.unreadCount > 0) && (
              <button onClick={() => markAllChatsRead()} style={{
                width: "100%", padding: "9px", borderRadius: "var(--radius-md)",
                border: "1px solid var(--border)", background: "transparent",
                color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
                fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
                justifyContent: "center", gap: 6, transition: "all var(--duration) var(--ease)",
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
              >
                <CheckCheck size={14} /> Mark All as Read
              </button>
            )}
            {/* New Group */}
            <button onClick={() => setShowCreateGroup(true)} style={{
              width: "100%", padding: "9px", borderRadius: "var(--radius-md)",
              border: "1px dashed var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6, transition: "all var(--duration) var(--ease)",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
            >
              <Users size={14} /> New Group Chat
            </button>
          </div>
        )}

        {/* Import contacts button at bottom of contacts list */}
        {view === "contacts" && (
          <div style={{ padding: "6px 16px" }}>
            <button onClick={() => setShowContactImport(true)} style={{
              width: "100%", padding: "9px", borderRadius: "var(--radius-md)",
              border: "1px dashed var(--border)", background: "transparent",
              color: "var(--text-secondary)", fontSize: 12, cursor: "pointer",
              fontFamily: "var(--font-sans)", display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6, transition: "all var(--duration) var(--ease)",
            }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.background = "transparent"; }}
            >
              <Upload size={14} /> Import Contacts
            </button>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <Avatar user={user} size={34} showStatus />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.displayName}</div>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{userLang.flag} {userLang.name}</div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className={`main-content${mobilePanel !== "chat" ? " is-hidden" : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <ChatView onBack={() => setMobilePanel("sidebar")} />
      </div>

      {/* Create group modal */}
      {showCreateGroup && (
        <CreateGroupModal
          onClose={() => setShowCreateGroup(false)}
          onCreated={() => { setView("chats"); setMobilePanel("chat"); }}
        />
      )}
      {showContactImport && (
        <ContactImportModal onClose={() => setShowContactImport(false)} />
      )}
    </div>
  );
}
