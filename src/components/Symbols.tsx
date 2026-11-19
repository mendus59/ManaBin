// Renders text containing mana symbols like {2}{G} with Scryfall's symbol images.

export function Symbols({ text }: { text?: string }) {
  if (!text) return null;
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const m = /^\{([^}]+)\}$/.exec(part);
        if (!m) return part;
        const file = m[1].replace(/\//g, "").toUpperCase();
        return (
          <img
            key={i}
            class="sym"
            src={`https://svgs.scryfall.io/card-symbols/${encodeURIComponent(file)}.svg`}
            alt={part}
            title={part}
            onError={(e) => (e.currentTarget as HTMLImageElement).replaceWith(part)}
          />
        );
      })}
    </>
  );
}
