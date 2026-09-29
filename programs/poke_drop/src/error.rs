use anchor_lang::prelude::*;

#[error_code]
pub enum PokeError {
    #[msg("Mint is missing, has an unsupported token program, or uses a blocked Token-2022 extension.")]
    InvalidMint,
    #[msg("Card mint must be a 0-decimal token with amount 1.")]
    NotNft,
    #[msg("This drop already holds 64 cards.")]
    InventoryFull,
    #[msg("The drop has no cards left to draw.")]
    InventoryEmpty,
    #[msg("Every remaining card is already reserved by a pending pull.")]
    SoldOut,
    #[msg("Drop is not in Draft.")]
    DropNotDraft,
    #[msg("Drop is not Live.")]
    DropNotLive,
    #[msg("Drop is not Closed.")]
    DropNotClosed,
    #[msg("Pending pulls must be revealed or refunded first.")]
    PendingPulls,
    #[msg("Switchboard randomness is not fresh for this slot.")]
    RandomnessNotFresh,
    #[msg("Switchboard randomness has not been revealed for this pull.")]
    RandomnessNotRevealed,
    #[msg("This pull was already revealed.")]
    AlreadyRevealed,
    #[msg("Card account does not match the mint this pull won.")]
    WrongCard,
    #[msg("Reveal timeout has not been reached.")]
    TimeoutNotReached,
    #[msg("Signer is not allowed to perform this action.")]
    Unauthorized,
    #[msg("Arithmetic overflow.")]
    MathOverflow,
    #[msg("Name, URL, grader, or tier is invalid.")]
    InvalidInput,
}
