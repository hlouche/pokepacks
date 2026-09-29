#!/usr/bin/env bash
# Build WITHOUT mock-randomness and deploy to devnet.
# POKEPACKS_DEPLOY=1 triggers compile_error! if the mock feature is on.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p target/deploy
cp -f keys/poke_drop-keypair.json target/deploy/poke_drop-keypair.json
chmod +x scripts/sbf-wrap/cargo-build-sbf
export PATH="$(pwd)/scripts/sbf-wrap:$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:/usr/local/cargo/bin:$PATH"
export POKEPACKS_DEPLOY=1
anchor build
if grep -a -q "MOCK_RANDOMNESS_ENABLED_DO_NOT_DEPLOY" target/deploy/poke_drop.so; then
  echo "Refusing to deploy a mock-randomness build." >&2
  exit 1
fi
anchor deploy --provider.cluster devnet
mkdir -p app/src/idl
cp -f target/idl/poke_drop.json app/src/idl/poke_drop.json
if [[ -f target/types/poke_drop.ts ]]; then
  cp -f target/types/poke_drop.ts app/src/idl/poke_drop.ts
fi
echo "IDL copied to app/src/idl/poke_drop.json"
