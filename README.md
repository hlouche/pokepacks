# Pokepacks

Devnet launchpad for transparent card drops. An operator deposits 0-decimal tokens into a drop. Buyers pay a fixed USDC price and receive one card drawn uniformly from the remaining inventory. The odds are the inventory.

Randomness is Switchboard On-Demand commit-reveal VRF. `buy_pack` is sent in the same transaction as `commitIx`. `reveal_pack` is sent in the same transaction as `revealIx`. Local tests use the `mock-randomness` feature because Switchboard oracles do not run on localnet. That feature must not be deployed: `POKEPACKS_DEPLOY=1` fails the build if the feature is on, and `scripts/deploy-devnet.sh` also refuses a binary that contains the mock marker.

Program id: `3hQgfmcBJbdvz2Gdab57SHuGAoCT9ST1QNyvFvyxqMHx`

## Commands

```bash
# local tests (mock randomness)
anchor build -- --features mock-randomness
anchor test

# devnet binary (no mock)
anchor build
bash scripts/deploy-devnet.sh

# demo drop + one real Switchboard pull
npm install
npm run setup:devnet
npm run e2e:devnet
```

`anchor test` is wrapped by `scripts/anchor-test.sh`, which puts `scripts/sbf-wrap` first on `PATH`. Solana CLI 2.3.0 ships platform-tools v1.48 (Rust 1.84). Current crates need edition 2024, so the wrapper calls `cargo-build-sbf --tools-version v1.52`.

## Frontend

The Next.js app lives in `app/`. The IDL is `app/src/idl/poke_drop.json` (copied from `target/idl` by the deploy script). The program id is the `address` field in that file.

```bash
cd app
npm install
npm run dev
```

Point it at a deployed program by replacing `app/src/idl/poke_drop.json` after `anchor keys sync` / `anchor build`. Optional env:

- `NEXT_PUBLIC_RPC_URL` — defaults to `https://api.devnet.solana.com`
- `NEXT_PUBLIC_USDC_MINT` — dummy USDC mint printed by `setup-devnet` (also saved in `devnet-state.json`)

In Phantom, switch the network to Devnet, then use the wallet button. Buy a pack from a live drop: the app sends commit, waits for the oracle, reveals, then claims. Pending pulls can be refunded from My Pulls after 1500 slots. Revealed pulls that did not claim show a Claim button.

Operator console (`/operator`): create a draft, deposit a 0-decimal mint from the connected wallet, remove it while the drop is still a draft, go live, close, and withdraw unsold cards one at a time after close. Closing is blocked while a pull is still pending. The USDC vault is closed on `close_drop` only when its balance is zero.

## Unsupported Token-2022 extensions

Mints with a transfer-fee or transfer-hook extension are rejected. Other Token-2022 extensions are not tested and should be treated as unsupported.

## Versions

- anchor-lang / anchor-spl 0.32.1
- switchboard-on-demand 0.10.0
- @switchboard-xyz/on-demand 3.10.1
- @solana/web3.js 1.98.4
- @anchor-lang/core 1.0.2
