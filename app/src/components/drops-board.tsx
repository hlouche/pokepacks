"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatUsdc, shortKey, textOf, variant } from "@/lib/format";
import { PROGRAM_ID, getProgram } from "@/lib/program";

type DropCard = {
  address: string;
  name: string;
  image: string;
  operator: string;
  price: string;
  left: number;
  total: number;
  pending: number;
  status: string;
};

export function DropsBoard() {
  const { connection } = useConnection();
  const [drops, setDrops] = useState<DropCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const program = getProgram(connection);
      const all = await program.account.drop.all();
      const cards: DropCard[] = all.map((row: { publicKey: PublicKey; account: Record<string, unknown> }) => {
        const inventory = row.account.inventory as PublicKey[];
        const sold = Number(row.account.totalSold);
        return {
          address: row.publicKey.toBase58(),
          name: textOf(row.account.name) || "Untitled drop",
          image: textOf(row.account.imageUrl),
          operator: (row.account.operator as PublicKey).toBase58(),
          price: String(row.account.priceAmount),
          left: inventory.length,
          total: inventory.length + sold,
          pending: Number(row.account.pending),
          status: variant(row.account.status),
        };
      });
      cards.sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
      setDrops(cards.filter((drop) => drop.status === "live"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connection]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Devnet counter</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Live drops</h1>
          <p className="mt-2 max-w-xl text-sm text-zinc-400">
            One card, drawn uniformly from whatever is still in the case. The inventory is the odds.
          </p>
        </div>
        <button className="font-mono text-[11px] uppercase tracking-widest text-primary" onClick={() => load()} type="button">
          Refresh
        </button>
      </div>
      {loading ? <p className="font-mono text-xs text-zinc-500">Scanning drop accounts…</p> : null}
      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
      {!loading && !error && drops.length === 0 ? (
        <div className="rounded-sm border border-dashed border-zinc-700 px-4 py-10 text-sm text-zinc-400">
          No live drops on this cluster yet. An operator can open a case from the counter, or run{" "}
          <span className="font-mono text-zinc-200">npm run setup:devnet</span>. Program{" "}
          <span className="font-mono text-zinc-200">{shortKey(PROGRAM_ID)}</span>.
        </div>
      ) : null}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {drops.map((drop) => (
          <li key={drop.address}>
            <Link href={`/drop/${drop.address}`} className="block overflow-hidden rounded-sm border border-zinc-800 bg-zinc-950 hover:border-primary/60">
              <div className="aspect-[16/9] bg-zinc-900">
                {drop.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={drop.image} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-end p-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                    Case
                  </div>
                )}
              </div>
              <div className="space-y-1 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="truncate text-lg font-medium">{drop.name}</h2>
                  <span className="font-mono text-sm text-primary">{formatUsdc(drop.price)}</span>
                </div>
                <p className="font-mono text-[11px] text-zinc-500">
                  {drop.left} left / {drop.total}
                  {drop.pending ? ` · ${drop.pending} pending` : ""} · {shortKey(drop.operator)}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
