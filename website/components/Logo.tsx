import logos from "@/content/logos.json";

const icons = logos.icons as Record<string, string>;
const custom = logos.custom as Record<string, { vb: string; b: string }>;
const letters = logos.fallbackLetters as Record<string, string>;

const hasLogo = (id: string) => !!custom[id] || !!icons[id];

/**
 * Every logo drawn once, as an invisible sprite; <Logo> then points at it with <use>.
 * The home page shows each logo several times (scrolling rows), so this keeps the page small.
 */
export function LogoSprite({ ids }: { ids: string[] }) {
  const unique = [...new Set(ids)].filter(hasLogo);
  // The custom SVG bodies are our own files in content/logos.json, not user input.
  const body = unique.map((id) =>
    custom[id]
      ? `<symbol id="lg-${id}" viewBox="${custom[id].vb}">${custom[id].b}</symbol>`
      : `<symbol id="lg-${id}" viewBox="0 0 24 24"><path d="${icons[id]}"/></symbol>`,
  ).join("");
  return <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden dangerouslySetInnerHTML={{ __html: body }} />;
}

/** A tool's logo in one colour (it takes the text colour). Falls back to two letters. Needs <LogoSprite> on the page. */
export function Logo({ id }: { id: string }) {
  if (!hasLogo(id)) return <div className="lo mo">{letters[id] ?? id.slice(0, 2)}</div>;
  return <div className="lo"><svg aria-hidden><use href={`#lg-${id}`} /></svg></div>;
}
