const ROWS: [string[], string][] = [
  [["goblin", '!"Lightning Bolt"'], "Name contains / exact name"],
  [["c:rg", "c=u", "c:m", "c:c"], "Colors (at least / exactly / multicolor / colorless)"],
  [["id:esper", "id<=wub"], "Color identity (fits in that commander deck)"],
  [["t:legendary t:creature"], "Type line"],
  [['o:"draw a card"', "o:~", "fo:"], "Rules text (~ = card name; fo: includes reminder text)"],
  [["m:{G}{G}", "m:2WW"], "Mana cost contains symbols"],
  [["mv>=4", "mv:even"], "Mana value"],
  [["pow>=4", "tou<pow", "loy:3", "pt>=10"], "Power, toughness, loyalty"],
  [["r:mythic", "r>=rare"], "Rarity"],
  [["s:woe", "cn:12", "st:commander"], "Set code (any printing in the library), collector number, set type"],
  [["f:commander", "banned:modern"], "Format legality"],
  [["kw:flying", "produces:g"], "Keyword abilities, mana produced"],
  [['a:"rebecca guay"', "ft:/dragon/", "wm:selesnya"], "Artist, flavor text, watermark"],
  [["usd>5", "year>=2020", "date<2010-01-01"], "Price, release year/date"],
  [["is:foil", "is:commander", "is:mdfc", "is:showcase"], "Card properties (also not:)"],
  [["qty>=2"], "Copies owned (collections only)"],
  [["order:usd", "dir:desc"], "Sort from the search box"],
];

export function SearchHelp({ examples, scope, onExample }: { examples: string[]; scope: string; onExample: (q: string) => void }) {
  return (
    <details class="help">
      <summary>Search help</summary>
      <div class="help-body">
        <p>
          Search works like <a href="https://scryfall.com/docs/syntax" target="_blank" rel="noopener">Scryfall</a>, over {scope}.
          Combine terms with spaces (AND), <code>or</code>, parentheses, and <code>-</code> to negate. Use quotes for phrases
          and <code>/regex/</code> for patterns.
        </p>
        <table>
          <tbody>
            {ROWS.map(([codes, what]) => (
              <tr key={what}>
                <td>{codes.map((c, i) => <>{i > 0 && " "}<code>{c}</code></>)}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="examples">
          Try:
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              class="ex"
              onClick={(e) => {
                (e.currentTarget as HTMLElement).closest("details")!.open = false;
                onExample(ex);
              }}
            >
              {ex}
            </button>
          ))}
        </p>
      </div>
    </details>
  );
}
