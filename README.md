# skill-cross-forge

A distributable Claude Code skill that drives **CROSS Forge** (`https://x.crosstoken.io/forge/`) — the NEXUS / Verse8 *Game Token Launch & Market Creation Layer* on CROSS Chain (`612055`).

It wraps the canonical agent-skill at `https://contents.crosstoken.io/forge/agent-skills/SKILL.md` (v2.0.1) verbatim for token deployment + bonding-curve pool creation, and adds Phase-1 stubs for the SPA's trade / portfolio / history surfaces.

> **v0.4 — per-token fee auto-detection**
>
> | Subcommand | Status |
> |---|---|
> | `deploy` | ✅ Builder API + Router pool creation (verbatim SKILL.md v2.0.1) |
> | `token` | ✅ Forge bonding-curve API (curve state + recent trades) → Blockscout fallback |
> | `tokens` | ✅ Forge bonding-curve API (trending / new / top / all + category + pagination) |
> | `portfolio` | ✅ Blockscout cross-joined with Forge API (`isForgeKnown`, market cap, graduated) |
> | `history` | ✅ Forge global activity feed + client-side `--wallet=` filter |
> | `quote` / `buy` / `sell` | ✅ Custom-selector swaps + **per-token fee auto-detected** from recent trades |
>
> The fee schedule turned out to be **per-token** (HERO=130 bps, ARA=80 bps, etc.) — v0.4 back-solves the actual bps from `/api/v1/tokens/<addr>.recent_trades[0]` whenever `--fee-bps` is not explicit, falling back to a 130 bps conservative default for tokens with no recent trades. Envelope surfaces `feeBpsSource: 'override'|'recent_trade'|'default'` with full breakdown. See `skills/cross-forge/references/forge.md` §4.4.

---

## Install

```bash
git clone https://github.com/to-nexus/skill-cross-forge.git
cd skill-cross-forge
./install.sh
```

The installer symlinks `skills/cross-forge/` into `~/.claude/skills/cross-forge/` and runs `npm install`. Re-runnable.

For `deploy --auth=client`, copy `.env.example → .env` inside the skill dir and fill in `CLIENT_KEY` / `CLIENT_SECRET` from `https://cross-ramp-console.crosstoken.io`.

---

## Use it from Claude Code

Just ask in natural language. Triggers include:

- KR: `"CROSS Forge 토큰 배포"`, `"forge에 게임 토큰 발행"`, `"forge 풀 생성"`, `"forge 본딩커브 매수"`, `"내 forge 포트폴리오"`
- EN: `"deploy a forge token"`, `"launch CROSS Forge token"`, `"buy on forge bonding curve"`, `"list trending forge tokens"`

Or invoke the scripts directly:

```bash
# Defaults: --auth=vendor --wallet=tmp  →  no signup, deploy + pool in one shot
node ~/.claude/skills/cross-forge/scripts/deploy.mjs \
  "MyToken" "MTK" "A fun community token" \
  "https://example.com/token.png" \
  "0xYourFeeRecipient" "game"

# Client auth + user wallet  →  returns unsigned pool tx for frontend signing
node ~/.claude/skills/cross-forge/scripts/deploy.mjs \
  --auth=client --wallet=user \
  "MyToken" "MTK" "A fun community token" "./token.png" \
  "0xYourWallet" "game"
```

---

## Layout

```
skill-cross-forge/
├─ .claude-plugin/plugin.json
├─ install.sh
├─ README.md
├─ LICENSE
└─ skills/cross-forge/
   ├─ SKILL.md                  ← driver doc (loaded by Claude on activation)
   ├─ package.json              ← deps: ethers ^6.14, dotenv ^17
   ├─ .env.example
   ├─ scripts/
   │  ├─ deploy.mjs             ← verbatim port of upstream SKILL.md v2.0.1
   │  ├─ tokens.mjs             ← Phase-1 stub
   │  ├─ token.mjs              ← Phase-1 stub
   │  ├─ quote.mjs              ← Phase-1 stub
   │  ├─ buy.mjs                ← Phase-1 stub
   │  ├─ sell.mjs               ← Phase-1 stub
   │  ├─ portfolio.mjs          ← Phase-1 stub
   │  ├─ history.mjs            ← Phase-1 stub
   │  └─ _envelope.mjs          ← shared single-line JSON emitter
   └─ references/
      └─ forge.md               ← capture playbook for the Phase-1 stubs
```

---

## Constants (verbatim from upstream)

| Name | Value |
|---|---|
| Chain id | `612055` (CROSS Chain mainnet) |
| RPC URL | `https://mainnet.crosstoken.io:22001` |
| Vendor deploy API | `https://cross-console-api.crosstoken.io/api/builder/mcp` |
| Client deploy API | `https://cross-console-api.crosstoken.io/api/client/mcp/builder` |
| Forge Router | `0x7aF414e4d373bb332f47769c8d28A446A0C1a1E8` (ERC1967 proxy → impl `0x4F0e564094…`) |
| Forge Factory | `0x78E53A7f8fD5e87906F0d4b6f7f85246AADE39E9` |
| TOKEN_B (WNATIVE) | `0xDdF8AaA3927b8Fd5684dc2edcc7287EcB0A2122d` (18 decimals) |
| BUY selector | `0xc075a591` `(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable` |
| SELL selector | `0x029e384f` `(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)` |
| Vendor wallet | `0x254465624da909e0072fbf8c32bcfc26b9fe9da9` |
| Trade-link template | `https://x.crosstoken.io/forge/token/<tokenAddress>` |

---

## Adjacent skills

- `da:token` — partial overlap (calls Builder API but does not create the pool). Prefer this skill's `deploy` for full launch.
- `cross-explorer` — raw on-chain reads (Blockscout v2). Use it instead of `portfolio` if you only need ERC-20 balances.
- `cross-dex-trade` — Gametoken orderbook on the same chain. **Different contract** — does not apply to Forge bonding curves.

---

## License

MIT for the scaffolding. The `deploy.mjs` script is a verbatim port of the canonical agent-skill at `https://contents.crosstoken.io/forge/agent-skills/SKILL.md` by NEXUS / Verse8 — its use is subject to the publisher's terms.
