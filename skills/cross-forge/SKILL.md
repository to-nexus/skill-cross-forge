---
name: cross-forge
description: This skill should be used when the user asks to drive the CROSS Forge service at https://x.crosstoken.io/forge/ — the "Game Token Launch & Market Creation Layer" by NEXUS / Verse8 on CROSS Chain (612055). Wraps the official agent-skill at https://contents.crosstoken.io/forge/agent-skills/SKILL.md (v2.0.1) verbatim for token deployment + bonding-curve pool creation against the Forge Router (0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8). Adds on-chain trade subcommands (BUY selector 0xc075a591 native-in, SELL 0x029e384f token-in; reserves read from Factory 0x78E53A7f… + per-pair getReserves; fee schedule 100 bps protocol + 30 bps creator). Adds Forge SPA back-end read subcommands (Bonding-Curve API at bonding-curve-api.crosstoken.io: trending list, activity feed, single-token bonding-curve state with recent_trades). Adds Blockscout-backed portfolio that auto-flags Forge-known holdings. v0.3 ships ALL EIGHT subcommands working today: deploy, token, tokens, portfolio, quote, buy, sell, history. Triggers on phrases like "Forge 토큰 발행", "CROSS Forge 토큰 배포", "forge 풀 생성", "forge 본딩커브 매수", "forge 본딩커브 매도", "내 forge 포트폴리오", "forge 거래 내역", "트렌딩 forge 토큰", "deploy a forge token", "launch CROSS Forge token", "create forge pool", "quote forge token buy", "buy on forge bonding curve", "sell forge token", "list trending forge tokens", "forge token portfolio", "forge activity history".
version: 0.4.0
license: MIT
---

# cross-forge — CROSS Forge Token Launch & Trade Driver

Drives **CROSS Forge** (`https://x.crosstoken.io/forge/`), the NEXUS / Verse8 "Game Token Launch & Market Creation Layer" on CROSS Chain (`612055`). It wraps the canonical agent-skill published by the team at `https://contents.crosstoken.io/forge/agent-skills/SKILL.md` (v2.0.1) and exposes additional subcommands for the trade-side UI surfaces.

> **v0.4 — per-token fee auto-detection**
>
> | Subcommand | Status |
> |---|---|
> | `deploy` | ✅ Builder API + Router.createPairWithVirtualReserve (verbatim SKILL.md v2.0.1) |
> | `token` | ✅ Forge bonding-curve API → Blockscout fallback |
> | `tokens` | ✅ Forge bonding-curve API (trending / new / top / all + category + pagination) |
> | `portfolio` | ✅ Blockscout × Forge cross-join (isForgeKnown, market cap, graduated flag) |
> | `history` | ✅ Forge global feed + client-side `--wallet=` filter |
> | `quote` | ✅ Factory.getPair + Pair.getReserves + asymmetric fee math + **auto-detected per-token fee** |
> | `buy` | ✅ Router selector `0xc075a591` payable + fresh quote + auto-fee → `amountOutMin` w/ `--slippage` |
> | `sell` | ✅ ERC-20 approve preflight + Router selector `0x029e384f` + auto-fee + output-side math |
>
> **What changed in v0.4:** the fee schedule turned out to be **per-token, not global** (e.g. HERO = 100 bps protocol + 30 bps creator = 130 bps total; ARA = 50 + 30 = 80 bps; varies by deploy config). `quote` / `buy` / `sell` now auto-back-solve the actual fee from `/api/v1/tokens/<addr>.recent_trades[0]` whenever `--fee-bps` is NOT explicit, then surface the source (`override` | `recent_trade` | `default`) and the breakdown (`{protocolBps, creatorBps, referralBps}`) in the envelope. Falls back to `DEFAULT_FEE_BPS = 130` (conservative upper bound) for tokens with zero recent trades or non-Forge addresses. Override remains via `--fee-bps=<n>`.
>
> All on-chain selectors and reserves layout were recovered by sampling live txs; the impl (`0x4F0e564094…`) is NOT source-verified. Provenance: `references/forge.md` §3–§4.

---

## 1. Activation

Activate when the user wants to:

- **Deploy** a new ERC-20 game/AI-agent token on CROSS Forge **and** create its bonding-curve pool — choosing between two auth methods (`vendor` no-signup ↔ `client` RampConsole keys) and two wallet types (`tmp` auto-signs pool-create with a throw-away wallet ↔ `user` returns an unsigned tx for frontend signing)
- **Browse** Forge tokens (trending / new / top-volume) — *Phase-1 stub*
- **Inspect** a single Forge token's curve state and metadata — *Phase-1 stub*
- **Quote / buy / sell** along the Forge bonding curve (TOKEN_B in/out) — *Phase-1 stub*
- **List** a wallet's Forge holdings (Portfolio tab) — *Phase-1 stub*
- **Read** a wallet's Forge activity feed (History / Share & Earn tab) — *Phase-1 stub*

Trigger phrases (Korean + English):

- KR: `"CROSS Forge 토큰 배포해줘"` / `"forge에 게임 토큰 발행"` / `"forge 풀 생성"` / `"forge 본딩커브 매수"` / `"pump 토큰 만들어줘"` / `"x.crosstoken.io/forge 토큰 발행"` / `"내 forge 포트폴리오"` / `"forge 거래 내역"`
- EN: `"deploy a forge token"` / `"launch a CROSS Forge token with vendor auth"` / `"create forge pool"` / `"buy 1 TOKEN_B worth of forge token 0x…"` / `"sell my forge holdings"` / `"list trending forge tokens"` / `"show my forge portfolio"` / `"forge trade history for 0x…"`

The skill operates **only on the user's own deployments and their own wallet**. Symbols are globally unique and case-insensitive — never deploy on someone else's behalf without explicit asks.

---

## 2. Prerequisites — verify before doing anything else

```bash
node --version          # require >= 20
```

One-time deps install:

```bash
SKILL_DIR="$HOME/.claude/skills/cross-forge"
[ -d "$SKILL_DIR/node_modules" ] || (cd "$SKILL_DIR" && npm install --silent)
```

For `deploy --auth=client`, ensure `.env` (in the skill dir or the cwd) contains both `CLIENT_KEY` and `CLIENT_SECRET`. The `vendor` path needs no creds.

---

## 3. Credential resolution — strict priority

Two distinct credentials are involved across all subcommands:

### 3.1 ClientKey/Secret  (only for `deploy --auth=client`)

Resolve in this order. Never echo back to the user.

1. `process.env.CLIENT_KEY` + `process.env.CLIENT_SECRET`
2. `./.env` in the user's cwd
3. `$HOME/.claude/skills/cross-forge/.env`
4. **Ask the user** — only if all three lack the keys and the requested invocation actually needs them. Recommend Option A (paste into `~/.claude/skills/cross-forge/.env`, then re-ask) over Option B (one-shot env). Surface that ClientKeys are obtained at `https://cross-ramp-console.crosstoken.io`.

### 3.2 PRIVATE_KEY  (Phase-2: trade-side `buy` / `sell` / future `claim`)

Resolve in this order. **Never echo, never log, never persist.**

1. `process.env.PRIVATE_KEY`
2. `./.env`
3. `$HOME/.claude/skills/cross-forge/.env`
4. **Ask the user** — same Option A / Option B framing as cross-shop. Validation: `^0x[0-9a-fA-F]{64}$`.

For personal testing, the default `env` backend reads the key from local
environment variables or a gitignored `.env` file. For team, hosted-agent, or
production funds, prefer Vault Transit, KMS, or HSM-backed signing so the raw
key is not exported to the agent runtime.

`deploy --wallet=user` does NOT need a PK on this side — the unsigned tx is returned for the frontend to sign. `deploy --wallet=tmp` generates a fresh ephemeral wallet *inside the script* (never persisted, owner permissions non-reusable post-deploy).

---

## 4. Safety rails — apply every time

For every invocation:

1. **Symbol uniqueness warning** — Forge symbols are globally unique and case-insensitive. Before running `deploy`, surface this fact and recommend the user double-check via the live UI.
2. **Image size guard** — `deploy.mjs` aborts if a local image file exceeds 1 MB.
3. **Address shape guard** — `^0x[0-9a-fA-F]{40}$` enforced on `walletAddress` before any tx is built.
4. **Category whitelist** — `game` or `ai_agent`. Confirm with the user; do not infer.
5. **Tmp-wallet caveat surface** — `--wallet=tmp` makes the tmp wallet the token *owner*, and that owner key is **not reusable** after deploy completes. Surface this to the user before invoking.
6. **Vendor address constant** — vendor path POSTs `vendor: 0x254465624da909e0072fbf8c32bcfc26b9fe9da9` (the team's published vendor wallet). Do not change.
7. **Single deploy per token** — once a symbol is registered, it is taken globally. Run `deploy` exactly **once** per token; do not retry on transient errors without first checking whether the deploy already succeeded.
8. **Phase-2 trade rails** (when `buy` / `sell` are unblocked):
   - Chain id check (`eth_chainId === 0xEF577` / `612055`)
   - `MIN_GAS_NATIVE` floor on native CROSS balance before signing
   - `MAX_TRADE_NOTIONAL` cap on TOKEN_B amount
   - `CONFIRM_THRESHOLD` + `--confirm` gate
   - Exact-amount ERC-20 approve by default; `--max-approve` to opt into unlimited
   - Slippage guard (`--slippage=<bps>`, default conservative)
9. **Never echo PK / ClientSecret** — same as siblings.

---

## 5. Execution

All subcommands run via Bash and emit a **single JSON line on stdout**. Stderr stays empty unless `DEBUG=1`.

```bash
cd "$HOME/.claude/skills/cross-forge"
node scripts/<subcommand>.mjs [args]
```

The one exception: `deploy.mjs` ALSO prints human-readable progress lines to stdout (verbatim from official SKILL.md v2.0.1) followed by the final JSON block. When parsing, take the **last** JSON object on stdout.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | runtime error (network, RPC, parse, contract revert) |
| 2 | user error (bad args, invalid address, bad category) |
| 3 | `phase_1_not_captured` — registry slot missing; capture via DevTools first |

### NL → subcommand map

| User says (KR / EN) | Subcommand |
|---|---|
| "Forge 토큰 배포 (vendor + tmp 기본값)" / "deploy forge token defaults" | `node scripts/deploy.mjs "<name>" "<symbol>" "<desc>" "<imgUrl-or-path>" "<feeRecipient>" "<game\|ai_agent>"` |
| "ClientKey + 내 지갑 owner로 deploy" / "deploy with client auth and user wallet" | `node scripts/deploy.mjs --auth=client --wallet=user "<name>" "<symbol>" "<desc>" "<img>" "<myWallet>" "<game\|ai_agent>"` |
| "0x... forge 토큰 정보" / "info on forge token 0x…" | `node scripts/token.mjs <0xAddr> [--recent-limit=10]` |
| "트렌딩 forge 토큰 보여줘" / "list trending forge tokens" | `node scripts/tokens.mjs trending [--category=all\|game\|ai_agent] [--page=1] [--limit=20]` |
| "신규 forge 게임 토큰" / "newest forge game tokens" | `node scripts/tokens.mjs new --category=game` |
| "Top 거래량 forge 토큰" / "top-volume forge tokens" | `node scripts/tokens.mjs top` |
| "1 TOKEN_B 만큼 매수 견적" / "quote buy 1 TOKEN_B of 0x…" | `node scripts/quote.mjs buy <0xAddr> 1 [--fee-bps=130]` |
| "100 토큰 매도 견적" / "quote sell 100 of 0x…" | `node scripts/quote.mjs sell <0xAddr> 100 [--fee-bps=130]` |
| "본딩커브에서 매수" / "buy on forge bonding curve" | `node scripts/buy.mjs <0xAddr> <amountInTokenB> [--slippage=300] [--fee-bps=130] [--confirm]` |
| "본딩커브에서 매도" / "sell my forge token" | `node scripts/sell.mjs <0xAddr> <amountInToken> [--slippage=300] [--fee-bps=130] [--confirm] [--max-approve]` |
| "내 forge 포트폴리오" / "show my forge holdings" | `node scripts/portfolio.mjs <0xWallet> [--enrich-limit=20]` |
| "Forge 글로벌 활동 피드" / "global forge activity" | `node scripts/history.mjs --limit=50` |
| "내 forge 거래 내역" / "my forge trades" | `node scripts/history.mjs --wallet=<0xWallet> --limit=200` |

### Subcommand cheat-sheet

#### `deploy` — works today

```bash
node scripts/deploy.mjs [--auth=client|vendor] [--wallet=user|tmp] \
  "<name>" "<symbol>" "<description>" "<imageUrlOrPath>" "<walletAddress>" "<category>"
```

- **Defaults:** `--auth=vendor --wallet=tmp` ⇒ no signup, no signing UX, finishes both **token deploy** AND **pool creation** in one call.
- `--wallet=user`: returns `{ tokenAddress, tradeLink, unsignedTx }` — the user's frontend must sign the unsignedTx (Router.`createPairWithVirtualReserve(tokenA, TOKEN_B, feeRecipient, deadline)`) for the trade link to come alive.
- `--wallet=tmp`: returns `{ poolCreated, tokenAddress, tradeLink, txHash, blockNumber }` — pool already created, owner key is gone.
- `walletAddress` semantics:
  - `--wallet=user` → token owner **and** creator-fee recipient
  - `--wallet=tmp` → creator-fee recipient only (owner is the throw-away wallet)
- Image: pass an `https://…` URL or a local file path (PNG/JPG, max 1 MB — auto-base64-inlined).
- Category: must be `game` or `ai_agent`. Confirm with the user.

Constants used (verbatim from official SKILL.md v2.0.1):
- Deploy API: `https://cross-console-api.crosstoken.io/api/builder/mcp` (vendor) / `…/api/client/mcp/builder` (client)
- RPC: `https://mainnet.crosstoken.io:22001` (override via `CROSS_RPC_URL`)
- Router: `0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8`
- TOKEN_B: `0xDdF8AaA3927b8Fd5684dc2edcc7287EcB0A2122d`
- Vendor address (POSTed when `--auth=vendor`): `0x254465624da909e0072fbf8c32bcfc26b9fe9da9`
- Trade link: `https://x.crosstoken.io/forge/token/<tokenAddress>`

#### `token` — works today

```bash
node scripts/token.mjs <0xTokenAddress> [--recent-limit=10]
```

Hits the Forge bonding-curve API at `/api/v1/tokens/<addr>` first → returns full metadata (name/symbol/category/description/image), bonding-curve state (`reserveA`, `reserveB`, `virtualReserveB`), and the last `--recent-limit` trades on this token (with per-trade `protocolFee` / `creatorFee` / `referralFee` fields). If the address isn't a Forge token, falls back to Blockscout v2 ERC-20 metadata with `bondingCurve: null`.

#### `tokens` — works today

```bash
node scripts/tokens.mjs <trending|new|top|all> [--category=all|game|ai_agent] [--page=1] [--limit=20]
```

Calls `/api/v1/tokens?sort=...&order=...&category=...&page=...&limit=...`. Filter mapping: `trending`→market_cap·desc, `new`→created_at·desc, `top`→volume_24h·desc, `all`→market_cap·desc. Pagination total observed at 1072 tokens; pages capped at 358 with `--limit=3`.

#### `portfolio` — works today

```bash
node scripts/portfolio.mjs <0xWalletAddress> [--enrich-limit=20]
```

Reads ALL ERC-20 holdings via Blockscout v2, then for the first `--enrich-limit` rows looks each token up in the bonding-curve API to set `isForgeKnown: true|false`, `forgeCurrentPrice`, `forgeMarketCap`, `forgeGraduated`. Rows past `--enrich-limit` get `isForgeKnown: null` (use a higher limit if you have many holdings). The TOKEN_B (WNATIVE) row is detected via `isTokenB: true`.

#### `quote` — works today (read-only, auto-fee)

```bash
node scripts/quote.mjs <buy|sell> <0xTokenAddress> <amount> [--fee-bps=<n>]
```

Reads `factory.getPair(tokenA, tokenB)` → `pair.getReserves()` and computes:
- BUY  : `amountInPostFee = amountIn * (1 - feeBps/10000)`, then `amountOut = amountInPostFee * reserveOut / (reserveIn + amountInPostFee)`
- SELL : `rawOut = amountIn * reserveOut / (reserveIn + amountIn)`, then `amountOut = rawOut * (1 - feeBps/10000)`

**Fee resolution (v0.4):** `--fee-bps=<n>` overrides; otherwise the fee is auto-back-solved from `/api/v1/tokens/<addr>.recent_trades[0]` (typically accurate within rounding for the originator's bps — referral fees inflate it for the referred party). Falls back to `DEFAULT_FEE_BPS = 130` if there are no recent trades or the token isn't in the Forge registry. The envelope surfaces `feeBpsAssumed`, `feeBpsSource: 'override'|'recent_trade'|'default'`, `feeBpsBreakdown: {protocolBps, creatorBps, referralBps}`, `feeBpsSampleTx`, `feeBpsAgeSec`, and (when fallback) `feeBpsFallbackReason`.

Always returns BOTH the assumed-fee `amountOut` AND the no-fee upper bound `amountOutNoFee` for audit.

#### `buy` — works today (sends a tx)

```bash
node scripts/buy.mjs <0xTokenAddress> <amountInTokenB> [--slippage=300] [--fee-bps=130] [--confirm]
```

`amountInTokenB` is in *human native CROSS units* (wrapped to WNATIVE inside the Router). Flow: chain-id check → gas-floor guard → notional/confirm guard → fresh quote (input-side fee) → `amountOutMin = amountOut * (1 - slippageBps/10000)` → sign+send selector `0xc075a591` payable.

#### `sell` — works today (sends a tx)

```bash
node scripts/sell.mjs <0xTokenAddress> <amountInToken> [--slippage=300] [--fee-bps=130] [--confirm] [--max-approve]
```

`amountInToken` is in human units of the Forge token. Flow: same guards → fresh quote (output-side fee) → ERC-20 `approve(ROUTER, amountIn)` (exact unless `--max-approve`) → sign+send selector `0x029e384f`. Notional cap is checked against the *expected TOKEN_B output* (not the input).

#### `history` — works today

```bash
node scripts/history.mjs [--wallet=<0xAddr>] [--limit=50]
```

Calls `/api/v1/feed/recent?limit=N`. With `--wallet=<addr>`, filters client-side by `data.trader == addr` (case-insensitive). Without it, returns the entire global activity feed across all Forge tokens. Each row exposes `{eventType, side, token, trader, amountIn, amountOut, price, marketCap, supply, reserve, protocolFee, creatorFee, referralFee, timestamp, blockNumber, txHash, logIndex}`.

---

## 6. Reporting back

After every action, surface to the user:

- The parsed intent — echo `parsedIntent`
- For `deploy --wallet=tmp`: `poolCreated`, `tokenAddress`, `tradeLink`, `txHash`, `blockNumber`. If `poolCreated:false`, surface the `txHash` and recommend checking on `https://www.crossscan.io/tx/<txHash>`.
- For `deploy --wallet=user`: `tokenAddress`, `tradeLink`, and a clear instruction that the **user must sign `unsignedTx` on their frontend** before the trade link becomes accessible. Echo the unsignedTx fields (to, data, gasLimit, maxFeePerGas, maxPriorityFeePerGas) so the user can verify against their wallet preview.
- For Phase-1 stub envelopes (exit 3): the `missing` slot and `hint`. Tell the user the skill cannot proceed until DevTools capture is added to `references/forge.json`. Offer to walk through `references/forge.md` if they want to do that capture session interactively.

Never include `CLIENT_SECRET` or `PRIVATE_KEY` in the report.

---

## 7. Distribution

This skill folder is the unit of distribution.

1. Copy `cross-forge/` into `~/.claude/skills/`, OR run `install.sh` from the package root to symlink it.
2. Run `cd ~/.claude/skills/cross-forge && npm install` once (or let `install.sh` do it).
3. (Optional, only for `deploy --auth=client`) create `~/.claude/skills/cross-forge/.env` from `.env.example` and fill in `CLIENT_KEY` / `CLIENT_SECRET`.
4. (Future, for trade subcommands) once `references/forge.json` is populated per `references/forge.md`, set `PRIVATE_KEY` in the same `.env`.

Cross-link: `references/forge.md` holds the **DevTools capture playbook** that unblocks the seven Phase-1 stubs. Lazy-load it only when an SPA endpoint shape is unfamiliar or when populating a new slot.
