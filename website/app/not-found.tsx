import Link from "next/link";
import { Footer, Nav } from "@/components/SiteChrome";

export default function NotFound() {
  return (
    <>
      <div className="w">
        <Nav />
        <section className="sec" style={{ textAlign: "center", padding: "90px 0 40px" }}>
          <div className="ey"># 404</div>
          <h2>This page doesn&apos;t exist.</h2>
          <p className="mu">It may have moved. Start from the docs or the home page.</p>
          <Link className="bt pr" href="/docs/intro/">Read the docs</Link>
          <Link className="bt" href="/">Home</Link>
        </section>
      </div>
      <Footer />
    </>
  );
}
