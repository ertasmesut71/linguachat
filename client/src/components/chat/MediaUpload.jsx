import { useState, useRef, useCallback } from "react";
import { FileText, X, Upload, Image as ImageIcon, Video, File as FileIcon } from "lucide-react";
import { getAccessToken } from "../../api/client";

// Must match server/modules/media/media.service.js SIZE_LIMITS
const LIMITS = {
  image: 15 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
  document: 25 * 1024 * 1024,
};

function classify(mime) {
  if (!mime) return null;
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "document";
}

function fmtSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function KindIcon({ kind, size = 20 }) {
  if (kind === "image") return <ImageIcon size={size} />;
  if (kind === "video") return <Video size={size} />;
  return <FileIcon size={size} />;
}

export default function MediaUpload({ onUploaded, onCancel }) {
  const [files, setFiles] = useState([]);   // [{ file, previewUrl, kind, id }]
  const [uploading, setUploading] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(-1); // which file is uploading
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const xhrRef = useRef(null);

  let nextId = useRef(0);

  const addFiles = useCallback((fileList) => {
    setError(null);
    const newEntries = [];
    for (const f of fileList) {
      const kind = classify(f.type);
      if (!kind) { setError(`Unsupported: ${f.name}`); continue; }
      const max = LIMITS[kind];
      if (f.size > max) { setError(`${f.name} too large (${fmtSize(f.size)}, max ${fmtSize(max)})`); continue; }
      const previewUrl = (kind === "image" || kind === "video") ? URL.createObjectURL(f) : null;
      newEntries.push({ file: f, previewUrl, kind, id: `f_${nextId.current++}` });
    }
    if (newEntries.length > 0) {
      setFiles((prev) => [...prev, ...newEntries]);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) { addFiles([f]); break; }
      }
    }
  }, [addFiles]);

  const removeFile = (id) => {
    setFiles((prev) => {
      const entry = prev.find((f) => f.id === id);
      if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Upload all files sequentially, calling onUploaded for each
  const handleUpload = async () => {
    if (files.length === 0 || uploading) return;
    setUploading(true);
    setError(null);

    for (let i = 0; i < files.length; i++) {
      setCurrentIdx(i);
      setProgress(0);

      try {
        const result = await uploadOne(files[i]);
        if (result) onUploaded(result);
      } catch (err) {
        setError(`Failed: ${files[i].file.name} — ${err.message || "upload error"}`);
        // Continue with remaining files
      }
    }

    // Clean up all preview URLs
    for (const f of files) { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }
    setFiles([]);
    setUploading(false);
    setCurrentIdx(-1);
    setProgress(0);
  };

  const uploadOne = (entry) => new Promise((resolve, reject) => {
    const token = getAccessToken();
    const form = new FormData();
    form.append("file", entry.file, entry.file.name);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/media/upload-stream");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };

    xhr.onload = () => {
      xhrRef.current = null;
      try {
        const json = JSON.parse(xhr.responseText || "{}");
        if (xhr.status >= 200 && xhr.status < 300 && json?.data) {
          resolve(json.data);
        } else {
          reject(new Error(json?.message || `HTTP ${xhr.status}`));
        }
      } catch { reject(new Error(`HTTP ${xhr.status}`)); }
    };

    xhr.onerror = () => { xhrRef.current = null; reject(new Error("Network error")); };
    xhr.onabort = () => { xhrRef.current = null; reject(new Error("Aborted")); };

    xhr.send(form);
  });

  const handleCancelUpload = () => {
    if (xhrRef.current) xhrRef.current.abort();
  };

  const clearAll = () => {
    for (const f of files) { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl); }
    setFiles([]);
    setError(null);
    setProgress(0);
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
      onPaste={handlePaste}
      tabIndex={0}
      style={{ padding: "12px 24px", borderTop: "1px solid var(--border)", background: "var(--bg-secondary)" }}
    >
      {files.length === 0 ? (
        <div
          onClick={() => inputRef.current?.click()}
          style={{
            border: "2px dashed var(--border)", borderRadius: "var(--radius-md)",
            padding: "20px", textAlign: "center", cursor: "pointer",
            transition: "border-color 0.15s ease",
          }}
          onMouseEnter={(e) => e.currentTarget.style.borderColor = "var(--accent)"}
          onMouseLeave={(e) => e.currentTarget.style.borderColor = "var(--border)"}
        >
          <Upload size={20} style={{ color: "var(--text-tertiary)", marginBottom: 6 }} />
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Click, drag & drop, or paste files
          </div>
          <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 2 }}>
            Images up to 15 MB · Videos up to 100 MB · Documents up to 25 MB · Select multiple
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/json"
            onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
          />
        </div>
      ) : (
        <div>
          {/* File list */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 200, overflowY: "auto" }}>
            {files.map((entry, i) => (
              <div key={entry.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "4px 0",
                opacity: uploading && currentIdx > i ? 0.4 : 1,
              }}>
                {entry.kind === "image" ? (
                  <img src={entry.previewUrl} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover" }} />
                ) : entry.kind === "video" ? (
                  <video src={entry.previewUrl} style={{ width: 48, height: 40, borderRadius: 6, objectFit: "cover", background: "#000" }} muted />
                ) : (
                  <div style={{ width: 40, height: 40, borderRadius: 6, background: "var(--bg-tertiary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <KindIcon kind={entry.kind} size={18} />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {uploading && currentIdx === i && "⏳ "}{entry.file.name}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-tertiary)" }}>
                    {fmtSize(entry.file.size)} · {entry.kind.toUpperCase()}
                    {uploading && currentIdx === i && ` · ${progress}%`}
                    {uploading && currentIdx > i && " · ✓ sent"}
                  </div>
                </div>
                {!uploading && (
                  <button onClick={() => removeFile(entry.id)} className="icon-btn" style={{ flexShrink: 0 }}><X size={14} /></button>
                )}
              </div>
            ))}
          </div>

          {/* Upload progress bar for current file */}
          {uploading && currentIdx >= 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 4, borderRadius: 2, background: "var(--bg-tertiary)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress}%`, background: "var(--accent)", transition: "width 120ms linear" }} />
              </div>
              <div style={{ marginTop: 3, fontSize: 10, color: "var(--text-tertiary)", display: "flex", justifyContent: "space-between" }}>
                <span>Uploading {currentIdx + 1} of {files.length}…</span>
                <span>{progress}%</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          {!uploading && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center" }}>
              <button onClick={() => inputRef.current?.click()} className="btn btn-ghost btn-sm" style={{ gap: 4 }}>
                + Add more
              </button>
              <input
                ref={inputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                accept="image/*,video/*,audio/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,application/json"
                onChange={(e) => { if (e.target.files?.length) addFiles(e.target.files); e.target.value = ""; }}
              />
              <div style={{ flex: 1 }} />
              <button onClick={() => { clearAll(); onCancel?.(); }} className="btn btn-ghost btn-sm">Cancel</button>
              <button onClick={handleUpload} className="btn btn-primary btn-sm" style={{ gap: 6 }}>
                <Upload size={13} /> Send {files.length > 1 ? `(${files.length})` : ""}
              </button>
            </div>
          )}
          {uploading && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button onClick={handleCancelUpload} className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }}>
                Cancel upload
              </button>
            </div>
          )}
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: "var(--red)", marginTop: 8 }}>{error}</div>}
    </div>
  );
}
