// _guard.mjs — pre-signing safety checks. Runs before every write-path tx.
//
// Rails enforced (in order):
//   1. Chain id must equal CROSS Chain mainnet (612055).
//   2. Native CROSS balance must be >= MIN_GAS_NATIVE (default 0.001).
//   3. Trade notional (in TOKEN_B units) must be <= MAX_TRADE_NOTIONAL if set.
//   4. Trade notional > CONFIRM_THRESHOLD requires --confirm flag.

import { ethers } from 'ethers';
import { CHAIN_ID } from './_chain.mjs';

export async function guardChain(provider) {
  const net = await provider.getNetwork();
  if (Number(net.chainId) !== CHAIN_ID) {
    const err = new Error(`Wrong chain: expected ${CHAIN_ID}, got ${net.chainId}.`);
    err.code = 'wrong_chain';
    err.exitCode = 2;
    throw err;
  }
}

export async function guardGasFloor(provider, address) {
  const floorStr = process.env.MIN_GAS_NATIVE;
  if (floorStr === '0' || floorStr === '') return; // explicit skip
  const floor = ethers.parseUnits(floorStr || '0.001', 18);
  const bal = await provider.getBalance(address);
  if (bal < floor) {
    const err = new Error(`Native balance ${ethers.formatUnits(bal, 18)} < MIN_GAS_NATIVE ${ethers.formatUnits(floor, 18)}.`);
    err.code = 'insufficient_gas';
    err.exitCode = 2;
    throw err;
  }
}

export function guardNotional({ amountTokenBHuman, confirmFlag }) {
  const cap = process.env.MAX_TRADE_NOTIONAL;
  if (cap && Number(amountTokenBHuman) > Number(cap)) {
    const err = new Error(`Trade notional ${amountTokenBHuman} TOKEN_B exceeds MAX_TRADE_NOTIONAL ${cap}.`);
    err.code = 'over_cap';
    err.exitCode = 2;
    throw err;
  }
  const threshold = process.env.CONFIRM_THRESHOLD;
  if (threshold && Number(amountTokenBHuman) > Number(threshold) && !confirmFlag) {
    const err = new Error(`Trade notional ${amountTokenBHuman} TOKEN_B exceeds CONFIRM_THRESHOLD ${threshold}; re-run with --confirm.`);
    err.code = 'awaiting_confirm';
    err.exitCode = 2;
    throw err;
  }
}
