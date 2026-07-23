import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { WorkspaceGate } from "./components/WorkspaceGate";
import { I18nProvider } from "./i18n";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element was not found.");
}

try {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <BrowserRouter>
        <I18nProvider>
          <AppErrorBoundary>
            <WorkspaceGate>
              <App />
            </WorkspaceGate>
          </AppErrorBoundary>
        </I18nProvider>
      </BrowserRouter>
    </React.StrictMode>,
  );
} catch (error) {
  console.error("AYMO bootstrap error", error);
  rootElement.innerHTML = `
    <div style="min-height:100vh;display:grid;place-items:center;font-family:Inter,Poppins,system-ui,sans-serif;padding:24px;background:#fff;color:#111;">
      <div style="max-width:520px;text-align:center">
        <h2 style="margin:0 0 12px;">App failed to start</h2>
        <p style="margin:0;">${error instanceof Error ? error.message : "Unexpected startup error."}</p>
      </div>
    </div>
  `;
}
