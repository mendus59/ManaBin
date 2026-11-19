# ManaBin

<!-- site-summary:start -->
<!-- This section is this project's card on https://mendus59.github.io and is copied there daily.
     Keep it true of what's on main: one plain-text summary line (max 160 characters), then 1-6 short bullets.
     See CLAUDE.md ("Site summary"). -->
A free web app for tracking a Magic: The Gathering collection, with every card and printing and Scryfall-style search.

- Search the full paper card library, with every printing and art variant.
- Add the exact printing, finish, condition and language you own, sort cards into binders, and import or export ManaBox CSVs.
- Build decks for any format, or paste one from Moxfield, Archidekt or Arena, and see which cards you already own.
- See TCGplayer, Card Kingdom and MTGGoldfish prices for each printing, and value your collection by any of them.
- Sign in with Google to keep a private collection that syncs across devices, and share it and chosen decks with friends.
- New sets are added automatically on release day by a daily GitHub Actions job.
<!-- site-summary:end -->

ManaBin started as [manabox-viewer](https://github.com/mendus59/manabox-viewer). It is growing into a full collection manager: binders, decks, an EDH deck builder that knows what you own, and card scanning on phones.

## Your collection

Open any card in the **Card library**, pick the exact printing from its list of printings, and add it with its finish, condition, language and quantity. **My collection** shows everything you own with its value, and searches and filters the same way as the library. It can import a ManaBox CSV export (keeping each card's printing, finish, condition, language, purchase price and binder) and export a ManaBox-compatible CSV or a JSON backup.

Collections are private and stored in Firebase (Firestore), on the free Spark plan:

- **Sign in with Google** to keep a collection. It shows up on every device you sign in on.
- If Anonymous sign-in is switched on in the Firebase console, each browser also gets a guest account automatically, and signing in with Google later keeps the guest's cards (adding them to the Google account's collection if it already has one). With it off, the collection, friends and the add-to-collection form ask you to sign in.
- Firestore keeps a copy on the device, so the collection works offline and syncs when you're back online.
- A collection is stored as 16 documents (by printing ID), so loading one costs 16 reads however big it is.

## Binders

**My collection** has a **Binder** menu: all cards, cards in no binder, or one binder. **New binder** makes one; choose a binder in the card dialog to add cards straight into it, or change an owned copy's binder there. **Move the cards shown** moves everything the current search and filters show, so `s:mh3` plus a move files a whole set at once. Deleting a binder keeps its cards, in no binder. ManaBox CSV imports keep their binder names, and the CSV export follows the binder you're looking at.

## Decks

**Decks** lists your decks with their card count, value and how many cards you're missing. A new deck can start empty or from a pasted decklist: Moxfield, Archidekt (categories like `[Commander]` and `[Maybeboard]` are read), MTGGoldfish, MTG Arena or plain `1 Card name` lines, with Commander, Deck, Sideboard and Maybeboard sections.

In a deck, add cards by name, change copies, and move cards between the commander, main deck, sideboard and maybeboard. The main deck is grouped by card type, and each card shows whether you own enough copies. Format checks cover deck size, copy limits, legality and the commander's color identity. **Copy decklist** and **Download .txt** export the list, and **Copy missing cards** gives just what you'd need to buy, ready for a store's mass entry. **Share this deck** picks the friends who can see it; they find it on their Friends page, read-only.

## Friends

**Friends** shows your friend code and an invite link (`#/friends/add/CODE`). A friend enters your code or opens the link and sends a request, and you accept it. For each friend you choose whether they may see your collection; when a friend shares theirs, **View collection** opens it read-only, with the same search and filters. Friends see your Google name and picture, never your email. Removing a friend also stops sharing your collection and decks with them. Decks are shared one by one, from each deck's page.

## Firebase

`firestore.rules` holds the security rules: each user can only read and write their own data, a friend can read your collection only while you list them as a viewer and you're still friends, and profiles hold only a name, picture and friend code. Firebase setup, done once in the [Firebase console](https://console.firebase.google.com/) for project `manabin-85e10`:

1. **Authentication → Sign-in method:** enable **Google**, and optionally **Anonymous** for guest collections.
2. **Authentication → Settings → Authorized domains:** add `mendus59.github.io`.
3. **Firestore Database → Rules:** paste `firestore.rules` and publish.

The Firebase web config in `src/lib/firebase.ts` is public by design; access is controlled by the rules and the authorized domains. To develop without Firebase, build with `VITE_STORE=memory` and the collection is kept in the browser's local storage instead.

## How it works

```
Scryfall bulk data ──► tools/build_library.py ──► data branch ──► Vite build ──► GitHub Pages
   (every printing)        (daily check)            (JSON)
```

- **The app** (`src/`) is Preact + TypeScript, built with Vite. All searching happens in the browser, so using the site never calls the Scryfall API. Card images load from Scryfall's image CDN, which Scryfall permits.
- **The card library** is built from Scryfall's Default Cards bulk file by `tools/build_library.py`. It leaves out digital-only cards, and marks tokens, emblems and art cards as extras that search hides unless you add `include:extras`. It writes:
  - `cards.json`: one entry per card (about 30k), with the rules text, legality and a representative printing.
  - `prints/xx.json`: every printing, sharded by oracle ID and loaded when you open a card.
  - `ids/xx.json`: printing ID to card, used when importing a collection.
  - `sets.json` and `manifest.json`: set details, and what the build covers.
- **Collections, binders, decks and friends** live in Firestore, never in the repo.

## Keeping the library current

`.github/workflows/library.yml` runs daily at 09:30 UTC. `tools/check_sets.py` compares Scryfall's set list with the last build and rebuilds when:

- a set has been released that the last build didn't include, or
- the last build is more than 30 days old (to pick up new printings, errata and price changes).

The run page lists upcoming sets and their release dates. The built files are force-pushed as a single commit to the `data` branch, so card data never bloats `main`, and the Pages deploy pulls them from there. To rebuild by hand: **Actions → Card library → Run workflow**, with **force** ticked.

## Developing

Requires Node 22+ and Python 3.9+ (no Python packages).

```
npm install
python tools/build_library.py      # downloads ~500 MB from Scryfall, writes public/library/
npm run dev                         # http://localhost:5173
npm test                            # search, collection and import/export tests
python -m unittest discover tools   # library build tests
npm run build                       # production build in dist/
```

`public/library/` is in `.gitignore`. To work offline, pass a saved bulk file: `python tools/build_library.py --bulk default-cards.json --sets sets.json`.

## Prices

Every printing has prices from three stores, shown side by side in the card dialog:

- **TCGplayer** market prices, from Scryfall's bulk data, refreshed whenever the library rebuilds.
- **Card Kingdom** near-mint retail and **MTGGoldfish** paper prices, fetched weekly by `.github/workflows/prices.yml` (Mondays 12:00 UTC) running `tools/build_prices.py`. Card Kingdom's public price list is one download, matched on Scryfall ID. MTGGoldfish is read one set page at a time (about 340 pages, two seconds apart) and matched on set code, collector number and finish.

The price files are force-pushed to the `prices` branch, like the library's `data` branch, and the Pages deploy adds them under `library/prices/`. To refresh by hand: **Actions → Store prices → Run workflow**.

A collection is valued by the **Prices** menu: the highest of the three for each card (the default), or one store, falling back to TCGplayer where that store doesn't list a card. The choice is remembered in the browser, and searches like `usd>10` and price sorting follow it.

## Hosting on GitHub Pages

`.github/workflows/pages.yml` builds and publishes the site when the app changes on `main`, and after the library job updates data.

One-time setup: in the repo on GitHub, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**, then run **Actions → Card library → Run workflow** once to build the library.

## Search

The search syntax follows https://scryfall.com/docs/syntax: `t:`, `o:`, `c:`, `id:`, `m:`, `mv`, `pow`/`tou`/`loy`, `r:`, `s:`, `cn:`, `f:`, `kw:`, `a:`, `ft:`, `usd`, `year`/`date`, `is:`/`not:`/`has:`, `produces:`, `order:`/`dir:`, `or`, `-` negation, parentheses, quotes, `/regex/`, and `!"exact name"`. Click **Search help** on the page for examples.

- In the library, `s:` matches any set a card was printed in, and `is:foil` matches cards that come in foil.
- In a collection, `qty>=2` filters by copies owned, and `is:foil`/`is:nonfoil` match the copies owned.

The **Filters** panel adds point-and-click filters, combined with the search box: color and color identity (including / exactly / at most), mana value, card type, subtype, set, rarity, format legality, finish, and price range. The search, sort, view and filters are stored in the URL, so you can send someone a link to a specific search.
