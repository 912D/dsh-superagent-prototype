#!/usr/bin/env bash
set -euo pipefail
SRC="/mnt/f/ScientificAndTechnological/ApplicationDesign/Project/Artifical-Intelligence-Associated-Project/dsh-superagent-msp"
DST="$HOME/sa"
rm -rf "$DST"
mkdir -p "$DST"
cd "$DST"
rsync -a --exclude node_modules --exclude '.dsh*' --exclude '.tools*' --exclude .git "$SRC/" ./
echo "files: $(find . -type f | wc -l)"
pnpm install --prefer-offline > /tmp/in.log 2>&1 || { echo "INSTALL FAILED"; tail -20 /tmp/in.log; exit 1; }
echo "INSTALL OK"
pnpm build > /tmp/b.log 2>&1 || { echo "BUILD FAILED"; tail -20 /tmp/b.log; exit 1; }
echo "BUILD OK"
ls -la lib/index.js lib/msp-watch.js 2>&1 | tail -3
