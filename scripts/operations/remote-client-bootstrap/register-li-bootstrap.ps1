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
  return ($taskSid -ceq $Sid -and $principal.LogonType -eq 3 -and $principal.RunLevel -eq 0 -and $task.Definition.RegistrationInfo.Description -ceq ('Ziwei Li bootstrap '+$RegistrationHash) -and $task.Definition.Actions.Count -eq 1 -and $task.Definition.Actions.Item(1).Path -ieq $PowerShell -and $task.Definition.Actions.Item(1).Arguments -ceq $Arguments -and $task.Definition.Actions.Item(1).WorkingDirectory -ieq $Plan.jobDirectory -and $task.Definition.Triggers.Count -eq 1 -and $task.Definition.Settings.RestartCount -eq 0 -and $task.Definition.Settings.MultipleInstances -eq 2)
}
function TaskOrNull{$found=@($Folder.GetTasks(1)|Where-Object {$_.Name -ceq $TaskName});Need ($found.Count -le 1) 'BOOTSTRAP_TASK_CONFLICT';if($found.Count -eq 1){return $found[0]};return $null}
function ParentImage($record){
  $image=[string]$record.ExecutablePath
  if([string]::IsNullOrWhiteSpace($image)){
    try{
      if(!('Ziwei.RemoteBootstrapParentImage' -as [type])){
        $nativeSource=@'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace Ziwei {
  public static class RemoteBootstrapParentImage {
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll", EntryPoint="QueryFullProcessImageNameW", CharSet=CharSet.Unicode, ExactSpelling=true, SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder value, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr process);
    public static string Read(int pid) {
      IntPtr handle = OpenProcess(0x1000, false, pid);
      if (handle == IntPtr.Zero) return null;
      try {
        uint size = 32768;
        StringBuilder value = new StringBuilder((int)size);
        if (!QueryFullProcessImageName(handle, 0, value, ref size) || size < 3 || size >= 32768) return null;
        return value.ToString();
      } finally { CloseHandle(handle); }
    }
  }
}
'@
        Add-Type -TypeDefinition $nativeSource -ErrorAction Stop|Out-Null
      }
      $image=[Ziwei.RemoteBootstrapParentImage]::Read([int]$record.ProcessId)
    }catch{throw 'BOOTSTRAP_PARENT_IMAGE_UNAVAILABLE'}
  }
  Need (![string]::IsNullOrWhiteSpace($image) -and $image -cmatch '^[A-Za-z]:\\') 'BOOTSTRAP_PARENT_IMAGE_UNAVAILABLE'
  return $image
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
  Need ($Plan.schemaVersion -eq 1 -and $Plan.workspace -ceq 'bigtron' -and $Plan.deviceId -ceq 'device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493' -and $Plan.userProfile -ieq $env:USERPROFILE -and $Plan.ownerSid -ceq $Sid -and $Plan.userDirectory -ieq $UserDirectory -and $Plan.acceptanceStage -ceq 'bootstrap-validation') 'BOOTSTRAP_SCOPE_INVALID'
  Need ($Plan.nonce -cmatch '^[a-f0-9-]{36}$' -and $Plan.candidateCommit -cmatch '^[a-f0-9]{40}$' -and $Plan.sourceBuild -cmatch '^[a-f0-9]{64}$' -and $Plan.targetBuild -cmatch '^[a-f0-9]{64}$' -and $Plan.archiveSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.configSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.workerSha256 -cmatch '^[a-f0-9]{64}$' -and $Plan.sourceNonce -cmatch '^[A-Za-z0-9_-]{16,128}$' -and $Plan.sourcePid -gt 0 -and $Plan.sourceBuild -cne $Plan.targetBuild) 'BOOTSTRAP_PIN_INVALID'
  Need ($Plan.root -ieq 'D:\work\nodejs\node_global\node_modules\ziwei' -and $Plan.configPath -ieq (Join-Path $UserDirectory 'ziwei_user.json') -and $Plan.jobDirectory -ieq (Join-Path $UserDirectory ('maintenance\remote-bootstrap-'+$Plan.nonce))) 'BOOTSTRAP_SCOPE_INVALID'
  Need ($Plan.ownerSid -ceq 'S-1-5-21-4019069998-341204304-2024549848-1001' -and $Plan.nodeExe -ieq 'C:\Program Files\nodejs\node.exe') 'BOOTSTRAP_OWNER_INVALID'
  $uri=[Uri]$Plan.archiveUrl
  Need ($uri.Scheme -ceq 'https' -and $uri.Host -ceq 'qzelynth.top' -and $uri.Port -eq 443 -and !$uri.UserInfo -and !$uri.Query -and !$uri.Fragment -and $uri.AbsolutePath -ceq ('/downloads/cli/remote-client-bootstrap-'+$Plan.candidateCommit+'-'+$Plan.archiveSha256.Substring(0,12)+'.tgz')) 'BOOTSTRAP_SOURCE_INVALID'
  Need ((HashBytes $WorkerBytes) -ceq $Plan.workerSha256) 'BOOTSTRAP_WORKER_CHANGED'
  foreach($file in @($Plan.root,$Plan.configPath,$Plan.jobDirectory,$Plan.nodeExe)){NoLink $file}
  $TaskName='Ziwei.RemoteClientBootstrap.Li.'+$Plan.nonce
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
    if(Test-Path -LiteralPath $Plan.jobDirectory){
      Need ((HashBytes (ReadBytes $OwnScript)) -ceq (HashBytes $ScriptBytes) -and (HashBytes (ReadBytes $OwnPlan)) -ceq (HashBytes $PlanBytes) -and (HashBytes (ReadBytes $OwnWorker)) -ceq $Plan.workerSha256) 'BOOTSTRAP_JOB_CONFLICT'
      if(Test-Path -LiteralPath (Join-Path $Plan.jobDirectory 'attempt.json')){[ordered]@{state='already_attempted';task=$TaskName;resubmitted=$false}|ConvertTo-Json -Compress;exit 0}
      Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_CONFLICT'
      [ordered]@{state='already_scheduled';task=$TaskName;resubmitted=$false}|ConvertTo-Json -Compress;exit 0
    }
    Need ($null -eq (TaskOrNull)) 'BOOTSTRAP_TASK_CONFLICT'
    $null=[IO.Directory]::CreateDirectory($Plan.jobDirectory)
    WriteNew $OwnScript $ScriptBytes;WriteNew $OwnPlan $PlanBytes;WriteNew $OwnWorker $WorkerBytes
    $definition=$Scheduler.NewTask(0);$definition.RegistrationInfo.Description='Ziwei Li bootstrap '+$RegistrationHash
    $definition.Principal.UserId=$Sid;$definition.Principal.LogonType=3;$definition.Principal.RunLevel=0
    $definition.Settings.Enabled=$true;$definition.Settings.MultipleInstances=2;$definition.Settings.RestartCount=0;$definition.Settings.StartWhenAvailable=$true;$definition.Settings.DisallowStartIfOnBatteries=$false;$definition.Settings.StopIfGoingOnBatteries=$false;$definition.Settings.ExecutionTimeLimit='PT26H'
    $trigger=$definition.Triggers.Create(1);$trigger.Enabled=$true;$trigger.StartBoundary=(Get-Date).AddMinutes(2).ToString('yyyy-MM-ddTHH:mm:ss')
    $action=$definition.Actions.Create(0);$action.Path=$PowerShell;$action.Arguments=$Arguments;$action.WorkingDirectory=$Plan.jobDirectory
    $Stage='register_single_limited_task';$null=$Folder.RegisterTaskDefinition($TaskName,$definition,2,$Sid,$null,3,$null)
    Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_POSTCHECK_FAILED'
    Status 'scheduled' 'BOOTSTRAP_TASK_SCHEDULED' @{delaySeconds=120;runLevel='limited';automaticRetries=0}
    exit 0
  }
  $Stage='verify_task_boundary'
  Need ($PSCommandPath -ieq $OwnScript -and $PlanPath -ieq $OwnPlan -and $WorkerSourcePath -ieq $OwnWorker -and (OwnTask (TaskOrNull))) 'BOOTSTRAP_TASK_BINDING_INVALID'
  $self=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$PID);$parent=Get-CimInstance Win32_Process -Filter ('ProcessId = '+[int]$self.ParentProcessId)
  Need ($parent -and $parent.Name -iin @('svchost.exe','taskeng.exe','taskhostw.exe')) 'BOOTSTRAP_OUTSIDE_TASK_UNCONFIRMED'
  $parentImage=ParentImage $parent
  Need ([IO.Path]::GetFileName($parentImage) -ieq $parent.Name -and [IO.Path]::GetDirectoryName($parentImage) -ieq (Join-Path $env:SystemRoot 'System32')) 'BOOTSTRAP_OUTSIDE_TASK_UNCONFIRMED'
  $Stage='wait_all_employees_idle'
  Status 'waiting_idle' 'BOOTSTRAP_WAITING_ALL_EMPLOYEES' @{forceStopped=$false}
  $env:ZIWEI_USER_HOME=$Plan.userDirectory;$env:ZIWEI_CONFIG=$Plan.configPath
  @(Get-ChildItem Env:|Where-Object {$_.Name.ToLowerInvariant() -ceq 'npm_config_prefix'})|ForEach-Object {[Environment]::SetEnvironmentVariable($_.Name,$null,'Process')}
  [Environment]::SetEnvironmentVariable('npm_config_prefix','D:\work\nodejs\node_global','Process')
  $text=(& $Plan.nodeExe $OwnWorker $OwnPlan --start 2>$null|Out-String);Need ($text.Length -lt 65536) 'BOOTSTRAP_OUTPUT_INVALID';$result=$text|ConvertFrom-Json
  Need ($LASTEXITCODE -eq 0 -and $result.state -ceq 'queued') 'BOOTSTRAP_START_FAILED'
  $Stage='observe_own_official_update';Status 'updating' 'BOOTSTRAP_OFFICIAL_WORKER_QUEUED' @{workerPid=$result.workerPid}
  $deadline=[DateTime]::UtcNow.AddMinutes(25)
  do{
    Start-Sleep -Seconds 3
    $text=(& $Plan.nodeExe $OwnWorker $OwnPlan --observe 2>$null|Out-String);Need ($text.Length -lt 65536) 'BOOTSTRAP_OUTPUT_INVALID';$result=$text|ConvertFrom-Json
    if($result.state -ceq 'complete'){
      Status 'complete' 'BOOTSTRAP_TARGET_READY' @{clientBuild=$result.clientBuild;pid=$result.pid;bootstrapOnly=$true;dedicatedRemoteProtocolVerified=$false}
      Need (OwnTask (TaskOrNull)) 'BOOTSTRAP_TASK_BINDING_INVALID';$Folder.DeleteTask($TaskName,0)
      exit 0
    }
    if($result.state -ceq 'failed'){Status 'failed' 'BOOTSTRAP_OFFICIAL_UPDATE_FAILED' @{code=$result.code;failureStage=$result.failureStage;reasonCode=$result.reasonCode};exit 1}
  }while([DateTime]::UtcNow -lt $deadline)
  Status 'unconfirmed' 'BOOTSTRAP_OBSERVATION_TIMEOUT' @{workerMayStillBeRunning=$true;forceStopped=$false}
  exit 1
}catch{
  $code=if($_.Exception.Message -cmatch '^BOOTSTRAP_[A-Z0-9_]{1,64}$'){$_.Exception.Message}else{'BOOTSTRAP_FAILED'}
  if($Plan -and (Test-Path -LiteralPath $Plan.jobDirectory)){try{Status 'failed' $code @{line=$_.InvocationInfo.ScriptLineNumber}}catch{}}
  [ordered]@{state='failed';stage=$Stage;code=$code;dedicatedRemoteProtocolVerified=$false}|ConvertTo-Json -Compress
  exit 1
}
