"use client";

import { OperatorConsole } from "@/components/operator-console";

export default function OperatorPage() {
  return (
    <div className="pp-stack">
      <div>
        <h1 className="pp-display">Open a case</h1>
        <p className="pp-muted" style={{ maxWidth: 560, marginTop: 12 }}>
          Deposit 0-decimal cards while the drop is a draft, then go live. Inventory stays frozen until you close the drop and withdraw what did not sell.
        </p>
      </div>
      <OperatorConsole />
    </div>
  );
}
