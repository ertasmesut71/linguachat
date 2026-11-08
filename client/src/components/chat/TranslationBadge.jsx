import { Globe, Loader2 } from "lucide-react";

/**
 * Small inline badge showing translation state.
 * @param {object} props
 * @param {'idle'|'loading'|'done'|'error'} props.status
 * @param {string} [props.sourceLang] - source language code
 * @param {string} [props.targetLang] - target language code
 */
export default function TranslationBadge({ status, sourceLang, targetLang }) {
  if (status === "idle") return null;

  const styles = {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    fontSize: 10,
    fontWeight: 500,
    padding: "1px 6px",
    borderRadius: "var(--radius-full)",
    lineHeight: 1.6,
  };

  if (status === "loading") {
    return (
      <span
        style={{
          ...styles,
          color: "var(--text-tertiary)",
          background: "rgba(255,255,255,0.06)",
        }}
      >
        <Loader2
          size={9}
          style={{
            animation: "spin 1s linear infinite",
          }}
        />
        Translating
      </span>
    );
  }

  if (status === "error") {
    return (
      <span
        style={{
          ...styles,
          color: "var(--red)",
          background: "var(--red-soft)",
        }}
      >
        <Globe size={9} />
        Translation failed
      </span>
    );
  }

  // status === "done"
  return (
    <span
      style={{
        ...styles,
        color: "var(--accent)",
        background: "var(--accent-soft)",
      }}
    >
      <Globe size={9} />
      {sourceLang?.toUpperCase()} → {targetLang?.toUpperCase()}
    </span>
  );
}
