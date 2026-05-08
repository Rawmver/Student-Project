import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Defense in depth: ensure the browser never auto-restores scroll position.
if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}
window.scrollTo(0, 0);

createRoot(document.getElementById("root")!).render(<App />);
