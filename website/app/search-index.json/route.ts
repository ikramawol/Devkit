import { searchIndex } from "@/lib/content";

/** Written once at build time as /search-index.json; the Ctrl K search loads it when first opened. */
export const dynamic = "force-static";

export function GET() {
  return Response.json(searchIndex());
}
