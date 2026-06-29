/** 前端入口。挂载 React App 到 #root，启用 BrowserRouter（basename="/studio"）。 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename="/studio">
      <App />
    </BrowserRouter>
  </StrictMode>,
);
