"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  sendAddCard,
  sendCloseDrop,
  sendCreateDrop,
  sendGoLive,
  sendRemoveCard,
  sendWithdraw,
} from "@/lib/actions";
import { formatUsdc, shortKey, solscanTx, textOf, variant } from "@/lib/format";
import { getProgram } from "@/lib/program";

type MintOption = { mint: string; program: string; amount: string };
type DropRow = { pubkey: string; name: string; status: string; price: string; left: number; pending: number };

const USDC_KEY = "pokepacks.usdcMint";

export function OperatorConsole() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [mints, setMints] = useState<MintOption[]>([]);
  const [drops, setDrops] = useState<DropRow[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("Night Counter");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState("25");
  const [seed, setSeed] = useState(() => Date.now().toString());
  const [usdcMint, setUsdcMint] = useState("");
  const [selectedDrop, setSelectedDrop] = useState("");
  const [mint, setMint] = useState("");
  const [tier, setTier] = useState("0");
  const [fmv, setFmv] = useState("5");
  const [grader, setGrader] = useState("RAW");
  const [cert, setCert] = useState("");
  const [title, setTitle] = useState("");
  const [cardImage, setCardImage] = useState("");

  useEffect(() => {
    const stored = window.localStorage.getItem(USDC_KEY) ?? process.env.NEXT_PUBLIC_USDC_MINT ?? "";
    setUsdcMint(stored);
  }, []);

  const load = useCallback(async () => {
    if (!publicKey) return;
    const program = getProgram(connection);
    const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_PROGRAM_ID });
    const t22 = await connection.getParsedTokenAccountsByOwner(publicKey, { programId: TOKEN_2022_PROGRAM_ID });
    const options: MintOption[] = [];
    for (const group of [
      { rows: accounts.value, program: TOKEN_PROGRAM_ID.toBase58() },
      { rows: t22.value, program: TOKEN_2022_PROGRAM_ID.toBase58() },
    ]) {
      for (const row of group.rows) {
        const info = row.account.data.parsed.info;
        if (info.tokenAmount.decimals !== 0) continue;
        if (Number(info.tokenAmount.amount) < 1) continue;
        options.push({ mint: info.mint, program: group.program, amount: info.tokenAmount.amount });
      }
    }
    setMints(options);
    setMint((current) => current || options[0]?.mint || "");

    const mine = await program.account.drop.all([{ memcmp: { offset: 16, bytes: publicKey.toBase58() } }]);
    setDrops(
      mine.map((row: { publicKey: PublicKey; account: Record<string, unknown> }) => ({
        pubkey: row.publicKey.toBase58(),
        name: textOf(row.account.name),
        status: variant(row.account.status),
        price: String(row.account.priceAmount),
        left: (row.account.inventory as PublicKey[]).length,
        pending: Number(row.account.pending),
      })),
    );
  }, [connection, publicKey]);

  useEffect(() => {
    load().catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [load]);

  async function run(fn: () => Promise<string>) {
    if (!signTransaction) return;
    setBusy(true);
    setNote(null);
    try {
      const sig = await fn();
      setNote(sig);
      await load();
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!publicKey || !signTransaction) {
    return <p className="text-sm text-zinc-400">Connect the operator wallet to open the counter.</p>;
  }

  const selectedMint = mints.find((m) => m.mint === mint);
  const sign = signTransaction as never;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <section className="space-y-3 rounded-sm border border-zinc-800 p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Create drop</h2>
        <Label htmlFor="usdc">Price mint (6 decimals)</Label>
        <Input
          id="usdc"
          value={usdcMint}
          onChange={(e) => {
            setUsdcMint(e.target.value);
            window.localStorage.setItem(USDC_KEY, e.target.value.trim());
          }}
          placeholder="dummy USDC mint from setup-devnet"
        />
        <Label htmlFor="name">Name</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} />
        <Label htmlFor="image">Image URL</Label>
        <Input id="image" value={image} onChange={(e) => setImage(e.target.value)} />
        <Label htmlFor="price">Price (USDC)</Label>
        <Input id="price" value={price} onChange={(e) => setPrice(e.target.value)} />
        <Label htmlFor="seed">Seed</Label>
        <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
        <Button
          disabled={busy || !usdcMint}
          onClick={() =>
            run(async () => {
              const created = await sendCreateDrop({
                connection,
                publicKey,
                signTransaction: sign,
                seed,
                name,
                imageUrl: image,
                priceUsdc: price,
                priceMint: new PublicKey(usdcMint.trim()),
              });
              setSelectedDrop(created.drop);
              return created.sig;
            })
          }
        >
          Create draft
        </Button>
      </section>

      <section className="space-y-3 rounded-sm border border-zinc-800 p-4">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Your drops</h2>
        {drops.length === 0 ? <p className="text-sm text-zinc-500">No drops from this wallet yet.</p> : null}
        <ul className="space-y-2">
          {drops.map((drop) => (
            <li key={drop.pubkey}>
              <button
                type="button"
                className={`w-full rounded-sm border px-3 py-2 text-left ${selectedDrop === drop.pubkey ? "border-primary" : "border-zinc-800"}`}
                onClick={() => setSelectedDrop(drop.pubkey)}
              >
                <span className="block text-sm">{drop.name || "Untitled"}</span>
                <span className="font-mono text-[11px] text-zinc-500">
                  {drop.status} · {formatUsdc(drop.price)} · {drop.left} left · pending {drop.pending} · {shortKey(drop.pubkey)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {selectedDrop ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(() => sendGoLive({ connection, publicKey, signTransaction: sign, drop: new PublicKey(selectedDrop) }))}>
              Go live
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => sendCloseDrop({ connection, publicKey, signTransaction: sign, drop: new PublicKey(selectedDrop) }))}>
              Close drop
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-sm border border-zinc-800 p-4 lg:col-span-2">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">Deposit a card</h2>
        <p className="text-sm text-zinc-500">
          Pick a 0-decimal mint already in this wallet. Draft drops can take cards back. Closed drops use withdraw unsold, one card per transaction.
        </p>
        <Label htmlFor="drop">Drop</Label>
        <Input id="drop" value={selectedDrop} onChange={(e) => setSelectedDrop(e.target.value)} placeholder="drop address" />
        <Label htmlFor="mint">Mint</Label>
        <select
          id="mint"
          className="h-8 w-full rounded-sm border border-zinc-700 bg-zinc-950 px-2 font-mono text-xs"
          value={mint}
          onChange={(e) => setMint(e.target.value)}
        >
          {mints.length === 0 ? <option value="">No 0-decimal tokens in this wallet</option> : null}
          {mints.map((option) => (
            <option key={option.mint} value={option.mint}>
              {option.mint} · bal {option.amount}
            </option>
          ))}
        </select>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tier">Tier 0-4</Label>
            <Input id="tier" value={tier} onChange={(e) => setTier(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="fmv">FMV USDC</Label>
            <Input id="fmv" value={fmv} onChange={(e) => setFmv(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="grader">Grader</Label>
            <Input id="grader" value={grader} onChange={(e) => setGrader(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="cert">Cert</Label>
            <Input id="cert" value={cert} onChange={(e) => setCert(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="card-image">Image URL</Label>
            <Input id="card-image" value={cardImage} onChange={(e) => setCardImage(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !selectedDrop || !selectedMint}
            onClick={() =>
              run(() =>
                sendAddCard({
                  connection,
                  publicKey,
                  signTransaction: sign,
                  drop: new PublicKey(selectedDrop),
                  mint: new PublicKey(mint),
                  tokenProgram: new PublicKey(selectedMint!.program),
                  tier: Number(tier),
                  fmvUsdc: fmv,
                  grader,
                  cert,
                  title,
                  imageUrl: cardImage,
                }),
              )
            }
          >
            Add card
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !selectedDrop || !selectedMint}
            onClick={() =>
              run(() =>
                sendRemoveCard({
                  connection,
                  publicKey,
                  signTransaction: sign,
                  drop: new PublicKey(selectedDrop),
                  mint: new PublicKey(mint),
                  tokenProgram: new PublicKey(selectedMint!.program),
                }),
              )
            }
          >
            Remove draft card
          </Button>
          <Button
            variant="secondary"
            disabled={busy || !selectedDrop || !selectedMint}
            onClick={() =>
              run(() =>
                sendWithdraw({
                  connection,
                  publicKey,
                  signTransaction: sign,
                  drop: new PublicKey(selectedDrop),
                  mint: new PublicKey(mint),
                  tokenProgram: new PublicKey(selectedMint!.program),
                }),
              )
            }
          >
            Withdraw unsold
          </Button>
        </div>
      </section>
      {note ? (
        <p className="break-all font-mono text-xs text-zinc-300 lg:col-span-2">
          {note.length > 40 && !note.includes(" ") ? (
            <a className="text-primary underline" href={solscanTx(note)}>
              {note}
            </a>
          ) : (
            note
          )}
        </p>
      ) : null}
    </div>
  );
}
