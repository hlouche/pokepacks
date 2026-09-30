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

const TIER_CLASS = ["tier-0", "tier-1", "tier-2", "tier-3", "tier-4"];

export function CardFace({ card, compact = false }: { card: CardView; compact?: boolean }) {
  const tier = TIERS[card.tier] ?? "Card";
  return (
    <article className={`pp-card${card.tier === 4 ? " is-chase" : ""}${compact ? " is-compact" : ""}`}>
      <div className="pp-card-top">
        <span className={TIER_CLASS[card.tier] ?? "tier-0"}>{tier}</span>
        <span>{formatUsdc(card.fmv)}</span>
      </div>
      {card.imageUrl ? (
        // Operator-supplied art. Arbitrary hosts, so a plain img is intentional.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={card.imageUrl} alt="" />
      ) : (
        <p className="pp-card-title">{card.title || "Card"}</p>
      )}
      <div className="pp-card-foot">
        {card.imageUrl ? <p>{card.title}</p> : null}
        <p>
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
