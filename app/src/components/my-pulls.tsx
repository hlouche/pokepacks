"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { sendClaim, sendRefund } from "@/lib/actions";
import { REVEAL_TIMEOUT_SLOTS, shortKey, solscanTx, variant } from "@/lib/format";
import { getProgram } from "@/lib/program";

type Row = {
  pubkey: string;
  drop: string;
  nonce: string;
  status: string;
  commitSlot: number;
  wonMint: string;
};

export function MyPulls({ dropFilter }: { dropFilter?: string }) {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [rows, setRows] = useState<Row[]>([]);
  const [slot, setSlot] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [sigs, setSigs] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!publicKey) {
      setRows([]);
      return;
    }
    const program = getProgram(connection);
    const [all, current] = await Promise.all([
      program.account.pull.all([{ memcmp: { offset: 8 + 32, bytes: publicKey.toBase58() } }]),
      connection.getSlot("confirmed"),
    ]);
    setSlot(current);
    const mapped: Row[] = all.map((row: { publicKey: PublicKey; account: Record<string, unknown> }) => ({
      pubkey: row.publicKey.toBase58(),
      drop: (row.account.drop as PublicKey).toBase58(),
      nonce: String(row.account.nonce),
      status: variant(row.account.status),
      commitSlot: Number(row.account.commitSlot),
      wonMint: (row.account.wonMint as PublicKey).toBase58(),
    }));
    setRows(mapped.filter((row) => !dropFilter || row.drop === dropFilter));
  }, [connection, publicKey, dropFilter]);

  useEffect(() => {
    load().catch((e) => setNote(e instanceof Error ? e.message : String(e)));
  }, [load]);

  if (!publicKey) {
    return <p className="font-mono text-xs text-zinc-500">Connect a wallet to see your pulls.</p>;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-400">My pulls</h2>
        <button className="font-mono text-[11px] text-primary" onClick={() => load()} type="button">
          Refresh
        </button>
      </div>
      {rows.length === 0 ? <p className="text-sm text-zinc-500">No open pulls on this wallet.</p> : null}
      <ul className="space-y-2">
        {rows.map((row) => {
          const refundSlot = row.commitSlot + REVEAL_TIMEOUT_SLOTS;
          const ready = slot > refundSlot;
          return (
            <li key={row.pubkey} className="rounded-sm border border-zinc-800 bg-zinc-950 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-xs uppercase text-zinc-300">{row.status}</p>
                  <p className="font-mono text-[11px] text-zinc-500">
                    drop {shortKey(row.drop)} · nonce {row.nonce}
                    {row.status === "revealed" ? ` · ${shortKey(row.wonMint)}` : ""}
                  </p>
                </div>
                {row.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!ready || busy === row.pubkey || !signTransaction}
                    onClick={async () => {
                      setBusy(row.pubkey);
                      setNote(null);
                      try {
                        const sig = await sendRefund({
                          connection,
                          publicKey,
                          signTransaction: signTransaction as never,
                          pull: new PublicKey(row.pubkey),
                        });
                        setSigs((s) => [sig, ...s]);
                        await load();
                      } catch (e) {
                        setNote(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    {ready ? "Refund" : `Refund after slot ${refundSlot}`}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy === row.pubkey || !signTransaction}
                    onClick={async () => {
                      setBusy(row.pubkey);
                      setNote(null);
                      try {
                        const sig = await sendClaim({
                          connection,
                          publicKey,
                          signTransaction: signTransaction as never,
                          pull: new PublicKey(row.pubkey),
                        });
                        setSigs((s) => [sig, ...s]);
                        await load();
                      } catch (e) {
                        setNote(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(null);
                      }
                    }}
                  >
                    Claim
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {note ? <p className="text-sm text-rose-300">{note}</p> : null}
      {sigs.map((sig) => (
        <a key={sig} className="block font-mono text-[11px] text-primary underline" href={solscanTx(sig)} target="_blank" rel="noreferrer">
          {sig.slice(0, 18)}…
        </a>
      ))}
    </section>
  );
}
