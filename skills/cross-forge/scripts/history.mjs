#!/usr/bin/env node
// history.mjs — Forge activity feed.
//
// Backed by GET /api/v1/feed/recent?limit=N (GLOBAL feed across all Forge
// tokens, no per-wallet endpoint observed). When --wallet=<addr> is supplied,
// we filter client-side by `data.trader === addr` (case-insensitive). Without
// --wallet, the entire global feed is returned.
//
// Args:
//   --wallet=<0xAddr>   filter to trades by this trader address (optional)
//   --limit=<n>         page size, 1..200 (default 50). Note: server-side
//                       limit applies BEFORE client-side wallet filter, so
//                       a small limit + tight wallet filter can return 0
//                       rows even when the wallet has older history. Bump
//                       --limit if needed.

import 'dotenv/config';
import { emit } from './_envelope.mjs';
import { forgeGet } from './_forge_api.mjs';

const argv = process.argv.slice(2);
const walletArg = (argv.find((a) => a.startsWith('--wallet=')) || '').split('=')[1];
const limitArg = Number((argv.find((a) => a.startsWith('--limit=')) || '--limit=50').split('=')[1]);

const parsedIntent = {
  command: 'history',
  walletFilter: walletArg ?? null,
  limit: limitArg,
};

async function main() {
  if (!Number.isFinite(limitArg) || limitArg < 1 || limitArg > 200) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--limit must be 1..200', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (walletArg && !/^0x[0-9a-fA-F]{40}$/.test(walletArg)) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--wallet must be a 0x-prefixed 40-hex EVM address', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  const body = await forgeGet(`/feed/recent?limit=${limitArg}`);
  const allRows = Array.isArray(body?.data) ? body.data : [];

  let rows = allRows.map((row) => normalizeRow(row));

  if (walletArg) {
    const want = walletArg.toLowerCase();
    rows = rows.filter((r) => r?.trader?.toLowerCase() === want);
  }

  emit({
    ok: true,
    parsedIntent,
    serverFetched: allRows.length,
    walletFilter: walletArg ?? null,
    count: rows.length,
    rows,
    note: walletArg
      ? `Filtered ${allRows.length} server rows down to ${rows.length} where trader == ${walletArg}. If 0, increase --limit (server returns newest first).`
      : null,
    signerWarn: null,
  });
}

function normalizeRow(row) {
  const eventType = row?.type ?? null;
  const d = row?.data ?? {};
  return {
    eventType,
    side: d?.type ?? null,                  // buy | sell (only for trade events)
    token: d?.token ?? null,
    trader: d?.trader ?? null,
    amountIn: d?.amount_in ?? null,
    amountOut: d?.amount_out ?? null,
    price: d?.price ?? null,
    marketCap: d?.market_cap ?? null,
    supply: d?.supply ?? null,
    reserve: d?.reserve ?? null,
    protocolFee: d?.protocol_fee ?? null,
    creatorFee: d?.creator_fee ?? null,
    referralFee: d?.referral_fee ?? null,
    timestamp: d?.timestamp ?? row?.timestamp ?? null,
    blockNumber: d?.block_number ?? null,
    txHash: d?.tx_hash ?? null,
    logIndex: d?.log_index ?? null,
  };
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
