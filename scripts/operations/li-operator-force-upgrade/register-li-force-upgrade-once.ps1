# Preparation template. Default Validate mode never registers or starts a task.
param(
  [ValidateSet('Validate','Register','Worker')][string]$Mode='Validate',
  [Parameter(Mandatory=$true)][string]$PlanPath,
  [Parameter(Mandatory=$true)][string]$WorkerSourcePath
)
$ErrorActionPreference='Stop'
$Encoding=[Text.UTF8Encoding]::new($false)
$Stage='validate'
function Need($value,[string]$code){if(!$value){throw $code}}
function HashBytes([byte[]]$bytes){$hash=[Security.Cryptography.SHA256]::Create();try{return [BitConverter]::ToString($hash.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()}finally{$hash.Dispose()}}
function NoLink([string]$file){$cursor=[IO.Path]::GetFullPath($file);while($cursor){if(Test-Path -LiteralPath $cursor){$entry=Get-Item -LiteralPath $cursor -Force;Need (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)-eq 0) 'BOOTSTRAP_PATH_UNSAFE'};$parent=[IO.Directory]::GetParent($cursor);if(!$parent){break};$cursor=$parent.FullName}}
function ReadBytes([string]$file){NoLink $file;$entry=Get-Item -LiteralPath $file -Force;Need (!$entry.PSIsContainer -and $entry.Length -lt 1048576) 'BOOTSTRAP_FILE_INVALID';return [IO.File]::ReadAllBytes($file)}
function WriteNew([string]$file,[byte[]]$bytes){NoLink $file;$stream=[IO.File]::Open($file,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None);try{$stream.Write($bytes,0,$bytes.Length);$stream.Flush($true)}finally{$stream.Dispose()}}
function Health{$request=[Net.HttpWebRequest]::Create('http://127.0.0.1:20242/healthz');$request.Proxy=$null;$request.Timeout=3000;$request.ReadWriteTimeout=3000;$request.AllowAutoRedirect=$false;$response=$request.GetResponse();try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{$body=$reader.ReadToEnd();Need ($body.Length -lt 1048576) 'BOOTSTRAP_HEALTH_INVALID';return ($body|ConvertFrom-Json)}finally{$reader.Dispose()}}finally{$response.Dispose()}}
function OwnTask($task){
  if(!$task){return $false}
  $principal=$task.Definition.Principal
  try{$taskUser=[string]$principal.UserId;$taskSid=if($taskUser -match '^S-[0-9]+-'){([Security.Principal.SecurityIdentifier]::new($taskUser)).Value}else{([Security.Principal.NTAccount]::new($taskUser)).Translate([Security.Principal.SecurityIdentifier]).Value}}catch{return $false}
  return ($taskSid -ceq $Sid -and $principal.LogonType -eq 3 -and $principal.RunLevel -eq 0 -and $task.Definition.RegistrationInfo.Description -ceq ('Ziwei Li operator force tree upgrade '+$RegistrationHash) -and $task.Definition.Actions.Count -eq 1 -and $task.Definition.Actions.Item(1).Path -ieq $PowerShell -and $task.Definition.Actions.Item(1).Arguments -ceq $Arguments -and $task.Definition.Actions.Item(1).WorkingDirectory -ieq $Plan.jobDirectory -and $task.Definition.Triggers.Count -eq 1 -and $task.Definition.Settings.RestartCount -eq 0 -and $task.Definition.Settings.MultipleInstances -eq 2)
}
function TaskOrNull{$found=@($Folder.GetTasks(1)|Where-Object {$_.Name -ceq $TaskName});Need ($found.Count -le 1) 'BOOTSTRAP_TASK_CONFLICT';if($found.Count -eq 1){return $found[0]};return $null}
function TaskInstance($expected){
  try{
    $task=TaskOrNull;Need (OwnTask $task) 'BOOTSTRAP_TASK_BINDING_INVALID'
    $instances=$task.GetInstances(0)
    Need ($instances -and $instances.Count -eq 1) 'BOOTSTRAP_TASK_INSTANCE_NOT_UNIQUE'
    $instance=$instances.Item(1);$null=$instance.Refresh()
    Need ([int]$instance.State -eq 4 -and [string]$instance.Path -ceq ('\'+$TaskName)) 'BOOTSTRAP_TASK_INSTANCE_NOT_RUNNING'
    $instanceGuid=[guid]::Empty
    Need ([guid]::TryParse([string]$instance.InstanceGuid,[ref]$instanceGuid) -and $instanceGuid -ne [guid]::Empty) 'BOOTSTRAP_TASK_INSTANCE_INVALID'
    $self=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$PID)
    Need ($self -and $self.ProcessId -eq $PID -and [int]$self.ParentProcessId -gt 0) 'BOOTSTRAP_OUTSIDE_TASK_UNCONFIRMED'
    $parent=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$self.ParentProcessId)
    Need ($parent -and $parent.Name -iin @('svchost.exe','taskeng.exe','taskhostw.exe')) 'BOOTSTRAP_OUTSIDE_TASK_UNCONFIRMED'
    $enginePid=[int]$instance.EnginePID
    Need ($enginePid -gt 0 -and ($enginePid -eq $PID -or $enginePid -eq [int]$self.ParentProcessId)) 'BOOTSTRAP_TASK_ENGINE_MISMATCH'
    $binding=[pscustomobject]@{instanceGuid=$instanceGuid.ToString('D');enginePid=$enginePid;selfPid=[int]$PID;parentPid=[int]$self.ParentProcessId}
    if($expected){Need ($binding.instanceGuid -ceq $expected.instanceGuid -and $binding.enginePid -eq $expected.enginePid -and $binding.selfPid -eq $expected.selfPid -and $binding.parentPid -eq $expected.parentPid) 'BOOTSTRAP_TASK_INSTANCE_CHANGED'}
    return $binding
  }catch{
    if($_.Exception.Message -cmatch '^BOOTSTRAP_[A-Z0-9_]{1,64}$'){throw}
    throw 'BOOTSTRAP_TASK_INSTANCE_UNAVAILABLE'
  }
}
function Status([string]$state,[string]$code,$detail){
  $row=[ordered]@{schemaVersion=1;state=$state;code=$code;stage=$Stage;task=$TaskName;workspace=$Plan.workspace;deviceId=$Plan.deviceId;targetBuild=$Plan.targetBuild;at=[DateTime]::UtcNow.ToString('o');bootstrapOnly=$true;dedicatedRemoteProtocolVerified=$false}
  if($detail){$row.detail=$detail}
  $temporary=Join-Path $Plan.jobDirectory ('status-'+[guid]::NewGuid().ToString('N')+'.tmp');$target=Join-Path $Plan.jobDirectory 'status.json'
  NoLink $temporary;NoLink $target
  [IO.File]::WriteAllText($temporary,($row|ConvertTo-Json -Depth 5 -Compress),$Encoding)
  if(Test-Path -LiteralPath $target){$backup=$target+'.backup-'+[guid]::NewGuid().ToString('N');NoLink $backup;Need (!(Test-Path -LiteralPath $backup)) 'BOOTSTRAP_STATUS_BACKUP_CONFLICT';[IO.File]::Replace($temporary,$target,$backup)}else{[IO.File]::Move($temporary,$target)}
  $row|ConvertTo-Json -Depth 5 -Compress
}
try{
  Need ($env:OS -ceq 'Windows_NT' -and $env:USERPROFILE -ieq 'C:\Users\25941') 'BOOTSTRAP_USER_INVALID'
  $Sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $PlanBytes=ReadBytes $PlanPath;$Plan=$Encoding.GetString($PlanBytes)|ConvertFrom-Json
  $WorkerBytes=ReadBytes $WorkerSourcePath;$ScriptBytes=ReadBytes $PSCommandPath
  $UserDirectory='C:\Users\25941\AppData\Local\Ziwei\ziwei_user'
  Need ($Plan.schemaVersion -eq 1 -and $Plan.workspace -ceq 'bigtron' -and $Plan.deviceId -ceq 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493' -and $Plan.userProfile -ieq $env:USERPROFILE -and $Plan.ownerSid -ceq $Sid -and $Plan.userDirectory -ieq $UserDirectory -and $Plan.acceptanceStage -ceq 'operator-force-tree-upgrade-once') 'BOOTSTRAP_SCOPE_INVALID'
  Need ($Plan.nonce -cmatch '^[a-f0-9-]{36}$' -and $Plan.candidateCommit -cmatch '^[a-f0-9]{40}$' -and $Plan.sourceBuild -cmatch '^[a-f0-9]{64}$' -and $Plan.targetBuild -cmatch '^[a-f0-9]{64}$' -and $Plan.archiveSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.configSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.workerSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.sourceNonce -cmatch '^[A-Za-z0-9_-]{16,128}$' -and $Plan.sourcePid -gt 0 -and $Plan.sourceBuild -cne $Plan.targetBuild) 'BOOTSTRAP_PIN_INVALID'
  Need ($Plan.root -ieq 'D:\work\nodejs\node_global\node_modules\ziwei' -and $Plan.configPath -ieq (Join-Path $UserDirectory 'ziwei_user.json') -and $Plan.jobDirectory -ieq (Join-Path $UserDirectory ('maintenance\operator-force-upgrade-'+$Plan.nonce))) 'BOOTSTRAP_SCOPE_INVALID'
  Need ($Plan.ownerSid -ceq 'S-1-5-21-4019069998-341204304-2024549848-1001' -and $Plan.nodeExe -ieq 'C:\Program Files\nodejs\node.exe') 'BOOTSTRAP_OWNER_INVALID'
  Need ($Plan.authorization -ceq 'operator_exact_daemon_tree_stop_once' -and $Plan.sourcePid -eq 55824 -and $Plan.sourceCreationTime -ceq '2026-10-19T09:09:20.3445030Z' -and $Plan.sourceBuild -ceq 'e0cfb63ee43c3d837a049b9c4f0c6d1362cab64918f8987b35597b9e549c4c18' -and $Plan.targetBuild -ceq '5d7be8976f785d1ced877293da25cba9dbcc25975456852030d1f110c11c181a' -and $Plan.archiveSha256 -ceq '20a1c9c849e70f14291429bf04bd1da7058e369989d51687eb05303bf705cf53' -and $Plan.archiveUrl -ceq 'https://qzelynth.top/downloads/cli/ziwei-latest.tgz') 'BOOTSTRAP_OPERATOR_SCOPE_INVALID'
  Need ((HashBytes $WorkerBytes) -ceq $Plan.workerSha256) 'BOOTSTRAP_WORKER_CHANGED'
  foreach($file in @($Plan.root,$Plan.configPath,$Plan.jobDirectory,$Plan.nodeExe)){NoLink $file}
  $TaskName='Ziwei.OperatorForceTreeUpgrade.Li.'+$Plan.nonce
  $PowerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $OwnScript=Join-Path $Plan.jobDirectory 'register-bootstrap.ps1';$OwnPlan=Join-Path $Plan.jobDirectory 'bootstrap-plan.json';$OwnWorker=Join-Path $Plan.jobDirectory 'bootstrap-li-worker.mjs'
  $Arguments='-NoLogo -NoProfile -NonInteractive -File "'+$OwnScript+'" -Mode Worker -PlanPath "'+$OwnPlan+'" -WorkerSourcePath "'+$OwnWorker+'"'
  $RegistrationHash=HashBytes ($Encoding.GetBytes(((HashBytes $PlanBytes)+'|'+(HashBytes $WorkerBytes)+'|'+(HashBytes $ScriptBytes))))
  if($Mode -ceq 'Validate'){
    [ordered]@{state='validated';task=$TaskName;registrationHash=$RegistrationHash;targetBuild=$Plan.targetBuild;scheduled=$false;deviceUpdatesSubmitted=0;dedicatedRemoteProtocolVerified=$false}|ConvertTo-Json -Compress
    exit 0
  }
  $Scheduler=New-Object -ComObject 'Schedule.Service';$Scheduler.Connect();$Folder=$Scheduler.GetFolder('\')
  if($Mode -ceq 'Register'){
    $Stage='verify_owned_daemon'
    $configBytes=ReadBytes $Plan.configPath;Need ((HashBytes $configBytes) -ceq $Plan.configSha256) 'BOOTSTRAP_CONFIG_CHANGED'
    $config=$Encoding.GetString($configBytes)|ConvertFrom-Json
    Need ($config.workspace -ceq $Plan.workspace -and $config.deviceId -ceq $Plan.deviceId -and $config.healthHost -ceq '127.0.0.1' -and $config.healthPort -eq 20242 -and $config.apiBase -ceq 'https://qzelynth.top') 'BOOTSTRAP_CONFIG_CHANGED'
    $health=Health
    Need ($health.service -ceq 'ziwei_user' -and $health.workspace -ceq $Plan.workspace -and $health.deviceId -ceq $Plan.deviceId -and $health.pid -eq $Plan.sourcePid -and $health.clientBuild -ceq $Plan.sourceBuild -and $health.lifecycle.nonce -ceq $Plan.sourceNonce -and $health.lifecycle.root -ieq $Plan.root -and $health.lifecycle.configPath -ieq $Plan.configPath -and $health.lifecycle.configSha256 -ceq $Plan.configSha256) 'BOOTSTRAP_INSTANCE_CHANGED'
    $native=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$health.pid);$owner=Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid
    Need ($owner.ReturnValue -eq 0 -and $owner.Sid -ceq $Sid -and $native.ExecutablePath -ieq $Plan.nodeExe -and [IO.Path]::GetFileName($Plan.nodeExe) -ieq 'node.exe') 'BOOTSTRAP_OWNER_INVALID'
    Need ($native.CreationDate.ToUniversalTime().ToString('o') -ceq $Plan.sourceCreationTime -and (HashBytes ($Encoding.GetBytes($native.CommandLine))) -ceq $Plan.sourceCommandHash) 'BOOTSTRAP_PROCESS_GENERATION_CHANGED'
    if(Test-Path -LiteralPath $Plan.jobDirectory){
      Need ((HashBytes (ReadBytes $OwnScript)) -ceq (HashBytes $ScriptBytes) -and (HashBytes (ReadBytes $OwnPlan)) -ceq (HashBytes $PlanBytes) -and (HashBytes (ReadBytes $OwnWorker)) -ceq $Plan.workerSha256) 'BOOTSTRAP_JOB_CONFLICT'
      if(Test-Path -LiteralPath (Join-Path $Plan.jobDirectory 'attempt.json')){[ordered]@{state='already_attempted';task=$TaskName;resubmitted=$false}|ConvertTo-Json -Compress;exit 0}
      Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_CONFLICT'
      [ordered]@{state='already_scheduled';task=$TaskName;resubmitted=$false}|ConvertTo-Json -Compress;exit 0
    }
    Need ($null -eq (TaskOrNull)) 'BOOTSTRAP_TASK_CONFLICT'
    $null=[IO.Directory]::CreateDirectory($Plan.jobDirectory)
    WriteNew $OwnScript $ScriptBytes;WriteNew $OwnPlan $PlanBytes;WriteNew $OwnWorker $WorkerBytes
    $definition=$Scheduler.NewTask(0);$definition.RegistrationInfo.Description='Ziwei Li operator force tree upgrade '+$RegistrationHash
    $definition.Principal.UserId=$Sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
    $definition.Settings.Enabled=$true;$definition.Settings.MultipleInstances=2;$definition.Settings.RestartCount=0;$definition.Settings.StartWhenAvailable=$true;$definition.Settings.DisallowStartIfOnBatteries=$false;$definition.Settings.StopIfGoingOnBatteries=$false;$definition.Settings.ExecutionTimeLimit='PT26H'
    $trigger=$definition.Triggers.Create(1);$trigger.Enabled=$true;$trigger.StartBoundary=(Get-Date).AddSeconds(15).ToString('yyyy-MM-ddTHH:mm:ss')
    $action=$definition.Actions.Create(0);$action.Path=$PowerShell;$action.Arguments=$Arguments;$action.WorkingDirectory=$Plan.jobDirectory
    $Stage='register_single_limited_task';$null=$Folder.RegisterTaskDefinition($TaskName,$definition,2,$Sid,$null,3,$null)
    Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_POSTCHECK_FAILED'
    Status 'scheduled' 'BOOTSTRAP_TASK_SCHEDULED' @{delaySeconds=15;runLevel='limited';automaticRetries=0}
    exit 0
  }
  $Stage='verify_task_boundary'
  Need ($PSCommandPath -ieq $OwnScript -and $PlanPath -ieq $OwnPlan -and $WorkerSourcePath -ieq $OwnWorker -and (OwnTask (TaskOrNull))) 'BOOTSTRAP_TASK_BINDING_INVALID'
  $TaskBoundary=TaskInstance $null

  $Stage='operator_once_lease'
  $Attempt=Join-Path $Plan.jobDirectory 'operator-attempt.json'
  Need (!(Test-Path -LiteralPath $Attempt)) 'BOOTSTRAP_ALREADY_ATTEMPTED'
  WriteNew $Attempt ($Encoding.GetBytes((@{authorization=$Plan.authorization;sourcePid=$Plan.sourcePid;sourceCreationTime=$Plan.sourceCreationTime;at=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json -Compress)))
  $env:ZIWEI_USER_HOME=$Plan.userDirectory;$env:ZIWEI_CONFIG=$Plan.configPath
  @(Get-ChildItem Env:|Where-Object {$_.Name.ToLowerInvariant() -ceq 'npm_config_prefix'})|ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
  [Environment]::SetEnvironmentVariable('npm_config_prefix','D:\work\nodejs\node_global','Process')
  function NodeStep([string]$step){$text=(& $Plan.nodeExe $OwnWorker $OwnPlan $step 2>$null|Out-String);Need ($text.Length -lt 65536 -and $LASTEXITCODE -eq 0) 'BOOTSTRAP_OFFICIAL_STEP_FAILED';return ($text|ConvertFrom-Json)}
  function SourceHealth{Need ((HashBytes (ReadBytes $Plan.configPath)) -ceq $Plan.configSha256) 'BOOTSTRAP_CONFIG_CHANGED';$h=Health;Need ($h.service -ceq 'ziwei_user' -and $h.workspace -ceq $Plan.workspace -and $h.deviceId -ceq $Plan.deviceId -and $h.pid -eq $Plan.sourcePid -and $h.clientBuild -ceq $Plan.sourceBuild -and $h.lifecycle.nonce -ceq $Plan.sourceNonce -and $h.lifecycle.configSha256 -ceq $Plan.configSha256 -and $h.lifecycle.root -ieq $Plan.root) 'BOOTSTRAP_INSTANCE_CHANGED';return $h}
  function Control([string]$operation){$cfg=$Encoding.GetString((ReadBytes $Plan.configPath))|ConvertFrom-Json;Need ($cfg.workspace -ceq $Plan.workspace -and $cfg.deviceId -ceq $Plan.deviceId -and $cfg.deviceToken) 'BOOTSTRAP_CONFIG_CHANGED';$h=SourceHealth;$request=[Net.HttpWebRequest]::Create('http://127.0.0.1:20242/local/connection-control');$request.Proxy=$null;$request.Timeout=8000;$request.Method='POST';$request.ContentType='application/json';$request.Headers.Add('x-ziwei-local-control',$cfg.deviceToken);$bytes=$Encoding.GetBytes((@{operation=$operation;nonce=$Plan.sourceNonce}|ConvertTo-Json -Compress));$stream=$request.GetRequestStream();try{$stream.Write($bytes,0,$bytes.Length)}finally{$stream.Dispose()};$response=$request.GetResponse();try{$reader=[IO.StreamReader]::new($response.GetResponseStream());try{return($reader.ReadToEnd()|ConvertFrom-Json)}finally{$reader.Dispose()}}finally{$response.Dispose()}}
  $Stage='download_pinned_official_before_stop';$ready=NodeStep '--prepare';Need ($ready.state -ceq 'prepared' -and $ready.archiveSha256 -ceq $Plan.archiveSha256) 'BOOTSTRAP_PACKAGE_NOT_READY'
  $Stage='wait_creator_action_exit';Status 'waiting_idle' 'BOOTSTRAP_WAITING_CREATOR_EXIT' @{operatorAuthorizedTreeStop=$true}
  $paused=$false;$MainKilled=$false;$MainKillRequested=$false;$null=Control 'pause';$paused=$true;$deadline=[DateTime]::UtcNow.AddMinutes(10)
  Need (@($Plan.creatorAncestors).Count -ge 1 -and @($Plan.creatorAncestors).Count -lt 32) 'BOOTSTRAP_CREATOR_CHAIN_INVALID'
  do{
    $h=SourceHealth;$remaining=0
    foreach($ancestor in @($Plan.creatorAncestors)){
      Need ($ancestor.pid -gt 0 -and $ancestor.pid -ne $Plan.sourcePid -and $ancestor.creationTime) 'BOOTSTRAP_CREATOR_CHAIN_INVALID'
      $native=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$ancestor.pid)
      if($native -and $native.CreationDate.ToUniversalTime().ToString('o') -ceq $ancestor.creationTime){$remaining++}
    }
    if($remaining -eq 0){break};Need ([DateTime]::UtcNow -lt $deadline) 'BOOTSTRAP_CREATOR_EXIT_TIMEOUT';Start-Sleep -Milliseconds 500
  }while($true)
  Need ($h.connectionState -ceq 'draining') 'BOOTSTRAP_NOT_DRAINED'
  $null=TaskInstance $TaskBoundary
  $Stage='backup_original_history'
  $history=Join-Path $Plan.jobDirectory 'original-runtime-history';$null=[IO.Directory]::CreateDirectory($history)
  foreach($relative in @('action-state.json','action-delivery')){$src=Join-Path (Join-Path $Plan.userDirectory 'runtime') $relative;if(Test-Path -LiteralPath $src){NoLink $src;foreach($entry in @(Get-ChildItem -LiteralPath $src -Recurse -Force -ErrorAction Stop)){Need (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)-eq 0) 'BOOTSTRAP_HISTORY_LINK'};Copy-Item -LiteralPath $src -Destination (Join-Path $history $relative) -Recurse -ErrorAction Stop}}
  $Stage='hold_exact_source_generation';$Main=Get-Process -Id $Plan.sourcePid -ErrorAction Stop;$null=$Main.Handle
  $Owned=@{};$ForceReceipt=Join-Path $Plan.jobDirectory 'force-stop-receipt.json'
  function CimIdentity($native,$process){Need ($native -and $native.ProcessId -eq $process.Id -and [Math]::Abs(($process.StartTime.ToUniversalTime()-$native.CreationDate.ToUniversalTime()).TotalMilliseconds) -le 2) 'BOOTSTRAP_PROCESS_GENERATION_CHANGED'}
  function CaptureTree{
    $all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$added=0
    do{$changed=$false;foreach($n in $all){$id=[int]$n.ProcessId;$parent=[int]$n.ParentProcessId;if($id -eq $Plan.sourcePid -or $Owned.ContainsKey($id) -or !$Owned.ContainsKey($parent)){continue};$owner=$Owned[$parent];$created=$n.CreationDate.ToUniversalTime();if($owner.process.HasExited){$owner.stoppedAt=$owner.process.ExitTime.ToUniversalTime()}else{$parentNow=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$parent);CimIdentity $parentNow $owner.process;Need ($parentNow.CreationDate.ToUniversalTime().ToString('o') -ceq $owner.creationTime) 'BOOTSTRAP_PARENT_GENERATION_CHANGED'};Need ($created -ge $owner.created -and (!$owner.stoppedAt -or $created -le $owner.stoppedAt)) 'BOOTSTRAP_DESCENDANT_GENERATION_UNPROVEN';Need ($id -ne $PID -and $id -ne $TaskBoundary.parentPid -and $id -ne $TaskBoundary.enginePid) 'BOOTSTRAP_TASK_IN_TARGET_TREE';$p=Get-Process -Id $id -ErrorAction SilentlyContinue;if(!$p){continue};$null=$p.Handle;$again=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$id);CimIdentity $again $p;Need ($again.CreationDate.ToUniversalTime().ToString('o') -ceq $n.CreationDate.ToUniversalTime().ToString('o') -and $again.ParentProcessId -eq $parent -and $again.ExecutablePath -ieq $n.ExecutablePath -and $again.CommandLine -ceq $n.CommandLine) 'BOOTSTRAP_DESCENDANT_CHANGED';$Owned[$id]=@{process=$p;created=$created;creationTime=$created.ToString('o');ppid=$parent;stoppedAt=$null;killRequested=$false};$added++;$changed=$true;Need ($Owned.Count -lt 2048) 'BOOTSTRAP_TREE_LIMIT'}}while($changed)
    return $added
  }
  try{
    $n=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$Plan.sourcePid);CimIdentity $n $Main;Need ($n.CreationDate.ToUniversalTime().ToString('o') -ceq $Plan.sourceCreationTime -and $n.ExecutablePath -ieq $Plan.nodeExe -and (HashBytes ($Encoding.GetBytes($n.CommandLine))) -ceq $Plan.sourceCommandHash) 'BOOTSTRAP_PROCESS_GENERATION_CHANGED'
    $Owned[[int]$Plan.sourcePid]=@{process=$Main;created=$n.CreationDate.ToUniversalTime();creationTime=$Plan.sourceCreationTime;ppid=[int]$n.ParentProcessId;stoppedAt=$null;killRequested=$false};$null=CaptureTree
    $h=SourceHealth;Need ($h.connectionState -ceq 'draining') 'BOOTSTRAP_NOT_DRAINED';foreach($ancestor in @($Plan.creatorAncestors)){$current=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$ancestor.pid);Need (!$current -or $current.CreationDate.ToUniversalTime().ToString('o') -cne $ancestor.creationTime) 'BOOTSTRAP_CREATOR_NOT_EXITED'};$null=TaskInstance $TaskBoundary
    $n=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$Plan.sourcePid);CimIdentity $n $Main;Need ($n.CreationDate.ToUniversalTime().ToString('o') -ceq $Plan.sourceCreationTime -and (HashBytes ($Encoding.GetBytes($n.CommandLine))) -ceq $Plan.sourceCommandHash -and !$Main.HasExited) 'BOOTSTRAP_PROCESS_GENERATION_CHANGED'
    $Stage='operator_force_exact_daemon_tree';$MainKillRequested=$true;$Main.Kill();$Owned[[int]$Plan.sourcePid].killRequested=$true;Need ($Main.WaitForExit(8000) -and $Main.HasExited) 'BOOTSTRAP_MAIN_EXIT_UNCONFIRMED';$MainKilled=$true;$Owned[[int]$Plan.sourcePid].stoppedAt=$Main.ExitTime.ToUniversalTime()
    $treeDeadline=[DateTime]::UtcNow.AddSeconds(30);$emptyObservations=0
    do{
      $null=CaptureTree
      foreach($id in @($Owned.Keys|Sort-Object -Descending)){$entry=$Owned[$id];if($id -eq $Plan.sourcePid){continue};$p=$entry.process;if(!$p.HasExited){$p.Kill();$entry.killRequested=$true;$remainingMs=[Math]::Max(1,[Math]::Min(3000,[int]($treeDeadline-[DateTime]::UtcNow).TotalMilliseconds));Need ($p.WaitForExit($remainingMs) -and $p.HasExited) 'BOOTSTRAP_DESCENDANT_EXIT_UNCONFIRMED'};if(!$entry.stoppedAt){$entry.stoppedAt=$p.ExitTime.ToUniversalTime()}}
      $new=CaptureTree;$alive=@($Owned.Values|Where-Object {!$_.process.HasExited}).Count;if($new -eq 0 -and $alive -eq 0){$emptyObservations++}else{$emptyObservations=0};Need ([DateTime]::UtcNow -lt $treeDeadline) 'BOOTSTRAP_TREE_EXIT_TIMEOUT';if($emptyObservations -lt 2){Start-Sleep -Milliseconds 200}
    }while($emptyObservations -lt 2)
    $receipt=@{schemaVersion=1;kind='operator-authorized-exact-daemon-tree-stop';authorization=$Plan.authorization;daemonPid=$Plan.sourcePid;daemonCreationTime=$Plan.sourceCreationTime;mainExited=$true;capturedDescendantCount=$Owned.Count-1;capturedDescendantsExited=$true;currentOwnedTreeEmptyObserved=$true;processes=@($Owned.GetEnumerator()|ForEach-Object {@{pid=[int]$_.Key;ppid=$_.Value.ppid;creationTime=$_.Value.creationTime;killRequested=$_.Value.killRequested;exitObserved=$_.Value.process.HasExited}});originalActionCompletionInferred=$false;originalActionTreeExitInferred=$false;at=[DateTime]::UtcNow.ToString('o')};WriteNew $ForceReceipt ($Encoding.GetBytes(($receipt|ConvertTo-Json -Depth 6 -Compress)))
  }catch{
    if($MainKillRequested -and !(Test-Path -LiteralPath $ForceReceipt)){
      $partial=@{schemaVersion=1;kind='operator-authorized-exact-daemon-tree-stop';authorization=$Plan.authorization;daemonPid=$Plan.sourcePid;daemonCreationTime=$Plan.sourceCreationTime;mainKillRequested=$true;mainExited=[bool]$Main.HasExited;capturedDescendantsExited=$false;currentOwnedTreeEmptyObserved=$false;processes=@($Owned.GetEnumerator()|ForEach-Object {@{pid=[int]$_.Key;ppid=$_.Value.ppid;creationTime=$_.Value.creationTime;killRequested=$_.Value.killRequested;exitObserved=$_.Value.process.HasExited}});originalActionCompletionInferred=$false;originalActionTreeExitInferred=$false;at=[DateTime]::UtcNow.ToString('o')};WriteNew $ForceReceipt ($Encoding.GetBytes(($partial|ConvertTo-Json -Depth 6 -Compress)))
    }
    throw
  }finally{foreach($entry in $Owned.Values){$entry.process.Dispose()};if(!$Owned.ContainsKey([int]$Plan.sourcePid)){$Main.Dispose()}}
  $Stage='queue_fixed_official_update';$queued=NodeStep '--launch';Need ($queued.state -ceq 'queued') 'BOOTSTRAP_OFFICIAL_QUEUE_FAILED';Status 'updating' 'BOOTSTRAP_OFFICIAL_WORKER_QUEUED' @{workerPid=$queued.workerPid;operatorForceStopReceipt=$true}
  $deadline=[DateTime]::UtcNow.AddMinutes(20)
  do{Start-Sleep -Seconds 2;$r=NodeStep '--observe';if($r.state -ceq 'complete'){break};Need ($r.state -cne 'failed') 'BOOTSTRAP_OFFICIAL_UPDATE_FAILED';Need ([DateTime]::UtcNow -lt $deadline) 'BOOTSTRAP_OBSERVATION_TIMEOUT'}while($true)
  $Stage='explicit_target_start';$r=NodeStep '--start';Need ($r.state -ceq 'ready' -and $r.clientBuild -ceq $Plan.targetBuild) 'BOOTSTRAP_TARGET_START_FAILED'
  Status 'complete_local' 'BOOTSTRAP_TARGET_READY' @{pid=$r.pid;clientBuild=$r.clientBuild;authenticatedServerHeartbeatVerified=$false;operatorForceTreeStop=$true;originalActionCompletionInferred=$false}
  Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_BINDING_INVALID';$Folder.DeleteTask($TaskName,0);exit 0

}catch{
  if($Mode -ceq 'Worker' -and $paused -and !$MainKillRequested){try{$null=SourceHealth;$null=Control 'resume'}catch{}}
  $code=if($_.Exception.Message -cmatch '^BOOTSTRAP_[A-Z0-9_]{1,64}$'){$_.Exception.Message}else{'BOOTSTRAP_FAILED'}
  if($Plan -and (Test-Path -LiteralPath $Plan.jobDirectory)){try{Status 'failed' $code @{line=$_.InvocationInfo.ScriptLineNumber}}catch{}}
  [ordered]@{state='failed';stage=$Stage;code=$code;dedicatedRemoteProtocolVerified=$false}|ConvertTo-Json -Compress
  exit 1
}
