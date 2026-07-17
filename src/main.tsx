import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles.css";

// Applied before first paint so a light-theme user never sees a dark flash.
const stored = localStorage.getItem("nexus.ui");
if (stored) {
  try {
    const theme = JSON.parse(stored)?.state?.theme;
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Corrupt preference blob: the dark default already applies. Chrome
    // preferences are not worth failing a boot over.
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
