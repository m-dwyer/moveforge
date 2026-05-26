import React from "react";
import { createRoot } from "react-dom/client";
import { AppRoot } from "./AppRoot";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root element in index.html");
createRoot(rootEl).render(
  <React.StrictMode>
    <AppRoot />
  </React.StrictMode>
);
