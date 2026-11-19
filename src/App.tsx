import { useEffect, useState } from "preact/hooks";
import { AccountButton } from "./components/AccountButton";
import { CollectionProvider, useCollection } from "./state/collection";
import { CollectionView } from "./views/CollectionView";
import { DecksView } from "./views/DecksView";
import { DeckView } from "./views/DeckView";
import { FriendsView } from "./views/FriendsView";
import { ScanView } from "./views/ScanView";
import { WishlistView } from "./views/WishlistView";
import { LibraryView } from "./views/LibraryView";
import { HomeView } from "./views/HomeView";

const ROUTES = ["home", "library", "collection", "scan", "decks", "wishlist", "friends"] as const;
type Route = (typeof ROUTES)[number];

/**
 * The section, plus what follows it:
 *   #/home               the welcome page, or your dashboard once signed in
 *   #/library            every card (the Browse tab)
 *   #/decks/new          your decks, with the new-deck dialog open
 *   #/friends/add/CODE   adds a friend from their invite link
 *   #/friends/<uid>      a friend's shared collection
 *   #/friends/<uid>/decks/<id>  a deck a friend shares with you
 *   #/decks/<id>         one of your decks
 *   #/wishlist           cards you want (no tab; linked from Decks)
 *   #/scan               scanning cards with the camera
 */
interface Place { route: Route; rest: string[] }

function readPlace(): Place {
  const [head, ...rest] = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if ((ROUTES as readonly string[]).includes(head)) return { route: head as Route, rest: rest.map(decodeURIComponent) };
  // An old shared search link (?q=… with no section) still opens the card library.
  return { route: new URLSearchParams(location.search).has("q") ? "library" : "home", rest: [] };
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
    <a href={`#/${to}`} class={route === to || (to === "decks" && route === "wishlist") ? "on" : ""} aria-current={route === to ? "page" : undefined} onClick={go(to)}>{label}</a>
  );
  const nav = (
    <>
      <nav class="tabs" aria-label="Sections">
        {tab("home", "Home")}
        {tab("library", "Browse")}
        {tab("collection", "My collection")}
        {tab("scan", "Scan")}
        {tab("decks", "Decks")}
        {col.kind !== "memory" && tab("friends", "Friends")}
      </nav>
      <AccountButton />
    </>
  );

  const friendUid = route === "friends" && place.rest[0] && place.rest[0] !== "add" ? place.rest[0] : null;
  const friendDeck = friendUid && place.rest[1] === "decks" ? place.rest[2] || null : null;
  const newDeck = route === "decks" && place.rest[0] === "new";
  const deckId = route === "decks" && !newDeck ? place.rest[0] || null : null;
  const addCode = route === "friends" && place.rest[0] === "add" ? place.rest[1] || "" : "";

  return (
    <>
      {col.error && (
        <div class="banner" role="alert">
          <span>{col.error}</span>
          <button type="button" class="linkish" onClick={col.dismissError}>Dismiss</button>
        </div>
      )}
      {route === "home" && <HomeView key="home" nav={nav} />}
      {route === "library" && <LibraryView key="library" nav={nav} />}
      {route === "collection" && <CollectionView key="collection" nav={nav} />}
      {route === "friends" && !friendUid && <FriendsView key="friends" nav={nav} addCode={addCode} />}
      {friendUid && !friendDeck && <CollectionView key={`friend-${friendUid}`} nav={nav} friendUid={friendUid} />}
      {friendUid && friendDeck && <DeckView key={`fdeck-${friendDeck}`} nav={nav} id={friendDeck} owner={friendUid} />}
      {route === "decks" && !deckId && <DecksView key={newDeck ? "decks-new" : "decks"} nav={nav} startNew={newDeck} />}
      {deckId && <DeckView key={`deck-${deckId}`} nav={nav} id={deckId} />}
      {route === "wishlist" && <WishlistView key="wishlist" nav={nav} />}
      {route === "scan" && <ScanView key="scan" nav={nav} />}
    </>
  );
}
