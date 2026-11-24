import Link from "next/link";
import { GlowLogo, ThemeToggle } from "./client";

const GITHUB = "https://github.com/ikramawol/Devkit";
const NPM = "https://www.npmjs.com/package/devsetupkit-cli";

export function Nav({ active }: { active?: "docs" | "story" }) {
  return (
    <nav>
      <GlowLogo />
      <div className="l">
        <Link href="/docs/intro/" className={active === "docs" ? "cur" : undefined}>docs</Link>
        <Link href="/story/" className={active === "story" ? "cur" : undefined}>story</Link>
        <a href={GITHUB} target="_blank" rel="noreferrer">github</a>
        <a href={NPM} target="_blank" rel="noreferrer">npm</a>
        <ThemeToggle />
      </div>
    </nav>
  );
}

const FOOTER_DOCS: [string, string][] = [
  ["install", "Install tools"], ["maintain", "Diagnose & update"], ["stacks", "Stacks"], ["migrate", "Migrate"],
  ["team", "Team setup"], ["snapshots", "Snapshots"], ["sync", "Sync PCs"],
];

export function Footer() {
  return (
    <div className="ft">
      <div className="w">
        <div className="fg">
          <div>
            <Link className="lg" href="/" style={{ fontSize: 18, color: "var(--tx)" }}><b>&gt;_</b> dkit</Link>
            <p className="mu" style={{ fontSize: 14, margin: "8px 0 10px", maxWidth: "22em" }}>Set up any dev machine in one command. Open source, MIT licensed.</p>
            <a href={GITHUB} style={{ color: "var(--ac)" }} target="_blank" rel="noreferrer">★ Star on GitHub</a>
          </div>
          <div>
            <h5>Docs</h5>
            {FOOTER_DOCS.map(([id, title]) => <Link key={id} href={`/docs/${id}/`}>{title}</Link>)}
          </div>
          <div>
            <h5>Project</h5>
            <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
            <a href={NPM} target="_blank" rel="noreferrer">npm</a>
            <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">Issues</a>
            <a href={`${GITHUB}/graphs/contributors`} target="_blank" rel="noreferrer">Contributors</a>
          </div>
        </div>
        <div className="fb"><span>© 2026 dkit · MIT license</span><span>Windows · macOS · Linux · WSL</span></div>
      </div>
    </div>
  );
}
