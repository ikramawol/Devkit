import Link from "next/link";
import { DOC_GROUPS, getDoc } from "@/lib/content";
import { Footer, Nav } from "./SiteChrome";
import { CodeCopy, DocsNav, Toc } from "./client";

/** A docs page: page list on the left, the article, "On this page" on the right. */
export function DocsPage({ id }: { id: string }) {
  const doc = getDoc(id);
  return (
    <div className="dmode">
      <div className="w">
        <Nav active="docs" />
        <div className="dxl">
          <DocsNav groups={DOC_GROUPS} current={doc.id} currentTitle={doc.title} />
          <article className="dxm">
            <div className="dxcr"><b>Docs</b> / {doc.group}</div>
            {/* Our own Markdown from content/docs, rendered to HTML at build time. */}
            <div dangerouslySetInnerHTML={{ __html: doc.html }} />
            <div className="dxpg">
              {doc.prev ? <Link href={`/docs/${doc.prev.id}/`}><small>← Previous</small>{doc.prev.title}</Link> : <span />}
              {doc.next ? <Link href={`/docs/${doc.next.id}/`}><small>Next →</small>{doc.next.title}</Link> : <span />}
            </div>
          </article>
          <Toc headings={doc.headings} />
        </div>
      </div>
      <CodeCopy />
      <Footer />
    </div>
  );
}
