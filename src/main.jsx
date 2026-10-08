import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(e, info) {
    console.error("Rink GM crashed:", e, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="title">
          <div className="panel" style={{ maxWidth: 460, textAlign: "center" }}>
            <h2 style={{ marginTop: 0 }}>Something went wrong</h2>
            <p className="muted">Your league is auto-saved in this browser. Reloading usually recovers it.</p>
            <pre className="small" style={{ whiteSpace: "pre-wrap", textAlign: "left", color: "#fca5a5" }}>{String(this.state.err?.message || this.state.err)}</pre>
            <button className="primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
