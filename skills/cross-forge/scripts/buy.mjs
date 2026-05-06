#!/usr/bin/env node
// buy.mjs — buy a Forge token by sending native CROSS to the Router.
// Selector 0xc075a591 (recovered from on-chain calldata; see references/forge.md §4).
//
// Flow:
//   1. Validate args (--confirm gate, slippage default 300 bps).
//   2. Load PK, build signer, run guards (chain id, gas floor, notional cap).
//   3. Fresh quote via quote.mjs logic (eth_call on Router) → amountOut.
//   4. Compute amountOutMin = amountOut * (10000 - slippageBps) / 10000.
//   5. Build calldata = SEL_BUY + abi.encode(amountOutMin, [TOKEN_B, target], to, deadline).
//   6. Sign + send tx with msg.value = amountIn (native).
//   7. Wait receipt, emit { ok, txHash, amountIn, amountOut, amountOutMin, ... }.

import 'dotenv/config';
import { ethers } from 'ethers';
import { emit } from './_envelope.mjs';
import { loadSigner } from './_signer.mjs';
import { guardChain, guardGasFloor, guardNotional } from './_guard.mjs';
import {
  ROUTER, TOKEN_B, TOKEN_B_DECIMALS, TRADE_URL, DEFAULT_FEE_BPS,
  getProvider, encodeBuyData, getPairAddress, getReserves, computeAmountOut, pickReservesByPath,
  ERC20_ABI,
} from './_chain.mjs';
import { getRecentFeeBps } from './_forge_api.mjs';

const argv = process.argv.slice(2);
const tokenAddress = argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const positional = argv.filter((a) => !a.startsWith('--') && a !== tokenAddress);
const amountInArg = positional[0];
const slippageBps = Number((argv.find((a) => a.startsWith('--slippage=')) || '--slippage=300').split('=')[1]);
const feeBpsArg = (argv.find((a) => a.startsWith('--fee-bps=')) || '').split('=')[1];
const feeBpsExplicit = feeBpsArg !== undefined && feeBpsArg !== '';
const confirmFlag = argv.includes('--confirm');

const parsedIntent = {
  command: 'buy',
  tokenAddress: tokenAddress ?? null,
  amountInTokenBHuman: amountInArg ?? null,
  slippageBps,
  confirm: confirmFlag,
};

async function main() {
  if (!tokenAddress || !amountInArg) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: 'usage: buy.mjs <0xTokenAddress> <amountInTokenB> [--slippage=<bps>] [--confirm]', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 5000) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--slippage must be 0..5000 bps', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  const provider = getProvider();
  await guardChain(provider);

  const { wallet, address: from, signerWarn } = loadSigner();
  await guardGasFloor(provider, from);
  guardNotional({ amountTokenBHuman: amountInArg, confirmFlag });

  const target = ethers.getAddress(tokenAddress);
  const amountIn = ethers.parseUnits(amountInArg, TOKEN_B_DECIMALS);

  // Resolve fee: --fee-bps wins; else auto-detect; else DEFAULT (130).
  let feeBps, feeMeta = null;
  if (feeBpsExplicit) {
    feeBps = Number(feeBpsArg);
    if (!Number.isFinite(feeBps) || feeBps < 0 || feeBps > 1000) {
      const err = new Error('--fee-bps must be 0..1000');
      err.code = 'bad_args'; err.exitCode = 2; throw err;
    }
    feeMeta = { feeBps, source: 'override' };
  } else {
    feeMeta = await getRecentFeeBps(target);
    feeBps = feeMeta.feeBps;
  }
  parsedIntent.feeBps = feeBps;
  parsedIntent.feeBpsSource = feeMeta.source;

  // Fresh quote via factory + pair reserves (Router itself does not expose
  // getAmountsOut; see references/forge.md §4).
  const pair = await getPairAddress(provider, TOKEN_B, target);
  const { reserve0, reserve1 } = await getReserves(provider, pair);
  const { reserveIn, reserveOut } = pickReservesByPath({ tokenIn: TOKEN_B, tokenOut: target, reserve0, reserve1 });
  const amountOut = computeAmountOut({ amountIn, reserveIn, reserveOut, feeBps, side: 'buy' });
  if (amountOut === 0n) {
    const err = new Error(`computed amountOut is zero (reserveIn=${reserveIn}, reserveOut=${reserveOut}). Pair has no liquidity?`);
    err.code = 'no_liquidity';
    err.exitCode = 2;
    throw err;
  }

  const targetDecimals = Number(await new ethers.Contract(target, ERC20_ABI, provider).decimals());
  const amountOutMin = amountOut * BigInt(10000 - slippageBps) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const data = encodeBuyData(amountOutMin, target, from, deadline);

  const fee = await provider.getFeeData();
  const txReq = {
    to: ROUTER,
    data,
    value: amountIn,
    type: 2,
    maxFeePerGas: fee.maxFeePerGas ?? ethers.parseUnits('100', 'gwei'),
    maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? ethers.parseUnits('1', 'gwei'),
  };
  const gasEstimate = await provider.estimateGas({ ...txReq, from });
  txReq.gasLimit = gasEstimate * 120n / 100n;

  const tx = await wallet.sendTransaction(txReq);
  const receipt = await tx.wait();
  const success = receipt.status === 1;

  emit({
    ok: success,
    parsedIntent,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    amountIn: amountIn.toString(),
    amountInHuman: amountInArg,
    amountOut: amountOut.toString(),
    amountOutHuman: ethers.formatUnits(amountOut, targetDecimals),
    amountOutMin: amountOutMin.toString(),
    amountOutMinHuman: ethers.formatUnits(amountOutMin, targetDecimals),
    targetDecimals,
    feeBpsApplied: feeBps,
    feeBpsSource: feeMeta.source,
    feeBpsBreakdown: feeMeta.breakdown ?? null,
    feeBpsSampleTx: feeMeta.sampleTxHash ?? null,
    feeBpsAgeSec: feeMeta.ageSec ?? null,
    feeBpsFallbackReason: feeMeta.reason ?? null,
    tradeLink: `${TRADE_URL}/${tokenAddress}`,
    explorer: `${process.env.MAINNET_BASE_URL || 'https://www.crossscan.io'}/tx/${tx.hash}`,
    signerWarn,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
