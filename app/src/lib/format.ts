import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";

export const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Chase"] as const;
export const REVEAL_TIMEOUT_SLOTS = 1500;
export const PROGRAM_ID_FALLBACK = "3hQgfmcBJbdvz2Gdab57SHuGAoCT9ST1QNyvFvyxqMHx";

export function textOf(value: unknown): string {
  const bytes = Array.isArray(value) ? value : value instanceof Uint8Array ? Array.from(value) : [];
  const end = bytes.findIndex === undefined ? bytes.length : (() => {
    let i = bytes.length;
    while (i > 0 && bytes[i - 1] === 0) i -= 1;
    return i;
  })();
  return new TextDecoder().decode(Uint8Array.from(bytes.slice(0, end)));
}

export function variant(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object") return Object.keys(value)[0]?.toLowerCase() ?? "";
  return String(value ?? "");
}

export function toBig(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  return BigInt((value as { toString(): string }).toString());
}

export function formatUsdc(value: unknown): string {
  const n = toBig(value);
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${neg ? "-" : ""}$${whole.toString()}.${frac}`;
}

export function shortKey(key: PublicKey | string): string {
  const s = typeof key === "string" ? key : key.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export function solscanTx(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

export function solscanAddress(key: string): string {
  return `https://solscan.io/account/${key}?cluster=devnet`;
}

export function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function parseUsdc(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) throw new Error("Enter a USDC amount like 25.00");
  const [whole, frac = ""] = trimmed.split(".");
  const micro = (frac + "000000").slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(micro);
}
