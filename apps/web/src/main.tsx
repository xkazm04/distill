import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (OFL-1.1): no font CDN, no third-party request. Each subset downloads only when a glyph needs it.
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght-italic.css";
import "@fontsource-variable/fredoka/wght.css";
import { App } from "./App";
import { startTheme } from "./brand/theme";
import "./ui/styles.css";

// Bind the brand roles before React renders anything (index.html already stamped the ground colour).
startTheme();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
