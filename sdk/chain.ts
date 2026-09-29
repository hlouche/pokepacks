import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("3hQgfmcBJbdvz2Gdab57SHuGAoCT9ST1QNyvFvyxqMHx");

export const TIERS = ["Common", "Uncommon", "Rare", "Epic", "Chase"] as const;

export function u64le(n: bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(n);
  return b;
}

export function dropPda(operator: PublicKey, seed: bigint, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("drop"), operator.toBuffer(), u64le(seed)],
    programId,
  )[0];
}

export function cardPda(drop: PublicKey, mint: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("card"), drop.toBuffer(), mint.toBuffer()],
    programId,
  )[0];
}

export function pullPda(
  drop: PublicKey,
  buyer: PublicKey,
  nonce: bigint,
  programId = PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pull"), drop.toBuffer(), buyer.toBuffer(), u64le(nonce)],
    programId,
  )[0];
}

export function configPda(programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId)[0];
}

export function bytesForIndex(index: number): number[] {
  const b = new Array<number>(32).fill(0);
  const n = BigInt(index);
  for (let i = 0; i < 8; i++) b[i] = Number((n >> BigInt(i * 8)) & 0xffn);
  return b;
}
