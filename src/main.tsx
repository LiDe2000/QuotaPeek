import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { storage } from "./services/storage";
import "./styles/global.css";

async function start() {
  const root = document.getElementById("root") as HTMLElement;
  try {
    // Restore settings and snapshots before mount, so defaults cannot overwrite them.
    await storage.initialize();
    ReactDOM.createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
  } catch (failure) {
    root.setAttribute("role", "alert");
    root.textContent = `Could not load saved data. Restart QuotaPeek. ${typeof failure === "string" ? failure : failure instanceof Error ? failure.message : ""}`;
  }
}
void start();
