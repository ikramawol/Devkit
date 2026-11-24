# dkit website

The dkit home page and docs: a static Next.js site. It lives next to the CLI so the docs change in the same commit as the code. The npm package (`devsetupkit-cli`) never includes this folder.

## Run it

```powershell
cd website
npm install
npm run dev        # http://localhost:3000, reloads as you edit
npm run build      # static site in out/
npm run start      # serve out/ locally to check the build
npm run typecheck
```

## Edit the content

Everything the site shows is in `content/`. You rarely need to touch the code.

| File | What it is |
|---|---|
| `content/docs/*.md` | One Markdown file per docs page. The front matter sets its title, sidebar group and position |
| `content/docs/_meta.json` | The sidebar: groups and page order. Add a new page here too |
| `content/story.md` | The "Why I built dkit" page. Sections start with `## 01 · label`; the line after `---` is the closing line |
| `content/home.json` | The home page: hero, counters, comparison table, guarantees, terminal, tools, libraries, stacks |
| `content/logos.json` | The black-and-white logos (24×24 paths from Simple Icons, CC0, plus a few custom ones) |

Links between docs pages can be written as `[Stacks](#stacks)`: they become `/docs/stacks/`.

## Code

```
app/layout.tsx             fonts, theme (light/dark, remembered), page titles
app/page.tsx               home page
app/story/page.tsx         the story
app/docs/[slug]/page.tsx   every docs page (built from content/docs)
app/search-index.json/     the Ctrl K search index, written at build time
components/client.tsx      the interactive parts: theme switch, install tabs, terminal, guarantees, docs menu, search
components/DocsPage.tsx    docs layout: page list, article, "On this page"
components/Logo.tsx        logos (one sprite, referenced with <use>)
lib/content.ts             reads content/ and turns Markdown into the docs HTML
app/globals.css            all styles
```

## Deploy

The build is plain HTML in `out/`, so any static host works.

- **Vercel:** import the GitHub repo and set **Root Directory** to `website`. Every push to main redeploys.
- **GitHub Pages:** the site is served under `/Devkit`, so build with the base path, then publish `out/`:
  ```powershell
  $env:NEXT_BASE_PATH="/Devkit"; npm run build
  ```
