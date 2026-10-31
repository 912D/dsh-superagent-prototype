# dsh-superagent-reactive one-line install (Windows PowerShell)
#
#   irm https://raw.githubusercontent.com/hxh230802/dsh-superagent-prototype/main/install.ps1 | iex
#
# Clones (or updates) the checkout, then hands over to scripts/dsh-superagent init,
# which creates the profile, installs the bundle and writes the required stateDir.

$ErrorActionPreference = 'Stop'
$repo = 'https://github.com/hxh230802/dsh-superagent-prototype.git'
$dir  = Join-Path $HOME 'dsh-superagent-prototype'

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "缺少 $cmd。" -ForegroundColor Red
    Write-Host "  $hint" -ForegroundColor Yellow
    exit 1
  }
}

Need git   'winget install --id Git.Git -e'
Need node  'winget install --id OpenJS.NodeJS.LTS -e'
Need dsh   'npm install -g @deepseek-ai/dsh@0.2.1-rc.3'

if (Test-Path (Join-Path $dir '.git')) {
  Write-Host "更新已有 checkout：$dir"
  git -C $dir pull --ff-only
} else {
  Write-Host "克隆到 $dir"
  git clone --depth 1 $repo $dir
}

Set-Location $dir

# init 由 Python 脚本提供（上游如此）。有 python 就用，没有就提示。
if (Get-Command python -ErrorAction SilentlyContinue) {
  python scripts/dsh-superagent init
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
  py scripts/dsh-superagent init
} else {
  Write-Host '需要 Python 3 来运行 init（只用到标准库）：winget install --id Python.Python.3.12 -e' -ForegroundColor Red
  exit 1
}
