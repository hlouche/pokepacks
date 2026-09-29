import { BN } from "@anchor-lang/core";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { Keypair, SystemProgram } from "@solana/web3.js";
import { writeFileSync } from "node:fs";
import { cardPda, configPda, dropPda } from "../sdk/chain.ts";
import { airdrop, devnetProgram } from "./program.ts";

const CARDS = [
  { title: "RAW-BULBASAUR", tier: 0, grader: "RAW", cert: "1001", fmv: 8_000_000 },
  { title: "RAW-SQUIRTLE", tier: 0, grader: "RAW", cert: "1002", fmv: 8_000_000 },
  { title: "RAW-CHARMANDER", tier: 0, grader: "RAW", cert: "1003", fmv: 8_000_000 },
  { title: "RAW-CATERPIE", tier: 0, grader: "RAW", cert: "1004", fmv: 5_000_000 },
  { title: "RAW-PIDGEY", tier: 0, grader: "RAW", cert: "1005", fmv: 5_000_000 },
  { title: "PSA8-EEVEE", tier: 2, grader: "PSA", cert: "2001", fmv: 25_000_000 },
  { title: "PSA8-SNORLAX", tier: 2, grader: "PSA", cert: "2002", fmv: 30_000_000 },
  { title: "CGC8-MEW", tier: 2, grader: "CGC", cert: "2003", fmv: 40_000_000 },
  { title: "BGS9-PIKACHU", tier: 3, grader: "BGS", cert: "3001", fmv: 90_000_000 },
  { title: "PSA10-CHARIZARD", tier: 4, grader: "PSA", cert: "4001", fmv: 250_000_000 },
];

const SEED = 1n;
const PRICE = 25_000_000n;

function bn(n: bigint | number) {
  return new BN(n.toString());
}

async function main() {
  const { program, connection, keypair, programId } = devnetProgram();
  const operator = keypair.publicKey;
  console.log("wallet", operator.toBase58());
  const bal = await connection.getBalance(operator);
  if (bal < 1_500_000_000) {
    console.log("airdropping SOL...");
    await airdrop(connection, operator, 2);
  }

  const treasury = Keypair.generate();
  const config = configPda(programId);
  const existingConfig = await connection.getAccountInfo(config);
  if (!existingConfig) {
    console.log("initialize_config");
    await program.methods
      .initializeConfig(250, treasury.publicKey)
      .accounts({
        config,
        admin: operator,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  } else {
    console.log("config exists");
  }

  console.log("creating dummy USDC");
  const usdc = await createMint(connection, keypair, operator, null, 6);
  const usdcAta = await getOrCreateAssociatedTokenAccount(connection, keypair, usdc, operator);
  await mintTo(connection, keypair, usdc, usdcAta.address, keypair, 1_000_000_000);

  const drop = dropPda(operator, SEED, programId);
  const dropInfo = await connection.getAccountInfo(drop);
  if (!dropInfo) {
    console.log("create_drop", drop.toBase58());
    await program.methods
      .createDrop(bn(SEED), Buffer.from("Night Counter"), Buffer.from(""), bn(PRICE))
      .accounts({
        dropAccount: drop,
        operator,
        priceMint: usdc,
        usdcVault: (
          await import("@solana/spl-token")
        ).getAssociatedTokenAddressSync(usdc, drop, true),
        priceTokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
  const mints: string[] = [];
  for (const card of CARDS) {
    const mint = await createMint(connection, keypair, operator, null, 0);
    const ata = await getOrCreateAssociatedTokenAccount(connection, keypair, mint, operator);
    await mintTo(connection, keypair, mint, ata.address, keypair, 1);
    const cardInfo = await connection.getAccountInfo(cardPda(drop, mint, programId));
    if (!cardInfo) {
      console.log("add_card", card.title, mint.toBase58());
      await program.methods
        .addCard(
          card.tier,
          bn(card.fmv),
          Buffer.from(card.grader),
          Buffer.from(card.cert),
          Buffer.from(card.title),
          Buffer.from(""),
        )
        .accounts({
          dropAccount: drop,
          operator,
          card: cardPda(drop, mint, programId),
          mint,
          operatorToken: ata.address,
          vault: getAssociatedTokenAddressSync(mint, drop, true),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }
    mints.push(mint.toBase58());
  }

  const state = await program.account.drop.fetch(drop);
  const status = typeof state.status === "string" ? state.status : Object.keys(state.status)[0];
  if (status.toLowerCase() === "draft") {
    console.log("go_live");
    await program.methods.goLive().accounts({ dropAccount: drop, operator }).rpc();
  }

  const out = {
    programId: programId.toBase58(),
    usdcMint: usdc.toBase58(),
    drop: drop.toBase58(),
    treasury: treasury.publicKey.toBase58(),
    operator: operator.toBase58(),
    price: PRICE.toString(),
    cards: mints,
  };
  writeFileSync("devnet-state.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
