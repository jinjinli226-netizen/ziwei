# One named current-user task: authorized owned idle daemon root stop, official update, normal start.
# No historical settlement, replay, deletion, process-tree claim, or unknown-process termination.
param([ValidateSet('Worker')][string]$Mode = 'Worker',[string]$SourceFile = $PSCommandPath)
$ErrorActionPreference = 'Stop'
$TaskName = 'Ziwei.TK.Scope.Update.20261018'
$ExpectedCommit = 'acee34d32f04167038cb1b55eab2377c142df614'
$ExpectedBuild = '5a642107fa32d8e8f09ea139a9f964e7f50c77d9648788ae5aba6e96ac509fec'
$ExpectedArchive = 'e386b28ab38fddfa53c88091418f372a2c91ebd8c1402b19d3db22b1d60e157c'
$ExpectedBootstrap = '526882bbed69de976a546e4d1cff122d55ab838d5d3ab4bad621121dd7cdd9bd'
$ExpectedBootstrapBytes = '6390'
$OfficialBase = 'https://qzelynth.top/downloads/cli/'
$Stage = 'initializing'
$JobDirectory = Join-Path $env:LOCALAPPDATA 'Ziwei\ziwei_user\maintenance\tk-scope-update-20261018'
$WorkerFile = Join-Path $JobDirectory 'task.ps1'
$PlanFile = Join-Path $JobDirectory 'plan.json'
$AttemptFile = Join-Path $JobDirectory 'attempt.json'
$StatusFile = Join-Path $JobDirectory 'status.json'
$UpdaterFailure = $null
$RecoverySnapshot = $null
$OwnedStopFailure = $null
$ForceStopAttempted = $false
$StopHelperSha = '8bee5728871440d0dee6f739084be99aaf30a62d4cffca15dfee49a3ba354de3'
$HandleHelperSha = '8c8b08032aaabff65912a2cdfd4e0466ff5b19b1442addd5104015c481aa8f51'
$Encoding = New-Object System.Text.UTF8Encoding($false)
function Sha([byte[]]$Bytes) {
  $h = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($h.ComputeHash($Bytes)).Replace('-','').ToLowerInvariant() } finally { $h.Dispose() }
}
function ExactFile([string]$File,[byte[]]$Bytes) {
  if (Test-Path -LiteralPath $File) {
    if ((Get-Item -LiteralPath $File).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'FILE_CHANGED' }
    if ((Sha ([IO.File]::ReadAllBytes($File))) -cne (Sha $Bytes)) { throw 'FILE_CHANGED' }
    return
  }
  $s = [IO.File]::Open($File,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $s.Write($Bytes,0,$Bytes.Length); $s.Flush($true) } finally { $s.Dispose() }
}
function Status([string]$State,[string]$Code) {
  $value = [ordered]@{schemaVersion=1;task=$TaskName;state=$State;stage=$Stage;code=$Code;expectedClientBuild=$ExpectedBuild;at=[DateTime]::UtcNow.ToString('o')}
  if ($UpdaterFailure) { $value.updaterSnapshot = $UpdaterFailure }
  if ($RecoverySnapshot) { $value.recovery = $RecoverySnapshot }
  if ($FailureDetail) { $value.failure = $FailureDetail }
  if ($OwnedStopFailure) { $value.ownedStop = $OwnedStopFailure }
  $temporary = $StatusFile + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
  [IO.File]::WriteAllText($temporary,($value | ConvertTo-Json -Compress),$Encoding)
  if (Test-Path -LiteralPath $StatusFile) { [IO.File]::Replace($temporary,$StatusFile,($StatusFile + '.backup.' + [guid]::NewGuid().ToString('N'))) } else { [IO.File]::Move($temporary,$StatusFile) }
  $value | ConvertTo-Json -Compress | Write-Output
}
function LocalHealth([string]$Endpoint) {
  $response = $null
  try {
    $request = [Net.HttpWebRequest]::Create($Plan.origin + $Endpoint)
    $request.Proxy = $null; $request.Timeout = 3000; $request.ReadWriteTimeout = 3000; $request.AllowAutoRedirect = $false
    $response = $request.GetResponse()
    if ([int]$response.StatusCode -ne 200) { return $null }
    $reader = New-Object IO.StreamReader($response.GetResponseStream())
    try { $text=$reader.ReadToEnd(); if ($text.Length -gt 1048576) { return $null }; return ($text | ConvertFrom-Json) } finally { $reader.Dispose() }
  } catch { return $null } finally { if ($response) { $response.Dispose() } }
}
function SameClient($Health) {
  return ($null -ne $Health -and $Health.service -ceq 'ziwei_user' -and $Health.agentId -ceq 'ziwei_user' -and $Health.workspace -ceq $Plan.workspace -and $Health.deviceId -ceq $Plan.deviceId -and $Health.lifecycle.root.TrimEnd('\') -ieq $Plan.root.TrimEnd('\'))
}
function ReadyTarget {
  $h = LocalHealth '/readyz'
  return ((SameClient $h) -and $h.ready -eq $true -and $h.clientBuild -ceq $ExpectedBuild)
}
function OwnTask($Task) {
  try {
    $taskUser = [string]$Task.Definition.Principal.UserId
    $taskSid = if ($taskUser -match '^S-[0-9]+-') { (New-Object Security.Principal.SecurityIdentifier($taskUser)).Value } else { (New-Object Security.Principal.NTAccount($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value }
  } catch { return $false }
  return ($Task.Definition.RegistrationInfo.Description -ceq ('Ziwei one-shot ' + $ScriptHash) -and $taskSid -ceq $Sid -and $Task.Definition.Principal.LogonType -eq 3 -and $Task.Definition.Principal.RunLevel -eq 0 -and $Task.Definition.Actions.Count -eq 1 -and $Task.Definition.Actions.Item(1).Path -ieq $PowerShell -and $Task.Definition.Actions.Item(1).Arguments -ceq $TaskArguments -and $Task.Definition.Actions.Item(1).WorkingDirectory -ieq $JobDirectory)
}
function ExactRunner([string]$File,[string]$ExpectedHash,[string]$Arguments) {
  return '$p=''' + $File.Replace("'","''") + ''';$b=[IO.File]::ReadAllBytes($p);$h=[Security.Cryptography.SHA256]::Create();try{$s=[BitConverter]::ToString($h.ComputeHash($b)).Replace(''-'','''').ToLowerInvariant()}finally{$h.Dispose()};if($s -cne ''' + $ExpectedHash + '''){throw ''SCRIPT_SHA_MISMATCH''};& ([scriptblock]::Create([Text.Encoding]::UTF8.GetString($b))) ' + $Arguments
}
function ReadPublicUpdaterStatus {
  try {
    $text = (& (Join-Path $Plan.nodeDirectory 'node.exe') (Join-Path $Plan.root 'scripts\ziwei-user.mjs') update-status --json 2>$null | Out-String)
    if ($text.Length -gt 65536) { return $null }
    $row = $text | ConvertFrom-Json
    $stages = @('validate_installation','resolve_npm','validate_paths','verify_archive','read_release_manifest','download_package','stage_install','validate_candidate','prepare_candidate','recover_history','stop_client','verify_original','backup_original','activate_candidate','verify_installation','restart_client','verify_configuration','stop_failed_candidate','restore_original','restart_original','read_restoration_configuration','wait_parent','acquire_lock','unknown')
    $codes = @('UPDATE_FAILED','MAINTENANCE_WORKER_EXITED','MAINTENANCE_BUSY','MAINTENANCE_OWNER_UNVERIFIED','CLIENT_BUSY','CONTROL_REJECTED','CLIENT_FORCE_ABANDON_REFUSED','HISTORICAL_PRELAUNCH_RECOVERY_REFUSED','RETAINED_STOP_RECOVERY_REFUSED','INSTALL_CHANGED','CONFIG_CHANGED','UPDATE_HASH_INVALID','UPDATE_HTTP_FAILED','UPDATE_TOO_LARGE','UPDATE_SOURCE_INVALID','UPDATE_MANIFEST_INVALID','UPDATE_BUILD_MISMATCH','NPM_UNAVAILABLE','INVALID_PARENT','PARENT_STILL_RUNNING','EBUSY','EPERM','EACCES','ENOENT','ENOSPC','EIO','ETIMEDOUT','ECONNREFUSED','ECONNRESET','ENOTFOUND','PROCESS_EXIT_NONZERO','PROCESS_TERMINATED','HEALTH_MISSING','STOP_TIMEOUT','STOP_FAILED')
    $safe = [ordered]@{source='latest-update-status';attribution='snapshot_only'}
    if ($row.state -cin @('none','queued','running','complete','failed','interrupted')) { $safe.state=$row.state }
    if ($row.failureStage -cin $stages) { $safe.failureStage=$row.failureStage }
    if ($row.reasonCode -cin $codes -or $row.reasonCode -cin @($stages | ForEach-Object { $_.ToUpperInvariant()+'_FAILED' })) { $safe.reasonCode=$row.reasonCode }
    if ($row.code -cin $codes) { $safe.code=$row.code }
    return $safe
  } catch { return $null }
}
try {
  if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_ONLY' }
  if ($ExpectedCommit -cnotmatch '^[a-f0-9]{40}$' -or $ExpectedBuild -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedArchive -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedBootstrap -cnotmatch '^[a-f0-9]{64}$' -or $ExpectedBootstrapBytes -le 0 -or $ExpectedBuild -ceq '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e') { throw 'TARGET_NOT_FROZEN' }
  $env:npm_config_prefix = 'C:\Users\PC\AppData\Roaming\npm'
  $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $PowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $ScriptBytes = [IO.File]::ReadAllBytes($SourceFile); $ScriptHash = Sha $ScriptBytes
  $TaskArguments = '-NoLogo -NoProfile -NonInteractive -Command "& { ' + (ExactRunner $WorkerFile $ScriptHash '-Mode Worker -SourceFile $p') + ' }"'
  $Scheduler = New-Object -ComObject 'Schedule.Service'; $Scheduler.Connect(); $Folder = $Scheduler.GetFolder('\')
  $Existing = @($Folder.GetTasks(1) | Where-Object { $_.Name -ceq $TaskName })
  if ($Existing.Count -gt 1 -or ($Existing.Count -eq 1 -and -not (OwnTask $Existing[0]))) { throw 'TASK_NAME_IN_USE' }
  $Stage = 'worker_preflight'
  $Plan = [IO.File]::ReadAllText($PlanFile) | ConvertFrom-Json
  if ($Plan.task -cne $TaskName -or $Plan.sourceBuild -cne '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e' -or $Plan.priorTaskSha256 -cne '74e1a307bb2902a3a7243b39735e86bb43fa4e4d50b345b27b52bf66f4e25953' -or $Plan.ownerSid -cne $Sid -or $Plan.scriptSha256 -cne $ScriptHash -or $Plan.expectedBuild -cne $ExpectedBuild -or $Existing.Count -ne 1 -or $SourceFile -ine $WorkerFile) { throw 'FILE_CHANGED' }
  $env:ZIWEI_USER_HOME = $Plan.userDirectory; $env:ZIWEI_CONFIG = $Plan.configPath
  $env:Path = $Plan.nodeDirectory + ';' + $Plan.npmDirectory + ';' + $env:Path
  if (Test-Path -LiteralPath $AttemptFile) { throw 'ATTEMPT_ALREADY_RECORDED' }
  $Stage = 'official_release_check'
  $release = Invoke-RestMethod -Uri ($OfficialBase+'release.json') -MaximumRedirection 0 -TimeoutSec 45
  if ($release.commit -cne $ExpectedCommit -or $release.clientBuild -cne $ExpectedBuild -or $release.sha256 -cne $ExpectedArchive -or $release.url -cne ($OfficialBase+'ziwei-latest.tgz') -or $release.updateWindowsScript.sha256 -cne $ExpectedBootstrap -or $release.updateWindowsScript.url -cne ($OfficialBase+'update-windows.ps1')) { throw 'OFFICIAL_RELEASE_CHANGED' }
  $bootstrap = Join-Path $JobDirectory 'update-windows.ps1'
  $download = Invoke-WebRequest -UseBasicParsing -Uri ($OfficialBase+'update-windows.ps1') -MaximumRedirection 0 -TimeoutSec 45
  $bytes = $download.RawContentStream.ToArray()
  if ($bytes.Length -ne $ExpectedBootstrapBytes -or (Sha $bytes) -cne $ExpectedBootstrap) { throw 'BOOTSTRAP_SHA_MISMATCH' }
  ExactFile $bootstrap $bytes
  $h = LocalHealth '/healthz'
  if (-not (SameClient $h) -or $h.clientBuild -cne '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e') { throw 'CLIENT_UNAVAILABLE' }
  $StopHelper = Join-Path $JobDirectory 'owned-idle-stop.mjs'
  $HandleHelper = Join-Path $JobDirectory 'owned-idle-handle.ps1'
  if ((Sha ([IO.File]::ReadAllBytes($StopHelper))) -cne $StopHelperSha -or (Sha ([IO.File]::ReadAllBytes($HandleHelper))) -cne $HandleHelperSha) { throw 'HELPER_SHA_MISMATCH' }
  $attempt = [ordered]@{schemaVersion=1;task=$TaskName;expectedClientBuild=$ExpectedBuild;archiveSha256=$ExpectedArchive;bootstrapSha256=$ExpectedBootstrap;at=[DateTime]::UtcNow.ToString('o')}
  $attemptBytes = $Encoding.GetBytes(($attempt | ConvertTo-Json -Compress))
  $attemptStream = [IO.File]::Open($AttemptFile,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try { $attemptStream.Write($attemptBytes,0,$attemptBytes.Length); $attemptStream.Flush($true) } finally { $attemptStream.Dispose() }
  $Stage = 'owned_idle_root_stop'; Status 'running' 'OWNED_IDLE_ROOT_STOP_STARTED'
  $ForceStopAttempted = $true
  $stopText = (& (Join-Path $Plan.nodeDirectory 'node.exe') $StopHelper $PlanFile 2>$null | Out-String)
  $stopExit = $LASTEXITCODE
  if ($stopText.Length -gt 16384) { throw 'OWNED_IDLE_STOP_REFUSED' }
  try { $stopResult = $stopText | ConvertFrom-Json } catch { throw 'OWNED_IDLE_STOP_REFUSED' }
  if ($stopResult.state -ceq 'failed') {
    $OwnedStopFailure = [ordered]@{state='failed';code='OWNED_IDLE_STOP_REFUSED'}
    if ($stopResult.code -cin @('IDENTITY_CHANGED','CONNECTIONS_CHANGED','CLIENT_ALREADY_DRAINING','DRAIN_TIMEOUT','CHILDREN_PRESENT','SNAPSHOT_INVALID','SNAPSHOT_CHANGED','NO_LONGER_IDLE','POST_EXIT_SNAPSHOT_CHANGED','ROOT_EXIT_UNCONFIRMED','PATH_UNSAFE','SNAPSHOT_TOO_LARGE','LOCAL_CONTROL_REFUSED','HEALTH_INVALID','PLAN_MISMATCH','HELPER_SHA_MISMATCH','OWNER_CHANGED','ARCHIVE_EXISTS','ARCHIVE_CHANGED')) { $OwnedStopFailure.code=$stopResult.code }
    foreach ($field in @('line','hresult')) { if ($stopResult.$field -is [int] -or $stopResult.$field -is [long]) { $OwnedStopFailure[$field]=$stopResult.$field } }
    foreach ($field in @('terminationRequested','exitObserved')) { if ($stopResult.$field -is [bool]) { $OwnedStopFailure[$field]=$stopResult.$field } }
  }
  if ($stopExit -ne 0 -or $stopResult.state -cne 'complete' -or $stopResult.scope -cne 'owned-daemon-root-only' -or $stopResult.stopped -ne $true -or $stopResult.historyRecordsUnchanged -ne $true) { throw 'OWNED_IDLE_STOP_REFUSED' }
  $Stage = 'official_updater'; Status 'running' 'OFFICIAL_UPDATER_STARTED'
  & $PowerShell -NoLogo -NoProfile -NonInteractive -Command (ExactRunner $bootstrap $ExpectedBootstrap '') *> $null
  if ($LASTEXITCODE -ne 0) { $UpdaterFailure = ReadPublicUpdaterStatus; throw 'UPDATER_FAILED' }
  $Stage = 'confirming_official_update'
  $updateText = (& (Join-Path $Plan.nodeDirectory 'node.exe') (Join-Path $Plan.root 'scripts\ziwei-user.mjs') update-status --json 2>$null | Out-String)
  if ($LASTEXITCODE -ne 0 -or $updateText.Length -gt 65536) { throw 'UPDATE_RESULT_UNVERIFIED' }
  $updated = $updateText | ConvertFrom-Json
  if ($updated.state -cne 'complete' -or $updated.operation -cne 'update' -or $updated.oldBuild -cne '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e' -or $updated.clientBuild -cne $ExpectedBuild -or $updated.sha256 -cne $ExpectedArchive -or $updated.configurationPreserved -ne $true -or $updated.restoredRunning -ne $false) { throw 'UPDATE_RESULT_UNVERIFIED' }
  $Stage = 'normal_start'; Status 'running' 'NORMAL_START_REQUESTED'
  & (Join-Path $Plan.nodeDirectory 'node.exe') (Join-Path $Plan.root 'scripts\ziwei-user.mjs') start *> $null
  if ($LASTEXITCODE -ne 0) { throw 'NORMAL_START_FAILED' }
  $Stage = 'verifying_ready'; Status 'verifying' 'WAITING_FOR_TARGET_READY'
  $verify = [Diagnostics.Stopwatch]::StartNew()
  while ($verify.Elapsed.TotalSeconds -lt 600) {
    if (ReadyTarget) {
      $Stage = 'complete'; Status 'complete' 'TARGET_BUILD_READY'
      $own = $Folder.GetTask($TaskName)
      if (-not (OwnTask $own)) { throw 'TASK_NAME_IN_USE' }
      $Folder.DeleteTask($TaskName,0)
      return
    }
    Start-Sleep -Seconds 5
  }
  throw 'TARGET_READY_TIMEOUT'
 } catch {
  $originalError = $_
  $FailureDetail = [ordered]@{line=$originalError.InvocationInfo.ScriptLineNumber;hresult=$originalError.Exception.HResult}
  # Never continue the updater or kill again after any failure. A verified original
  # root-only exit can permit only the unchanged old client's normal start.
  if ($ForceStopAttempted -and $Plan -and $StopHelper -and (Test-Path -LiteralPath $StopHelper)) {
    $RecoverySnapshot = [ordered]@{state='offline_or_unknown';originalFailurePreserved=$true}
    try {
      if ((Sha ([IO.File]::ReadAllBytes($StopHelper))) -cne $StopHelperSha) { throw 'HELPER_SHA_MISMATCH' }
      $restoreText = (& (Join-Path $Plan.nodeDirectory 'node.exe') $StopHelper --restore-original $PlanFile 2>$null | Out-String)
      $restoreExit = $LASTEXITCODE
      if ($restoreExit -eq 0 -and $restoreText.Length -le 16384) {
        $restored = $restoreText | ConvertFrom-Json
        if ($restored.state -ceq 'original_restarted' -and $restored.clientBuild -ceq '88b2ea9f41c10c53498ecb524ad1dc5d836813440f804a61050f0e98da9cc14e' -and $restored.originalFailurePreserved -eq $true) { $RecoverySnapshot.state='original_restarted' }
      }
    } catch {}
  }
  $codes = @('TARGET_NOT_FROZEN','WINDOWS_ONLY','FILE_CHANGED','TASK_NAME_IN_USE','TASK_ALREADY_EXISTS','EXISTING_PLAN_NOT_RESUBMITTED','INSTALL_UNAVAILABLE','LOCAL_ENDPOINT_UNSUPPORTED','CLIENT_UNAVAILABLE','ATTEMPT_ALREADY_RECORDED','IDLE_TIMEOUT','OFFICIAL_RELEASE_CHANGED','BOOTSTRAP_SHA_MISMATCH','CLIENT_BECAME_BUSY','TARGET_READY_TIMEOUT','UPDATER_FAILED','HELPER_SHA_MISMATCH','OWNED_IDLE_STOP_REFUSED','UPDATE_RESULT_UNVERIFIED','NORMAL_START_FAILED')
  $code = if ($originalError.Exception.Message -cin $codes) { $originalError.Exception.Message } else { 'TASK_FAILED' }
  try { if (Test-Path -LiteralPath $JobDirectory) { Status 'failed' $code } else { @{state='failed';stage=$Stage;code=$code} | ConvertTo-Json -Compress | Write-Output } } catch { [ordered]@{state='failed';stage=$Stage;code=$code;failure=$FailureDetail;recovery=$RecoverySnapshot;ownedStop=$OwnedStopFailure;statusWriteFailed=$true} | ConvertTo-Json -Depth 4 -Compress | Write-Output }
  exit 1
}
