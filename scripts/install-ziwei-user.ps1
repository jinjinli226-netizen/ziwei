$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm was not found. Install Node.js 24 or newer first.'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node was not found. Install Node.js 24 or newer first.'
}
$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v?(\d+)') {
  throw "Unable to determine Node.js version ($nodeVersion). Install Node.js 24 or newer first."
}
if ([int]$Matches[1] -lt 24) {
  throw "Node.js 24 or newer is required (found $nodeVersion)."
}

Push-Location $root
try {
  # Local installer for Ziwei; it does not download AuraBaba CLI or accept tokens.
  & npm run ziwei:setup -- $args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node scripts/start-ziwei-user.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

