import { useEffect, useState } from "preact/hooks";
import { AccountButton } from "./components/AccountButton";
import { CollectionProvider, useCollection } from "./state/collection";
import { CollectionView } from "./views/CollectionView";
import { FriendsView } from "./views/FriendsView";
import { LibraryView } from "./views/LibraryView";

const ROUTES = ["library", "collection", "friends"] as const;
type Route = (typeof ROUTES)[number];

/**
 * The section, plus what follows it:
 *   #/friends/add/CODE   adds a friend from their invite link
 *   #/friends/<uid>      a friend's shared collection
 */
interface Place { route: Route; rest: string[] }

function readPlace(): Place {
  const [head, ...rest] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if ((ROUTES as readonly string[]).includes(head)) return { route: head as Route, rest: rest.map(decodeURIComponent) };
  return { route: "library", rest: [] };
}

export function App() {
  return (
    <CollectionProvider>
      <Shell />
    </CollectionProvider>
  );
}

function Shell() {
  const [place, setPlace] = useState<Place>(readPlace);
  const col = useCollection();
  const route = place.route;

  useEffect(() => {
    // Always name the section in the URL, so a shared library search doesn't open another section.
    if (!new RegExp(`^#/(${ROUTES.join("|")})(/|$)`).test(location.hash)) {
      history.replaceState(null, "", location.pathname + location.search + "#/" + route);
    }
    const onHash = () => setPlace(readPlace());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  // Switching sections starts a fresh search; the query string belongs to the section it was made in.
  const go = (to: Route) => (e: Event) => {
    e.preventDefault();
    if (to === route && !place.rest.length) return;
    history.pushState(null, "", location.pathname + "#/" + to);
    setPlace({ route: to, rest: [] });
  };

  const tab = (to: Route, label: string) => (
    <a href={`#/${to}`} class={route === to ? "on" : ""} aria-current={route === to ? "page" : undefined} onClick={go(to)}>{label}</a>
  );
  const nav = (
    <>
      <nav class="tabs" aria-label="Sections">
        {tab("library", "Card library")}
        {tab("collection", "My collection")}
        {col.kind !== "memory" && tab("friends", "Friends")}
      </nav>
      <AccountButton />
    </>
  );

  const friendUid = route === "friends" && place.rest[0] && place.rest[0] !== "add" ? place.rest[0] : null;
  const addCode = route === "friends" && place.rest[0] === "add" ? place.rest[1] || "" : "";

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
      {route === "friends" && !friendUid && <FriendsView key="friends" nav={nav} addCode={addCode} />}
      {friendUid && <CollectionView key={`friend-${friendUid}`} nav={nav} friendUid={friendUid} />}
    </>
  );
}
