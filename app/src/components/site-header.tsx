"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <div className="h-9 w-32 rounded-full bg-zinc-800" /> },
);

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
        <Link href="/" className="font-heading text-xl tracking-[0.18em] text-primary">
          POKEPACKS
        </Link>
        <nav className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
          <Link href="/" className="hover:text-primary">
            Drops
          </Link>
          <Link href="/operator" className="hover:text-primary">
            Operator
          </Link>
          <Link href="/pulls" className="hover:text-primary">
            Pulls
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="rounded-full border border-primary/40 px-2 py-1 font-mono text-[10px] tracking-[0.2em] text-primary">
            DEVNET
          </span>
          <WalletMultiButton />
        </div>
      </div>
    </header>
  );
}
