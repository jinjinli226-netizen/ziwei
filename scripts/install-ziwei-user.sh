#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo '未找到 Node.js/npm。请安装 Node.js 24 或更高版本后重试。' >&2
  exit 1
fi
NODE_MAJOR="$(node --version | sed -E 's/^v([0-9]+).*$/\1/')"
if [[ -z "$NODE_MAJOR" || "$NODE_MAJOR" -lt 24 ]]; then
  echo "需要 Node.js 24 或更高版本，当前为 $(node --version)。" >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules/vue" ]]; then
  echo '正在安装紫薇依赖...'
  npm ci --ignore-scripts
fi

# This installs only the local Ziwei daemon. It never downloads or invokes an
# AuraBaba executable and does not accept credentials.
npm run ziwei:setup -- "$@"
npm run ziwei:start
