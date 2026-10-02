import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import "./telemetry"; // starts analytics (if not opted out) before the first render
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
