#!/usr/bin/env node
// quote.mjs — read-only Forge bonding-curve quote.
//
// Strategy: factory.getPair(tokenA, tokenB) → pair.getReserves() → constant-
// product math with assumed fee (DEFAULT_FEE_BPS = 30; override --fee-bps).
//
// The Forge implementation is NOT source-verified, so the exact swap fee is
// inferred. We always return BOTH a 0-bps (no-fee, upper bound) and the
// assumed-fee estimate so the caller can audit. buy/sell uses the assumed-fee
// number and applies user --slippage on top.

import 'dotenv/config';
import { ethers } from 'ethers';
import { emit } from './_envelope.mjs';
import {
  TOKEN_B, TOKEN_B_DECIMALS, DEFAULT_FEE_BPS,
  getProvider, getPairAddress, getReserves, computeAmountOut, pickReservesByPath,
  ERC20_ABI,
} from './_chain.mjs';
import { getRecentFeeBps } from './_forge_api.mjs';

const argv = process.argv.slice(2);
const sideArg = argv.find((a) => a === 'buy' || a === 'sell');
const tokenAddress = argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const positional = argv.filter((a) => !a.startsWith('--') && a !== sideArg && a !== tokenAddress);
const amountArg = positional[0];
const feeBpsArg = (argv.find((a) => a.startsWith('--fee-bps=')) || '').split('=')[1];
const feeBpsExplicit = feeBpsArg !== undefined && feeBpsArg !== '';

const parsedIntent = {
  command: 'quote',
  side: sideArg ?? null,
  tokenAddress: tokenAddress ?? null,
  amountHuman: amountArg ?? null,
};

async function main() {
  if (!sideArg || !tokenAddress || !amountArg) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: 'usage: quote.mjs <buy|sell> <0xTokenAddress> <amount> [--fee-bps=<bps>]', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  // Resolve fee: explicit --fee-bps wins; else auto-detect from recent_trades[0]; else DEFAULT.
  let feeBps, feeMeta = null;
  if (feeBpsExplicit) {
    feeBps = Number(feeBpsArg);
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) {
      emit({ ok: false, parsedIntent, error: 'bad_args', message: '--fee-bps must be 0..1000', missing: null, hint: null, signerWarn: null });
      process.exit(2);
    }
    feeMeta = { feeBps, source: 'override' };
  } else {
    feeMeta = await getRecentFeeBps(tokenAddress);
    feeBps = feeMeta.feeBps;
  }
  parsedIntent.feeBps = feeBps;
  parsedIntent.feeBpsSource = feeMeta.source;

  const provider = getProvider();
  const target = ethers.getAddress(tokenAddress);

  const tokenIn = sideArg === 'buy' ? TOKEN_B : target;
  const tokenOut = sideArg === 'buy' ? target : TOKEN_B;

  let amountInDecimals = TOKEN_B_DECIMALS;
  let amountOutDecimals = TOKEN_B_DECIMALS;
  if (sideArg === 'buy') {
    amountOutDecimals = Number(await new ethers.Contract(target, ERC20_ABI, provider).decimals());
  } else {
    amountInDecimals = Number(await new ethers.Contract(target, ERC20_ABI, provider).decimals());
  }
  const amountIn = ethers.parseUnits(amountArg, amountInDecimals);

  const pair = await getPairAddress(provider, tokenIn, tokenOut);
  const { reserve0, reserve1, blockTimestampLast } = await getReserves(provider, pair);
  const { reserveIn, reserveOut } = pickReservesByPath({ tokenIn, tokenOut, reserve0, reserve1 });

  const amountOutNoFee = computeAmountOut({ amountIn, reserveIn, reserveOut, feeBps: 0, side: sideArg });
  const amountOutWithFee = computeAmountOut({ amountIn, reserveIn, reserveOut, feeBps, side: sideArg });

  emit({
    ok: true,
    parsedIntent,
    pair,
    reserves: {
      reserve0: reserve0.toString(),
      reserve1: reserve1.toString(),
      blockTimestampLast,
    },
    reserveIn: reserveIn.toString(),
    reserveOut: reserveOut.toString(),
    amountIn: amountIn.toString(),
    amountInHuman: amountArg,
    amountInDecimals,
    amountOut: amountOutWithFee.toString(),
    amountOutHuman: ethers.formatUnits(amountOutWithFee, amountOutDecimals),
    amountOutNoFee: amountOutNoFee.toString(),
    amountOutNoFeeHuman: ethers.formatUnits(amountOutNoFee, amountOutDecimals),
    amountOutDecimals,
    feeBpsAssumed: feeBps,
    feeBpsSource: feeMeta.source,        // 'override' | 'recent_trade' | 'default'
    feeBpsBreakdown: feeMeta.breakdown ?? null,
    feeBpsSampleTx: feeMeta.sampleTxHash ?? null,
    feeBpsAgeSec: feeMeta.ageSec ?? null,
    feeBpsFallbackReason: feeMeta.reason ?? null,
    feeNote: 'amountOut uses feeBps (auto-detected from recent_trades[0] when --fee-bps not explicit). amountOutNoFee is the no-fee upper bound for audit.',
    signerWarn: null,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
