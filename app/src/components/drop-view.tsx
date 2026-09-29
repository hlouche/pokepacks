"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CardFace, cardFromAccount, type CardView } from "@/components/card-face";
import { MyPulls } from "@/components/my-pulls";
import { Button } from "@/components/ui/button";
import { buyRevealClaim } from "@/lib/buy";
import { formatUsdc, shortKey, solscanTx, textOf, variant } from "@/lib/format";
import { getProgram } from "@/lib/program";

type DropViewModel = {
  operator: string;
  name: string;
  image: string;
  status: string;
  price: bigint;
  priceMint: string;
  priceTokenProgram: string;
  inventory: string[];
  pending: number;
  totalSold: number;
};

function tierLabelFrom(tier: number) {
  return ["Common", "Uncommon", "Rare", "Epic", "Chase"][tier] ?? "Card";
}

export function DropView({ address }: { address: string }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [drop, setDrop] = useState<DropViewModel | null>(null);
  const [cards, setCards] = useState<CardView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [won, setWon] = useState<CardView | null>(null);
  const [sigs, setSigs] = useState<{ buy: string; reveal: string; claim: string | null; claimError: string | null } | null>(null);
  const [flipped, setFlipped] = useState(false);

  const load = useCallback(async () => {
    const program = getProgram(connection);
    const key = new PublicKey(address);
    const account = await program.account.drop.fetch(key);
    const inventory = (account.inventory as PublicKey[]).map((m) => m.toBase58());
    const fetched = await program.account.card.all([{ memcmp: { offset: 8, bytes: address } }]);
    const views: CardView[] = fetched.map((row: { account: Parameters<typeof cardFromAccount>[0] }) =>
      cardFromAccount(row.account),
    );
    setDrop({
      operator: (account.operator as PublicKey).toBase58(),
      name: textOf(account.name),
      image: textOf(account.imageUrl),
      status: variant(account.status),
      price: BigInt(account.priceAmount.toString()),
      priceMint: (account.priceMint as PublicKey).toBase58(),
      priceTokenProgram: (account.tokenProgramPrice as PublicKey).toBase58(),
      inventory,
      pending: Number(account.pending),
      totalSold: Number(account.totalSold),
    });
    setCards(views.filter((card) => inventory.includes(card.mint)));
  }, [address, connection]);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [load]);

  const odds = useMemo(() => {
    const total = cards.length || 1;
    return [0, 1, 2, 3, 4]
      .map((tier) => {
        const count = cards.filter((c) => c.tier === tier).length;
        return { tier, count, pct: (count / total) * 100 };
      })
      .filter((row) => row.count > 0);
  }, [cards]);

  const ev = useMemo(() => {
    if (!cards.length) return 0n;
    const sum = cards.reduce((acc, card) => acc + card.fmv, 0n);
    return sum / BigInt(cards.length);
  }, [cards]);

  if (error && !drop) return <p className="text-rose-300">{error}</p>;
  if (!drop) return <p className="font-mono text-xs text-zinc-500">Reading the drop account…</p>;

  const left = drop.inventory.length;
  const total = left + drop.totalSold;
  const soldOut = left <= drop.pending;

  return (
    <div className="space-y-8">
      <header className="grid gap-6 md:grid-cols-[180px_1fr]">
        <div className="overflow-hidden rounded-sm border border-zinc-800 bg-zinc-950">
          {drop.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={drop.image} alt="" className="aspect-[4/5] w-full object-cover" />
          ) : (
            <div className="flex aspect-[4/5] items-center justify-center font-mono text-xs text-zinc-600">NO ART</div>
          )}
        </div>
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-primary">{drop.status}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{drop.name}</h1>
          <p className="font-mono text-xs text-zinc-500">operator {shortKey(drop.operator)}</p>
          <p className="text-sm text-zinc-300">
            {formatUsdc(drop.price)} per pack · {left} left of {total}
            {drop.pending ? ` · ${drop.pending} awaiting reveal` : ""}
          </p>
          <p className="font-mono text-sm text-zinc-100">
            EV {formatUsdc(ev)} vs price {formatUsdc(drop.price)}
          </p>
          <div className="flex flex-wrap gap-2 font-mono text-[11px] text-zinc-400">
            {odds.map((row) => (
              <span key={row.tier} className="border border-zinc-800 px-2 py-1">
                {tierLabelFrom(row.tier)} {row.count} · {row.pct.toFixed(1)}%
              </span>
            ))}
          </div>
          <Button
            disabled={busy || drop.status !== "live" || soldOut || !publicKey || !signTransaction}
            onClick={async () => {
              if (!publicKey || !signTransaction) return;
              const snapshot = cards;
              setBusy(true);
              setError(null);
              setWon(null);
              setSigs(null);
              setFlipped(false);
              try {
                const result = await buyRevealClaim({
                  connection,
                  publicKey,
                  signTransaction: signTransaction as never,
                  drop: new PublicKey(address),
                  priceMint: new PublicKey(drop.priceMint),
                  priceTokenProgram: new PublicKey(drop.priceTokenProgram),
                  onStatus: setPhase,
                });
                const card = snapshot.find((c) => c.mint === result.mint) ?? {
                  mint: result.mint,
                  tier: 0,
                  title: result.mint.slice(0, 8),
                  grader: "",
                  cert: "",
                  fmv: 0n,
                  imageUrl: "",
                };
                setWon(card);
                setSigs({
                  buy: result.buySig,
                  reveal: result.revealSig,
                  claim: result.claimSig,
                  claimError: result.claimError,
                });
                requestAnimationFrame(() => setFlipped(true));
                await load();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
                setPhase(null);
              }
            }}
          >
            {busy ? phase ?? "Working" : soldOut ? "Sold out" : `Buy pack · ${formatUsdc(drop.price)}`}
          </Button>
          {!publicKey ? <p className="text-xs text-zinc-500">Connect a wallet on devnet to buy.</p> : null}
          {error ? <p className="text-sm text-rose-300">{error}</p> : null}
        </div>
      </header>

      {busy || won ? (
        <section className="rounded-sm border border-primary/40 bg-zinc-950 p-4">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">
            {won ? "Pulled" : phase ?? "Shuffling remaining inventory"}
          </p>
          <div className="flip-scene w-44">
            <div className={`flip-card relative ${flipped ? "is-flipped" : ""}`}>
              <div className="flip-face">
                <div className="flex aspect-[3/4] items-end rounded-sm border border-zinc-700 bg-zinc-900 p-3">
                  <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-500">Pokepacks</p>
                </div>
              </div>
              {won ? (
                <div className="flip-face flip-back absolute inset-0">
                  <CardFace card={won} />
                </div>
              ) : null}
            </div>
          </div>
          {sigs ? (
            <ul className="mt-3 space-y-1 font-mono text-[11px]">
              <li>
                buy{" "}
                <a className="text-primary underline" href={solscanTx(sigs.buy)}>
                  {sigs.buy.slice(0, 18)}…
                </a>
              </li>
              <li>
                reveal{" "}
                <a className="text-primary underline" href={solscanTx(sigs.reveal)}>
                  {sigs.reveal.slice(0, 18)}…
                </a>
              </li>
              <li>
                claim{" "}
                {sigs.claim ? (
                  <a className="text-primary underline" href={solscanTx(sigs.claim)}>
                    {sigs.claim.slice(0, 18)}…
                  </a>
                ) : (
                  <span className="text-rose-300">{sigs.claimError ?? "claim did not land"}</span>
                )}
              </li>
            </ul>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">
          Remaining inventory · {cards.length}
        </h2>
        {cards.length === 0 ? <p className="text-sm text-zinc-500">Nothing left in the case.</p> : null}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map((card) => (
            <CardFace key={card.mint} card={card} />
          ))}
        </div>
      </section>

      <MyPulls dropFilter={address} />
    </div>
  );
}
