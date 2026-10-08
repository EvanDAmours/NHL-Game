import React, { useEffect, useRef } from "react";

// In-page replacement for window.confirm, which embedded viewers suppress.
export default function ConfirmModal({ req, onAnswer }) {
  const yesRef = useRef(null);
  useEffect(() => {
    yesRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && onAnswer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);
  return (
    <div className="modalbg" style={{ zIndex: 80, alignItems: "center" }} onMouseDown={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className="modal" role="alertdialog" aria-modal="true" style={{ width: "min(440px, 100%)" }}>
        <div className="mhead">
          <div style={{ fontWeight: 800, fontSize: 17 }}>{req.title}</div>
        </div>
        <div className="mbody stack" style={{ gap: 16 }}>
          {req.body && <div className="muted">{req.body}</div>}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button onClick={() => onAnswer(false)}>{req.no || "Cancel"}</button>
            <button ref={yesRef} className={req.danger ? "danger" : "primary"} onClick={() => onAnswer(true)}>{req.yes || "OK"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
