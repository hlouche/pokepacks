import { BN } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import * as sb from "@switchboard-xyz/on-demand";
import { readFileSync } from "node:fs";
import { cardPda, configPda, pullPda } from "../sdk/chain.ts";
import { devnetProgram } from "./program.ts";

const COMMIT_REVEAL_WAIT_MS = 3_000;
const REVEAL_RETRIES = 8;
const REVEAL_BACKOFF_MS = 2_000;

function asIx(ix: {
  programId: { toBase58(): string };
  keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[];
  data: Buffer | Uint8Array;
}) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId.toBase58()),
    keys: ix.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey.toBase58()),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

function txUrl(sig: string) {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

async function send(
  connection: import("@solana/web3.js").Connection,
  payer: Keypair,
  ixs: import("@solana/web3.js").TransactionInstruction[],
  extra: Keypair[] = [],
) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 75_000 }),
      ...ixs,
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...extra]);
  const sig = await connection.sendTransaction(tx, { skipPreflight: false });
  const status = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (status.value.err) throw new Error(`tx failed ${sig} ${JSON.stringify(status.value.err)}`);
  return sig;
}

async function main() {
  const state = JSON.parse(readFileSync("devnet-state.json", "utf8")) as {
    usdcMint: string;
    drop: string;
    treasury: string;
  };
  const { program, connection, keypair, programId } = devnetProgram();
  const buyer = keypair.publicKey;
  const drop = new PublicKey(state.drop);
  const usdc = new PublicKey(state.usdcMint);
  const treasury = new PublicKey(state.treasury);
  const dropAcc = await program.account.drop.fetch(drop);
  console.log("drop", drop.toBase58(), "inventory", dropAcc.inventory.length, "pending", dropAcc.pending);

  const queue = await sb.getDefaultQueue(connection.rpcEndpoint);
  const sbProgram = queue.program;
  const rngKp = Keypair.generate();
  console.log("randomness", rngKp.publicKey.toBase58());
  const [randomness, createIx] = await sb.Randomness.create(sbProgram, rngKp, queue.pubkey, buyer);
  const createSig = await send(connection, keypair, [asIx(createIx)], [rngKp]);
  console.log("create", txUrl(createSig));

  const nonce = BigInt(Date.now());
  const pull = pullPda(drop, buyer, nonce, programId);
  const commitIx = await randomness.commitIx(queue.pubkey, buyer);
  const buyIx = await program.methods
    .buyPack(new BN(nonce.toString()))
    .accounts({
      buyer,
      dropAccount: drop,
      pull,
      randomnessAccountData: rngKp.publicKey,
      priceMint: usdc,
      buyerUsdc: getAssociatedTokenAddressSync(usdc, buyer),
      usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
      priceTokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const commitSig = await send(connection, keypair, [asIx(commitIx), buyIx]);
  console.log("commit+buy", txUrl(commitSig));

  await new Promise((r) => setTimeout(r, COMMIT_REVEAL_WAIT_MS));
  let revealIx: Awaited<ReturnType<typeof randomness.revealIx>> | undefined;
  for (let attempt = 1; attempt <= REVEAL_RETRIES; attempt++) {
    try {
      revealIx = await randomness.revealIx(buyer);
      break;
    } catch (e) {
      if (attempt === REVEAL_RETRIES) throw e;
      console.log(`reveal not ready (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, REVEAL_BACKOFF_MS));
    }
  }
  if (!revealIx) throw new Error("oracle did not produce a reveal instruction");

  const revealProgramIx = await program.methods
    .revealPack()
    .accounts({
      dropAccount: drop,
      pull,
      randomnessAccountData: rngKp.publicKey,
    })
    .instruction();
  const revealSig = await send(connection, keypair, [asIx(revealIx), revealProgramIx]);
  console.log("reveal", txUrl(revealSig));

  const pullAcc = await program.account.pull.fetch(pull);
  const won = pullAcc.wonMint as PublicKey;
  const cardAcc = await program.account.card.fetch(cardPda(drop, won, programId));
  const tokenProgram = cardAcc.tokenProgram as PublicKey;
  const claimIx = await program.methods
    .claimPull()
    .accounts({
      caller: buyer,
      config: configPda(programId),
      treasury,
      dropAccount: drop,
      pull,
      buyer,
      operator: dropAcc.operator,
      card: cardPda(drop, won, programId),
      mint: won,
      vault: getAssociatedTokenAddressSync(won, drop, true, tokenProgram),
      buyerAta: getAssociatedTokenAddressSync(won, buyer, false, tokenProgram),
      priceMint: usdc,
      usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
      operatorUsdc: getAssociatedTokenAddressSync(usdc, dropAcc.operator as PublicKey),
      treasuryUsdc: getAssociatedTokenAddressSync(usdc, treasury),
      tokenProgram,
      priceTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const claimSig = await send(connection, keypair, [claimIx]);
  console.log("claim", txUrl(claimSig));
  console.log("won", won.toBase58());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
