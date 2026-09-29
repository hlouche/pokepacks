use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFeeConfig;
use anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::TransferHook;
use anchor_spl::token_interface::get_mint_extension_data;

use crate::error::PokeError;

pub fn fit_bytes<const N: usize>(src: &[u8]) -> Result<[u8; N]> {
    require!(src.len() <= N, PokeError::InvalidInput);
    let mut out = [0u8; N];
    out[..src.len()].copy_from_slice(src);
    Ok(out)
}

fn significant(src: &[u8]) -> &[u8] {
    match src.iter().rposition(|b| *b != 0) {
        Some(i) => &src[..=i],
        None => &[],
    }
}

pub fn pack_text<const N: usize>(src: &[u8], required: bool) -> Result<[u8; N]> {
    let shown = significant(src);
    if required {
        require!(!shown.is_empty(), PokeError::InvalidInput);
    }
    fit_bytes(src)
}

pub fn pack_grader(src: &[u8]) -> Result<[u8; 8]> {
    let shown = significant(src);
    const ALLOWED: [&[u8]; 6] = [b"PSA", b"BGS", b"SGC", b"CGC", b"RAW", b"OTHER"];
    require!(ALLOWED.contains(&shown), PokeError::InvalidInput);
    fit_bytes(src)
}

/// Token-2022 extensions this program refuses.
///
/// Blocked (they change transfer accounts or amounts, so a plain
/// `transfer_checked` is not safe):
/// - Transfer fee (`TransferFeeConfig`)
/// - Transfer hook (`TransferHook`)
///
/// Also unsupported, and untested — do not deposit these mints:
/// permanent delegate, non-transferable, memo transfer, confidential
/// transfers, default account state = frozen, and transfer-fee-like
/// withholding. Metadata pointer and group pointer are fine.
pub fn assert_supported_mint(mint_info: &AccountInfo) -> Result<()> {
    if mint_info.owner == &anchor_spl::token::ID {
        return Ok(());
    }
    require!(
        mint_info.owner == &anchor_spl::token_2022::ID,
        PokeError::InvalidMint
    );
    if get_mint_extension_data::<TransferFeeConfig>(mint_info).is_ok()
        || get_mint_extension_data::<TransferHook>(mint_info).is_ok()
    {
        return err!(PokeError::InvalidMint);
    }
    Ok(())
}

pub fn fee_split(amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(error!(PokeError::MathOverflow))?
        .checked_div(10_000)
        .ok_or(error!(PokeError::MathOverflow))?;
    let fee = u64::try_from(fee).map_err(|_| error!(PokeError::MathOverflow))?;
    let rest = amount
        .checked_sub(fee)
        .ok_or(error!(PokeError::MathOverflow))?;
    Ok((fee, rest))
}
