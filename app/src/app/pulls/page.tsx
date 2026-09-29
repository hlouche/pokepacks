"use client";

import { MyPulls } from "@/components/my-pulls";

export default function PullsPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Buyer</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">My pulls</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          A revealed pull can be claimed if the follow-up transaction did not land. A pending pull can be refunded after 1500 slots.
        </p>
      </div>
      <MyPulls />
    </div>
  );
}
