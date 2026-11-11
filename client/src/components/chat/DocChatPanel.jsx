import { useState, useEffect, useRef } from "react";
import { X, Sparkles, Send, FileText, Image as ImageIcon, RefreshCw, MessageSquare, Eye, ListChecks } from "lucide-react";
import api from "../../api/client";
import SidePanel from "../ui/SidePanel";

/**
 * Side panel that lets the user:
 *  - Summarize an uploaded file (PDF/DOCX/XLSX/TXT/MD) in their receive language
 *  - Run OCR + translation on an image
 *  - Ask free-form cross-lingual questions about the document's content
 *
 * Props:
 *  - fileId       (required) id of the uploaded file in /api/media
 *  - originalName (optional) display name
 *  - kindHint     (optional) "image" | "video" | "file" — decides initial tab
 *  - chatId       (optional) chat context — used to pick receive language server-side
 *  - onClose      () => void
 */
export default function DocChatPanel({ fileId, originalName, kindHint, chatId, onClose }) {
  const initialTab = kindHint === "image" ? "ocr" : "summary";
  const [tab, setTab] = useState(initialTab);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const [ocr, setOcr] = useState(null);
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrError, setOcrError] = useState(null);

  const [qaHistory, setQaHistory] = useState([]); // [{ q, a, lang }]
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const qaEndRef = useRef(null);

  // Auto-run the primary action when the panel opens
  useEffect(() => {
    if (!fileId) return;
    if (tab === "summary" && !summary && !summaryLoading) runSummary();
    if (tab === "ocr" && !ocr && !ocrLoading) runOcr();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, tab]);

  useEffect(() => {
    qaEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [qaHistory.length, asking]);

  const runSummary = async () => {
    setSummaryLoading(true); setSummaryError(null);
    try {
      const resp = await api.post(`/ai/files/${fileId}/summarize`, { chatId: chatId || undefined });
      setSummary(resp.data);
    } catch (err) {
      if (err?.code === "PREMIUM_REQUIRED") {
        setSummaryError("Bu özellik yalnızca Premium üyeler için geçerlidir.");
        setSummaryLoading(false);
        return;
      }
      setSummaryError(err?.message || "Summary failed");
    }
    setSummaryLoading(false);
  };

  const runOcr = async () => {
    setOcrLoading(true); setOcrError(null);
    try {
      const resp = await api.post(`/ai/files/${fileId}/ocr`, { chatId: chatId || undefined });
      setOcr(resp.data);
    } catch (err) {
      if (err?.code === "PREMIUM_REQUIRED") {
        setOcrError("Bu özellik yalnızca Premium üyeler için geçerlidir.");
        setOcrLoading(false);
        return;
      }
      setOcrError(err?.message || "OCR failed");
    }
    setOcrLoading(false);
  };

  const handleAsk = async (e) => {
    e?.preventDefault?.();
    const q = question.trim();
    if (!q || asking) return;
    setAsking(true);
    const nextHistory = [...qaHistory, { q, a: null, lang: null, pending: true }];
    setQaHistory(nextHistory);
    setQuestion("");
    try {
      const resp = await api.post(`/ai/files/${fileId}/ask`, { question: q, chatId: chatId || undefined });
      setQaHistory((h) => {
        const copy = [...h];
        copy[copy.length - 1] = { q, a: resp.data.answer, lang: resp.data.lang, pending: false };
        return copy;
      });
    } catch (err) {
      if (err?.code === "PREMIUM_REQUIRED") {
        setQaHistory((h) => {
          const copy = [...h];
          copy[copy.length - 1] = { q, a: "Bu özellik yalnızca Premium üyeler için geçerlidir.", lang: null, pending: false, error: true };
          return copy;
        });
        setAsking(false);
        return;
      }
      setQaHistory((h) => {
        const copy = [...h];
        copy[copy.length - 1] = { q, a: `[Error: ${err?.message || "request failed"}]`, lang: null, pending: false, error: true };
        return copy;
      });
    }
    setAsking(false);
  };

  const TabButton = ({ id, icon: Icon, label, disabled }) => (
    <button
      onClick={() => !disabled && setTab(id)}
      disabled={disabled}
      style={{
        flex: 1, padding: "8px 10px", fontSize: 12, fontWeight: 600,
        background: tab === id ? "var(--accent-soft)" : "transparent",
        color: tab === id ? "var(--accent)" : "var(--text-secondary)",
        border: "none",
        borderBottom: tab === id ? "2px solid var(--accent)" : "2px solid transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
        fontFamily: "inherit",
      }}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <SidePanel onClose={onClose}>
      {/* Header */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
        <Sparkles size={16} style={{ color: "var(--accent)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Document AI</div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {originalName || fileId?.slice(0, 12) + "…"}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <TabButton id="summary" icon={FileText} label="Summary" disabled={kindHint === "image"} />
        <TabButton id="ocr" icon={ImageIcon} label="OCR" disabled={kindHint !== "image"} />
        <TabButton id="ask" icon={MessageSquare} label="Ask" />
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, minHeight: 0 }}>
        {tab === "summary" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <ListChecks size={14} style={{ color: "var(--text-tertiary)" }} />
              <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>AI Summary</div>
              <button className="icon-btn" onClick={runSummary} disabled={summaryLoading} title="Regenerate">
                <RefreshCw size={14} style={{ animation: summaryLoading ? "spin 1s linear infinite" : "none" }} />
              </button>
            </div>

            {summaryLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
                <div className="spinner spinner-md" />
              </div>
            )}
            {summaryError && (
              <div style={{ padding: 12, background: "var(--red-soft)", border: "1px solid var(--red)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--red)" }}>
                {summaryError}
              </div>
            )}
            {!summaryLoading && !summaryError && summary && (
              <>
                <div style={{
                  background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)", padding: 14, fontSize: 13, lineHeight: 1.7,
                  color: "var(--text-secondary)", whiteSpace: "pre-wrap",
                }}>
                  {summary.summary}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {summary.kind && <span>kind: {summary.kind}</span>}
                  {summary.pages ? <span>· {summary.pages} pages</span> : null}
                  {summary.sheets ? <span>· sheets: {summary.sheets.join(", ")}</span> : null}
                  {summary.lang && <span>· lang: {summary.lang}</span>}
                  {summary.truncated && <span style={{ color: "var(--amber, var(--text-tertiary))" }}>· truncated for model</span>}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "ocr" && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <Eye size={14} style={{ color: "var(--text-tertiary)" }} />
              <div style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>OCR + Translation</div>
              <button className="icon-btn" onClick={runOcr} disabled={ocrLoading} title="Re-run">
                <RefreshCw size={14} style={{ animation: ocrLoading ? "spin 1s linear infinite" : "none" }} />
              </button>
            </div>

            {ocrLoading && (
              <div style={{ display: "flex", justifyContent: "center", padding: "30px 0" }}>
                <div className="spinner spinner-md" />
              </div>
            )}
            {ocrError && (
              <div style={{ padding: 12, background: "var(--red-soft)", border: "1px solid var(--red)", borderRadius: "var(--radius-md)", fontSize: 12, color: "var(--red)" }}>
                {ocrError}
              </div>
            )}
            {!ocrLoading && !ocrError && ocr && (
              <>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                  Extracted
                </div>
                <div style={{
                  background: "var(--bg-tertiary)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)", padding: 12, fontSize: 13, lineHeight: 1.6,
                  whiteSpace: "pre-wrap", marginBottom: 12,
                }}>
                  {ocr.extracted || "(no text found)"}
                </div>

                {ocr.translated && (
                  <>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-tertiary)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 4 }}>
                      Translation ({ocr.lang})
                    </div>
                    <div style={{
                      background: "var(--accent-soft)", border: "1px solid var(--accent)",
                      borderRadius: "var(--radius-md)", padding: 12, fontSize: 13, lineHeight: 1.6,
                      whiteSpace: "pre-wrap", color: "var(--text-primary)",
                    }}>
                      {ocr.translated}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {tab === "ask" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 400 }}>
            <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginBottom: 10 }}>
              Ask questions about this document. Answers come back in your receive language.
            </div>

            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 4 }}>
              {qaHistory.length === 0 && (
                <div style={{ color: "var(--text-tertiary)", fontSize: 12, fontStyle: "italic", padding: "8px 0" }}>
                  No questions yet. Try: "What are the main points?" or "List any dates mentioned."
                </div>
              )}

              {qaHistory.map((entry, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{
                    alignSelf: "flex-end", maxWidth: "85%",
                    background: "var(--accent)", color: "white",
                    padding: "8px 12px", borderRadius: 14,
                    borderBottomRightRadius: 4,
                    fontSize: 13, lineHeight: 1.5,
                  }}>
                    {entry.q}
                  </div>
                  <div style={{
                    alignSelf: "flex-start", maxWidth: "92%",
                    background: "var(--surface-raised)", color: "var(--text-primary)",
                    padding: "8px 12px", borderRadius: 14,
                    borderBottomLeftRadius: 4,
                    fontSize: 13, lineHeight: 1.6,
                    border: "1px solid var(--border-subtle)",
                    whiteSpace: "pre-wrap",
                    opacity: entry.pending ? 0.7 : 1,
                  }}>
                    {entry.pending ? <span style={{ fontStyle: "italic", color: "var(--text-tertiary)" }}>Thinking…</span> : entry.a}
                  </div>
                </div>
              ))}
              <div ref={qaEndRef} />
            </div>

            <form onSubmit={handleAsk} style={{ marginTop: 10, display: "flex", gap: 6 }}>
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about this document…"
                disabled={asking}
                className="form-input"
                style={{ flex: 1, fontSize: 13, padding: "8px 12px" }}
              />
              <button type="submit" className="btn btn-primary btn-sm" disabled={asking || !question.trim()}>
                <Send size={14} />
              </button>
            </form>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </SidePanel>
  );
}
