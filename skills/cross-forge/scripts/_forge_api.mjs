// _forge_api.mjs — minimal GET helper for the Forge SPA back-end at
// https://bonding-curve-api.crosstoken.io/api/v1. All endpoints captured to
// date are public (no auth, no session token); this helper only forwards a
// User-Agent and Accept header.

import { BONDING_CURVE_API, DEFAULT_FEE_BPS } from './_chain.mjs';

export async function forgeGet(path) {
  const url = `${BONDING_CURVE_API}${path}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'cross-forge/0.3', 'Accept': 'application/json' },
  });
  if (res.status === 404) {
    const err = new Error(`Forge API 404: ${url}`);
    err.code = 'not_found';
    err.exitCode = 2;
    throw err;
  }
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Forge API HTTP ${res.status}: ${text.slice(0, 300)}`);
    err.code = 'forge_api_error';
    err.exitCode = 1;
    throw err;
  }
  const body = await res.json();
  if (body && body.success === false) {
    const err = new Error(`Forge API returned success=false: ${JSON.stringify(body).slice(0, 300)}`);
    err.code = 'forge_api_error';
    err.exitCode = 1;
    throw err;
  }
  return body;
}

// Per-token fee bps, back-solved from the latest recent_trades row. Returns:
//   { feeBps, source: 'recent_trade', breakdown: {protocol, creator, referral}, ageSec }
// or { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: <string> } as a graceful fallback.
//
// Math:
//   BUY  trade : feeBps = (protocol + creator + referral) * 10000 / amount_in
//   SELL trade : feeBps = (protocol + creator + referral) * 10000 / (amount_out + protocol + creator + referral)
// (i.e. divide fees by the GROSS native side — pre-fee on buy, post-fee + fees on sell.)
//
// Caller decides whether to use this (when no explicit --fee-bps was supplied).
export async function getRecentFeeBps(tokenAddress) {
  let body;
  try {
    body = await forgeGet(`/tokens/${tokenAddress}`);
  } catch (err) {
    return { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: `forge_api_${err.code || 'error'}` };
  }
  const trades = body?.data?.recent_trades ?? [];
  if (trades.length === 0) {
    return { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: 'no_recent_trades' };
  }
  const t = trades[0];
  const protocol = BigInt(t.protocol_fee || '0');
  const creator  = BigInt(t.creator_fee  || '0');
  const referral = BigInt(t.referral_fee || '0');
  const totalFee = protocol + creator + referral;
  if (totalFee === 0n) {
    return { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: 'zero_fee_in_recent_trade' };
  }
  let grossNative;
  if (t.type === 'buy') {
    grossNative = BigInt(t.amount_in || '0');
  } else if (t.type === 'sell') {
    grossNative = BigInt(t.amount_out || '0') + totalFee;
  } else {
    return { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: `unknown_trade_type_${t.type}` };
  }
  if (grossNative === 0n) {
    return { feeBps: DEFAULT_FEE_BPS, source: 'default', reason: 'zero_gross_native' };
  }
  const feeBps = Number(totalFee * 10000n / grossNative);
  const ageSec = t.timestamp ? Math.round((Date.now() - new Date(t.timestamp).getTime()) / 1000) : null;
  return {
    feeBps,
    source: 'recent_trade',
    breakdown: {
      protocolBps: Number(protocol * 10000n / grossNative),
      creatorBps:  Number(creator  * 10000n / grossNative),
      referralBps: Number(referral * 10000n / grossNative),
    },
    sampleTxHash: t.tx_hash || null,
    sampleSide: t.type,
    ageSec,
  };
}
