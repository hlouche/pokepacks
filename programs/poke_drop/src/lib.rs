pub mod error;
pub mod state;
pub mod util;

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked},
};

use error::PokeError;
pub use state::*;

use util::{assert_supported_mint, fee_split, pack_grader, pack_text};

declare_id!("3hQgfmcBJbdvz2Gdab57SHuGAoCT9ST1QNyvFvyxqMHx");

/// Deploy guard. `scripts/deploy-devnet.sh` sets `POKEPACKS_DEPLOY=1` while
/// building. A mock-randomness binary accepts caller-supplied bytes and must
/// never be deployed. See README.
#[cfg(all(feature = "mock-randomness", poke_deploy))]
compile_error!(
    "mock-randomness is enabled and POKEPACKS_DEPLOY=1. Refusing to compile a deployable binary. Run `anchor build` with no extra features before `anchor deploy`."
);

#[cfg(feature = "mock-randomness")]
const MOCK_MARKER: &str = "MOCK_RANDOMNESS_ENABLED_DO_NOT_DEPLOY";

#[program]
pub mod poke_drop {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        fee_bps: u16,
        treasury: Pubkey,
    ) -> Result<()> {
        require!(fee_bps <= 1000, PokeError::InvalidInput);
        require!(treasury != Pubkey::default(), PokeError::InvalidInput);
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.treasury = treasury;
        config.fee_bps = fee_bps;
        config.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn create_drop(
        ctx: Context<CreateDrop>,
        seed: u64,
        name: Vec<u8>,
        image_url: Vec<u8>,
        price_amount: u64,
    ) -> Result<()> {
        require!(price_amount > 0, PokeError::InvalidInput);
        assert_supported_mint(&ctx.accounts.price_mint.to_account_info())?;
        let drop_account = &mut ctx.accounts.drop_account;
        drop_account.seed = seed;
        drop_account.operator = ctx.accounts.operator.key();
        drop_account.bump = ctx.bumps.drop_account;
        drop_account.created_at = Clock::get()?.unix_timestamp;
        drop_account.status = DropStatus::Draft;
        drop_account.name = pack_text(&name, true)?;
        drop_account.image_url = pack_text(&image_url, false)?;
        drop_account.price_mint = ctx.accounts.price_mint.key();
        drop_account.price_amount = price_amount;
        drop_account.token_program_price = ctx.accounts.price_token_program.key();
        drop_account.inventory = Vec::new();
        drop_account.pending = 0;
        drop_account.total_sold = 0;
        Ok(())
    }

    pub fn add_card(
        ctx: Context<AddCard>,
        tier: u8,
        fmv_usdc: u64,
        grader: Vec<u8>,
        cert: Vec<u8>,
        title: Vec<u8>,
        image_url: Vec<u8>,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.drop_account.operator,
            ctx.accounts.operator.key(),
            PokeError::Unauthorized
        );
        require!(
            ctx.accounts.drop_account.status == DropStatus::Draft,
            PokeError::DropNotDraft
        );
        require!(tier <= 4, PokeError::InvalidInput);
        require!(
            ctx.accounts.drop_account.inventory.len() < MAX_INVENTORY,
            PokeError::InventoryFull
        );
        require!(ctx.accounts.mint.decimals == 0, PokeError::NotNft);
        assert_supported_mint(&ctx.accounts.mint.to_account_info())?;

        let mint_key = ctx.accounts.mint.key();
        require!(
            !ctx.accounts
                .drop_account
                .inventory
                .iter()
                .any(|m| *m == mint_key),
            PokeError::InvalidMint
        );

        move_tokens(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.operator_token.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.operator.to_account_info(),
            &[],
            1,
            0,
        )?;

        let card = &mut ctx.accounts.card;
        card.drop = ctx.accounts.drop_account.key();
        card.mint = mint_key;
        card.token_program = ctx.accounts.token_program.key();
        card.tier = tier;
        card.fmv_usdc = fmv_usdc;
        card.grader = pack_grader(&grader)?;
        card.cert = pack_text(&cert, false)?;
        card.title = pack_text(&title, true)?;
        card.image_url = pack_text(&image_url, false)?;
        card.bump = ctx.bumps.card;

        ctx.accounts.drop_account.inventory.push(mint_key);
        Ok(())
    }

    pub fn remove_card(ctx: Context<RemoveCard>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.drop_account.operator,
            ctx.accounts.operator.key(),
            PokeError::Unauthorized
        );
        require!(
            ctx.accounts.drop_account.status == DropStatus::Draft,
            PokeError::DropNotDraft
        );
        let mint_key = ctx.accounts.mint.key();
        let pos = ctx
            .accounts
            .drop_account
            .inventory
            .iter()
            .position(|m| *m == mint_key)
            .ok_or(error!(PokeError::WrongCard))?;
        ctx.accounts.drop_account.inventory.swap_remove(pos);

        let bump = ctx.accounts.drop_account.bump;
        let seed_le = ctx.accounts.drop_account.seed.to_le_bytes();
        let seeds: [&[u8]; 4] = [
            b"drop",
            ctx.accounts.drop_account.operator.as_ref(),
            seed_le.as_ref(),
            &[bump],
        ];
        let signer = &[seeds.as_slice()];

        move_tokens(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.operator_token.to_account_info(),
            ctx.accounts.drop_account.to_account_info(),
            signer,
            1,
            0,
        )?;
        close_token_account(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.operator.to_account_info(),
            ctx.accounts.drop_account.to_account_info(),
            signer,
        )?;
        Ok(())
    }

    pub fn go_live(ctx: Context<OperatorDrop>) -> Result<()> {
        let drop_account = &mut ctx.accounts.drop_account;
        require_keys_eq!(
            drop_account.operator,
            ctx.accounts.operator.key(),
            PokeError::Unauthorized
        );
        require!(drop_account.status == DropStatus::Draft, PokeError::DropNotDraft);
        require!(!drop_account.inventory.is_empty(), PokeError::InventoryEmpty);
        drop_account.status = DropStatus::Live;
        Ok(())
    }

    pub fn buy_pack(ctx: Context<BuyPack>, nonce: u64) -> Result<()> {
        let clock = Clock::get()?;
        let drop_account = &mut ctx.accounts.drop_account;
        require!(drop_account.status == DropStatus::Live, PokeError::DropNotLive);
        require!(
            drop_account.inventory.len() > drop_account.pending as usize,
            PokeError::SoldOut
        );
        require_keys_eq!(
            ctx.accounts.price_mint.key(),
            drop_account.price_mint,
            PokeError::InvalidMint
        );
        require_keys_eq!(
            ctx.accounts.price_token_program.key(),
            drop_account.token_program_price,
            PokeError::InvalidMint
        );

        let randomness_key = ctx.accounts.randomness_account_data.key();
        require!(
            randomness_key != Pubkey::default(),
            PokeError::RandomnessNotFresh
        );

        let commit_slot = read_commit_slot(
            &ctx.accounts.randomness_account_data.to_account_info(),
            randomness_key,
            clock.slot,
        )?;

        let price_amount = drop_account.price_amount;
        let price_decimals = ctx.accounts.price_mint.decimals;
        move_tokens(
            ctx.accounts.price_token_program.to_account_info(),
            ctx.accounts.buyer_usdc.to_account_info(),
            ctx.accounts.price_mint.to_account_info(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.buyer.to_account_info(),
            &[],
            price_amount,
            price_decimals,
        )?;

        let pull = &mut ctx.accounts.pull;
        pull.drop = drop_account.key();
        pull.buyer = ctx.accounts.buyer.key();
        pull.nonce = nonce;
        pull.randomness_account = randomness_key;
        pull.commit_slot = commit_slot;
        pull.paid_amount = drop_account.price_amount;
        pull.status = PullStatus::Pending;
        pull.won_mint = Pubkey::default();
        pull.bump = ctx.bumps.pull;

        drop_account.pending = drop_account
            .pending
            .checked_add(1)
            .ok_or(error!(PokeError::MathOverflow))?;
        Ok(())
    }

    #[cfg(feature = "mock-randomness")]
    pub fn reveal_pack(ctx: Context<RevealPack>, mock_random: [u8; 32]) -> Result<()> {
        let _ = MOCK_MARKER;
        msg!("MOCK_RANDOMNESS_ENABLED_DO_NOT_DEPLOY");
        settle_reveal(ctx, mock_random)
    }

    #[cfg(not(feature = "mock-randomness"))]
    pub fn reveal_pack(ctx: Context<RevealPack>) -> Result<()> {
        let clock = Clock::get()?;
        let commit_slot = ctx.accounts.pull.commit_slot;
        let expected = ctx.accounts.pull.randomness_account;
        require_keys_eq!(
            ctx.accounts.randomness_account_data.key(),
            expected,
            PokeError::RandomnessNotFresh
        );
        // Copy the bytes out before settle_reveal mutably borrows the pull.
        // get_value requires reveal_slot == clock.slot, so revealIx and
        // reveal_pack have to land in the same transaction.
        let value = {
            let data = switchboard_on_demand::RandomnessAccountData::parse(
                ctx.accounts.randomness_account_data.data.borrow(),
            )
            .map_err(|_| error!(PokeError::RandomnessNotFresh))?;
            require!(data.seed_slot == commit_slot, PokeError::RandomnessNotFresh);
            let value = data
                .get_value(clock.slot)
                .map_err(|_| error!(PokeError::RandomnessNotRevealed))?;
            require!(
                data.reveal_slot > commit_slot,
                PokeError::RandomnessNotRevealed
            );
            value
        };
        settle_reveal(ctx, value)
    }

    pub fn claim_pull(ctx: Context<ClaimPull>) -> Result<()> {
        require!(
            ctx.accounts.pull.status == PullStatus::Revealed,
            PokeError::RandomnessNotRevealed
        );
        require_keys_eq!(
            ctx.accounts.card.mint,
            ctx.accounts.pull.won_mint,
            PokeError::WrongCard
        );
        require_keys_eq!(
            ctx.accounts.mint.key(),
            ctx.accounts.pull.won_mint,
            PokeError::WrongCard
        );
        require!(ctx.accounts.vault.amount == 1, PokeError::NotNft);
        require_keys_eq!(
            ctx.accounts.price_mint.key(),
            ctx.accounts.drop_account.price_mint,
            PokeError::InvalidMint
        );
        require!(
            ctx.accounts.config.treasury != Pubkey::default(),
            PokeError::Unauthorized
        );

        let (fee, rest) = fee_split(ctx.accounts.pull.paid_amount, ctx.accounts.config.fee_bps)?;
        let decimals = ctx.accounts.price_mint.decimals;
        let bump = ctx.accounts.drop_account.bump;
        let seed_le = ctx.accounts.drop_account.seed.to_le_bytes();
        let seeds: [&[u8]; 4] = [
            b"drop",
            ctx.accounts.drop_account.operator.as_ref(),
            seed_le.as_ref(),
            &[bump],
        ];
        let signer = &[seeds.as_slice()];

        send_card(ctx.accounts.token_program.to_account_info(), &ctx.accounts, signer)?;
        close_card_vault(ctx.accounts.token_program.to_account_info(), &ctx.accounts, signer)?;
        pay_usdc(
            ctx.accounts.price_token_program.to_account_info(),
            &ctx.accounts,
            signer,
            fee,
            ctx.accounts.treasury_usdc.to_account_info(),
            decimals,
        )?;
        pay_usdc(
            ctx.accounts.price_token_program.to_account_info(),
            &ctx.accounts,
            signer,
            rest,
            ctx.accounts.operator_usdc.to_account_info(),
            decimals,
        )?;

        ctx.accounts.drop_account.total_sold = ctx
            .accounts
            .drop_account
            .total_sold
            .checked_add(1)
            .ok_or(error!(PokeError::MathOverflow))?;
        msg!("WON_MINT: {}", ctx.accounts.pull.won_mint);
        Ok(())
    }

    pub fn refund_pull(ctx: Context<RefundPull>) -> Result<()> {
        require!(
            ctx.accounts.pull.status == PullStatus::Pending,
            PokeError::AlreadyRevealed
        );
        let clock = Clock::get()?;
        let deadline = ctx
            .accounts
            .pull
            .commit_slot
            .checked_add(REVEAL_TIMEOUT_SLOTS)
            .ok_or(error!(PokeError::MathOverflow))?;
        require!(clock.slot > deadline, PokeError::TimeoutNotReached);
        require_keys_eq!(
            ctx.accounts.price_mint.key(),
            ctx.accounts.drop_account.price_mint,
            PokeError::InvalidMint
        );

        let amount = ctx.accounts.pull.paid_amount;
        let decimals = ctx.accounts.price_mint.decimals;
        let bump = ctx.accounts.drop_account.bump;
        let seed_le = ctx.accounts.drop_account.seed.to_le_bytes();
        let seeds: [&[u8]; 4] = [
            b"drop",
            ctx.accounts.drop_account.operator.as_ref(),
            seed_le.as_ref(),
            &[bump],
        ];
        let signer = &[seeds.as_slice()];

        move_tokens(
            ctx.accounts.price_token_program.to_account_info(),
            ctx.accounts.usdc_vault.to_account_info(),
            ctx.accounts.price_mint.to_account_info(),
            ctx.accounts.buyer_usdc.to_account_info(),
            ctx.accounts.drop_account.to_account_info(),
            signer,
            amount,
            decimals,
        )?;

        ctx.accounts.drop_account.pending = ctx
            .accounts
            .drop_account
            .pending
            .checked_sub(1)
            .ok_or(error!(PokeError::MathOverflow))?;
        Ok(())
    }

    pub fn close_drop(ctx: Context<CloseDrop>) -> Result<()> {
        let drop_account = &mut ctx.accounts.drop_account;
        require_keys_eq!(
            drop_account.operator,
            ctx.accounts.operator.key(),
            PokeError::Unauthorized
        );
        require!(drop_account.pending == 0, PokeError::PendingPulls);
        require!(drop_account.status != DropStatus::Closed, PokeError::Unauthorized);
        drop_account.status = DropStatus::Closed;

        if ctx.accounts.usdc_vault.amount == 0 {
            let bump = drop_account.bump;
            let seed_le = drop_account.seed.to_le_bytes();
            let seeds: [&[u8]; 4] = [
                b"drop",
                drop_account.operator.as_ref(),
                seed_le.as_ref(),
                &[bump],
            ];
            let signer = &[seeds.as_slice()];
            token_interface::close_account(CpiContext::new_with_signer(
                ctx.accounts.price_token_program.to_account_info(),
                CloseAccount {
                    account: ctx.accounts.usdc_vault.to_account_info(),
                    destination: ctx.accounts.operator.to_account_info(),
                    authority: drop_account.to_account_info(),
                },
                signer,
            ))?;
        }
        Ok(())
    }

    /// One unsold card per call, after the drop is Closed.
    /// Cards removed from inventory at reveal time are not withdrawable;
    /// the buyer still claims those. Draft boxes use `remove_card` instead.
    pub fn withdraw_unsold(ctx: Context<WithdrawUnsold>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.drop_account.operator,
            ctx.accounts.operator.key(),
            PokeError::Unauthorized
        );
        require!(
            ctx.accounts.drop_account.status == DropStatus::Closed,
            PokeError::DropNotClosed
        );
        let mint_key = ctx.accounts.mint.key();
        let pos = ctx
            .accounts
            .drop_account
            .inventory
            .iter()
            .position(|m| *m == mint_key)
            .ok_or(error!(PokeError::WrongCard))?;
        ctx.accounts.drop_account.inventory.swap_remove(pos);

        let bump = ctx.accounts.drop_account.bump;
        let seed_le = ctx.accounts.drop_account.seed.to_le_bytes();
        let seeds: [&[u8]; 4] = [
            b"drop",
            ctx.accounts.drop_account.operator.as_ref(),
            seed_le.as_ref(),
            &[bump],
        ];
        let signer = &[seeds.as_slice()];

        move_tokens(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.operator_token.to_account_info(),
            ctx.accounts.drop_account.to_account_info(),
            signer,
            1,
            0,
        )?;
        close_token_account(
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.vault.to_account_info(),
            ctx.accounts.operator.to_account_info(),
            ctx.accounts.drop_account.to_account_info(),
            signer,
        )?;
        Ok(())
    }
}

#[inline(never)]
fn move_tokens<'info>(
    token_program: AccountInfo<'info>,
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer: &[&[&[u8]]],
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
            signer,
        ),
        amount,
        decimals,
    )
}

#[inline(never)]
fn close_token_account<'info>(
    token_program: AccountInfo<'info>,
    account: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token_interface::close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account,
            destination,
            authority,
        },
        signer,
    ))
}

#[inline(never)]
fn send_card<'info>(
    token_program: AccountInfo<'info>,
    ctx: &ClaimPull<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: ctx.vault.to_account_info(),
                mint: ctx.mint.to_account_info(),
                to: ctx.buyer_ata.to_account_info(),
                authority: ctx.drop_account.to_account_info(),
            },
            signer,
        ),
        1,
        0,
    )
}

#[inline(never)]
fn close_card_vault<'info>(
    token_program: AccountInfo<'info>,
    ctx: &ClaimPull<'info>,
    signer: &[&[&[u8]]],
) -> Result<()> {
    token_interface::close_account(CpiContext::new_with_signer(
        token_program,
        CloseAccount {
            account: ctx.vault.to_account_info(),
            destination: ctx.operator.to_account_info(),
            authority: ctx.drop_account.to_account_info(),
        },
        signer,
    ))
}

#[inline(never)]
fn pay_usdc<'info>(
    token_program: AccountInfo<'info>,
    ctx: &ClaimPull<'info>,
    signer: &[&[&[u8]]],
    amount: u64,
    to: AccountInfo<'info>,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program,
            TransferChecked {
                from: ctx.usdc_vault.to_account_info(),
                mint: ctx.price_mint.to_account_info(),
                to,
                authority: ctx.drop_account.to_account_info(),
            },
            signer,
        ),
        amount,
        decimals,
    )
}

fn settle_reveal(ctx: Context<RevealPack>, value: [u8; 32]) -> Result<()> {
    require!(
        ctx.accounts.pull.status == PullStatus::Pending,
        PokeError::AlreadyRevealed
    );
    require_keys_eq!(
        ctx.accounts.pull.drop,
        ctx.accounts.drop_account.key(),
        PokeError::WrongCard
    );
    let len = ctx.accounts.drop_account.inventory.len();
    require!(len > 0, PokeError::InventoryEmpty);
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&value[..8]);
    let index = (u64::from_le_bytes(buf) % (len as u64)) as usize;
    let won = ctx.accounts.drop_account.inventory.swap_remove(index);
    ctx.accounts.pull.won_mint = won;
    ctx.accounts.pull.status = PullStatus::Revealed;
    ctx.accounts.drop_account.pending = ctx
        .accounts
        .drop_account
        .pending
        .checked_sub(1)
        .ok_or(error!(PokeError::MathOverflow))?;
    msg!("WON_MINT: {}", won);
    Ok(())
}

#[cfg(feature = "mock-randomness")]
fn read_commit_slot(
    _randomness: &AccountInfo,
    _expected: Pubkey,
    clock_slot: u64,
) -> Result<u64> {
    // Local validator has no Switchboard oracle. The mock build records the
    // current slot and lets reveal_pack consume caller-supplied bytes.
    Ok(clock_slot)
}

#[cfg(not(feature = "mock-randomness"))]
fn read_commit_slot(randomness: &AccountInfo, expected: Pubkey, clock_slot: u64) -> Result<u64> {
    require_keys_eq!(randomness.key(), expected, PokeError::RandomnessNotFresh);
    let data = switchboard_on_demand::RandomnessAccountData::parse(randomness.data.borrow())
        .map_err(|_| error!(PokeError::RandomnessNotFresh))?;
    let prev_slot = clock_slot
        .checked_sub(1)
        .ok_or(error!(PokeError::RandomnessNotFresh))?;
    // seed_slot must be the previous slot, so commitIx and buy_pack share a tx.
    require!(data.seed_slot == prev_slot, PokeError::RandomnessNotFresh);
    require!(
        data.get_value(clock_slot).is_err(),
        PokeError::AlreadyRevealed
    );
    Ok(data.seed_slot)
}

#[derive(Accounts)]
#[instruction(fee_bps: u16, treasury: Pubkey)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = Config::DISCRIMINATOR.len() + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(seed: u64)]
pub struct CreateDrop<'info> {
    #[account(
        init,
        payer = operator,
        space = Drop::DISCRIMINATOR.len() + Drop::INIT_SPACE,
        seeds = [b"drop", operator.key().as_ref(), &seed.to_le_bytes()],
        bump
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(mut)]
    pub operator: Signer<'info>,
    pub price_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = operator,
        associated_token::mint = price_mint,
        associated_token::authority = drop_account,
        associated_token::token_program = price_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    pub price_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddCard<'info> {
    #[account(
        mut,
        has_one = operator @ PokeError::Unauthorized,
        seeds = [b"drop", operator.key().as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        init,
        payer = operator,
        space = Card::DISCRIMINATOR.len() + Card::INIT_SPACE,
        seeds = [b"card", drop_account.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub card: Account<'info, Card>,
    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = operator,
        token::token_program = token_program,
    )]
    pub operator_token: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = drop_account,
        associated_token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveCard<'info> {
    #[account(
        mut,
        has_one = operator @ PokeError::Unauthorized,
        seeds = [b"drop", operator.key().as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Box<Account<'info, Drop>>,
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        mut,
        close = operator,
        seeds = [b"card", drop_account.key().as_ref(), mint.key().as_ref()],
        bump = card.bump,
        constraint = card.drop == drop_account.key() @ PokeError::WrongCard,
        constraint = card.mint == mint.key() @ PokeError::WrongCard,
    )]
    pub card: Box<Account<'info, Card>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = operator,
        token::token_program = token_program,
    )]
    pub operator_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop_account,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OperatorDrop<'info> {
    #[account(
        mut,
        has_one = operator @ PokeError::Unauthorized,
        seeds = [b"drop", operator.key().as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct BuyPack<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"drop", drop_account.operator.as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(
        init,
        payer = buyer,
        space = Pull::DISCRIMINATOR.len() + Pull::INIT_SPACE,
        seeds = [b"pull", drop_account.key().as_ref(), buyer.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub pull: Account<'info, Pull>,
    /// CHECK: Switchboard RandomnessAccountData. Parsed in read_commit_slot.
    /// Under mock-randomness the account is recorded and not parsed.
    pub randomness_account_data: UncheckedAccount<'info>,
    #[account(mint::token_program = price_token_program)]
    pub price_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = buyer,
        associated_token::token_program = price_token_program,
    )]
    pub buyer_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = drop_account,
        associated_token::token_program = price_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    pub price_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevealPack<'info> {
    #[account(
        mut,
        seeds = [b"drop", drop_account.operator.as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(
        mut,
        seeds = [b"pull", drop_account.key().as_ref(), pull.buyer.as_ref(), &pull.nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.drop == drop_account.key() @ PokeError::WrongCard,
    )]
    pub pull: Account<'info, Pull>,
    /// CHECK: same Switchboard randomness account stored on the pull.
    pub randomness_account_data: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct ClaimPull<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: wallet that owns the protocol fee ATA. Key must match config.treasury.
    #[account(address = config.treasury @ PokeError::Unauthorized)]
    pub treasury: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"drop", drop_account.operator.as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Box<Account<'info, Drop>>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"pull", drop_account.key().as_ref(), pull.buyer.as_ref(), &pull.nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.drop == drop_account.key() @ PokeError::WrongCard,
    )]
    pub pull: Box<Account<'info, Pull>>,
    /// CHECK: pull rent goes back to the buyer. Checked against pull.buyer.
    #[account(mut, address = pull.buyer @ PokeError::Unauthorized)]
    pub buyer: UncheckedAccount<'info>,
    /// CHECK: card and vault rent go back to the operator.
    #[account(mut, address = drop_account.operator @ PokeError::Unauthorized)]
    pub operator: UncheckedAccount<'info>,
    #[account(
        mut,
        close = operator,
        seeds = [b"card", drop_account.key().as_ref(), pull.won_mint.as_ref()],
        bump = card.bump,
        constraint = card.mint == pull.won_mint @ PokeError::WrongCard,
        constraint = card.drop == drop_account.key() @ PokeError::WrongCard,
    )]
    pub card: Box<Account<'info, Card>>,
    #[account(
        mint::token_program = token_program,
        constraint = mint.key() == pull.won_mint @ PokeError::WrongCard,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop_account,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = mint,
        associated_token::authority = buyer,
        associated_token::token_program = token_program,
    )]
    pub buyer_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mint::token_program = price_token_program,
        constraint = price_mint.key() == drop_account.price_mint @ PokeError::InvalidMint,
    )]
    pub price_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = drop_account,
        associated_token::token_program = price_token_program,
    )]
    pub usdc_vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = price_mint,
        associated_token::authority = operator,
        associated_token::token_program = price_token_program,
    )]
    pub operator_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = caller,
        associated_token::mint = price_mint,
        associated_token::authority = treasury,
        associated_token::token_program = price_token_program,
    )]
    pub treasury_usdc: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub price_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundPull<'info> {
    #[account(
        mut,
        seeds = [b"drop", drop_account.operator.as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(
        mut,
        close = buyer,
        seeds = [b"pull", drop_account.key().as_ref(), buyer.key().as_ref(), &pull.nonce.to_le_bytes()],
        bump = pull.bump,
        constraint = pull.drop == drop_account.key() @ PokeError::WrongCard,
        constraint = pull.buyer == buyer.key() @ PokeError::Unauthorized,
    )]
    pub pull: Account<'info, Pull>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mint::token_program = price_token_program)]
    pub price_mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = drop_account,
        associated_token::token_program = price_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = buyer,
        associated_token::token_program = price_token_program,
    )]
    pub buyer_usdc: InterfaceAccount<'info, TokenAccount>,
    pub price_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct CloseDrop<'info> {
    #[account(
        mut,
        has_one = operator @ PokeError::Unauthorized,
        seeds = [b"drop", operator.key().as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Account<'info, Drop>,
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        mut,
        associated_token::mint = price_mint,
        associated_token::authority = drop_account,
        associated_token::token_program = price_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,
    #[account(
        mint::token_program = price_token_program,
        constraint = price_mint.key() == drop_account.price_mint @ PokeError::InvalidMint,
    )]
    pub price_mint: InterfaceAccount<'info, Mint>,
    pub price_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct WithdrawUnsold<'info> {
    #[account(
        mut,
        has_one = operator @ PokeError::Unauthorized,
        seeds = [b"drop", operator.key().as_ref(), &drop_account.seed.to_le_bytes()],
        bump = drop_account.bump,
    )]
    pub drop_account: Box<Account<'info, Drop>>,
    #[account(mut)]
    pub operator: Signer<'info>,
    #[account(
        mut,
        close = operator,
        seeds = [b"card", drop_account.key().as_ref(), mint.key().as_ref()],
        bump = card.bump,
        constraint = card.drop == drop_account.key() @ PokeError::WrongCard,
        constraint = card.mint == mint.key() @ PokeError::WrongCard,
    )]
    pub card: Box<Account<'info, Card>>,
    #[account(mint::token_program = token_program)]
    pub mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = operator,
        associated_token::mint = mint,
        associated_token::authority = operator,
        associated_token::token_program = token_program,
    )]
    pub operator_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = drop_account,
        associated_token::token_program = token_program,
    )]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}
