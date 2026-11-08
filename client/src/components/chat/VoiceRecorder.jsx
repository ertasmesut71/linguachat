import { useEffect, useCallback } from "react";
import { useVoiceRecorder } from "../../hooks/useVoiceRecorder";
import { Mic, X, Send, Square } from "lucide-react";

function formatDuration(s) {
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

export default function VoiceRecorder({ onSend, onCancel }) {
  const { isRecording, duration, audioBlob, audioBase64, mimeType, error, start, stop, cancel } = useVoiceRecorder();

  // Auto-start recording on mount
  useEffect(() => { start(); }, []);

  const handleCancel = useCallback(() => {
    cancel();
    onCancel();
  }, [cancel, onCancel]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const handleSend = useCallback(() => {
    if (audioBase64) {
      onSend({ audioBase64, mimeType, duration });
    }
  }, [audioBase64, mimeType, duration, onSend]);

  // Send once audio is ready after stopping
  const hasStopped = !isRecording && audioBase64;

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
      backdropFilter: "blur(8px)", display: "flex", alignItems: "center",
      justifyContent: "center", zIndex: 100, animation: "fadeIn 0.2s ease",
    }}>
      <div style={{
        background: "var(--surface-raised)", border: "1px solid var(--border)",
        borderRadius: "var(--radius-xl)", padding: "40px 48px",
        textAlign: "center", minWidth: 340, boxShadow: "var(--shadow-lg)",
      }}>
        {error ? (
          <>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🎙️</div>
            <div style={{ fontSize: 14, color: "var(--red)", marginBottom: 20 }}>{error}</div>
            <button onClick={handleCancel} style={{
              padding: "10px 28px", borderRadius: "var(--radius-full)", border: "none",
              background: "var(--bg-tertiary)", color: "var(--text-secondary)",
              fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
            }}>Close</button>
          </>
        ) : isRecording ? (
          <>
            {/* Recording state */}
            <div style={{
              width: 80, height: 80, borderRadius: "50%", background: "var(--red)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, color: "white", marginBottom: 20,
              animation: "recordPulse 1.5s infinite",
            }}>
              <Mic size={32} />
            </div>
            <div style={{
              fontSize: 36, fontWeight: 300, fontFamily: "var(--font-mono)",
              marginBottom: 6, color: "var(--text-primary)",
            }}>
              {formatDuration(duration)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 28 }}>
              Recording voice message...
            </div>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={handleCancel} style={{
                padding: "10px 24px", borderRadius: "var(--radius-full)", border: "none",
                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
                display: "flex", alignItems: "center", gap: 6,
              }}><X size={14} /> Cancel</button>
              <button onClick={handleStop} style={{
                padding: "10px 24px", borderRadius: "var(--radius-full)", border: "none",
                background: "var(--accent)", color: "white",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
                display: "flex", alignItems: "center", gap: 6,
              }}><Square size={12} /> Stop</button>
            </div>
          </>
        ) : hasStopped ? (
          <>
            {/* Review & send state */}
            <div style={{
              width: 80, height: 80, borderRadius: "50%", background: "var(--accent)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 28, color: "white", marginBottom: 20,
            }}>
              <Mic size={32} />
            </div>
            <div style={{
              fontSize: 36, fontWeight: 300, fontFamily: "var(--font-mono)",
              marginBottom: 6, color: "var(--text-primary)",
            }}>
              {formatDuration(duration)}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              Voice message ready
            </div>

            {/* Playback preview */}
            {audioBlob && (
              <div style={{ marginBottom: 20 }}>
                <audio controls src={URL.createObjectURL(audioBlob)} style={{
                  height: 36, borderRadius: "var(--radius-full)",
                  filter: "invert(1) hue-rotate(180deg)", opacity: 0.8,
                }} />
              </div>
            )}

            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button onClick={handleCancel} style={{
                padding: "10px 24px", borderRadius: "var(--radius-full)", border: "none",
                background: "var(--bg-tertiary)", color: "var(--text-secondary)",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
                display: "flex", alignItems: "center", gap: 6,
              }}><X size={14} /> Discard</button>
              <button onClick={handleSend} style={{
                padding: "10px 24px", borderRadius: "var(--radius-full)", border: "none",
                background: "var(--green)", color: "white",
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "var(--font-sans)",
                display: "flex", alignItems: "center", gap: 6,
              }}><Send size={14} /> Send</button>
            </div>
          </>
        ) : (
          <div style={{ padding: 20 }}>
            <div className="spinner spinner-md" />
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0; } to { opacity:1; } }
        @keyframes recordPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(225, 112, 85, 0.4); }
          50% { box-shadow: 0 0 0 20px rgba(225, 112, 85, 0); }
        }
      `}</style>
    </div>
  );
}
