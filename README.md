# ManaBin

<!-- site-summary:start -->
<!-- This section is this project's card on https://mendus59.github.io and is copied there daily.
     Keep it true of what's on main: one plain-text summary line (max 160 characters), then 1-6 short bullets.
     See CLAUDE.md ("Site summary"). -->
A free web app for tracking a Magic: The Gathering collection, with every card and printing and Scryfall-style search.

- Search the full paper card library, with every printing and art variant and its price.
- Add the exact printing, finish, condition and language you own, or import a ManaBox CSV export.
- Your collection syncs across devices when you sign in with Google, and works offline.
- New sets are added automatically on release day by a daily GitHub Actions job.
- Export your collection as a ManaBox-compatible CSV or a JSON backup at any time.
- Browse a shared collection, with prices from TCGplayer, Card Kingdom and MTGGoldfish.
<!-- site-summary:end -->

ManaBin started as [manabox-viewer](https://github.com/mendus59/manabox-viewer). It is growing into a full collection manager: binders, decks, an EDH deck builder that knows what you own, and card scanning on phones.

## Your collection

Open any card in the **Card library**, pick the exact printing from its list of printings, and add it with its finish, condition, language and quantity. **My collection** shows everything you own with its value, and searches and filters the same way as the library. It can import a ManaBox CSV export (keeping each card's printing, finish, condition, language, purchase price and binder) and export a ManaBox-compatible CSV or a JSON backup.

Collections are stored in Firebase (Firestore), on the free Spark plan:

- Each browser gets a guest account automatically, so nothing is needed to start.
- **Sign in with Google** turns the guest account into a Google account, so the collection is safe and shows up on every device you sign in on. If that Google account already has a collection, the guest's cards are added to it.
- Firestore keeps a copy on the device, so the collection works offline and syncs when you're back online.
- A collection is stored as 16 documents (by printing ID), so loading one costs 16 reads however big it is.

`firestore.rules` holds the security rules: each user can only read and write their own data. Firebase setup, done once in the [Firebase console](https://console.firebase.google.com/) for project `manabin-85e10`:

1. **Authentication → Sign-in method:** enable **Anonymous** and **Google**.
2. **Authentication → Settings → Authorized domains:** add `mendus59.github.io`.
3. **Firestore Database → Rules:** paste `firestore.rules` and publish.

The Firebase web config in `src/lib/firebase.ts` is public by design; access is controlled by the rules and the authorized domains. To develop without Firebase, build with `VITE_STORE=memory` and the collection is kept in the browser's local storage instead.

## How it works

```
Scryfall bulk data ──► tools/build_library.py ──► data branch ──┐
   (every printing)        (daily check)            (JSON)      ├──► Vite build ──► GitHub Pages
ManaBox CSV ──► build.py ──► public/shared/collection.json ─────┘
```

- **The app** (`src/`) is Preact + TypeScript, built with Vite. All searching happens in the browser, so using the site never calls the Scryfall API. Card images load from Scryfall's image CDN, which Scryfall permits.
- **The card library** is built from Scryfall's Default Cards bulk file by `tools/build_library.py`. It leaves out digital-only cards, and marks tokens, emblems and art cards as extras that search hides unless you add `include:extras`. It writes:
  - `cards.json`: one entry per card (about 30k), with the rules text, legality and a representative printing.
  - `prints/xx.json`: every printing, sharded by oracle ID and loaded when you open a card.
  - `ids/xx.json`: printing ID to card, used when importing a collection.
  - `sets.json` and `manifest.json`: set details, and what the build covers.
- **The shared collection** (`public/shared/collection.json`) is built from a ManaBox export by `build.py`, as before.

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

## Updating the shared collection

1. Export your collection from ManaBox as CSV and save it over `ManaBox_Collection.csv`, or pass a different path.
2. Run `python build.py` (or `python build.py path/to/export.csv`), then `python refresh_prices.py`.
3. Commit and push `public/shared/collection.json`. The site redeploys automatically.

ManaBox CSV exports are listed in `.gitignore`, so your purchase prices and binder names never reach the repo.

## Prices

- **Card library:** TCGplayer market prices, via Scryfall's bulk data, refreshed whenever the library rebuilds.
- **Shared collection:** the highest of TCGplayer market (via Scryfall), Card Kingdom near-mint retail, and MTGGoldfish paper for each finish you own. `.github/workflows/prices.yml` runs `refresh_prices.py` every Monday at 12:00 UTC, commits `public/shared/collection.json` and redeploys. Add `--no-goldfish` to skip the ~15-minute MTGGoldfish scrape.
- **For the CSV:** `python update_prices.py` writes `ManaBox_Collection_updated.csv` (with `Purchase price` set to the highest price) and `ManaBox_Collection_prices.csv` (each source's price per row).

## Hosting on GitHub Pages

`.github/workflows/pages.yml` builds and publishes the site when the app changes on `main`, and after the library or price jobs update data.

One-time setup: in the repo on GitHub, go to **Settings → Pages → Build and deployment** and set **Source** to **GitHub Actions**, then run **Actions → Card library → Run workflow** once to build the library.

## Search

The search syntax follows https://scryfall.com/docs/syntax: `t:`, `o:`, `c:`, `id:`, `m:`, `mv`, `pow`/`tou`/`loy`, `r:`, `s:`, `cn:`, `f:`, `kw:`, `a:`, `ft:`, `usd`, `year`/`date`, `is:`/`not:`/`has:`, `produces:`, `order:`/`dir:`, `or`, `-` negation, parentheses, quotes, `/regex/`, and `!"exact name"`. Click **Search help** on the page for examples.

- In the library, `s:` matches any set a card was printed in, and `is:foil` matches cards that come in foil.
- In the shared collection, `qty>=2` filters by copies owned, and `is:foil`/`is:nonfoil` match the copies you own.

The **Filters** panel adds point-and-click filters, combined with the search box: color and color identity (including / exactly / at most), mana value, card type, subtype, set, rarity, format legality, finish, and price range. The search, sort, view and filters are stored in the URL, so you can send someone a link to a specific search. Links from the old collection viewer still open the shared collection.
