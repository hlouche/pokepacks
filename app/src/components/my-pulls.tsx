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

  return (
    <section>
      <div className="pp-band-head">
        <div>
          <h2 className={dropFilter ? undefined : "pp-display"}>My pulls</h2>
          {dropFilter ? null : (
            <p className="pp-muted" style={{ maxWidth: 560, marginTop: 12 }}>
              A revealed pull can be claimed if the follow-up transaction did not land. A pending pull can be refunded after 1500 slots.
            </p>
          )}
        </div>
        <button className="pp-refresh" onClick={() => load()} type="button">
          Refresh
        </button>
      </div>
      {!publicKey ? <p className="pp-empty">Connect a wallet to see your pulls.</p> : null}
      {publicKey && rows.length === 0 ? <p className="pp-empty">No open pulls on this wallet.</p> : null}
      {rows.length > 0 ? (
      <div className="pp-panel">
        {rows.map((row) => {
          const refundSlot = row.commitSlot + REVEAL_TIMEOUT_SLOTS;
          const ready = slot > refundSlot;
          return (
            <div key={row.pubkey} className="pp-row">
              <div>
                <p>{row.status}</p>
                <p className="pp-muted">
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
          );
        })}
      </div>
      ) : null}
      {note ? <p className="pp-err">{note}</p> : null}
      {sigs.map((sig) => (
        <a key={sig} className="pp-link" href={solscanTx(sig)} target="_blank" rel="noreferrer">
          {sig.slice(0, 18)}…
        </a>
      ))}
    </section>
  );
}
