import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import {
  RECONSTRUCTION_PARAMETER,
  reconstructionIn,
} from "./reconstruction-client.js";
import "./app.css";

const root = document.getElementById("root");
if (root === null) {
  throw new Error('index.html has no <div id="root">.');
}
createRoot(root).render(
  <StrictMode>
    <App
      reconstruction={reconstructionIn(window.location.search)}
      onFollow={(id) => {
        // Kept in the address, so loading the page again follows it again.
        const url = new URL(window.location.href);
        url.searchParams.set(RECONSTRUCTION_PARAMETER, id);
        window.history.replaceState(null, "", url);
      }}
    />
  </StrictMode>,
);
