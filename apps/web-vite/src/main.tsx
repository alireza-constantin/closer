import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/app/app";
import { ReloadPrompt } from "@/pwa/reload-prompt";

import "./index.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("The application root element is missing.");
}

createRoot(container).render(
  <StrictMode>
    <App />
    <ReloadPrompt />
  </StrictMode>,
);
