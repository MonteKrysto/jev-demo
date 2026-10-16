import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/manrope";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
