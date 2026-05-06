#!/usr/bin/env bash
# cross-forge installer — symlinks the skill into ~/.claude/skills/ and
# installs Node deps. Idempotent: safe to re-run.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_SRC="$REPO_DIR/skills/cross-forge"
SKILL_DST="$HOME/.claude/skills/cross-forge"

if [ ! -d "$SKILL_SRC" ]; then
  echo "ERROR: $SKILL_SRC not found. Run install.sh from inside the cloned repo." >&2
  exit 1
fi

mkdir -p "$HOME/.claude/skills"

if [ -L "$SKILL_DST" ]; then
  current="$(readlink "$SKILL_DST")"
  if [ "$current" = "$SKILL_SRC" ]; then
    echo "✓ symlink already points at $SKILL_SRC"
  else
    echo "↻ updating symlink: $SKILL_DST → $SKILL_SRC (was $current)"
    rm "$SKILL_DST"
    ln -s "$SKILL_SRC" "$SKILL_DST"
  fi
elif [ -e "$SKILL_DST" ]; then
  echo "ERROR: $SKILL_DST already exists and is NOT a symlink." >&2
  echo "  Move/back it up, then re-run install.sh." >&2
  exit 1
else
  ln -s "$SKILL_SRC" "$SKILL_DST"
  echo "✓ symlinked $SKILL_DST → $SKILL_SRC"
fi

echo "↻ installing Node deps in $SKILL_SRC ..."
( cd "$SKILL_SRC" && npm install --silent )
echo "✓ deps installed"

if [ ! -f "$SKILL_SRC/.env" ]; then
  cat <<EOF

NEXT STEPS

  1. Try a no-credential dry run (defaults: vendor + tmp wallet):
       node $SKILL_SRC/scripts/deploy.mjs --help

  2. Deploy a token + bonding-curve pool in one shot (no signup needed):
       node $SKILL_SRC/scripts/deploy.mjs \\
         "MyToken" "MTK" "A fun community token" \\
         "https://example.com/token.png" \\
         "0xYourFeeRecipientAddress" "game"

  3. (Only for --auth=client) create your wallet env file:
       cp $SKILL_SRC/.env.example $SKILL_SRC/.env
       chmod 600 $SKILL_SRC/.env
     Then edit it and set CLIENT_KEY / CLIENT_SECRET (from https://cross-ramp-console.crosstoken.io).

  4. Try it from Claude Code:
       "CROSS Forge에 게임 토큰 배포해줘"
       "deploy a CROSS Forge token"
       "list trending forge tokens"   (will exit 3 — see references/forge.md)

  NOTE: Phase-1 trade-side subcommands (tokens, token, quote, buy, sell,
  portfolio, history) all exit 3 with phase_1_not_captured until
  $SKILL_SRC/references/forge.md DevTools capture is followed.

EOF
else
  echo "✓ $SKILL_SRC/.env already present — skipping setup"
fi
