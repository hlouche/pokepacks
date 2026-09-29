"use client";

import { Buffer } from "buffer";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, type VersionedTransaction } from "@solana/web3.js";
import { sendIxs } from "@/lib/buy";
import { parseUsdc } from "@/lib/format";
import { ata, bn, cardPda, configPda, dropPda, getProgram } from "@/lib/program";

export type Signer = (tx: VersionedTransaction) => Promise<VersionedTransaction>;

function readonlyWallet(publicKey: PublicKey) {
  return {
    publicKey,
    signTransaction: async (tx: never) => tx,
    signAllTransactions: async (txs: never) => txs,
  };
}

export async function sendCreateDrop(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  seed: string;
  name: string;
  imageUrl: string;
  priceUsdc: string;
  priceMint: PublicKey;
  priceTokenProgram?: PublicKey;
}) {
  const tokenProgram = args.priceTokenProgram ?? TOKEN_PROGRAM_ID;
  const seed = BigInt(args.seed);
  const drop = dropPda(args.publicKey, seed);
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const ix = await program.methods
    .createDrop(bn(seed), Buffer.from(args.name), Buffer.from(args.imageUrl), bn(parseUsdc(args.priceUsdc)))
    .accounts({
      dropAccount: drop,
      operator: args.publicKey,
      priceMint: args.priceMint,
      usdcVault: ata(args.priceMint, drop, tokenProgram, true),
      priceTokenProgram: tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const sig = await sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
  return { sig, drop: drop.toBase58() };
}

export async function sendAddCard(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  drop: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  tier: number;
  fmvUsdc: string;
  grader: string;
  cert: string;
  title: string;
  imageUrl: string;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const ix = await program.methods
    .addCard(
      args.tier,
      bn(parseUsdc(args.fmvUsdc)),
      Buffer.from(args.grader),
      Buffer.from(args.cert),
      Buffer.from(args.title),
      Buffer.from(args.imageUrl),
    )
    .accounts({
      dropAccount: args.drop,
      operator: args.publicKey,
      card: cardPda(args.drop, args.mint),
      mint: args.mint,
      operatorToken: ata(args.mint, args.publicKey, args.tokenProgram),
      vault: ata(args.mint, args.drop, args.tokenProgram, true),
      tokenProgram: args.tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendRemoveCard(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  drop: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const ix = await program.methods
    .removeCard()
    .accounts({
      dropAccount: args.drop,
      operator: args.publicKey,
      card: cardPda(args.drop, args.mint),
      mint: args.mint,
      operatorToken: ata(args.mint, args.publicKey, args.tokenProgram),
      vault: ata(args.mint, args.drop, args.tokenProgram, true),
      tokenProgram: args.tokenProgram,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendGoLive(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  drop: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const ix = await program.methods
    .goLive()
    .accounts({ dropAccount: args.drop, operator: args.publicKey })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendCloseDrop(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  drop: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const dropAcc = await program.account.drop.fetch(args.drop);
  const priceMint = dropAcc.priceMint as PublicKey;
  const priceTokenProgram = dropAcc.tokenProgramPrice as PublicKey;
  const ix = await program.methods
    .closeDrop()
    .accounts({
      dropAccount: args.drop,
      operator: args.publicKey,
      usdcVault: ata(priceMint, args.drop, priceTokenProgram, true),
      priceMint,
      priceTokenProgram,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendWithdraw(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  drop: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const ix = await program.methods
    .withdrawUnsold()
    .accounts({
      dropAccount: args.drop,
      operator: args.publicKey,
      card: cardPda(args.drop, args.mint),
      mint: args.mint,
      operatorToken: ata(args.mint, args.publicKey, args.tokenProgram),
      vault: ata(args.mint, args.drop, args.tokenProgram, true),
      tokenProgram: args.tokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendClaim(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  pull: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const pullAcc = await program.account.pull.fetch(args.pull);
  const drop = pullAcc.drop as PublicKey;
  const won = pullAcc.wonMint as PublicKey;
  const dropAcc = await program.account.drop.fetch(drop);
  const card = await program.account.card.fetch(cardPda(drop, won));
  const config = await program.account.config.fetch(configPda());
  const tokenProgram = card.tokenProgram as PublicKey;
  const priceMint = dropAcc.priceMint as PublicKey;
  const priceTokenProgram = dropAcc.tokenProgramPrice as PublicKey;
  const buyer = pullAcc.buyer as PublicKey;
  const operator = dropAcc.operator as PublicKey;
  const treasury = config.treasury as PublicKey;
  const ix = await program.methods
    .claimPull()
    .accounts({
      caller: args.publicKey,
      config: configPda(),
      treasury,
      dropAccount: drop,
      pull: args.pull,
      buyer,
      operator,
      card: cardPda(drop, won),
      mint: won,
      vault: ata(won, drop, tokenProgram, true),
      buyerAta: ata(won, buyer, tokenProgram),
      priceMint,
      usdcVault: ata(priceMint, drop, priceTokenProgram, true),
      operatorUsdc: ata(priceMint, operator, priceTokenProgram),
      treasuryUsdc: ata(priceMint, treasury, priceTokenProgram),
      tokenProgram,
      priceTokenProgram,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}

export async function sendRefund(args: {
  connection: Connection;
  publicKey: PublicKey;
  signTransaction: Signer;
  pull: PublicKey;
}) {
  const program = getProgram(args.connection, readonlyWallet(args.publicKey) as never);
  const pullAcc = await program.account.pull.fetch(args.pull);
  const drop = pullAcc.drop as PublicKey;
  const dropAcc = await program.account.drop.fetch(drop);
  const priceMint = dropAcc.priceMint as PublicKey;
  const priceTokenProgram = dropAcc.tokenProgramPrice as PublicKey;
  const ix = await program.methods
    .refundPull()
    .accounts({
      dropAccount: drop,
      pull: args.pull,
      buyer: args.publicKey,
      priceMint,
      usdcVault: ata(priceMint, drop, priceTokenProgram, true),
      buyerUsdc: ata(priceMint, args.publicKey, priceTokenProgram),
      priceTokenProgram,
    })
    .instruction();
  return sendIxs(args.connection, args.publicKey, args.signTransaction, [ix]);
}
