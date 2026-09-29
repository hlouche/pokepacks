use anchor_lang::prelude::*;

/// Slots a buyer waits before an unrevealed pull can be refunded.
/// Production and devnet builds use 1500. The `mock-randomness` feature
/// (local `anchor test` only, never deployed) uses 15 so tests can reach
/// the timeout without waiting out ~10 minutes of slots.
#[cfg(not(feature = "mock-randomness"))]
pub const REVEAL_TIMEOUT_SLOTS: u64 = 1500;

#[cfg(feature = "mock-randomness")]
pub const REVEAL_TIMEOUT_SLOTS: u64 = 15;

pub const MAX_INVENTORY: usize = 64;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    /// Wallet that owns the protocol-fee USDC ATA. Not the ATA itself.
    pub treasury: Pubkey,
    pub fee_bps: u16,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum DropStatus {
    Draft,
    Live,
    Closed,
}

#[account]
#[derive(InitSpace)]
pub struct Drop {
    pub seed: u64,
    pub operator: Pubkey,
    pub bump: u8,
    pub created_at: i64,
    pub status: DropStatus,
    pub name: [u8; 32],
    pub image_url: [u8; 128],
    pub price_mint: Pubkey,
    pub price_amount: u64,
    pub token_program_price: Pubkey,
    #[max_len(64)]
    pub inventory: Vec<Pubkey>,
    pub pending: u16,
    pub total_sold: u32,
}

#[account]
#[derive(InitSpace)]
pub struct Card {
    pub drop: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    /// 0 common .. 4 chase. Display only in v1. The draw is uniform.
    pub tier: u8,
    /// Operator-stated value in price-mint base units. Display / EV only.
    pub fmv_usdc: u64,
    pub grader: [u8; 8],
    pub cert: [u8; 32],
    pub title: [u8; 64],
    pub image_url: [u8; 128],
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum PullStatus {
    Pending,
    Revealed,
}

#[account]
#[derive(InitSpace)]
pub struct Pull {
    pub drop: Pubkey,
    pub buyer: Pubkey,
    pub nonce: u64,
    pub randomness_account: Pubkey,
    pub commit_slot: u64,
    pub paid_amount: u64,
    pub status: PullStatus,
    pub won_mint: Pubkey,
    pub bump: u8,
}
