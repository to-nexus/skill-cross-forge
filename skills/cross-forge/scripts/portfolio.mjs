#!/usr/bin/env node
// portfolio.mjs — wallet's ERC-20 holdings on CROSS Chain, annotated with
// Forge-aware metadata.
//
// Source 1: Blockscout v2 /api/v2/addresses/<wallet>/token-balances → ALL ERC-20s
// Source 2: Forge bonding-curve API /api/v1/tokens/<addr> per-row → marks
//            isForgeKnown true/false and folds in current price + market cap.
//
// To keep the worst case bounded (a wallet with hundreds of tokens), we only
// hit the Forge API for the first --enrich-limit rows (default 20). The rest
// are returned with isForgeKnown=null.

import 'dotenv/config';
import { emit } from './_envelope.mjs';
import { bsGet } from './_blockscout.mjs';
import { forgeGet } from './_forge_api.mjs';
import { TOKEN_B, TRADE_URL } from './_chain.mjs';

const argv = process.argv.slice(2);
const walletAddress = argv.find((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const enrichLimit = Number((argv.find((a) => a.startsWith('--enrich-limit=')) || '--enrich-limit=20').split('=')[1]);

const parsedIntent = { command: 'portfolio', walletAddress: walletAddress ?? null, enrichLimit };

async function main() {
  if (!walletAddress) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: 'usage: portfolio.mjs <0xWalletAddress> [--enrich-limit=20]', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }
  if (!Number.isFinite(enrichLimit) || enrichLimit < 0 || enrichLimit > 200) {
    emit({ ok: false, parsedIntent, error: 'bad_args', message: '--enrich-limit must be 0..200', missing: null, hint: null, signerWarn: null });
    process.exit(2);
  }

  const balances = await bsGet(`/api/v2/addresses/${walletAddress}/token-balances`);
  const erc20 = (Array.isArray(balances) ? balances : balances?.items ?? [])
    .filter((b) => b?.token?.type === 'ERC-20');

  const rows = await Promise.all(erc20.map(async (b, idx) => {
    // Blockscout v2 uses `address_hash`; fall back to `address` for safety.
    const tokenAddr = b.token.address_hash ?? b.token.address;
    const decimals = b.token.decimals ? Number(b.token.decimals) : 18;
    const row = {
      tokenAddress: tokenAddr,
      name: b.token.name,
      symbol: b.token.symbol,
      decimals,
      balanceRaw: b.value,
      balanceHuman: humanize(b.value, decimals),
      isTokenB: tokenAddr?.toLowerCase() === TOKEN_B.toLowerCase(),
      isForgeKnown: null,
      forgeCurrentPrice: null,
      forgeMarketCap: null,
      forgeGraduated: null,
      tradeLink: tokenAddr ? `${TRADE_URL}/${tokenAddr}` : null,
    };
    if (idx < enrichLimit && !row.isTokenB && tokenAddr) {
      try {
        const f = await forgeGet(`/tokens/${tokenAddr}`);
        const t = f?.data?.token;
        if (t) {
          row.isForgeKnown = true;
          row.forgeCurrentPrice = t.current_price;
          row.forgeMarketCap = t.market_cap;
          row.forgeGraduated = t.graduated;
        }
      } catch (err) {
        if (err.code === 'not_found') row.isForgeKnown = false;
        // Other errors leave isForgeKnown=null and continue.
      }
    }
    return row;
  }));

  emit({
    ok: true,
    parsedIntent,
    wallet: walletAddress,
    tokenBAddress: TOKEN_B,
    count: rows.length,
    enriched: Math.min(enrichLimit, rows.length),
    holdings: rows,
    note: enrichLimit < rows.length ? `Only first ${enrichLimit} rows enriched against Forge API (use --enrich-limit to widen).` : null,
    signerWarn: null,
  });
}

function humanize(weiStr, decimals) {
  if (!weiStr) return '0';
  try {
    const n = BigInt(weiStr);
    const div = 10n ** BigInt(decimals);
    const whole = n / div;
    const frac = n % div;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr ? `${whole}.${fracStr}` : whole.toString();
  } catch { return weiStr; }
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit({ ok: false, parsedIntent, error: err?.code || 'unknown_error', message: err?.message || String(err), missing: null, hint: null, signerWarn: null });
  process.exit(err?.exitCode ?? 1);
});
