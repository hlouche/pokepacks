import { TIERS, formatUsdc, textOf } from "@/lib/format";

export type CardView = {
  mint: string;
  tier: number;
  title: string;
  grader: string;
  cert: string;
  fmv: bigint;
  imageUrl: string;
};

const TIER_TONE = ["text-zinc-300", "text-emerald-300", "text-sky-300", "text-violet-300", "text-primary"];

export function CardFace({ card, compact = false }: { card: CardView; compact?: boolean }) {
  const tier = TIERS[card.tier] ?? "Card";
  return (
    <article
      className={`slab relative flex aspect-[3/4] flex-col justify-between overflow-hidden rounded-sm border p-3 ${
        card.tier === 4 ? "border-primary shadow-[0_0_0_1px_#e6ff3d]" : "border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[10px] uppercase tracking-[0.22em] ${TIER_TONE[card.tier] ?? ""}`}>{tier}</span>
        <span className="font-mono text-[10px] text-zinc-400">{formatUsdc(card.fmv)}</span>
      </div>
      {card.imageUrl ? (
        // Operator-supplied art. Arbitrary hosts, so a plain img is intentional.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" className="mt-2 h-24 w-full rounded-sm object-cover" />
      ) : (
        <div className={`mt-3 flex flex-1 items-end ${compact ? "min-h-16" : "min-h-28"}`}>
          <p className="font-heading text-2xl leading-none tracking-tight text-zinc-50 uppercase">{card.title}</p>
        </div>
      )}
      <div className="mt-3 border-t border-white/10 pt-2">
        {card.imageUrl ? <p className="truncate text-sm font-medium uppercase tracking-wide">{card.title}</p> : null}
        <p className="font-mono text-[11px] text-zinc-400">
          {card.grader || "RAW"} {card.cert}
        </p>
      </div>
    </article>
  );
}

export function cardFromAccount(account: {
  mint: { toBase58(): string };
  tier: number;
  title: unknown;
  grader: unknown;
  cert: unknown;
  fmvUsdc: { toString(): string };
  imageUrl: unknown;
}): CardView {
  return {
    mint: account.mint.toBase58(),
    tier: account.tier,
    title: textOf(account.title),
    grader: textOf(account.grader),
    cert: textOf(account.cert),
    fmv: BigInt(account.fmvUsdc.toString()),
    imageUrl: textOf(account.imageUrl),
  };
}
