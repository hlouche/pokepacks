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
    <div>
      <section className="pp-hero">
        <div className="pp-hero-glow" />
        <div className="pp-hero-title">
          <h1>
            Open the
            <br />
            case.
            <br />
            <em>See the odds.</em>
          </h1>
        </div>
        <div className="pp-hero-card">
          <p>One card per pack, drawn uniformly from whatever is still in the case. The inventory is the odds.</p>
          <Link className="pp-link" href="/operator">
            Open a drop
          </Link>
        </div>
      </section>

      <div className="pp-band-head">
        <div>
          <h2>Live drops</h2>
          <p className="pp-muted">Devnet · program {shortKey(PROGRAM_ID)}</p>
        </div>
        <button className="pp-refresh" onClick={() => load()} type="button">
          Refresh
        </button>
      </div>

      {loading ? <p className="pp-empty">Scanning drop accounts…</p> : null}
      {error ? <p className="pp-err">{error}</p> : null}
      {!loading && !error && drops.length === 0 ? (
        <p className="pp-empty">
          No live drops on this cluster yet. An operator can open a case from the counter, or run npm run setup:devnet.
        </p>
      ) : null}

      <div className="pp-pack-row">
        {drops.map((drop) => (
          <Link key={drop.address} href={`/drop/${drop.address}`} className="pp-box">
            <div className="pp-box-face">
              {drop.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={drop.image} alt="" />
              ) : null}
              <span className="pp-box-pill">Open</span>
            </div>
            <div className="pp-box-copy">
              <strong>{drop.name}</strong>
              <p>
                {formatUsdc(drop.price)} · {drop.left} left / {drop.total}
                {drop.pending ? ` · ${drop.pending} pending` : ""} · {shortKey(drop.operator)}
              </p>
            </div>
          </Link>
        ))}
      </div>

      <section className="pp-cta">
        <h2>The inventory is the odds.</h2>
        <Link href="/operator">Open the operator counter</Link>
      </section>
    </div>
  );
}
