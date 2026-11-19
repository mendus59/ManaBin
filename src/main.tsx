import { render } from "preact";
import { App } from "./App";
import "./style.css";

render(<App />, document.getElementById("app")!);

// The installed app works offline: the service worker keeps the page, the text reader and card data.
if (import.meta.env.PROD && "serviceWorker" in navigator && !import.meta.env.VITE_FIREBASE_EMULATOR) {
  addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
