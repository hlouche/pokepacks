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
  const [overlay, setOverlay] = useState(false);

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

  if (error && !drop) return <p className="pp-err">{error}</p>;
  if (!drop) return <p className="pp-empty">Reading the drop account…</p>;

  const left = drop.inventory.length;
  const total = left + drop.totalSold;
  const soldOut = left <= drop.pending;

  return (
    <div className="pp-stack">
      <article className="pp-detail">
        <div className="pp-detail-art">
          {drop.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={drop.image} alt="" />
          ) : (
            <p className="pp-muted">No pack art</p>
          )}
        </div>
        <div className="pp-detail-body">
          <p className="pp-chip">{drop.status}</p>
          <h1>{drop.name}</h1>
          <p className="pp-muted">operator {shortKey(drop.operator)}</p>
          <div className="pp-price-row">
            <strong>{formatUsdc(drop.price)}</strong>
            <span className="pp-muted">
              {left} left of {total}
              {drop.pending ? ` · ${drop.pending} awaiting reveal` : ""}
            </span>
          </div>
          <p className="pp-muted">
            EV {formatUsdc(ev)} vs price {formatUsdc(drop.price)}
          </p>
          <div className="pp-odds">
            {odds.map((row) => (
              <span key={row.tier}>
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
              setOverlay(true);
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
          {!publicKey ? <p className="pp-muted">Connect a wallet on devnet to buy.</p> : null}
          {error ? <p className="pp-err">{error}</p> : null}
        </div>
      </article>

      {overlay && (busy || won) ? (
        <div className="pp-reveal">
          <div className={`pp-reveal-card ${won && flipped ? "is-pop" : "is-spin"}`}>
            <p className="pp-chip">{won ? "Pulled" : phase ?? "Shuffling remaining inventory"}</p>
            <div className="pp-reveal-art">{won ? <CardFace card={won} /> : <div className="pp-card" />}</div>
            {sigs ? (
              <ul className="pp-muted" style={{ marginTop: 16, textAlign: "left" }}>
                <li>
                  buy{" "}
                  <a className="pp-link" href={solscanTx(sigs.buy)}>
                    {sigs.buy.slice(0, 18)}…
                  </a>
                </li>
                <li>
                  reveal{" "}
                  <a className="pp-link" href={solscanTx(sigs.reveal)}>
                    {sigs.reveal.slice(0, 18)}…
                  </a>
                </li>
                <li>
                  claim{" "}
                  {sigs.claim ? (
                    <a className="pp-link" href={solscanTx(sigs.claim)}>
                      {sigs.claim.slice(0, 18)}…
                    </a>
                  ) : (
                    <span className="pp-err">{sigs.claimError ?? "claim did not land"}</span>
                  )}
                </li>
              </ul>
            ) : null}
            {!busy ? (
              <button className="pp-refresh" style={{ marginTop: 16 }} type="button" onClick={() => setOverlay(false)}>
                Close
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <section>
        <div className="pp-band-head">
          <h2>Remaining inventory</h2>
          <span className="pp-muted">{cards.length}</span>
        </div>
        {cards.length === 0 ? <p className="pp-empty">Nothing left in the case.</p> : null}
        <div className="pp-inventory">
          {cards.map((card) => (
            <CardFace key={card.mint} card={card} />
          ))}
        </div>
      </section>

      <MyPulls dropFilter={address} />
    </div>
  );
}
