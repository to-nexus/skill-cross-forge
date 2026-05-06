#!/usr/bin/env node
// tokens.mjs — list Forge tokens from the bonding-curve API.
//
// Backed by GET /api/v1/tokens?sort=...&order=...&category=...&page=...&limit=...
// Captured 2026-05-06 from x.crosstoken.io/forge DevTools tap.
//
// Args:
//   <filter>             trending (default) | new | top | all
//   --category=<c>       all (default) | game | ai_agent
//   --page=<n>           1-based page (default 1)
//   --limit=<n>          rows per page, 1..100 (default 20)
//
// `filter` maps to (sort, order) on the backend:
//   trending → market_cap   desc
//   new      → created_at   desc
//   top      → volume_24h   desc
//   all      → market_cap   desc

import 'dotenv/config';
import { emit } from './_envelope.mjs';
import { forgeGet } from './_forge_api.mjs';
import { TRADE_URL } from './_chain.mjs';

const FILTER_TO_SORT = {
  trending: { sort: 'market_cap', order: 'desc' },
  new:      { sort: 'created_at', order: 'desc' },
  top:      { sort: 'volume_24h', order: 'desc' },
  all:      { sort: 'market_cap', order: 'desc' },
};

const CATEGORY_MAP = {
  all:       'all',
  game:      'Game',
  ai_agent:  'AI Agent',
  'ai agent':'AI Agent',
};

const argv = process.argv.slice(2);
const filter = (argv.find((a) => !a.startsWith('--')) || 'trending').toLowerCase();
const categoryArg = (argv.find((a) => a.startsWith('--category=')) || '--category=all').split('=')[1].toLowerCase();
const pageArg = Number((argv.find((a) => a.startsWith('--page=')) || '--page=1').split('=')[1]);
const limitArg = Number((argv.find((a) => a.startsWith('--limit=')) || '--limit=20').split('=')[1]);

const parsedIntent = { command: 'tokens', filter, category: categoryArg, page: pageArg, limit: limitArg };

async function main() {
  if (!FILTER_TO_SORT[filter]) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: `filter must be one of: ${Object.keys(FILTER_TO_SORT).join('|')} (got: ${filter})`, missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (!CATEGORY_MAP[categoryArg]) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: `--category must be one of: ${Object.keys(CATEGORY_MAP).filter((k)=>k!=='ai agent').join('|')} (got: ${categoryArg})`, missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (!Number.isFinite(pageArg) || pageArg < 1) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--page must be >= 1', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (!Number.isFinite(limitArg) || limitArg < 1 || limitArg > 100) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--limit must be 1..100', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  const { sort, order } = FILTER_TO_SORT[filter];
  const cat = encodeURIComponent(CATEGORY_MAP[categoryArg]);
  const path = `/tokens?sort=${sort}&order=${order}&category=${cat}&page=${pageArg}&limit=${limitArg}`;
  const body = await forgeGet(path);

  const items = (body?.data?.items ?? []).map((t) => ({
    address: t.address,
    name: t.name,
    symbol: t.symbol,
    creator: t.creator,
    pairAddress: t.pair_address,
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
    reserveA: t.reserve_a,
    reserveB: t.reserve_b,
    virtualReserveB: t.virtual_reserve_b,
    tradeLink: `${TRADE_URL}/${t.address}`,
  }));

  emit({
    ok: true,
    parsedIntent,
    sort,
    order,
    pagination: body?.data?.pagination ?? null,
    count: items.length,
    items,
    signerWarn: null,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
