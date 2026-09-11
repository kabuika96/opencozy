import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MobileApp } from "./mobile/MobileApp";
import { installAppZoomLock } from "./mobile/zoomLock";
import { registerServiceWorker } from "./registerServiceWorker";

installAppZoomLock();
registerServiceWorker();

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MobileApp />
  </StrictMode>,
);
