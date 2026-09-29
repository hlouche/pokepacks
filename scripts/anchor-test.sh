#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
cp -f keys/poke_drop-keypair.json target/deploy/poke_drop-keypair.json
chmod +x scripts/sbf-wrap/cargo-build-sbf
export PATH="$(pwd)/scripts/sbf-wrap:$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$PATH"
anchor test -- --features mock-randomness "$@"
