import { useEffect, useState } from "react";

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

/**
 * Responsive side panel container.
 * Desktop: 340px sidebar with border.
 * Mobile: full-screen overlay with backdrop.
 */
export default function SidePanel({ children, onClose }) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "rgba(0,0,0,0.5)",
          backdropFilter: "blur(4px)",
          display: "flex",
          justifyContent: "flex-end",
          animation: "fadeIn 0.15s ease",
        }}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 400,
            background: "var(--bg-secondary)",
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            animation: "slideInRight 0.2s ease-out",
            overflowY: "auto",
          }}
        >
          {children}
        </div>
        <style>{`
          @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
          @keyframes slideInRight { from { transform:translateX(100%) } to { transform:translateX(0) } }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        width: 340,
        minWidth: 340,
        background: "var(--bg-secondary)",
        borderLeft: "1px solid var(--border)",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.2s ease-out",
      }}
    >
      {children}
      <style>{`
        @keyframes slideInRight { from { opacity:0; transform:translateX(20px) } to { opacity:1; transform:translateX(0) } }
      `}</style>
    </div>
  );
}
