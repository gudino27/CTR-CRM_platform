/**
 * main.jsx — Application entry point
 *
 * Mounts the React app into the <div id="root"> in index.html.
 * StrictMode enables extra runtime warnings in development
 * (double-invokes renders/effects to surface side-effect bugs).
 * Global CSS is imported here so it applies to every page.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/global.css";
import App from "./App";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
