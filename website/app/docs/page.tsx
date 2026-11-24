import type { Metadata } from "next";
import { DocsPage } from "@/components/DocsPage";

export const metadata: Metadata = { title: "Docs" };

/** /docs/ shows the introduction, so the address works without picking a page. */
export default function DocsIndex() {
  return <DocsPage id="intro" />;
}
