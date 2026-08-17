import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import { ReviewerApplication } from "./app.js";
import "./global.css";

const rootElement = document.querySelector<HTMLElement>("#root");

if (rootElement === null) {
  throw new Error("The frontend root element is missing.");
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <ReviewerApplication />
    </BrowserRouter>
  </StrictMode>,
);
