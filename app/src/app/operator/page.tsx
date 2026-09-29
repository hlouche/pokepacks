"use client";

import { OperatorConsole } from "@/components/operator-console";

export default function OperatorPage() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Operator</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Open a case</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          Deposit 0-decimal cards while the drop is a draft, then go live. Inventory stays frozen until you close the drop and withdraw what did not sell.
        </p>
      </div>
      <OperatorConsole />
    </div>
  );
}
