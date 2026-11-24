import { readFileSync } from "node:fs";
import path from "node:path";
import { Marked, type Tokens } from "marked";

/**
 * Everything the site shows comes from website/content: the docs as Markdown (one file per page,
 * sidebar order in docs/_meta.json), the story, the home page data and the logos.
 * This runs at build time only; the result is static HTML.
 */

const CONTENT = path.join(process.cwd(), "content");
const read = (file: string) => readFileSync(path.join(CONTENT, file), "utf8");
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export interface DocMeta { id: string; title: string; group: string }
export interface Heading { id: string; text: string; level: 2 | 3 }
export interface Doc extends DocMeta { html: string; headings: Heading[]; prev?: DocMeta; next?: DocMeta }

export const DOC_GROUPS: { group: string; pages: { id: string; title: string }[] }[] = JSON.parse(read("docs/_meta.json"));
export const DOC_ORDER: DocMeta[] = DOC_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group })));
const DOC_IDS = new Set(DOC_ORDER.map((d) => d.id));

export const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Heading text as a reader sees it: no backticks or bold markers. */
const plain = (t: string) => t.replace(/[`*_]/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();

/** `---\nkey: "value"\n---\n` at the top of a file. */
export function frontmatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].startsWith('"') ? JSON.parse(kv[2]) : kv[2];
  }
  return { data, body: text.slice(m[0].length) };
}

const LANG_LABEL: Record<string, string> = {
  powershell: "PowerShell", bash: "Bash", sh: "Shell", shell: "Shell", json: "JSON", ts: "TypeScript", js: "JavaScript", yaml: "YAML",
};

/** Shell blocks: commands (dkit, npm, git, cd) in the accent colour, `# comments` muted. */
function highlight(code: string, lang: string): string {
  const shellish = /^(powershell|bash|sh|shell)?$/.test(lang) || /^(dkit|npm) /.test(code);
  if (!shellish) return esc(code);
  return code.split("\n").map((line) => {
    let body = line;
    let comment = "";
    const k = body.search(/(^|\s)# /);
    if (k >= 0) { comment = body.slice(k); body = body.slice(0, k); }
    let html = esc(body).replace(/^(\s*)(dkit|npm|git|cd)(?= )/, '$1<span class="p">$2</span>');
    if (comment) html += `<span class="m">${esc(comment)}</span>`;
    return html;
  }).join("\n");
}

/** Markdown → the docs' HTML. Collects the h2/h3 headings for "On this page". */
export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const headings: Heading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Heading) {
        const inner = this.parser.parseInline(token.tokens);
        const text = plain(token.text);
        let id = slug(text) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n + 1}`;
        if (token.depth === 2 || token.depth === 3) headings.push({ id, text, level: token.depth });
        // A heading that is only a command (### `dkit doctor`) gets the command style.
        const isCmd = token.depth === 3 && token.tokens.length === 1 && token.tokens[0].type === "codespan";
        return `<h${token.depth} id="${id}"${isCmd ? ' class="cmd"' : ""}>${inner}</h${token.depth}>\n`;
      },
      code(token: Tokens.Code) {
        const lang = (token.lang ?? "").trim().split(/\s/)[0];
        const label = LANG_LABEL[lang] ?? (lang || "Output");
        return `<div class="dxp"><div class="dxph"><span>${esc(label)}</span><button class="dxc" type="button" aria-label="Copy code">copy</button></div>` +
          `<pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${highlight(token.text, lang)}</code></pre></div>\n`;
      },
      link(this: { parser: { parseInline: (t: Tokens.Generic[]) => string } }, token: Tokens.Link) {
        const inner = this.parser.parseInline(token.tokens);
        let href = token.href;
        // Links between docs pages were written as #page-id: point them at /docs/page-id/.
        const hash = href.match(/^#([\w-]+)$/);
        if (hash && DOC_IDS.has(hash[1])) href = `${BASE}/docs/${hash[1]}/`;
        const external = /^https?:\/\//.test(href);
        return `<a href="${esc(href)}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${inner}</a>`;
      },
    },
  });
  const html = (marked.parse(md) as string)
    .replace(/<table>/g, '<div class="sc"><table>')
    .replace(/<\/table>/g, "</table></div>");
  return { html, headings };
}

export function getDoc(id: string): Doc {
  const i = DOC_ORDER.findIndex((d) => d.id === id);
  if (i < 0) throw new Error(`No docs page "${id}"`);
  const { body } = frontmatter(read(`docs/${id}.md`));
  return { ...DOC_ORDER[i], ...renderMarkdown(body), prev: DOC_ORDER[i - 1], next: DOC_ORDER[i + 1] };
}

export interface SearchEntry { id: string; page: string; h: string; hid: string; text: string }

/** One entry per section of every page, for the Ctrl K search. */
export function searchIndex(): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const d of DOC_ORDER) {
    const { body } = frontmatter(read(`docs/${d.id}.md`));
    let h = d.title;
    let text = "";
    let fence = false;
    const push = () => { if (text.trim()) out.push({ id: d.id, page: d.title, h, hid: slug(h), text: text.replace(/\s+/g, " ").trim() }); text = ""; };
    for (const line of body.split(/\r?\n/)) {
      if (/^```/.test(line)) { fence = !fence; continue; }
      const m = !fence && line.match(/^(#{1,3}) (.*)/);
      if (m) {
        push();
        h = plain(m[2]);
        continue;
      }
      text += " " + line.replace(/[|`*#>[\]]/g, " ").replace(/\(#[\w-]+\)/g, "");
    }
    push();
  }
  // The page title section points at the top of the page, not at an anchor.
  return out.map((e) => (e.h === e.page ? { ...e, hid: "" } : e));
}

// ── Story ───────────────────────────────────────────────────

export interface Story {
  title: string;
  eyebrow: string;
  lead: string;
  sections: { label: string; title: string; html: string }[];
  closing: string;
}

export function getStory(): Story {
  const { data, body } = frontmatter(read("story.md"));
  const [main, closing = ""] = body.split(/\r?\n---\r?\n/);
  const parts = main.split(/^## /m);
  const sections = parts.slice(1).map((part) => {
    const [label, ...rest] = part.split(/\r?\n/);
    const text = rest.join("\n");
    const title = text.match(/^### (.*)$/m)?.[1] ?? "";
    const html = (new Marked().parse(text.replace(/^### .*$/m, "")) as string).replace(/<strong>/g, "<b>").replace(/<\/strong>/g, "</b>");
    return { label: label.trim(), title, html };
  });
  return {
    title: data.title ?? "Why I built dkit",
    eyebrow: data.eyebrow ?? "# the story",
    lead: parts[0].trim(),
    sections,
    closing: closing.trim(),
  };
}
