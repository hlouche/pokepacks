"use client";

import { Buffer } from "buffer";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { useMemo } from "react";
import { RPC_URL } from "@/lib/program";
import "@solana/wallet-adapter-react-ui/styles.css";

if (typeof globalThis !== "undefined") {
  const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer };
  scope.Buffer = scope.Buffer ?? Buffer;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const endpoint = useMemo(() => RPC_URL, []);
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export const DEVNET = WalletAdapterNetwork.Devnet;
