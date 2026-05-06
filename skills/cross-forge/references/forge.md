# cross-forge — Reference & Capture Playbook

This file holds the deeper details that are not loaded into the SKILL.md context by default. Open it only when you need to:

- Cross-check what the official upstream skill (v2.0.1) says vs. what we shipped
- Unblock one of the Phase-1 stubs (`tokens`, `token`, `quote`, `buy`, `sell`, `portfolio`, `history`) via DevTools capture
- Populate / extend `references/forge.json` (the skill's runtime registry — created on first capture)

---

## 1. Authoritative sources

| Source | Purpose |
|---|---|
| `https://contents.crosstoken.io/forge/agent-skills/SKILL.md` | **Canonical**. Defines `deploy` flow verbatim (v2.0.1). When in doubt, this beats anything in this repo. |
| `https://x.crosstoken.io/forge/` | Live SPA. Source of truth for all UI flows that aren't in SKILL.md (trending, token detail, trade, portfolio, history, share-earn). |
| `https://cross-console-api.crosstoken.io/api/builder/mcp` | Vendor deploy endpoint (no auth, POST). |
| `https://cross-console-api.crosstoken.io/api/client/mcp/builder` | Client deploy endpoint (`Authorization: API-Key <KEY>:<SECRET>`). |
| `https://cross-ramp-console.crosstoken.io` | Where `CLIENT_KEY` / `CLIENT_SECRET` are issued. |
| Router contract | `0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8` on chain `612055`. ERC1967 proxy → impl `0x4F0e564094C54e0B44b7cBeD7D64f9a202E5C248` (NOT source-verified). Public functions captured: `createPairWithVirtualReserve` (deploy, official), `factory()` returns `0x78E53A7f8fD5e87906F0d4b6f7f85246AADE39E9`, `<unnamed>` selector `0xc075a591` (BUY native-in), `<unnamed>` selector `0x029e384f` (SELL token-in). Standard UniswapV2 reads (`getAmountsOut`, `WETH`, `tokenB`) all REVERT — quote goes through factory+pair instead. |
| Factory contract | `0x78E53A7f8fD5e87906F0d4b6f7f85246AADE39E9`. Standard UniswapV2 fork: `getPair(address,address)`, `allPairs(uint256)`, `allPairsLength()` all work. At capture time `allPairsLength()` = 1076. |
| Pair contract (per token) | UniswapV2-style. `getReserves()` (selector `0x0902f1ac`) returns `(uint112 r0, uint112 r1, uint32 ts)` — these are the **virtual** reserves (raw + virtual baked together; `r0 * r1 = k`), so the standard constant-product formula applies. `token0()` / `token1()` REVERT — use lex-ordering (token0 = min(addr) lower-cased) to map reserves to a path. |
| TOKEN_B (quote token) | `0xDdF8AaA3927b8Fd5684dc2edcc7287EcB0A2122d`. ERC-20 symbol `WNATIVE` (Wrapped Native CROSS), 18 decimals. The Router auto-wraps native CROSS to WNATIVE on BUY and unwraps on SELL. |
| Vendor wallet | `0x254465624da909e0072fbf8c32bcfc26b9fe9da9`. Sent in vendor-path POST body as `vendor: …`. Do not change without reading the upstream SKILL.md again. |

---

## 2. Verified deploy flow (v2.0.1)

This is what `scripts/deploy.mjs` already does, line-for-line from upstream. Don't change it without re-reading the canonical SKILL.md.

```
1. POST {DEPLOY_API[auth]}
   body = { owner, project_name, token:{name,symbol,image_url}, token_description, category, [vendor] }
   headers = { Content-Type: application/json,
               [Authorization: API-Key <KEY>:<SECRET>]  // when auth=client
             }
   ↳ returns { code:200, data:{ token_address } }   on success
   ↳ throws on { code != 200 }   or { HTTP != 2xx }

2. Build Router.createPairWithVirtualReserve calldata:
     tokenA              = token_address (just deployed)
     tokenB              = TOKEN_B
     creatorFeeRecipient = walletAddress (positional arg)
     deadline            = floor(now/1000) + 300
     gasLimit            = estimateGas * 1.20
     type=2, maxFeePerGas=100 gwei, maxPriorityFeePerGas=1 gwei

3. If wallet=tmp: sign+send with the ephemeral wallet, wait receipt, emit
     { poolCreated, tokenAddress, tradeLink, txHash, blockNumber }
   If wallet=user: populate transaction, return
     { tokenAddress, tradeLink, unsignedTx }   for the frontend to sign
```

`tradeLink` template: `https://x.crosstoken.io/forge/token/<tokenAddress>`.

---

## 3. Forge SPA back-end (UNBLOCKED in v0.3)

Captured against live mainnet `2026-05-06` from `https://x.crosstoken.io/forge/` DevTools network tap. The SPA back-end lives at `https://bonding-curve-api.crosstoken.io/api/v1` and is **fully public** — no auth header, no session token, no CSRF; CORS is open from `https://x.crosstoken.io`. All endpoints used are GET and have a uniform `{ success: true, data: ... }` envelope.

### 3.1 Endpoints in use

| Path | Used by | Notes |
|---|---|---|
| `GET /tokens?sort=&order=&category=&page=&limit=` | `tokens.mjs` | sort ∈ {market_cap, created_at, volume_24h, ...}; order ∈ {asc, desc}; category ∈ {all, Game, "AI Agent"} (URL-encoded). Returns `data.items[]` with full token row + bonding state, plus `data.pagination = {page, limit, total, totalPages}`. Observed 1072 total tokens. |
| `GET /tokens/<address>` | `token.mjs`, `portfolio.mjs` (per-row enrichment) | Returns `data.token`, `data.bonding_curve = {virtual_reserve_b, reserve_a, reserve_b}`, and `data.recent_trades[]` (per-trade with `protocol_fee`, `creator_fee`, `referral_fee`). 404 → `not_found` → fall back to Blockscout for token.mjs, leave `isForgeKnown=false` for portfolio. |
| `GET /feed/recent?limit=N` | `history.mjs` | GLOBAL activity feed across all Forge tokens (newest first). Per-wallet filtering is client-side on `data[i].data.trader`. Each item: `{type:"trade", data:{token, type:"buy"\|"sell", trader, amount_in, amount_out, price, market_cap, supply, reserve, protocol_fee, creator_fee, [referral_fee], timestamp, block_number, tx_hash, log_index}, timestamp}`. |

### 3.2 Adjacent endpoint observed but not used

| Path | Why not used |
|---|---|
| `GET https://wallet-server.crosstoken.io/api/v1/public/token/stats?chain_id=612055&token=0x000…001` | Returns aggregate / market-wide stats (called from the SPA's right rail). Not strictly Forge-specific and not needed for any current subcommand. Wire in later if a "global market summary" surface is wanted. |
| `eventsource /stream` (SSE), `GET /info`, `GET /stats` (root) | Realtime updates + meta. Not needed for the read-only commands we ship today; ignore unless a future v0.4 surfaces live ticks. |

### 3.3 Field naming convention

Backend uses `snake_case`; we normalize to `camelCase` in the envelope (e.g. `image_url → imageUrl`, `market_cap → marketCap`, `pair_address → pairAddress`). When adding new fields, keep that convention.

### 3.4 If a future capture is needed

Same playbook as before:

1. Open `https://x.crosstoken.io/forge/` in a browser with DevTools docked.
2. Switch to the **Network** tab → Fetch/XHR → filter `-mainnet.crosstoken.io` to hide the wallet's RPC chatter.
3. Click through new tabs / tabs that change behavior with a wallet connected.
4. For any new request, capture: URL, method, request headers (non-default only), request body (if POST), and a representative response row.
5. If it requires auth (likely SIWE-style), do NOT bake the token into the registry — accept it via env (`FORGE_SESSION_TOKEN`) or derive via a separate `login.mjs` subcommand.

---

## 4. Trade-side capture (UNBLOCKED in v0.2)

This was the original Phase-1 blocker for `quote` / `buy` / `sell`. Captured against live mainnet `2026-05-04`; the resulting selectors and reserves layout are baked into `scripts/_chain.mjs` and exercised by `scripts/quote.mjs` (read), `scripts/buy.mjs` and `scripts/sell.mjs` (write).

### 4.1 Selectors recovered from on-chain calldata

Sampled 25 recent successful txs to the Router proxy and decoded their calldata layouts. Three distinct user-facing selectors observed:

| Selector | Layout (after selector) | Direction | Notes |
|---|---|---|---|
| `0xc075a591` | `(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable` | **BUY** native → token | `path = [TOKEN_B, target]`. `msg.value = amountIn` (native CROSS, auto-wrapped to WNATIVE inside). 0-value not allowed. |
| `0x029e384f` | `(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)` | **SELL** token → native | `path = [target, TOKEN_B]`. Requires ERC-20 `approve(target, ROUTER, amountIn)` preflight. `msg.value = 0`. |
| `0xc9e164e3` | (not used here) | createPair-with-fee variant | Observed on a payable tx with small native value; out of scope for trade-side. |

Both swap return types decode as `uint256[] amounts` (UniswapV2-standard). Static-call simulation requires a `from` with the relevant balance, so `quote.mjs` does not use static-call — it derives from reserves.

### 4.2 Read path (factory + pair reserves)

Probed standard UniswapV2 read API:

| Call | Result |
|---|---|
| `Router.factory()` (`0xc45a0155`) | `0x78E53A7f8fD5e87906F0d4b6f7f85246AADE39E9` ✅ |
| `Router.getAmountsOut`, `WETH`, `tokenB` | all REVERT ❌ — Forge fork stripped the read API from the router |
| `Factory.getPair(TOKEN_B, target)` (`0xe6a43905`) | returns pair address ✅ |
| `Factory.allPairsLength()` (`0x574f2ba3`) | `0x434` = 1076 at capture time ✅ |
| `Pair.getReserves()` (`0x0902f1ac`) | `(uint112 r0, uint112 r1, uint32 ts)` ✅ — virtual reserves baked in |
| `Pair.token0`, `Pair.token1` | both REVERT ❌ — use lex-ordering (`token0 = min(addr)` lower-cased) |

Worked example (HERO `0xc171…`, capture 2026-05-04):
- `pair = factory.getPair(TOKEN_B, HERO)` → `0x0B78C53750fDe8d6a276e888BA91a203aE5ed9B2`
- `getReserves()` → `r0 = 9.42e26`, `r1 = 5.31e21`, `ts = 1777886498`
- HERO < TOKEN_B lex → `token0 = HERO`, `token1 = TOKEN_B`
- BUY 0.01 native: `reserveIn = r1 = 5.31e21`, `reserveOut = r0 = 9.42e26`
- amountOut (30 bps fee, UniswapV2 formula) = **1767.34 HERO**
- Verified plausible against TX 1 from the sampled set: `0.01 native → ≥ 1738 HERO` (amountOutMin floor).

### 4.3 Fee schedule (CONFIRMED in v0.3 against bonding-curve API)

Earlier guess (UniswapV2 30 bps) was wrong. `recent_trades[]` from `/api/v1/tokens/<addr>` exposes the per-trade fee fields, which gives us the actual schedule:

| Component | Rate | Where it's taken |
|---|---|---|
| `protocol_fee` | **100 bps** | "near side" of the trade |
| `creator_fee` | **30 bps** | "near side" of the trade |
| `referral_fee` | 0 bps default; ≥ 0 bps when invoked via a referral link | "near side" |
| **Total default** | **130 bps** | — |

"Near side" asymmetry verified empirically:

- BUY (native → token): fees taken on **input** (native). `protocol_fee + creator_fee` deducted before swap; remainder enters constant-product math.
- SELL (token → native): fees taken on **output** (native). Constant-product math runs first; `protocol_fee + creator_fee` deducted from the resulting native amount.

Implementation (`scripts/_chain.mjs::computeAmountOut`):

```js
if (side === 'buy') {
  amountInPostFee = amountIn * (10000 - feeBps) / 10000;
  amountOut = amountInPostFee * reserveOut / (reserveIn + amountInPostFee);
} else { // sell
  rawOut = amountIn * reserveOut / (reserveIn + amountIn);
  amountOut = rawOut * (10000 - feeBps) / 10000;
}
```

`DEFAULT_FEE_BPS = 130`. Override via `--fee-bps=<n>` on `quote` / `buy` / `sell`. If a referral applies, set `--fee-bps=130 + <referral_bps>`.

### 4.4 Per-token fee auto-detection (IMPLEMENTED in v0.4)

The fee schedule is **per-token**, not global. Confirmed against live fills on 2026-05-06:

| Token | protocol_fee bps | creator_fee bps | total bps |
|---|---:|---:|---:|
| HERO `0xc171…` | 100 | 30 | 130 |
| ARA `0x23c3…`  | 50  | 30 | 80  |

`scripts/_forge_api.mjs::getRecentFeeBps(addr)` back-solves the bps from `/api/v1/tokens/<addr>.recent_trades[0]`:

```
BUY  : bps = (protocol + creator + referral) * 10000 / amount_in
SELL : bps = (protocol + creator + referral) * 10000 / (amount_out + protocol + creator + referral)
```

`quote`, `buy`, `sell` call this whenever `--fee-bps` is NOT explicit. They surface in the envelope:

- `feeBpsAssumed` — bps actually applied
- `feeBpsSource` — `override` | `recent_trade` | `default`
- `feeBpsBreakdown` — `{protocolBps, creatorBps, referralBps}` (only when source=`recent_trade`)
- `feeBpsSampleTx` — tx hash of the recent_trades[0] used
- `feeBpsAgeSec` — how stale the sample is (seconds since that trade)
- `feeBpsFallbackReason` — only when source=`default` (e.g. `forge_api_not_found`, `no_recent_trades`, `zero_fee_in_recent_trade`)

Caveat: if recent_trades[0] happens to be a referred trade (`referral_fee > 0`), the inferred bps will be *that buyer's* effective rate, not the base. To get base fees only, sample multiple rows from `recent_trades` and take the minimum total bps across rows where `referral_fee == 0` — currently we trust [0] as a single-shot heuristic.

`DEFAULT_FEE_BPS = 130` remains a conservative fallback for the rare cases where auto-detection has nothing to work with (brand-new token with zero trades, or non-Forge address).

---

## 5. Differences from the official SKILL.md

| Concern | Official `SKILL.md` v2.0.1 | This skill |
|---|---|---|
| File names | `deploy-token.js`, `package.json` at repo root | `scripts/deploy.mjs`, `package.json` under skill dir (matches the `cross-skills/` repo convention; logic & constants verbatim) |
| Scope | Deploy + pool only | Adds Phase-1 stubs for trending/detail/trade/portfolio/history |
| RPC env override | Hardcoded | Honors `CROSS_RPC_URL` (defaults to upstream value) |
| Image base64 | Same | Same |
| All addresses, endpoints, gas params, and ABI fragment | — | **Identical.** Do not change without re-reading upstream. |

If upstream publishes a v2.1.x with new constants or new endpoints, re-read it and bump this skill in lock-step. The single source-of-truth for `deploy` is upstream.

---

## 6. Adjacent skills (don't duplicate)

- **`cross-explorer`** — read-only Blockscout v2 lookups (block / tx / address / token). If the user only wants "what's the balance of 0x…?", route them there instead of waiting on Phase-1 capture. The Forge UI's number is wrapped in curve-state context, but a raw ERC-20 balance is a one-liner via `cross-explorer`.
- **`cross-dex-trade`** — Gametoken orderbook (`0x6690…` router) on the **same chain**. Different contract, different liquidity model — its quotes do not apply to Forge bonding curves.
- **``** — totally separate platform (`/points`), but the Forge UI's "Share & Earn" tab may eventually surface CP rewards. If a captured Forge activity row references `/points/quests/<id>`, route the claim leg through `` rather than re-implementing it here.
- **`da:token`** (global Davinci skill) — partial overlap with our `deploy`: it calls the same Builder API but does **not** create the pool. Prefer this skill's `deploy` when the user wants the full launch (deploy + pool) in one shot.
