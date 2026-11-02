import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./app.css";
import App from "./App";
import { MATH_CSS } from "../../core/math.ts";

// Formula styling has one source, shared with the printed report.
const mathStyle = document.createElement("style");
mathStyle.textContent = MATH_CSS;
document.head.append(mathStyle);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
