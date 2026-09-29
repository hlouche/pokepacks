import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export function loadIdl() {
  return JSON.parse(readFileSync(resolve(here, "../target/idl/poke_drop.json"), "utf8"));
}

export function loadKeypair(path = `${homedir()}/.config/solana/id.json`): Keypair {
  const override = process.env.KEYPAIR_PATH;
  const file = override && override.length > 0 ? override : path;
  const secret = Uint8Array.from(JSON.parse(readFileSync(file, "utf8")));
  return Keypair.fromSecretKey(secret);
}

export function devnetProgram() {
  const idl = loadIdl();
  const keypair = loadKeypair();
  const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", "confirmed");
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  const program = new Program(idl, provider);
  return { idl, keypair, connection, wallet, provider, program, programId: new PublicKey(idl.address) };
}

export async function airdrop(connection: Connection, pubkey: PublicKey, sol = 2) {
  let last = "airdrop failed";
  for (let i = 0; i < 6; i++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, sol * anchor.web3.LAMPORTS_PER_SOL);
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(last);
}
