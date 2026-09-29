import * as anchor from "@anchor-lang/core";
import { AnchorError, BN } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMint,
  getAccount,
  getAssociatedTokenAddressSync,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { expect } from "chai";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bytesForIndex, cardPda, configPda, dropPda, pullPda } from "../sdk/chain.ts";

const here = dirname(fileURLToPath(import.meta.url));
const idl = JSON.parse(readFileSync(resolve(here, "../target/idl/poke_drop.json"), "utf8"));

const PRICE = 10_000_000n;
const FEE_BPS = 250;
const TIMEOUT = 15; // mock-randomness REVEAL_TIMEOUT_SLOTS

function bn(n: bigint | number): BN {
  return new BN(n.toString());
}

function variant(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase();
  if (value && typeof value === "object") return Object.keys(value)[0].toLowerCase();
  return String(value);
}

function blob(e: unknown): string {
  if (e instanceof AnchorError) {
    return `${e.error.errorCode.code} ${e.error.errorMessage} ${e.message}`;
  }
  const any = e as { error?: { errorCode?: { code?: string } }; message?: string };
  return `${any?.error?.errorCode?.code ?? ""} ${any?.message ?? ""} ${e}`;
}

async function mustFail(fn: () => Promise<unknown>, needle: string) {
  try {
    await fn();
  } catch (e) {
    const text = blob(e);
    if (!text.includes(needle)) {
      throw new Error(`expected ${needle} but got ${text.slice(0, 900)}`);
    }
    return;
  }
  throw new Error(`expected failure containing ${needle}`);
}

async function tokenBal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  programId: PublicKey,
): Promise<bigint> {
  try {
    const acc = await getAccount(connection, ata, "confirmed", programId);
    return acc.amount;
  } catch {
    return 0n;
  }
}

async function untilBal(
  connection: anchor.web3.Connection,
  ata: PublicKey,
  programId: PublicKey,
  expected: bigint,
): Promise<bigint> {
  let last = 0n;
  for (let i = 0; i < 20; i++) {
    last = await tokenBal(connection, ata, programId);
    if (last === expected) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}

describe("poke_drop", function () {
  this.timeout(300_000);

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(idl, provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;
  const programId = new PublicKey(idl.address);

  const buyer = Keypair.generate();
  const treasury = Keypair.generate();
  const rando = Keypair.generate();
  let usdc: PublicKey;
  const cards: { mint: PublicKey; tokenProgram: PublicKey; title: string }[] = [];

  async function airdrop(pk: PublicKey, sol = 8) {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  async function pokeSlots(fromSlot: number) {
    const target = fromSlot + TIMEOUT + 2;
    const start = Date.now();
    while (Date.now() - start < 90_000) {
      const now = await connection.getSlot("confirmed");
      if (now > target) return now;
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: payer.publicKey,
          lamports: 1,
        }),
      );
      await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    }
    throw new Error(`slot did not pass ${target}`);
  }

  async function makeNft(tokenProgram: PublicKey, owner: PublicKey) {
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      0,
      Keypair.generate(),
      { commitment: "confirmed" },
      tokenProgram,
    );
    const ataAddress = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram);
    const createAta = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ataAddress, owner, mint, tokenProgram),
    );
    try {
      await sendAndConfirmTransaction(connection, createAta, [payer], { commitment: "confirmed" });
    } catch (e) {
      const info = await connection.getAccountInfo(mint);
      const bal = await connection.getBalance(payer.publicKey);
      console.error("create ata failed", { mint: mint.toBase58(), info: info?.owner.toBase58(), bal, e });
      throw e;
    }
    const ata = await getAccount(connection, ataAddress, "confirmed", tokenProgram);
    await mintTo(
      connection,
      payer,
      mint,
      ata.address,
      payer,
      1,
      [],
      { commitment: "confirmed" },
      tokenProgram,
    );
    return { mint, ata: ata.address, tokenProgram };
  }

  async function addCard(
    drop: PublicKey,
    operator: PublicKey,
    card: { mint: PublicKey; tokenProgram: PublicKey; title: string },
    tier: number,
    fmv: bigint,
    signer?: Keypair,
  ) {
    const builder = program.methods
      .addCard(tier, bn(fmv), Buffer.from("PSA"), Buffer.from("99"), Buffer.from(card.title), Buffer.from(""))
      .accounts({
        dropAccount: drop,
        operator,
        card: cardPda(drop, card.mint, programId),
        mint: card.mint,
        operatorToken: getAssociatedTokenAddressSync(card.mint, operator, false, card.tokenProgram),
        vault: getAssociatedTokenAddressSync(card.mint, drop, true, card.tokenProgram),
        tokenProgram: card.tokenProgram,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      });
    if (signer) builder.signers([signer]);
    return builder.rpc();
  }

  async function createDrop(seed: bigint, operator = payer.publicKey) {
    const drop = dropPda(operator, seed, programId);
    await program.methods
      .createDrop(bn(seed), Buffer.from(`Box ${seed}`), Buffer.from(""), bn(PRICE))
      .accounts({
        dropAccount: drop,
        operator,
        priceMint: usdc,
        usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
        priceTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    return drop;
  }

  async function buy(drop: PublicKey, nonce: bigint) {
    const pull = pullPda(drop, buyer.publicKey, nonce, programId);
    const randomness = Keypair.generate().publicKey;
    await program.methods
      .buyPack(bn(nonce))
      .accounts({
        buyer: buyer.publicKey,
        dropAccount: drop,
        pull,
        randomnessAccountData: randomness,
        priceMint: usdc,
        buyerUsdc: getAssociatedTokenAddressSync(usdc, buyer.publicKey),
        usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
        priceTokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    return { pull, randomness };
  }

  async function reveal(drop: PublicKey, pull: PublicKey, randomness: PublicKey, index = 0) {
    await program.methods
      .revealPack(bytesForIndex(index))
      .accounts({
        dropAccount: drop,
        pull,
        randomnessAccountData: randomness,
      })
      .rpc();
  }

  async function claim(
    drop: PublicKey,
    pull: PublicKey,
    wonMint: PublicKey,
    tokenProgram: PublicKey,
  ) {
    await program.methods
      .claimPull()
      .accounts({
        caller: payer.publicKey,
        config: configPda(programId),
        treasury: treasury.publicKey,
        dropAccount: drop,
        pull,
        buyer: buyer.publicKey,
        operator: payer.publicKey,
        card: cardPda(drop, wonMint, programId),
        mint: wonMint,
        vault: getAssociatedTokenAddressSync(wonMint, drop, true, tokenProgram),
        buyerAta: getAssociatedTokenAddressSync(wonMint, buyer.publicKey, false, tokenProgram),
        priceMint: usdc,
        usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
        operatorUsdc: getAssociatedTokenAddressSync(usdc, payer.publicKey),
        treasuryUsdc: getAssociatedTokenAddressSync(usdc, treasury.publicKey),
        tokenProgram,
        priceTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  before(async () => {
    await airdrop(payer.publicKey);
    await airdrop(buyer.publicKey);
    await airdrop(rando.publicKey);
    usdc = await createMint(connection, payer, payer.publicKey, null, 6);
    const buyerUsdc = await getOrCreateAssociatedTokenAccount(connection, payer, usdc, buyer.publicKey);
    await mintTo(connection, payer, usdc, buyerUsdc.address, payer, 200_000_000n);
    cards.push(await makeNft(TOKEN_PROGRAM_ID, payer.publicKey));
    cards.push(await makeNft(TOKEN_PROGRAM_ID, payer.publicKey));
    cards.push(await makeNft(TOKEN_2022_PROGRAM_ID, payer.publicKey));
    cards[0].title = "PSA10-CHARIZARD";
    cards[1].title = "RAW-BULBASAUR";
    cards[2].title = "BGS9-PIKACHU";
  });

  it("initializes config, creates a drop, adds cards, and goes live", async () => {
    await program.methods
      .initializeConfig(FEE_BPS, treasury.publicKey)
      .accounts({
        config: configPda(programId),
        admin: payer.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const drop = await createDrop(1n);
    await addCard(drop, payer.publicKey, cards[0], 4, 250_000_000n);
    await addCard(drop, payer.publicKey, cards[1], 0, 8_000_000n);
    const removed = await makeNft(TOKEN_PROGRAM_ID, payer.publicKey);
    removed.title = "TEMP";
    await addCard(drop, payer.publicKey, removed, 0, 1_000_000n);
    let state = await program.account.drop.fetch(drop);
    expect(state.inventory.length).to.equal(3);
    const removedAta = getAssociatedTokenAddressSync(removed.mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
    const removedVault = getAssociatedTokenAddressSync(removed.mint, drop, true, TOKEN_PROGRAM_ID);
    const vaultInfo = await connection.getAccountInfo(removedVault);
    expect(vaultInfo?.owner.equals(TOKEN_PROGRAM_ID)).to.equal(true);
    expect(await untilBal(connection, removedVault, TOKEN_PROGRAM_ID, 1n)).to.equal(1n);
    await program.methods
      .removeCard()
      .accounts({
        dropAccount: drop,
        operator: payer.publicKey,
        card: cardPda(drop, removed.mint, programId),
        mint: removed.mint,
        operatorToken: getAssociatedTokenAddressSync(removed.mint, payer.publicKey, false, TOKEN_PROGRAM_ID),
        vault: getAssociatedTokenAddressSync(removed.mint, drop, true),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    expect(await untilBal(connection, removedAta, TOKEN_PROGRAM_ID, 1n)).to.equal(1n);
    await addCard(drop, payer.publicKey, cards[2], 3, 90_000_000n);
    state = await program.account.drop.fetch(drop);
    expect(state.inventory.length).to.equal(3);
    expect(variant(state.status)).to.equal("draft");

    const foreign = await makeNft(TOKEN_PROGRAM_ID, rando.publicKey);
    foreign.title = "NOPE";
    await mustFail(() => addCard(drop, rando.publicKey, foreign, 0, 1n, rando), "Constraint");

    await program.methods
      .goLive()
      .accounts({ dropAccount: drop, operator: payer.publicKey })
      .rpc();
    state = await program.account.drop.fetch(drop);
    expect(variant(state.status)).to.equal("live");

    await mustFail(
      () =>
        program.methods
          .goLive()
          .accounts({ dropAccount: drop, operator: rando.publicKey })
          .signers([rando])
          .rpc(),
      "Constraint",
    );
    await mustFail(
      () =>
        program.methods
          .closeDrop()
          .accounts({
            dropAccount: drop,
            operator: rando.publicKey,
            usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
            priceMint: usdc,
            priceTokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([rando])
          .rpc(),
      "Constraint",
    );
  });

  it("buys, reveals, and claims without repeating a card", async () => {
    const drop = dropPda(payer.publicKey, 1n, programId);
    const won: string[] = [];
    const opBefore = await tokenBal(connection, getAssociatedTokenAddressSync(usdc, payer.publicKey), TOKEN_PROGRAM_ID);
    const treBefore = await tokenBal(connection, getAssociatedTokenAddressSync(usdc, treasury.publicKey), TOKEN_PROGRAM_ID);
    const buyerBefore = await tokenBal(connection, getAssociatedTokenAddressSync(usdc, buyer.publicKey), TOKEN_PROGRAM_ID);

    for (let i = 0; i < 3; i++) {
      const before = (await program.account.drop.fetch(drop)).inventory.map((m: PublicKey) => m.toBase58());
      const { pull, randomness } = await buy(drop, BigInt(100 + i));
      await reveal(drop, pull, randomness, 0);
      const pullAcc = await program.account.pull.fetch(pull);
      expect(variant(pullAcc.status)).to.equal("revealed");
      const mint = pullAcc.wonMint as PublicKey;
      expect(before).to.include(mint.toBase58());
      expect(won).to.not.include(mint.toBase58());
      won.push(mint.toBase58());
      const after = (await program.account.drop.fetch(drop)).inventory.map((m: PublicKey) => m.toBase58());
      expect(after).to.not.include(mint.toBase58());
      expect(after.length).to.equal(before.length - 1);
      const tokenProgram = cards.find((c) => c.mint.equals(mint))!.tokenProgram;
      await claim(drop, pull, mint, tokenProgram);
      expect(
        await untilBal(
          connection,
          getAssociatedTokenAddressSync(mint, buyer.publicKey, false, tokenProgram),
          tokenProgram,
          1n,
        ),
      ).to.equal(1n);
      const closed = await connection.getAccountInfo(pull);
      expect(closed).to.equal(null);
    }

    const fee = (PRICE * BigInt(FEE_BPS)) / 10_000n;
    const rest = PRICE - fee;
    expect(
      await untilBal(
        connection,
        getAssociatedTokenAddressSync(usdc, treasury.publicKey),
        TOKEN_PROGRAM_ID,
        treBefore + fee * 3n,
      ),
    ).to.equal(treBefore + fee * 3n);
    expect(
      await untilBal(connection, getAssociatedTokenAddressSync(usdc, payer.publicKey), TOKEN_PROGRAM_ID, opBefore + rest * 3n),
    ).to.equal(opBefore + rest * 3n);
    expect(
      await untilBal(
        connection,
        getAssociatedTokenAddressSync(usdc, buyer.publicKey),
        TOKEN_PROGRAM_ID,
        buyerBefore - PRICE * 3n,
      ),
    ).to.equal(buyerBefore - PRICE * 3n);
    const end = await program.account.drop.fetch(drop);
    expect(end.inventory.length).to.equal(0);
    expect(end.totalSold).to.equal(3);
    expect(end.pending).to.equal(0);
    expect(new Set(won).size).to.equal(3);
  });

  it("rejects a buy when every remaining card is reserved", async () => {
    const extra = await makeNft(TOKEN_PROGRAM_ID, payer.publicKey);
    extra.title = "LAST";
    const drop = await createDrop(2n);
    await addCard(drop, payer.publicKey, extra, 1, 12_000_000n);
    await program.methods.goLive().accounts({ dropAccount: drop, operator: payer.publicKey }).rpc();
    await buy(drop, 1n);
    const state = await program.account.drop.fetch(drop);
    expect(state.inventory.length).to.equal(state.pending);
    await mustFail(() => buy(drop, 2n), "SoldOut");
  });

  it("refunds after the timeout and blocks close while a pull is pending", async () => {
    const extra = await makeNft(TOKEN_PROGRAM_ID, payer.publicKey);
    extra.title = "REFUND";
    const drop = await createDrop(3n);
    await addCard(drop, payer.publicKey, extra, 0, 4_000_000n);
    await program.methods.goLive().accounts({ dropAccount: drop, operator: payer.publicKey }).rpc();
    const before = await tokenBal(connection, getAssociatedTokenAddressSync(usdc, buyer.publicKey), TOKEN_PROGRAM_ID);
    const { pull } = await buy(drop, 7n);
    const pullAcc = await program.account.pull.fetch(pull);
    await mustFail(
      () =>
        program.methods
          .closeDrop()
          .accounts({
            dropAccount: drop,
            operator: payer.publicKey,
            usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
            priceMint: usdc,
            priceTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "PendingPulls",
    );
    await mustFail(
      () =>
        program.methods
          .refundPull()
          .accounts({
            dropAccount: drop,
            pull,
            buyer: buyer.publicKey,
            priceMint: usdc,
            usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
            buyerUsdc: getAssociatedTokenAddressSync(usdc, buyer.publicKey),
            priceTokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([buyer])
          .rpc(),
      "TimeoutNotReached",
    );
    await pokeSlots(Number(pullAcc.commitSlot));
    await program.methods
      .refundPull()
      .accounts({
        dropAccount: drop,
        pull,
        buyer: buyer.publicKey,
        priceMint: usdc,
        usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
        buyerUsdc: getAssociatedTokenAddressSync(usdc, buyer.publicKey),
        priceTokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([buyer])
      .rpc();
    expect(
      await untilBal(connection, getAssociatedTokenAddressSync(usdc, buyer.publicKey), TOKEN_PROGRAM_ID, before),
    ).to.equal(before);
    const state = await program.account.drop.fetch(drop);
    expect(state.pending).to.equal(0);
    expect(state.inventory.length).to.equal(1);
    await program.methods
      .closeDrop()
      .accounts({
        dropAccount: drop,
        operator: payer.publicKey,
        usdcVault: getAssociatedTokenAddressSync(usdc, drop, true),
        priceMint: usdc,
        priceTokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();
    await program.methods
      .withdrawUnsold()
      .accounts({
        dropAccount: drop,
        operator: payer.publicKey,
        card: cardPda(drop, extra.mint, programId),
        mint: extra.mint,
        operatorToken: getAssociatedTokenAddressSync(extra.mint, payer.publicKey),
        vault: getAssociatedTokenAddressSync(extra.mint, drop, true),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    expect(
      await untilBal(
        connection,
        getAssociatedTokenAddressSync(extra.mint, payer.publicKey, false, TOKEN_PROGRAM_ID),
        TOKEN_PROGRAM_ID,
        1n,
      ),
    ).to.equal(1n);
    const closed = await program.account.drop.fetch(drop);
    expect(variant(closed.status)).to.equal("closed");
    expect(closed.inventory.length).to.equal(0);
  });
});
