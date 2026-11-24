"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// ── Header ──────────────────────────────────────────────────

/** The ">_ dkit" logo; a soft light follows the mouse over the letters. */
export function GlowLogo() {
  const ref = useRef<HTMLAnchorElement>(null);
  return (
    <Link
      ref={ref}
      className="lg"
      href="/"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty("--gx", `${e.clientX - r.left}px`);
        e.currentTarget.style.setProperty("--gy", `${e.clientY - r.top}px`);
      }}
      onMouseLeave={(e) => e.currentTarget.style.setProperty("--gx", "-99px")}
    >
      <b>&gt;_</b> <span className="gl">dkit</span>
    </Link>
  );
}

export function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("dk-theme", next); } catch { /* private mode: just don't remember */ }
  };
  return (
    <button className="thb" type="button" onClick={toggle} aria-label="Switch between light and dark theme" title="Toggle theme">
      <svg className="moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      <svg className="sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
    </button>
  );
}

// ── Home ────────────────────────────────────────────────────

async function copy(text: string, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "copied";
    setTimeout(() => { button.textContent = "copy"; }, 1300);
  } catch { /* clipboard blocked: nothing to do */ }
}

/** `npm install -g devsetupkit-cli`, with tabs for pnpm, yarn and bun. */
export function InstallBox({ commands, withCopy = true, center = false }: { commands: Record<string, string>; withCopy?: boolean; center?: boolean }) {
  const pms = Object.keys(commands);
  const [pm, setPm] = useState(pms[0]);
  return (
    <>
      <div className="pmx" style={center ? { justifyContent: "center", marginTop: 20 } : undefined}>
        {pms.map((k) => (
          <span key={k} className={k === pm ? "on" : ""} role="button" tabIndex={0} onClick={() => setPm(k)} onKeyDown={(e) => e.key === "Enter" && setPm(k)}>{k}</span>
        ))}
      </div>
      <div className="in" style={center ? { margin: "0 auto" } : undefined}>
        <span><i>$</i><span>{commands[pm]}</span></span>
        {withCopy && <button type="button" onClick={(e) => copy(commands[pm], e.currentTarget)}>copy</button>}
      </div>
    </>
  );
}

/** Colours for a line of terminal text: the prompt, ✓, ✗, ↑, and # comments. */
export function TermLine({ text }: { text: string }) {
  if (/^\s*#/.test(text)) return <span className="m">{text}</span>;
  const parts = text.split(/(\$ |✓|✗|↑|^\? |^plan.*$)/);
  return (
    <>
      {parts.map((p, i) =>
        p === "$ " ? <span key={i} className="p">$ </span>
        : p === "✓" ? <span key={i} className="ok">✓</span>
        : p === "✗" ? <span key={i} className="whe">✗</span>
        : p === "↑" || p === "? " ? <span key={i} className="p">{p}</span>
        : /^plan/.test(p) ? <span key={i} className="m">{p}</span>
        : p)}
    </>
  );
}

type TermStep = { command?: string; output?: string; prompt?: string; answer?: string };

/** The hero terminal: types each command, prints its output, then starts again. */
export function Terminal({ steps }: { steps: TermStep[] }) {
  const full = useMemo(() => steps.map((s) => (s.command ? `$ ${s.command}` : s.prompt ? `${s.prompt}${s.answer}` : s.output ?? "")), [steps]);
  const [lines, setLines] = useState<string[]>(full);
  const [typing, setTyping] = useState<string | null>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      while (alive) {
        const done: string[] = [];
        setLines([]); setTyping("");
        await sleep(600);
        for (const s of steps) {
          if (!alive) return;
          if (s.output !== undefined) { await sleep(420); done.push(s.output); setLines([...done]); continue; }
          const pre = s.command ? "$ " : s.prompt ?? "";
          const txt = s.command ?? s.answer ?? "";
          for (let k = 1; k <= txt.length && alive; k++) { setTyping(pre + txt.slice(0, k)); await sleep(50 + Math.random() * 70); }
          await sleep(450);
          done.push(pre + txt); setTyping(""); setLines([...done]);
        }
        await sleep(4500);
      }
    })();
    return () => { alive = false; };
  }, [steps]);
  // The full text sets the height once, so the page doesn't jump while it types.
  return (
    <pre id="ht" style={{ minHeight: `${full.length * 1.75 + 2.3}em` }}>
      {lines.map((l, i) => <div key={i}><TermLine text={l} /></div>)}
      {typing !== null && <div><TermLine text={typing} /><span className="tcur">█</span></div>}
    </pre>
  );
}

/** The big "dkit" behind the hero lights up around the mouse. */
export function HeroGlow({ children }: { children: ReactNode }) {
  const hl = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const target = useRef({ x: -999, y: -999 });
  const pos = useRef({ x: -999, y: -999 });
  const frame = useRef(0);
  const tick = useCallback(() => {
    pos.current.x += (target.current.x - pos.current.x) * 0.14;
    pos.current.y += (target.current.y - pos.current.y) * 0.14;
    hl.current?.style.setProperty("--mx", `${pos.current.x}px`);
    hl.current?.style.setProperty("--my", `${pos.current.y}px`);
    if (Math.abs(target.current.x - pos.current.x) + Math.abs(target.current.y - pos.current.y) > 0.5) frame.current = requestAnimationFrame(tick);
    else frame.current = 0;
  }, []);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return (
    <section
      className="hero2"
      onMouseMove={(e) => {
        const r = box.current!.getBoundingClientRect();
        target.current = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (pos.current.x < -900) pos.current = { ...target.current };
        if (!frame.current) frame.current = requestAnimationFrame(tick);
      }}
      onMouseLeave={() => { target.current = { x: -999, y: -999 }; pos.current = { x: -999, y: -999 }; hl.current?.style.setProperty("--mx", "-999px"); }}
    >
      <div className="wm bg" aria-hidden ref={box}><span>dkit</span><span className="hl" ref={hl}>dkit</span></div>
      {children}
    </section>
  );
}

/** "Why dkit": pick a guarantee to see it in the terminal; moves on by itself every few seconds. */
export function Guarantees({ items }: { items: { title: string; text: string; terminal: string }[] }) {
  const [on, setOn] = useState(0);
  const [round, setRound] = useState(0); // restarts the progress bar when picked again
  const pick = (i: number) => { setOn(i); setRound((r) => r + 1); };
  return (
    <div className="whx">
      <div className="whl">
        {items.map((w, i) => (
          <div
            key={i === on ? `${i}-${round}` : i}
            className={`whi${i === on ? " on" : ""}`}
            onClick={() => pick(i)}
            onAnimationEnd={(e) => { if (e.animationName === "wprog") pick((on + 1) % items.length); }}
          >
            <b><i>0{i + 1}</i>{w.title}</b>
            <small>{w.text}</small>
          </div>
        ))}
      </div>
      <div className="wht">
        <div className="whb"><i /><i /><i /><span>dkit</span></div>
        <div className="whp on" key={on}>
          <pre>{items[on].terminal.split("\n").map((l, i) => <div key={i}><TermLine text={l} /></div>)}</pre>
        </div>
      </div>
    </div>
  );
}

// ── Story ───────────────────────────────────────────────────

/** Children fade in as they scroll into view (respects reduced motion through CSS). */
export function Reveal({ children, className = "", as = "div", delay = 0 }: { children: ReactNode; className?: string; as?: "div" | "h1" | "p"; delay?: number }) {
  const ref = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }, { threshold: 0.18 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const Tag = as as "div";
  return <Tag ref={ref as React.Ref<HTMLDivElement>} className={`rv ${className}${shown ? " shown" : ""}`} style={{ transitionDelay: `${delay}s` }}>{children}</Tag>;
}

// ── Docs ────────────────────────────────────────────────────

interface Group { group: string; pages: { id: string; title: string }[] }

/** Left column: search box and the page list. On phones it folds behind a Menu button. */
export function DocsNav({ groups, current, currentTitle }: { groups: Group[]; current: string; currentTitle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="dxmb" type="button" onClick={() => setOpen((o) => !o)} aria-label="Open docs menu">
        <span>☰ Menu</span><span className="mu">{currentTitle}</span>
      </button>
      <aside className={`dxn${open ? " open" : ""}`}>
        <SearchButton />
        {groups.map((g) => (
          <div key={g.group}>
            <h6>{g.group}</h6>
            {g.pages.map((p) => (
              <Link key={p.id} href={`/docs/${p.id}/`} className={p.id === current ? "on" : ""} onClick={() => setOpen(false)}>{p.title}</Link>
            ))}
          </div>
        ))}
      </aside>
    </>
  );
}

/** Right column: the page's headings; the one you're reading is highlighted. */
export function Toc({ headings }: { headings: { id: string; text: string; level: number }[] }) {
  const [cur, setCur] = useState<string | null>(null);
  useEffect(() => {
    const spy = () => {
      let c: string | null = null;
      for (const h of headings) {
        const el = document.getElementById(h.id);
        if (el && el.getBoundingClientRect().top < 140) c = h.id;
      }
      setCur(c);
    };
    spy();
    document.addEventListener("scroll", spy, { passive: true });
    return () => document.removeEventListener("scroll", spy);
  }, [headings]);
  if (headings.length < 2) return <div className="dxt" />;
  return (
    <div className="dxt">
      <h6>On this page</h6>
      {headings.map((h) => (
        <a key={h.id} href={`#${h.id}`} className={`${h.level === 3 ? "l3" : ""}${h.id === cur ? " on" : ""}`} title={h.text}>{h.text}</a>
      ))}
    </div>
  );
}

/** Copy buttons on code blocks (the article HTML is static, so one listener handles them all). */
export function CodeCopy() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".dxc");
      const code = b?.closest(".dxp")?.querySelector("code");
      if (b && code) copy(code.textContent ?? "", b);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}

// ── Search (Ctrl K) ─────────────────────────────────────────

interface Entry { id: string; page: string; h: string; hid: string; text: string }
let indexPromise: Promise<Entry[]> | null = null;
const loadIndex = () => (indexPromise ??= fetch(`${BASE}/search-index.json`).then((r) => r.json() as Promise<Entry[]>));

function SearchButton() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /INPUT|TEXTAREA/.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      else if (e.key === "/" && !typing) { e.preventDefault(); setOpen(true); }
      else if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className="dxs" role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => e.key === "Enter" && setOpen(true)}>
        <span>Search docs</span><kbd>Ctrl K</kbd>
      </div>
      {open && <SearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [index, setIndex] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  useEffect(() => { loadIndex().then(setIndex).catch(() => setIndex([])); }, []);

  const results = useMemo(() => {
    const query = q.toLowerCase().trim();
    if (!query) return [];
    const terms = query.split(/\s+/);
    const scored: (Entry & { sc: number })[] = [];
    for (const x of index) {
      const head = `${x.h} ${x.page}`.toLowerCase();
      const body = x.text.toLowerCase();
      let sc = 0;
      for (const t of terms) {
        const a = head.includes(t);
        const b = body.includes(t);
        if (!a && !b) { sc = 0; break; }
        sc += (a ? 6 : 0) + (b ? 2 : 0);
      }
      if (sc) scored.push({ ...x, sc: sc + (head.includes(query) ? 8 : 0) });
    }
    return scored.sort((a, b) => b.sc - a.sc).slice(0, 8);
  }, [q, index]);

  const go = (r: Entry) => { onClose(); router.push(`/docs/${r.id}/${r.hid ? `#${r.hid}` : ""}`); };
  const snippet = (r: Entry) => {
    const t = q.toLowerCase().trim().split(/\s+/)[0];
    const k = r.text.toLowerCase().indexOf(t);
    return k >= 0 ? r.text.slice(Math.max(0, k - 40), k + 90) : r.text.slice(0, 110);
  };

  return (
    <div className="sr open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="srb">
        <input
          autoFocus
          placeholder="Search the docs..."
          autoComplete="off"
          value={q}
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter" && results[sel]) go(results[sel]);
          }}
        />
        <div id="srl">
          {!q.trim() && <div className="srn">Type to search commands, options and guides.</div>}
          {q.trim() && !results.length && <div className="srn">No results for “{q}”.</div>}
          {results.map((r, i) => (
            <div key={`${r.id}-${r.hid}-${i}`} className={`sri${i === sel ? " on" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => go(r)}>
              <span>{r.page}</span><b>{r.h}</b><small>{snippet(r)}</small>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
