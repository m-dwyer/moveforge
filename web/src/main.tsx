import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./AppRoot";
import "./index.css";

if (import.meta.hot) {
  import.meta.hot.on("moveforge:wasm-rebuilt", (data: { moduleId: string | null }) => {
    window.dispatchEvent(new CustomEvent("moveforge:wasm-rebuilt", { detail: data }));
  });
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");
createRoot(rootEl).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);
