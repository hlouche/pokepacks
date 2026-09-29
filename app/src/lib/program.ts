"use client";

import { AnchorProvider, BN, Program, type Idl, type Wallet } from "@anchor-lang/core";
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import idlJson from "@/idl/poke_drop.json";
import { u64le } from "@/lib/format";

const idl = idlJson as Idl;

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey((idlJson as { address: string }).address);

export function makeConnection() {
  return new Connection(RPC_URL, "confirmed");
}

const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction: async (tx: unknown) => tx,
  signAllTransactions: async (txs: unknown[]) => txs,
} as unknown as Wallet;

export function getProgram(connection: Connection, wallet?: Wallet) {
  const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet, { commitment: "confirmed" });
  // Anchor's generic Program type needs a generated IDL type. The JSON IDL is loaded at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idl, provider) as Program & { methods: any; account: any };
}

export function configPda() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function dropPda(operator: PublicKey, seed: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("drop"), operator.toBuffer(), u64le(seed)],
    PROGRAM_ID,
  )[0];
}

export function cardPda(drop: PublicKey, mint: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("card"), drop.toBuffer(), mint.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function pullPda(drop: PublicKey, buyer: PublicKey, nonce: bigint) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pull"), drop.toBuffer(), buyer.toBuffer(), u64le(nonce)],
    PROGRAM_ID,
  )[0];
}

export function ata(mint: PublicKey, owner: PublicKey, tokenProgram: PublicKey, allowOffCurve = false) {
  return getAssociatedTokenAddressSync(mint, owner, allowOffCurve, tokenProgram);
}

export const SYS = {
  systemProgram: SystemProgram.programId,
  associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
};

export function bn(n: bigint | number) {
  return new BN(n.toString());
}
