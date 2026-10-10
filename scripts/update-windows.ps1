# Official bootstrap for older Windows clients which do not yet have update/stop.
# Run in a normal PowerShell terminal: irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw '本次维护入口仅支持 Windows。' }
$ziweiNode = (Get-Command node -ErrorAction Stop).Source
$ziweiNpm = (Get-Command npm.cmd -ErrorAction Stop).Source
$ziweiNodeMajor = [int]((& $ziweiNode --version).Trim().TrimStart('v').Split('.')[0])
if ($ziweiNodeMajor -lt 24) { throw '需要 Node.js 24 或更高版本。' }
$ziweiModules = (& $ziweiNpm root --global).Trim()
if ($LASTEXITCODE -ne 0) { throw '无法读取当前 npm 全局安装目录。' }
$ziweiInstalledRoot = Join-Path $ziweiModules 'ziwei'
if (-not (Test-Path -LiteralPath (Join-Path $ziweiInstalledRoot 'package.json'))) { throw '当前 npm prefix 未安装紫薇，请使用网页安装命令；不会更改 npm prefix。' }
$ziweiInstalledMeta = Get-Content -Raw -LiteralPath (Join-Path $ziweiInstalledRoot 'package.json') | ConvertFrom-Json
if ($ziweiInstalledMeta.name -ne 'ziwei') { throw '安装身份不匹配，未修改程序。' }
$ziweiMaintenanceDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('ziwei-updater-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $ziweiMaintenanceDirectory
$ziweiRelease = Invoke-RestMethod -Uri 'https://qzelynth.top/downloads/cli/release.json' -MaximumRedirection 0
if ($ziweiRelease.url -ne 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz' -or $ziweiRelease.sha256 -notmatch '^[0-9a-f]{64}$') { throw '官方客户端发布清单无效。' }
$ziweiArchive = Join-Path $ziweiMaintenanceDirectory 'ziwei-latest.tgz'
Invoke-WebRequest -UseBasicParsing -Uri $ziweiRelease.url -OutFile $ziweiArchive -MaximumRedirection 0
if ((Get-FileHash -LiteralPath $ziweiArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ziweiRelease.sha256) { throw '下载包 SHA-256 校验失败，原安装未修改。' }
$ziweiStagePrefix = Join-Path $ziweiMaintenanceDirectory 'bootstrap-prefix'
& $ziweiNpm install --global --prefix $ziweiStagePrefix $ziweiArchive --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '更新器准备失败，原安装未修改。' }
$ziweiUpdaterEntry = Join-Path $ziweiStagePrefix 'node_modules\ziwei\scripts\ziwei-user.mjs'
$ziweiQueuedText = & $ziweiNode $ziweiUpdaterEntry update --target $ziweiInstalledRoot --package $ziweiArchive --sha256 $ziweiRelease.sha256 --json
if ($LASTEXITCODE -ne 0) { throw '更新任务提交失败，原安装未修改。' }
$ziweiQueued = $ziweiQueuedText | ConvertFrom-Json
Write-Host ('更新任务正在包外执行，结果文件：' + $ziweiQueued.resultFile)
$ziweiWaitUntil = [DateTime]::UtcNow.AddMinutes(5)
while ([DateTime]::UtcNow -lt $ziweiWaitUntil) {
  $ziweiResult = Get-Content -Raw -LiteralPath $ziweiQueued.resultFile | ConvertFrom-Json
  if ($ziweiResult.state -eq 'complete') {
    Write-Host ('紫薇更新完成，实际 build：' + $ziweiResult.clientBuild)
    Write-Host '原 npm prefix、主/共享连接、设备身份及用户数据已保留。'
    break
  }
  if ($ziweiResult.state -eq 'failed') { throw ($ziweiResult.message + ' 结果文件：' + $ziweiQueued.resultFile) }
  Start-Sleep -Milliseconds 500
}
if ($ziweiResult.state -ne 'complete') { throw ('更新仍未完成；请查看结果文件，不要重新配对：' + $ziweiQueued.resultFile) }
