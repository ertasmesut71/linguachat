import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// D7 — Register the service worker for offline shell + installability.
// Only in production builds: in dev, Vite serves modules directly and the
// SW would intercept HMR requests. We also gate on the API existing so old
// browsers never throw. All errors are swallowed so a broken SW can never
// take down the app.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/service-worker.js")
      .then((reg) => {
        // If a new SW is found, ask it to take over so the next reload
        // sees the new build immediately rather than after two reloads.
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => {
        // Silently ignore — SW failure must never block the app.
      });
  });
}
