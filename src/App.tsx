import { useEffect, useState } from "preact/hooks";
import { AccountButton } from "./components/AccountButton";
import { SHARED_COLLECTION_NAME } from "./config";
import { CollectionProvider, useCollection } from "./state/collection";
import { CollectionView } from "./views/CollectionView";
import { LibraryView } from "./views/LibraryView";
import { SharedView } from "./views/SharedView";

const ROUTES = ["library", "collection", "shared"] as const;
type Route = (typeof ROUTES)[number];

// Links from before ManaBin (the collection viewer) had a search in the query string and no hash,
// so those still open the shared collection.
function readRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, "");
  if ((ROUTES as readonly string[]).includes(hash)) return hash as Route;
  return location.search ? "shared" : "library";
}

export function App() {
  return (
    <CollectionProvider>
      <Shell />
    </CollectionProvider>
  );
}

function Shell() {
  const [route, setRoute] = useState<Route>(readRoute);
  const col = useCollection();

  useEffect(() => {
    // Always name the section in the URL, so a shared library search doesn't open the collection.
    if (!new RegExp(`^#/(${ROUTES.join("|")})$`).test(location.hash)) {
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

  const tab = (to: Route, label: string) => (
    <a href={`#/${to}`} class={route === to ? "on" : ""} aria-current={route === to ? "page" : undefined} onClick={go(to)}>{label}</a>
  );
  const nav = (
    <>
      <nav class="tabs" aria-label="Sections">
        {tab("library", "Card library")}
        {tab("collection", "My collection")}
        {tab("shared", SHARED_COLLECTION_NAME)}
      </nav>
      <AccountButton />
    </>
  );

  return (
    <>
      {col.error && (
        <div class="banner" role="alert">
          <span>{col.error}</span>
          <button type="button" class="linkish" onClick={col.dismissError}>Dismiss</button>
        </div>
      )}
      {route === "library" && <LibraryView key="library" nav={nav} />}
      {route === "collection" && <CollectionView key="collection" nav={nav} />}
      {route === "shared" && <SharedView key="shared" nav={nav} />}
    </>
  );
}
