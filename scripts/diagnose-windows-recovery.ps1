# Read-only recovery support. No installation, stopping, replay or credentials output.
$ErrorActionPreference = 'Stop'
$ziweiDiagnosticEncoding = [Console]::OutputEncoding
$ziweiDiagnosticDirectory = $null
$ziweiDiagnosticDirectoryCreated = $false
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
  if ($env:OS -ne 'Windows_NT') { throw 'This diagnostic supports Windows only.' }
  $ziweiDiagnosticNode = (Get-Command node -ErrorAction Stop).Source
  $ziweiDiagnosticNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
  $ziweiDiagnosticModules = (& $ziweiDiagnosticNpm root --global).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Cannot locate the installed Ziwei package.' }
  $ziweiDiagnosticRoot = Join-Path $ziweiDiagnosticModules 'ziwei'
  $ziweiDiagnosticPackage = Get-Content -LiteralPath (Join-Path $ziweiDiagnosticRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($ziweiDiagnosticPackage.name -ne 'ziwei') { throw 'The installed package is not Ziwei.' }
  $ziweiDiagnosticManifest = Invoke-RestMethod -Uri 'https://qzelynth.top/downloads/cli/recovery-diagnostic.json' -MaximumRedirection 0 -TimeoutSec 45
  if ($ziweiDiagnosticManifest.schemaVersion -ne 1 -or $ziweiDiagnosticManifest.readOnly -ne $true -or $ziweiDiagnosticManifest.url -ne 'https://qzelynth.top/downloads/cli/diagnose-bot-recovery.mjs' -or $ziweiDiagnosticManifest.sha256 -notmatch '^[0-9a-f]{64}$' -or $ziweiDiagnosticManifest.commit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid official diagnostic manifest.' }
  $ziweiDiagnosticDirectory = Join-Path ([IO.Path]::GetTempPath()) ('ziwei-readonly-diagnostic-' + [guid]::NewGuid().ToString('N'))
  $null = New-Item -ItemType Directory -Path $ziweiDiagnosticDirectory
  $ziweiDiagnosticDirectoryCreated = $true
  $ziweiDiagnosticFile = Join-Path $ziweiDiagnosticDirectory 'diagnose-bot-recovery.mjs'
  Invoke-WebRequest -UseBasicParsing -Uri $ziweiDiagnosticManifest.url -OutFile $ziweiDiagnosticFile -MaximumRedirection 0 -TimeoutSec 45
  if ((Get-Item -LiteralPath $ziweiDiagnosticFile).Length -gt 1048576) { throw 'The diagnostic file exceeds its size limit.' }
  $ziweiDiagnosticHasher = [Security.Cryptography.SHA256]::Create()
  try { $ziweiDiagnosticHash = [BitConverter]::ToString($ziweiDiagnosticHasher.ComputeHash([IO.File]::ReadAllBytes($ziweiDiagnosticFile))).Replace('-', '').ToLowerInvariant() } finally { $ziweiDiagnosticHasher.Dispose() }
  if ($ziweiDiagnosticHash -ne $ziweiDiagnosticManifest.sha256) { throw 'Diagnostic SHA-256 verification failed.' }
  Write-Host 'Read-only diagnostic: no update, stop, replay or Bot configuration changes.'
  & $ziweiDiagnosticNode $ziweiDiagnosticFile --root $ziweiDiagnosticRoot
  if ($LASTEXITCODE -ne 0) { throw 'The read-only diagnostic could not complete.' }
} finally {
  if ($ziweiDiagnosticDirectoryCreated -and (Test-Path -LiteralPath $ziweiDiagnosticDirectory)) { Remove-Item -LiteralPath $ziweiDiagnosticDirectory -Recurse -Force -ErrorAction SilentlyContinue }
  [Console]::OutputEncoding = $ziweiDiagnosticEncoding
}
