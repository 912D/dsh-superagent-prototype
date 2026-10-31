#!/usr/bin/env bash
set -uo pipefail
P="$HOME/.dsh/profiles/superagent/cordis.patch.yml"
mkdir -p "$HOME/.dsh/state/superagent"
echo "--- before ---"; cat "$P"
if grep -q "stateDir" "$P" 2>/dev/null; then echo "stateDir already present"; else
cat >> "$P" <<'YML'

# 部署必需：superagent 的数据目录（SETUP 的 Machine configuration）
- id: dsh-superagent
  config:
    stateDir: "/root/.dsh/state/superagent"
YML
fi
echo "--- after ---"; tail -6 "$P"
cd "$HOME/sa"
scripts/dsh-superagent restart 2>&1 | tail -12
