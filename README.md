# ManaBin

<!-- site-summary:start -->
<!-- This section is this project's card on https://mendus59.github.io and is copied there daily.
     Keep it true of what's on main: one plain-text summary line (max 160 characters), then 1-6 short bullets.
     See CLAUDE.md ("Site summary"). -->
A free web app for browsing every Magic: The Gathering card and sharing a collection, with Scryfall-style search.

- Search the full paper card library, with every printing and art variant and its price.
- New sets are added automatically on release day by a daily GitHub Actions job.
- Browse a shared collection built from a ManaBox export, with its total value.
- Prices for the shared collection refresh weekly from TCGplayer, Card Kingdom and MTGGoldfish.
- Runs entirely in the browser on GitHub Pages, with no server or account.
<!-- site-summary:end -->

ManaBin started as [manabox-viewer](https://github.com/mendus59/manabox-viewer). It is growing into a full collection manager: binders, decks, an EDH deck builder that knows what you own, manual add by exact printing, and card scanning on phones.

## How it works

```
Scryfall bulk data ──► tools/build_library.py ──► data branch ──┐
   (every printing)        (daily check)            (JSON)      ├──► Vite build ──► GitHub Pages
ManaBox CSV ──► build.py ──► public/shared/collection.json ─────┘
```

- **The app** (`src/`) is Preact + TypeScript, built with Vite. All searching happens in the browser, so using the site never calls the Scryfall API. Card images load from Scryfall's image CDN, which Scryfall permits.
- **The card library** is built from Scryfall's Default Cards bulk file by `tools/build_library.py`. It leaves out tokens, digital-only cards and other non-collectible printings, and writes:
  - `cards.json`: one entry per card (about 30k), with the rules text, legality and a representative printing.
  - `prints/xx.json`: every printing, sharded by oracle ID and loaded when you open a card.
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
npm test                            # search engine tests
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
