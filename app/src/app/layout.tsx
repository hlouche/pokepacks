import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "@/components/providers";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pokepacks",
  description: "Devnet launchpad for transparent card drops. The inventory is the odds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="pp-site">
        <Providers>
          <SiteHeader />
          <main className="pp-page">{children}</main>
          <footer className="pp-foot">
            <div>
              <strong>Pokepacks</strong>
              <p>Devnet launchpad. One card per pack, drawn uniformly from the remaining inventory.</p>
            </div>
            <nav>
              <Link href="/">Drops</Link>
              <Link href="/operator">Operator</Link>
              <Link href="/pulls">Pulls</Link>
            </nav>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
