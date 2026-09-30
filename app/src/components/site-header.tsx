"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <div style={{ width: 148, height: 40, background: "#fff" }} /> },
);

export function SiteHeader() {
  const path = usePathname();
  const on = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="pp-header">
      <Link href="/" className="pp-logo">
        Poke<span>packs</span>
      </Link>
      <nav className="pp-nav">
        <Link href="/" className={on("/") ? "on" : undefined}>
          Drops
        </Link>
        <Link href="/operator" className={on("/operator") ? "on" : undefined}>
          Operator
        </Link>
        <Link href="/pulls" className={on("/pulls") ? "on" : undefined}>
          Pulls
        </Link>
      </nav>
      <div className="pp-actions">
        <span className="pp-chip">DEVNET</span>
        <WalletMultiButton />
      </div>
    </header>
  );
}
