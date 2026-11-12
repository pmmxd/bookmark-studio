import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "@/lib/theme";
import { initI18n } from "@/lib/i18n";
import "@/styles/globals.css";

Promise.all([initTheme(), initI18n()]).finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
