import { useState, useEffect, useRef } from "react";
import { useChatStore } from "../store/chatStore";
import Avatar from "./ui/Avatar";
import Spinner from "./ui/Spinner";
import { X, Upload, UserCheck, UserPlus, MessageSquarePlus, Phone, Smartphone, Share2, Copy, Check } from "lucide-react";
import api from "../api/client";
import { getLanguage } from "../lib/constants";
import { formatPhone } from "../lib/formatPhone";
import { isDeviceContactsAvailable, readDeviceContacts } from "../lib/deviceContacts";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || "";
const INVITE_URL = import.meta.env.VITE_INVITE_URL || `${typeof window !== "undefined" ? window.location.origin : ""}/register`;

function getInviteMessage() {
  return `Join me on LinguaChat — chat across languages automatically.\n${INVITE_URL}`;
}

// ─── Invite button with Web Share + clipboard fallback ───
function InviteButton({ contact }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

  const handleInvite = async () => {
    const msg = getInviteMessage();
    if (canShare) {
      try {
        await navigator.share({ title: "Join LinguaChat", text: msg });
      } catch (e) {
        if (e.name !== "AbortError") copyFallback(msg);
      }
      return;
    }
    copyFallback(msg);
  };

  const copyFallback = async (msg) => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  // SMS URI fallback for mobile
  const smsUri = contact.phoneNumber
    ? `sms:+${contact.phoneNumber}?body=${encodeURIComponent(getInviteMessage())}`
    : null;

  return (
    <div style={{ display: "flex", gap: 4 }}>
      <button onClick={handleInvite} title={canShare ? "Share invitation" : "Copy invitation"} style={{
        display: "flex", alignItems: "center", gap: 4, padding: "6px 10px",
        borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
        background: "transparent", color: "var(--text-secondary)",
        fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
      }}>
        {copied ? <><Check size={13} /> Copied</> : <>{canShare ? <Share2 size={13} /> : <Copy size={13} />} Invite</>}
      </button>
      {smsUri && (
        <a href={smsUri} title="Send via SMS app" style={{
          display: "flex", alignItems: "center", padding: "6px 8px",
          borderRadius: "var(--radius-md)", border: "1px solid var(--border)",
          background: "transparent", color: "var(--text-secondary)",
          textDecoration: "none", fontSize: 12,
        }}>
          <Phone size={13} />
        </a>
      )}
    </div>
  );
}

// ─── Matched results with invite section ───
function MatchedResults({ results, onStartChat, onReset, resetLabel }) {
  const matched = results.matched || [];
  const unmatched = results.unmatchedContacts || [];

  return (
    <>
      {/* Matched section */}
      {matched.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            <UserCheck size={13} style={{ verticalAlign: -2, marginRight: 4, color: "var(--green)" }} />
            On LinguaChat ({matched.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {matched.map((u) => {
              const lang = getLanguage(u.primaryLang);
              return (
                <div key={u.id} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)",
                }}>
                  <Avatar user={u} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      {u.displayName}
                      {u.contactName && u.contactName !== u.displayName && (
                        <span style={{ fontSize: 11, color: "var(--text-tertiary)", fontWeight: 400, marginLeft: 6 }}>
                          (saved as "{u.contactName}")
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 6 }}>
                      <span>{formatPhone(u.phoneNumber)}</span>
                      {lang && <span>{lang.flag} {lang.name}</span>}
                    </div>
                  </div>
                  <button onClick={() => onStartChat(u.id)} style={{
                    display: "flex", alignItems: "center", gap: 4, padding: "6px 12px",
                    borderRadius: "var(--radius-md)", border: "none", background: "var(--accent)",
                    color: "white", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
                  }}>
                    <MessageSquarePlus size={13} /> Chat
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Unmatched / Invite section */}
      {unmatched.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
            <UserPlus size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
            Not yet on LinguaChat ({unmatched.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 }}>
            {unmatched.map((c, i) => (
              <div key={`u-${i}`} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                borderRadius: "var(--radius-md)", border: "1px dashed var(--border-subtle)",
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", background: "var(--bg-tertiary)",
                  display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)", fontSize: 14,
                }}>
                  {(c.contactName || "?")[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                    {c.contactName || "Unknown"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)" }}>{formatPhone(c.phoneNumber)}</div>
                </div>
                <InviteButton contact={c} />
              </div>
            ))}
          </div>
        </>
      )}

      {matched.length === 0 && unmatched.length === 0 && (
        <div style={{ padding: 24, textAlign: "center", color: "var(--text-tertiary)", fontSize: 13 }}>
          No contacts to show.
        </div>
      )}

      <button onClick={onReset} className="btn btn-ghost btn-block" style={{ marginTop: 4 }}>
        {resetLabel || "Import more"}
      </button>
    </>
  );
}

export default function ContactImportModal({ onClose }) {
  const { openDirectChat } = useChatStore();
  const isNative = isDeviceContactsAvailable();
  const [tab, setTab] = useState(isNative ? "device" : "manual");

  // Device state
  const [dLoading, setDLoading] = useState(false);
  const [dResults, setDResults] = useState(null);
  const [dError, setDError] = useState(null);

  // Manual state
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);

  // Google state
  const [gLoading, setGLoading] = useState(false);
  const [gResults, setGResults] = useState(null);
  const [gError, setGError] = useState(null);
  const [gisLoaded, setGisLoaded] = useState(false);
  const tokenClientRef = useRef(null);

  // Load GIS
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || tab !== "google") return;
    if (document.getElementById("gis-script")) { setGisLoaded(!!window.google?.accounts); return; }
    const script = document.createElement("script");
    script.id = "gis-script"; script.src = "https://accounts.google.com/gsi/client";
    script.async = true; script.defer = true;
    script.onload = () => setGisLoaded(true);
    script.onerror = () => setGError("Failed to load Google Sign-In");
    document.head.appendChild(script);
  }, [tab]);

  useEffect(() => {
    if (!gisLoaded || !window.google?.accounts?.oauth2 || tokenClientRef.current) return;
    tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID, scope: "https://www.googleapis.com/auth/contacts.readonly",
      callback: (r) => { if (r.access_token) doGoogleSync(r.access_token); else { setGError("Google auth failed"); setGLoading(false); } },
      error_callback: () => { setGError("Google sign-in cancelled"); setGLoading(false); },
    });
  }, [gisLoaded]);

  const handleDeviceSync = async () => {
    setDLoading(true); setDError(null);
    try {
      const result = await readDeviceContacts();
      if (!result.available || !result.granted) { setDError(result.reason); setDLoading(false); return; }
      if (result.contacts.length === 0) { setDResults({ matched: [], unmatchedContacts: [], unmatched: 0, total: 0 }); setDLoading(false); return; }
      const res = await api.post("/contacts/match", { contacts: result.contacts });
      setDResults(res.data);
    } catch (err) { setDError(err?.message || "Device contacts sync failed"); }
    setDLoading(false);
  };

  const handleManualMatch = async () => {
    const lines = input.split(/[\n,;]+/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) { setError("Enter at least one phone number"); return; }
    const contacts = lines.map((line) => {
      const ci = line.indexOf(":"); if (ci > 0) return { name: line.slice(0, ci).trim(), phone: line.slice(ci + 1).trim() };
      return { name: "", phone: line };
    });
    setLoading(true); setError(null);
    try { const res = await api.post("/contacts/match", { contacts }); setResults(res.data); }
    catch (err) { setError(err?.message || "Match failed"); }
    setLoading(false);
  };

  const handleGoogleConnect = () => { if (!tokenClientRef.current) { setGError("Google not ready"); return; } setGLoading(true); setGError(null); tokenClientRef.current.requestAccessToken(); };
  const doGoogleSync = async (accessToken) => {
    setGLoading(true); setGError(null);
    try { const res = await api.post("/contacts/google-sync", { accessToken }); setGResults(res.data); }
    catch (err) { setGError(err?.message || "Google sync failed"); }
    setGLoading(false);
  };

  const handleStartChat = async (userId) => { await openDirectChat(userId); onClose(); };

  const tabs = [
    { key: "device", label: "Device" },
    { key: "manual", label: "Phone Numbers" },
    ...(GOOGLE_CLIENT_ID ? [{ key: "google", label: "Google" }] : []),
  ];

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
      <div style={{ background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-xl)", width: 500, maxWidth: "92vw", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-lg)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Upload size={16} style={{ color: "var(--accent)" }} />
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>Import Contacts</h3>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)" }}>
          {tabs.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              flex: 1, padding: "10px 0", textAlign: "center", fontSize: 12, fontWeight: 600,
              color: tab === t.key ? "var(--accent)" : "var(--text-tertiary)",
              background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-sans)",
              borderBottom: `2px solid ${tab === t.key ? "var(--accent)" : "transparent"}`,
            }}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

          {/* DEVICE TAB */}
          {tab === "device" && !dResults && (
            <>
              {isNative ? (
                <>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>Read your phone's contacts to find which ones are already on LinguaChat, and invite the rest.</div>
                  <button onClick={handleDeviceSync} disabled={dLoading} className="btn btn-primary btn-block" style={{ gap: 8 }}>
                    {dLoading ? <><Spinner size="sm" /> Reading contacts...</> : <><Smartphone size={15} /> Sync Device Contacts</>}
                  </button>
                </>
              ) : (
                <div style={{ textAlign: "center", padding: "20px 0" }}>
                  <Smartphone size={32} style={{ color: "var(--text-tertiary)", marginBottom: 12 }} />
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 8 }}>Device contacts require the mobile app</div>
                  <div style={{ fontSize: 13, color: "var(--text-tertiary)", lineHeight: 1.5, marginBottom: 16 }}>Use the other tabs to import contacts manually or via Google.</div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                    <button onClick={() => setTab("manual")} className="btn btn-ghost" style={{ fontSize: 12 }}><Phone size={13} /> Phone Numbers</button>
                    {GOOGLE_CLIENT_ID && <button onClick={() => setTab("google")} className="btn btn-ghost" style={{ fontSize: 12 }}>Google Contacts</button>}
                  </div>
                </div>
              )}
              {dError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 12 }}>{dError}</div>}
            </>
          )}
          {tab === "device" && dResults && <MatchedResults results={dResults} onStartChat={handleStartChat} onReset={() => setDResults(null)} resetLabel="Sync again" />}

          {/* MANUAL TAB */}
          {tab === "manual" && !results && (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12, lineHeight: 1.5 }}>Paste phone numbers to find contacts on LinguaChat.</div>
              <textarea value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={"+90 555 123 4567\nAlice: +49 30 99887766"} rows={6}
                style={{ width: "100%", padding: 10, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: 13, fontFamily: "var(--font-sans)", resize: "vertical", outline: "none", lineHeight: 1.5 }} />
              {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{error}</div>}
              <button onClick={handleManualMatch} disabled={loading || !input.trim()} className="btn btn-primary btn-block" style={{ marginTop: 12, gap: 6 }}>
                {loading ? <><Spinner size="sm" /> Matching...</> : <><Phone size={14} /> Find Contacts</>}
              </button>
            </>
          )}
          {tab === "manual" && results && <MatchedResults results={results} onStartChat={handleStartChat} onReset={() => { setResults(null); setInput(""); }} />}

          {/* GOOGLE TAB */}
          {tab === "google" && !gResults && (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16, lineHeight: 1.5 }}>Connect your Google account to find which contacts are on LinguaChat, and invite the rest.</div>
              {!GOOGLE_CLIENT_ID ? (
                <div style={{ padding: 16, background: "var(--bg-tertiary)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--text-tertiary)" }}>Google Contacts sync is not configured. Set <code>VITE_GOOGLE_CLIENT_ID</code>.</div>
              ) : (
                <>
                  <button onClick={handleGoogleConnect} disabled={gLoading || !gisLoaded} className="btn btn-block" style={{ padding: "12px", gap: 8, background: "white", color: "#3c4043", border: "1px solid #dadce0", borderRadius: "var(--radius-md)", fontSize: 14, fontWeight: 500, cursor: gLoading ? "wait" : "pointer", fontFamily: "var(--font-sans)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {gLoading ? <><Spinner size="sm" /> Syncing...</> : <>
                      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#34A853" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#FBBC05" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                      Sign in with Google
                    </>}
                  </button>
                  <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 8, textAlign: "center" }}>Only names and phone numbers are read. No data is stored.</div>
                </>
              )}
              {gError && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 12 }}>{gError}</div>}
            </>
          )}
          {tab === "google" && gResults && <MatchedResults results={gResults} onStartChat={handleStartChat} onReset={() => setGResults(null)} resetLabel="Sync again" />}
        </div>
      </div>
    </div>
  );
}
