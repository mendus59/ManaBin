import { useEffect, useState } from "preact/hooks";
import { SHARED_COLLECTION_NAME } from "./config";
import { LibraryView } from "./views/LibraryView";
import { SharedView } from "./views/SharedView";

type Route = "library" | "shared";

// Links from before ManaBin (the collection viewer) had a search in the query string and no hash,
// so those still open the shared collection.
function readRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if (hash === "shared" || hash === "library") return hash;
  return location.search ? "shared" : "library";
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    // Always name the section in the URL, so a shared library search doesn't open the collection.
    if (!/^#\/(library|shared)$/.test(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search + "#/" + route);
    }
    const onHash = () => setRoute(readRoute());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Switching sections starts a fresh search; the query string belongs to the section it was made in.
  const go = (to: Route) => (e: Event) => {
    e.preventDefault();
    if (to === route) return;
    history.pushState(null, "", location.pathname + "#/" + to);
    setRoute(to);
  };

  const nav = (
    <nav class="tabs" aria-label="Sections">
      <a href="#/library" class={route === "library" ? "on" : ""} aria-current={route === "library" ? "page" : undefined} onClick={go("library")}>Card library</a>
      <a href="#/shared" class={route === "shared" ? "on" : ""} aria-current={route === "shared" ? "page" : undefined} onClick={go("shared")}>{SHARED_COLLECTION_NAME}</a>
    </nav>
  );

  return route === "library" ? <LibraryView key="library" nav={nav} /> : <SharedView key="shared" nav={nav} />;
}
