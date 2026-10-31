#!/usr/bin/env bash
# dsh-superagent-reactive one-line install (Linux / macOS / WSL)
#
#   curl -fsSL https://raw.githubusercontent.com/hxh230802/dsh-superagent-prototype/main/install.sh | bash
#
# Clones (or updates) the checkout, then hands over to scripts/dsh-superagent init,
# which creates the profile, installs the bundle and writes the required stateDir.

set -euo pipefail
REPO="https://github.com/hxh230802/dsh-superagent-prototype.git"
DIR="${HOME}/dsh-superagent-prototype"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "缺少 $1。$2" >&2
    exit 1
  }
}

need git  "apt install git / brew install git"
need node "https://nodejs.org（>= 22）"
need dsh  "npm install -g @deepseek-ai/dsh@0.2.1-rc.3"

if [ -d "$DIR/.git" ]; then
  echo "更新已有 checkout：$DIR"
  git -C "$DIR" pull --ff-only
else
  echo "克隆到 $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi

cd "$DIR"

if command -v python3 >/dev/null 2>&1; then
  exec python3 scripts/dsh-superagent init
elif command -v python >/dev/null 2>&1; then
  exec python scripts/dsh-superagent init
else
  echo '需要 Python 3 来运行 init（只用到标准库）。' >&2
  exit 1
fi
