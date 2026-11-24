import type { Metadata } from "next";
import { DOC_ORDER } from "@/lib/content";
import { DocsPage } from "@/components/DocsPage";

export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_ORDER.map((d) => ({ slug: d.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: DOC_ORDER.find((d) => d.id === slug)?.title ?? "Docs" };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DocsPage id={slug} />;
}
