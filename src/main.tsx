import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./app/App";
import "./styles.css";

// Applied before first paint so a light-theme user never sees a dark flash — e o
// "Movimento do fundo" antes do primeiro quadro, para a galáxia e a poeira da logo
// já nascerem com a preferência certa (default LIGADO), sem depender do effect do
// App nem piscar um quadro no valor errado (fase 10, BUG B).
const stored = localStorage.getItem("nexus.ui");
if (stored) {
  try {
    const state = JSON.parse(stored)?.state;
    const theme = state?.theme;
    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
    // Só "reduced" desliga; qualquer outro valor (inclusive ausente) fica LIGADO.
    document.documentElement.dataset.bgMotion =
      state?.backgroundMotion === "reduced" ? "reduced" : "on";
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
