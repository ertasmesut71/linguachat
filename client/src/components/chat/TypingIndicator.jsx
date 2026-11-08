export default function TypingIndicator({ names }) {
  if (!names || names.length === 0) return null;

  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
      ? `${names[0]} and ${names[1]} are typing`
      : `${names[0]} and ${names.length - 1} others are typing`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 16px",
        fontSize: 12,
        color: "var(--text-tertiary)",
        fontStyle: "italic",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          gap: 3,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              background: "var(--text-tertiary)",
              animation: `typingBounce 1.4s infinite ease-in-out`,
              animationDelay: `${i * 0.2}s`,
            }}
          />
        ))}
      </span>
      {text}

      <style>{`
        @keyframes typingBounce {
          0%, 80%, 100% { transform: translateY(0); }
          40% { transform: translateY(-5px); }
        }
      `}</style>
    </div>
  );
}
