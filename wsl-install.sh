#!/usr/bin/env bash
set -uo pipefail
cd "$HOME/sa"

echo "== tmux =="
if ! command -v tmux >/dev/null; then
  (apt-get update -qq && apt-get install -y -qq tmux) > /tmp/apt.log 2>&1 && echo "tmux installed" || { echo "tmux install failed"; tail -5 /tmp/apt.log; }
else echo "tmux $(tmux -V)"; fi

echo "== dsh =="
if ! command -v dsh >/dev/null; then
  npm install -g @deepseek-ai/dsh@0.2.1-rc.3 > /tmp/dshinst.log 2>&1 && echo "dsh installed" || { echo "dsh install failed"; tail -10 /tmp/dshinst.log; }
fi
dsh --version

echo "== profile =="
dsh superagent --from-default-profile web --dump-config > /dev/null 2>/tmp/prof.log && echo "profile ok" || { echo "profile failed"; tail -10 /tmp/prof.log; }

echo "== plugin =="
dsh plugin --profile superagent add "link:$PWD" > /tmp/add.log 2>&1 && echo "plugin ok" || { echo "plugin failed"; tail -10 /tmp/add.log; }

echo "== start =="
scripts/dsh-superagent start 2>&1 | tail -15
echo "START_EXIT=$?"
