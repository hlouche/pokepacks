"use client";

import { Buffer } from "buffer";
import { useConnection } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { ata, bn, cardPda, configPda, getProgram, pullPda } from "@/lib/program";

function normalizeIx(ix: {
  programId: { toBase58(): string };
  keys: { pubkey: { toBase58(): string }; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}): TransactionInstruction {
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

export async function sendIxs(
  connection: ReturnType<typeof useConnection>["connection"],
  payer: PublicKey,
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>,
  ixs: TransactionInstruction[],
  extra: Keypair[] = [],
) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
      ...ixs,
    ],
  }).compileToV0Message();
  let tx = new VersionedTransaction(message);
  if (extra.length) tx.sign(extra);
  tx = await signTransaction(tx);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const status = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  if (status.value.err) throw new Error(`Transaction failed: ${JSON.stringify(status.value.err)}`);
  return signature;
}

export type PullResult = {
  mint: string;
  createSig: string;
  buySig: string;
  revealSig: string;
  claimSig: string | null;
  claimError: string | null;
  pull: string;
};

export async function buyRevealClaim(args: {
  connection: ReturnType<typeof useConnection>["connection"];
  publicKey: PublicKey;
  signTransaction: (tx: VersionedTransaction) => Promise<VersionedTransaction>;
  drop: PublicKey;
  priceMint: PublicKey;
  priceTokenProgram: PublicKey;
  onStatus: (status: string) => void;
}): Promise<PullResult> {
  const { connection, publicKey, signTransaction, drop, onStatus } = args;
  const wallet = {
    publicKey,
    signTransaction: async (tx: never) => tx,
    signAllTransactions: async (txs: never) => txs,
  };
  const program = getProgram(connection, wallet as never);
  const sb = await import("@switchboard-xyz/on-demand");
  onStatus("Opening a randomness account");
  const queue = await sb.getDefaultQueue(connection.rpcEndpoint);
  const rngKp = Keypair.generate();
  const [, createIx] = await sb.Randomness.create(queue.program, rngKp, queue.pubkey, publicKey);
  const createSig = await sendIxs(connection, publicKey, signTransaction, [normalizeIx(createIx)], [rngKp]);

  const nonce = BigInt(Date.now());
  const pull = pullPda(drop, publicKey, nonce);
  onStatus("Paying for the pack");
  const randomness = new sb.Randomness(queue.program, rngKp.publicKey);
  const commitIx = await randomness.commitIx(queue.pubkey, publicKey);
  const buyIx = await program.methods
    .buyPack(bn(nonce))
    .accounts({
      buyer: publicKey,
      dropAccount: drop,
      pull,
      randomnessAccountData: rngKp.publicKey,
      priceMint: args.priceMint,
      buyerUsdc: ata(args.priceMint, publicKey, args.priceTokenProgram),
      usdcVault: ata(args.priceMint, drop, args.priceTokenProgram, true),
      priceTokenProgram: args.priceTokenProgram,
      systemProgram: (await import("@solana/web3.js")).SystemProgram.programId,
    })
    .instruction();
  const buySig = await sendIxs(connection, publicKey, signTransaction, [normalizeIx(commitIx), buyIx]);

  onStatus("Waiting for the oracle");
  await new Promise((r) => setTimeout(r, 3000));
  let revealIx: Awaited<ReturnType<typeof randomness.revealIx>> | undefined;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      revealIx = await randomness.revealIx(publicKey);
      break;
    } catch (e) {
      if (attempt === 8) throw e;
      onStatus(`Oracle still signing (${attempt}/8)`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (!revealIx) throw new Error("Switchboard did not return a reveal instruction");

  onStatus("Revealing the card");
  const revealProgramIx = await program.methods
    .revealPack()
    .accounts({
      dropAccount: drop,
      pull,
      randomnessAccountData: rngKp.publicKey,
    })
    .instruction();
  const revealSig = await sendIxs(connection, publicKey, signTransaction, [normalizeIx(revealIx), revealProgramIx]);
  const pullAcc = await program.account.pull.fetch(pull);
  const won = pullAcc.wonMint as PublicKey;
  const card = await program.account.card.fetch(cardPda(drop, won));
  const tokenProgram = card.tokenProgram as PublicKey;
  const dropAcc = await program.account.drop.fetch(drop);
  const config = await program.account.config.fetch(configPda());

  onStatus("Sending the card to your wallet");
  let claimSig: string | null = null;
  let claimError: string | null = null;
  try {
    const claimIx = await program.methods
      .claimPull()
      .accounts({
        caller: publicKey,
        config: configPda(),
        treasury: config.treasury as PublicKey,
        dropAccount: drop,
        pull,
        buyer: publicKey,
        operator: dropAcc.operator as PublicKey,
        card: cardPda(drop, won),
        mint: won,
        vault: ata(won, drop, tokenProgram, true),
        buyerAta: ata(won, publicKey, tokenProgram),
        priceMint: args.priceMint,
        usdcVault: ata(args.priceMint, drop, args.priceTokenProgram, true),
        operatorUsdc: ata(args.priceMint, dropAcc.operator as PublicKey, args.priceTokenProgram),
        treasuryUsdc: ata(args.priceMint, config.treasury as PublicKey, args.priceTokenProgram),
        tokenProgram,
        priceTokenProgram: args.priceTokenProgram,
        associatedTokenProgram: (await import("@solana/spl-token")).ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: (await import("@solana/web3.js")).SystemProgram.programId,
      })
      .instruction();
    claimSig = await sendIxs(connection, publicKey, signTransaction, [claimIx]);
  } catch (e) {
    claimError = e instanceof Error ? e.message : String(e);
  }

  return {
    mint: won.toBase58(),
    createSig,
    buySig,
    revealSig,
    claimSig,
    claimError,
    pull: pull.toBase58(),
  };
}

export { TOKEN_PROGRAM_ID };
