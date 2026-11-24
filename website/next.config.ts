import path from "node:path";
import type { NextConfig } from "next";

/**
 * A fully static site (`next build` writes plain HTML to out/), so it can be hosted anywhere:
 * Vercel, Netlify or GitHub Pages. For GitHub Pages under /Devkit, build with NEXT_BASE_PATH=/Devkit.
 */
const basePath = process.env.NEXT_BASE_PATH ?? "";

const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  // The CLI's package-lock.json sits one folder up; this folder is the website's own project.
  turbopack: { root: path.resolve(".") },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default config;
