#!/usr/bin/env node
// sell.mjs — sell a Forge token back to native CROSS via the Router.
// Selector 0x029e384f (recovered from on-chain calldata; see references/forge.md §4).
//
// Flow:
//   1. Validate args (--slippage default 300 bps; --confirm gate; --max-approve opt-in).
//   2. Load PK, build signer, run guards (chain id, gas floor; notional cap is
//      against the *expected* TOKEN_B output once quoted).
//   3. Fresh quote via Router eth_call → amountOut (TOKEN_B units).
//   4. Approve preflight: if allowance(token, ROUTER, signer) < amountIn,
//      send approve(ROUTER, exactAmount) — or approve(MAX) when --max-approve.
//   5. Compute amountOutMin = amountOut * (10000 - bps) / 10000.
//   6. Build calldata = SEL_SELL + abi.encode(amountIn, amountOutMin,
//      [token, TOKEN_B], to, deadline).  Sign + send. Wait receipt.

import 'dotenv/config';
import { ethers } from 'ethers';
import { emit } from './_envelope.mjs';
import { loadSigner } from './_signer.mjs';
import { guardChain, guardGasFloor, guardNotional } from './_guard.mjs';
import {
  ROUTER, TOKEN_B, TOKEN_B_DECIMALS, TRADE_URL, DEFAULT_FEE_BPS,
  getProvider, encodeSellData, getPairAddress, getReserves, computeAmountOut, pickReservesByPath,
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
const maxApprove = argv.includes('--max-approve');

const parsedIntent = {
  command: 'sell',
  tokenAddress: tokenAddress ?? null,
  amountInTokenHuman: amountInArg ?? null,
  slippageBps,
  confirm: confirmFlag,
  maxApprove,
};

async function main() {
  if (!tokenAddress || !amountInArg) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: 'usage: sell.mjs <0xTokenAddress> <amountInToken> [--slippage=<bps>] [--confirm] [--max-approve]', missing: null, hint: null, signerWarn: null });
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

  const target = ethers.getAddress(tokenAddress);
  const erc = new ethers.Contract(target, ERC20_ABI, wallet);
  const tokenDecimals = Number(await erc.decimals());
  const amountIn = ethers.parseUnits(amountInArg, tokenDecimals);

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

  // Fresh quote via factory + pair reserves (token in → TOKEN_B out).
  const pair = await getPairAddress(provider, target, TOKEN_B);
  const { reserve0, reserve1 } = await getReserves(provider, pair);
  const { reserveIn, reserveOut } = pickReservesByPath({ tokenIn: target, tokenOut: TOKEN_B, reserve0, reserve1 });
  const amountOut = computeAmountOut({ amountIn, reserveIn, reserveOut, feeBps, side: 'sell' });
  if (amountOut === 0n) {
    const err = new Error(`computed amountOut is zero (reserveIn=${reserveIn}, reserveOut=${reserveOut}). Pair has no liquidity?`);
    err.code = 'no_liquidity';
    err.exitCode = 2;
    throw err;
  }

  const amountOutHuman = ethers.formatUnits(amountOut, TOKEN_B_DECIMALS);
  guardNotional({ amountTokenBHuman: amountOutHuman, confirmFlag });

  // Approve preflight
  const allowance = await erc.allowance(from, ROUTER);
  let approveTxHash = null;
  if (allowance < amountIn) {
    const approveAmount = maxApprove ? ethers.MaxUint256 : amountIn;
    const aTx = await erc.approve(ROUTER, approveAmount);
    const aReceipt = await aTx.wait();
    if (aReceipt.status !== 1) {
      const err = new Error(`approve failed (tx ${aTx.hash})`);
      err.code = 'approve_failed';
      throw err;
    }
    approveTxHash = aTx.hash;
  }

  const amountOutMin = amountOut * BigInt(10000 - slippageBps) / 10000n;
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const data = encodeSellData(amountIn, amountOutMin, target, from, deadline);

  const fee = await provider.getFeeData();
  const txReq = {
    to: ROUTER,
    data,
    value: 0n,
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
    approveTxHash,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    amountIn: amountIn.toString(),
    amountInHuman: amountInArg,
    tokenDecimals,
    amountOut: amountOut.toString(),
    amountOutHuman,
    amountOutMin: amountOutMin.toString(),
    amountOutMinHuman: ethers.formatUnits(amountOutMin, TOKEN_B_DECIMALS),
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
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
