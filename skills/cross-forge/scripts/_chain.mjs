// _chain.mjs — provider + Forge constants for CROSS Chain (612055).
//
// Constants are shared across deploy/buy/sell/quote/portfolio/token. They mirror
// the official SKILL.md v2.0.1 values plus on-chain captures from
// https://www.crossscan.io (proxy at 0x7aF414e4… is verified, implementation
// at 0x4F0e564094C54e0B44b7cBeD7D64f9a202E5C248 is NOT verified — selectors
// below were recovered by sampling recent successful txs to the Router and
// decoding their calldata layout. Provenance: references/forge.md §4).

import { ethers } from 'ethers';

export const CHAIN_ID = 612055;
export const RPC_URL = process.env.CROSS_RPC_URL || 'https://mainnet.crosstoken.io:22001';
export const ROUTER = '0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8';
// Forge factory recovered from `factory()` (selector 0xc45a0155) on the Router.
// allPairsLength() returned 0x434 (1076 pairs) at capture time, confirming
// it's a UniswapV2-style fork. See references/forge.md §4.
export const FACTORY = '0x78E53A7f8fD5e87906F0d4b6f7f85246AADE39E9';
export const TOKEN_B = '0xDdF8AaA3927b8Fd5684dc2edcc7287EcB0A2122d'; // WNATIVE
export const TOKEN_B_DECIMALS = 18;
export const VENDOR_ADDRESS = '0x254465624da909e0072fbf8c32bcfc26b9fe9da9';
export const TRADE_URL = 'https://x.crosstoken.io/forge/token';

export const BLOCKSCOUT_BASE = process.env.MAINNET_BASE_URL || 'https://www.crossscan.io';
// Forge SPA back-end (Bonding Curve API) — public, no auth required.
// Captured 2026-05-06 from /forge/ DevTools network tap. See references/forge.md §3.
export const BONDING_CURVE_API = process.env.BONDING_CURVE_API || 'https://bonding-curve-api.crosstoken.io/api/v1';

// Captured selectors. See references/forge.md §4 for the decoded calldata.
// Param layout (after selector):
//   BUY:  (uint256 amountOutMin, address[] path, address to, uint256 deadline) payable
//         msg.value = amountIn (native CROSS, auto-wrapped to WNATIVE inside)
//         path = [TOKEN_B, targetToken]
//   SELL: (uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)
//         path = [tokenIn, TOKEN_B]
//         requires ERC-20 approve(ROUTER, amountIn) preflight
export const SEL_BUY  = '0xc075a591';
export const SEL_SELL = '0x029e384f';

// UniswapV2-fork read API on the factory + pair (verified to work against this
// Forge router via on-chain probe; getAmountsOut on the Router itself reverts).
export const SEL_GET_PAIR     = '0xe6a43905'; // factory.getPair(address,address)
export const SEL_GET_RESERVES = '0x0902f1ac'; // pair.getReserves() → (uint112,uint112,uint32)

// Forge fee schedule recovered from /api/v1/tokens/<addr>.recent_trades:
//   protocol_fee = 100 bps of "near side" (input on buy, output on sell)
//   creator_fee  = 30 bps of "near side"
//   referral_fee = 0 bps by default (set when invoked via referral link)
// Total default fee = 130 bps. Fee is applied ASYMMETRICALLY:
//   BUY  → fee taken on amountIn before constant-product swap
//   SELL → fee taken on amountOut after constant-product swap
// Override via --fee-bps on quote/buy/sell.
export const DEFAULT_FEE_BPS = 130;

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];

export function getProvider() {
  return new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
}

export function encodeBuyData(amountOutMin, targetToken, to, deadline) {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'address[]', 'address', 'uint256'],
    [amountOutMin, [TOKEN_B, targetToken], to, deadline],
  );
  return SEL_BUY + enc.slice(2);
}

export function encodeSellData(amountIn, amountOutMin, tokenIn, to, deadline) {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint256', 'uint256', 'address[]', 'address', 'uint256'],
    [amountIn, amountOutMin, [tokenIn, TOKEN_B], to, deadline],
  );
  return SEL_SELL + enc.slice(2);
}

export async function getPairAddress(provider, tokenA, tokenB) {
  const enc = ethers.AbiCoder.defaultAbiCoder().encode(['address','address'], [tokenA, tokenB]);
  const ret = await provider.call({ to: FACTORY, data: SEL_GET_PAIR + enc.slice(2) });
  const [pair] = ethers.AbiCoder.defaultAbiCoder().decode(['address'], ret);
  if (pair === ethers.ZeroAddress) {
    const err = new Error(`No Forge pair exists for ${tokenA} / ${tokenB}.`);
    err.code = 'no_pair';
    err.exitCode = 2;
    throw err;
  }
  return pair;
}

export async function getReserves(provider, pair) {
  const ret = await provider.call({ to: pair, data: SEL_GET_RESERVES });
  const [r0, r1, ts] = ethers.AbiCoder.defaultAbiCoder().decode(['uint112','uint112','uint32'], ret);
  return { reserve0: r0, reserve1: r1, blockTimestampLast: Number(ts) };
}

// Forge fee asymmetry — see DEFAULT_FEE_BPS comment above.
// `side='buy'`  : fee taken on amountIn   (then constant-product swap).
// `side='sell'` : constant-product swap   (then fee taken on amountOut).
// Both branches reduce to the same formula when feeBps=0.
export function computeAmountOut({ amountIn, reserveIn, reserveOut, feeBps, side = 'buy' }) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  if (side === 'buy') {
    const amountInPostFee = amountIn * BigInt(10000 - feeBps) / 10000n;
    return (amountInPostFee * reserveOut) / (reserveIn + amountInPostFee);
  }
  const rawOut = (amountIn * reserveOut) / (reserveIn + amountIn);
  return rawOut * BigInt(10000 - feeBps) / 10000n;
}

// Returns { reserveIn, reserveOut } given a path [tokenIn, tokenOut] and
// the pair's lex-ordered (token0 < token1) reserves.
export function pickReservesByPath({ tokenIn, tokenOut, reserve0, reserve1 }) {
  // UniswapV2 factory enforces token0 = min(tokenA, tokenB) lexicographically.
  const token0IsTokenIn = tokenIn.toLowerCase() < tokenOut.toLowerCase();
  return token0IsTokenIn
    ? { reserveIn: reserve0, reserveOut: reserve1 }
    : { reserveIn: reserve1, reserveOut: reserve0 };
}
