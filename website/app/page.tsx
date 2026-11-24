import Link from "next/link";
import type { ReactNode } from "react";
import home from "@/content/home.json";
import { Logo, LogoSprite } from "@/components/Logo";
import { Footer, Nav } from "@/components/SiteChrome";
import { Guarantees, HeroGlow, InstallBox, Terminal } from "@/components/client";

function Sec({ eyebrow, title, text, children }: { eyebrow: string; title: string; text: string; children: ReactNode }) {
  return (
    <section className="sec">
      <div className="ey">{eyebrow}</div>
      <h2>{title}</h2>
      <p className="sub">{text}</p>
      {children}
    </section>
  );
}

const descriptions = home.descriptions as Record<string, string>;
const toolName = (id: string) => home.tools.find((t) => t.id === id)?.name ?? id;

function Pill({ id, name, sub }: { id: string; name: string; sub: string }) {
  return <div className="pl"><Logo id={id} /><div><b>{name}</b><small>{sub}</small></div></div>;
}

/** One scrolling row; the items are repeated so the loop is seamless. */
function MarqueeRow({ n, title, sub, items }: { n: number; title: string; sub: string; items: ReactNode[] }) {
  const loop = [...items, ...items, ...items, ...items];
  return (
    <div className="mq">
      <div className="lb"><i>0{n}</i><b>{title}</b><small>{sub}</small></div>
      <div className="tr"><div className="rw">{loop.map((it, i) => <div key={i} style={{ display: "contents" }}>{it}</div>)}</div></div>
    </div>
  );
}

export default function Home() {
  const { hero, problem, why } = home;
  return (
    <>
      <div className="w">
        <Nav />
        <HeroGlow>
          <div className="hero">
            <div>
              <div className="ey">{hero.eyebrow}</div>
              <h1>{hero.title[0]}<br /><em>{hero.title[1]}</em></h1>
              <p className="mu" style={{ fontSize: 17, maxWidth: "30em" }}>{hero.text}</p>
              <InstallBox commands={hero.install} />
              <p className="mu" style={{ marginTop: 12, fontSize: 13 }}>Needs Node.js 22+. Installs the <code>dkit</code> command. Free and MIT licensed.</p>
              <p className="soon"><span>{hero.comingSoon.label}</span>{hero.comingSoon.text}</p>
            </div>
            <Terminal steps={home.terminal} />
          </div>
          <div className="sts">
            {home.stats.map(([n, label]) => <div key={label}><b>{n}</b>{label}</div>)}
          </div>
        </HeroGlow>

        <Sec eyebrow={problem.eyebrow} title={problem.title} text={problem.text}>
          <div className="sc">
            <table className="vsx">
              <thead><tr><th>&nbsp;</th><th>By hand</th><th>With dkit</th></tr></thead>
              <tbody>
                {problem.comparison.map((r) => (
                  <tr key={r.task}><td>{r.task}</td><td>{r.byHand}</td><td>{r.withDkit.startsWith("dkit ") ? <code>{r.withDkit}</code> : r.withDkit}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Sec>

        <Sec eyebrow={why.eyebrow} title={why.title} text={why.text}>
          <Guarantees items={why.guarantees} />
        </Sec>

        <Sec eyebrow={home.toolsSection.eyebrow} title={home.toolsSection.title} text={home.toolsSection.text}>
          <LogoSprite ids={[...home.categories.flatMap((c) => c.ids), ...home.libraries.map((l) => l.id)]} />
          {home.categories.map((c, i) => (
            <MarqueeRow key={c.name} n={i + 1} title={c.name} sub={`${c.ids.length} tools`}
              items={c.ids.map((id) => <Pill key={id} id={id} name={toolName(id)} sub={descriptions[id] ?? ""} />)} />
          ))}
          <MarqueeRow n={home.categories.length + 1} title="Libraries" sub={`${home.libraries.length} packages`}
            items={home.libraries.map((l) => <Pill key={l.id} id={l.id} name={l.id} sub={l.adds} />)} />
          <Link className="bt" href="/docs/catalog/">Full reference with installers per OS →</Link>
        </Sec>

        <Sec eyebrow={home.jobs.eyebrow} title={home.jobs.title} text={home.jobs.text}>
          <div className="g g4" style={{ margin: 0 }}>
            {home.jobs.cards.map(([id, title, text], i) => (
              <Link key={id} className="cd" href={`/docs/${id}/`}><div className="n">0{i + 1}</div><h3>{title}</h3><p>{text}</p></Link>
            ))}
          </div>
        </Sec>

        <Sec eyebrow={home.stacksSection.eyebrow} title={home.stacksSection.title} text={home.stacksSection.text}>
          <div className="in" style={{ maxWidth: "none", margin: "0 0 22px" }}><span><i>$</i>{home.stacksSection.command}</span></div>
          <div className="stp">
            {home.stacksSection.steps.map(([t, p], i) => <div key={t}><i>0{i + 1}</i><b>{t}</b><p>{p}</p></div>)}
          </div>
          <Link className="bt" href="/docs/stacks/">All 12 stacks →</Link>
        </Sec>

        <Sec eyebrow={home.movingSection.eyebrow} title={home.movingSection.title} text={home.movingSection.text}>
          <div className="mvg">
            {home.movingSection.parts.map(([b, p]) => <div key={b}><b>{b}</b><p>{p}</p></div>)}
          </div>
          <p className="nvr"><b>never exported:</b> {home.movingSection.never}</p>
        </Sec>

        <div className="cta">
          <div className="ey">{home.cta.eyebrow}</div>
          <h2>{home.cta.title}</h2>
          <InstallBox commands={hero.install} withCopy={false} center />
          <Link className="bt pr" href="/docs/install/">Read the docs</Link>
          <a className="bt" href="https://github.com/ikramawol/Devkit" target="_blank" rel="noreferrer">★ Star on GitHub</a>
        </div>
      </div>
      <Footer />
    </>
  );
}
