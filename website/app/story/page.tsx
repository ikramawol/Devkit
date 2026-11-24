import Link from "next/link";
import type { Metadata } from "next";
import { getStory } from "@/lib/content";
import { Footer, Nav } from "@/components/SiteChrome";
import { Reveal } from "@/components/client";

export const metadata: Metadata = { title: "Why I built dkit" };

export default function StoryPage() {
  const story = getStory();
  const [before, after] = story.title.split("dkit");
  return (
    <>
      <div className="w">
        <Nav active="story" />
        <div className="sty">
          <Reveal className="ey">{story.eyebrow}</Reveal>
          <Reveal as="h1">{before}<em>dkit</em>{after}</Reveal>
          <Reveal as="p" className="lead">{story.lead}</Reveal>
          {story.sections.map((s) => (
            <Reveal key={s.label} className="sb">
              <div className="ey">{s.label}</div>
              <h2>{s.title}</h2>
              {/* Our own Markdown from content/story.md, rendered at build time. */}
              <div dangerouslySetInnerHTML={{ __html: s.html }} />
            </Reveal>
          ))}
          <Reveal className="sig">
            <p>{story.closing}</p>
            <Link className="bt pr" href="/docs/intro/">Read the docs</Link>
            <a className="bt" href="https://github.com/ikramawol/Devkit" target="_blank" rel="noreferrer">★ Star on GitHub</a>
          </Reveal>
        </div>
      </div>
      <Footer />
    </>
  );
}
