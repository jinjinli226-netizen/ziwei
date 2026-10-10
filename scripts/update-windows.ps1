# Keep this bootstrap ASCII without a BOM: Windows PowerShell 5.1 decodes an
# octet-stream IRM response using its legacy encoding, even when a BOM exists.
# Run: irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
$ErrorActionPreference = 'Stop'
$ziweiPreviousEncoding = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  if ($env:OS -ne 'Windows_NT') { throw 'This update entry supports Windows only.' }
  $ziweiNode = (Get-Command node -ErrorAction Stop).Source
  $ziweiNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $ziweiNodeMajor = [int]((& $ziweiNode --version).Trim().TrimStart('v').Split('.')[0])
  if ($ziweiNodeMajor -lt 24) { throw 'Node.js 24 or later is required.' }
  $ziweiModules = (& $ziweiNpm root --global).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read the current global npm directory.' }
  $ziweiInstalledRoot = Join-Path $ziweiModules 'ziwei'
  if (-not (Test-Path -LiteralPath (Join-Path $ziweiInstalledRoot 'package.json'))) { throw 'Ziwei is not installed in this npm prefix. Use the installation command from the website.' }
  $ziweiInstalledMeta = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ziweiInstalledRoot 'package.json') | ConvertFrom-Json
  if ($ziweiInstalledMeta.name -ne 'ziwei') { throw 'Package identity does not match; nothing was changed.' }
  $ziweiMaintenanceDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('ziwei-updater-' + [guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path $ziweiMaintenanceDirectory
  $ziweiRelease = Invoke-RestMethod -Uri 'https://qzelynth.top/downloads/cli/release.json' -MaximumRedirection 0
  if ($ziweiRelease.url -ne 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz' -or $ziweiRelease.sha256 -notmatch '^[0-9a-f]{64}$') { throw 'Invalid official release manifest.' }
  $ziweiArchive = Join-Path $ziweiMaintenanceDirectory 'ziwei-latest.tgz'
  Invoke-WebRequest -UseBasicParsing -Uri $ziweiRelease.url -OutFile $ziweiArchive -MaximumRedirection 0
  $ziweiHasher = [System.Security.Cryptography.SHA256]::Create()
  try { $ziweiArchiveHash = [BitConverter]::ToString($ziweiHasher.ComputeHash([System.IO.File]::ReadAllBytes($ziweiArchive))).Replace('-', '').ToLowerInvariant() } finally { $ziweiHasher.Dispose() }
  if ($ziweiArchiveHash -ne $ziweiRelease.sha256) { throw 'SHA-256 verification failed; the original installation was not changed.' }
  $ziweiStagePrefix = Join-Path $ziweiMaintenanceDirectory 'bootstrap-prefix'
  & $ziweiNpm install --global --prefix $ziweiStagePrefix $ziweiArchive --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Updater staging failed; the original installation was not changed.' }
  $ziweiUpdaterEntry = Join-Path $ziweiStagePrefix 'node_modules\ziwei\scripts\ziwei-user.mjs'
  $ziweiQueuedText = & $ziweiNode $ziweiUpdaterEntry update --target $ziweiInstalledRoot --package $ziweiArchive --sha256 $ziweiRelease.sha256 --json
  if ($LASTEXITCODE -ne 0) { throw 'Update submission failed; the original installation was not changed.' }
  $ziweiQueued = $ziweiQueuedText | ConvertFrom-Json
  Write-Host ('The update runs outside the package. Result: ' + $ziweiQueued.resultFile)
  $ziweiWaitUntil = [DateTime]::UtcNow.AddMinutes(5)
  while ([DateTime]::UtcNow -lt $ziweiWaitUntil) {
    $ziweiResult = Get-Content -Raw -Encoding UTF8 -LiteralPath $ziweiQueued.resultFile | ConvertFrom-Json
    if ($ziweiResult.state -eq 'complete') {
      Write-Host ('Ziwei update complete. Actual build: ' + $ziweiResult.clientBuild)
      Write-Host 'The original npm prefix, main/shared connections, device identity and user data were preserved.'
      break
    }
    if ($ziweiResult.state -eq 'failed') { throw ($ziweiResult.message + ' Result file: ' + $ziweiQueued.resultFile) }
    Start-Sleep -Milliseconds 500
  }
  if ($ziweiResult.state -ne 'complete') { throw ('Update has not completed. Check the result file; do not pair again: ' + $ziweiQueued.resultFile) }
} finally {
  [Console]::OutputEncoding = $ziweiPreviousEncoding
}
