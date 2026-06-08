#!/usr/bin/env node
// token.mjs — single-token detail.
//
// Tries the Forge bonding-curve API first (gives full curve state + recent
// trades). Falls back to Blockscout v2 ERC-20 metadata if the Forge API
// returns 404 (i.e. the token wasn't deployed via Forge).

import 'dotenv/config';
import { emit } from './_envelope.mjs';
import { bsGet } from './_blockscout.mjs';
import { forgeGet } from './_forge_api.mjs';
import { TRADE_URL } from './_chain.mjs';

const argv = process.argv.slice(2);
const tokenAddress = argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const recentLimit = Number((argv.find((a) => a.startsWith('--recent-limit=')) || '--recent-limit=10').split('=')[1]);
const parsedIntent = { command: 'token', tokenAddress: tokenAddress ?? null, recentLimit };

async function main() {
  if (!tokenAddress) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: 'usage: token.mjs <0xTokenAddress> [--recent-limit=10]', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  let forge = null;
  try {
    const body = await forgeGet(`/tokens/${tokenAddress}`);
    forge = body?.data ?? null;
  } catch (err) {
    if (err.code !== 'not_found') throw err;
  }

  if (forge?.token) {
    const t = forge.token;
    const trades = (forge.recent_trades ?? []).slice(0, recentLimit).map((tr) => ({
      id: tr.id,
      side: tr.type,
      trader: tr.trader,
      amountIn: tr.amount_in,
      amountOut: tr.amount_out,
      price: tr.price,
      protocolFee: tr.protocol_fee,
      creatorFee: tr.creator_fee,
      referralFee: tr.referral_fee,
      timestamp: tr.timestamp,
      blockNumber: tr.block_number,
      txHash: tr.tx_hash,
    }));
    emit({
      ok: true,
      parsedIntent,
      source: 'bonding-curve-api',
      token: {
        address: t.address,
        name: t.name,
        symbol: t.symbol,
        creator: t.creator,
        pairAddress: t.pair_address,
        wrappedNative: t.wrapped_native,
        category: t.category,
        description: t.description ?? null,
        imageUrl: t.image_url ?? t.image ?? null,
        graduated: t.graduated,
        createdAt: t.created_at,
        currentPrice: t.current_price,
        marketCap: t.market_cap,
        totalSupply: t.total_supply,
        availableSupply: t.available_supply,
        volume24h: t.volume_24h,
        priceChange24h: t.price_change_24h,
        tradeCount24h: t.trade_count_24h,
      },
      bondingCurve: {
        virtualReserveB: forge.bonding_curve?.virtual_reserve_b ?? t.virtual_reserve_b,
        reserveA: forge.bonding_curve?.reserve_a ?? t.reserve_a,
        reserveB: forge.bonding_curve?.reserve_b ?? t.reserve_b,
      },
      recentTrades: trades,
      tradeLink: `${TRADE_URL}/${t.address}`,
      signerWarn: null,
    });
    return;
  }

  // Fallback: not a Forge token, but might still be a normal ERC-20 on chain.
  const data = await bsGet(`/api/v2/tokens/${tokenAddress}`);
  const resolvedAddr = data.address?.hash ?? data.address ?? tokenAddress;
  emit({
    ok: true,
    parsedIntent,
    source: 'blockscout',
    token: {
      address: resolvedAddr,
      name: data.name,
      symbol: data.symbol,
      decimals: data.decimals ? Number(data.decimals) : null,
      type: data.type,
      totalSupply: data.total_supply ?? null,
      holdersCount: data.holders_count ? Number(data.holders_count) : null,
      iconUrl: data.icon_url ?? null,
      reputation: data.reputation ?? null,
    },
    bondingCurve: null,
    recentTrades: [],
    tradeLink: `${TRADE_URL}/${resolvedAddr}`,
    note: 'Token not found in Forge bonding-curve registry — returning Blockscout ERC-20 metadata only.',
    signerWarn: null,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
