$ErrorActionPreference = 'Stop'
$ownedProcess = $null
$terminationRequested = $false
$exitObserved = $false
try {
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
  $inputText = [Console]::In.ReadToEnd()
  if ($inputText.Length -gt 8388608) { throw [InvalidOperationException]::new('OWNED_IDLE_FACT_REFUSED') }
  $d = $inputText | ConvertFrom-Json
  function Assert-Fact($value) {
    if (!$value) { throw [InvalidOperationException]::new('OWNED_IDLE_FACT_REFUSED') }
  }
  function Assert-Zero($value) {
    Assert-Fact (($value -is [int] -or $value -is [long]) -and $value -eq 0)
  }
  function Assert-Absolute($file) {
    Assert-Fact ($file -is [string] -and $file -match '^[A-Za-z]:\\' -and [IO.Path]::GetFullPath($file) -ieq $file)
  }
  function Same-Path($left, $right) {
    return ($left -is [string] -and $right -is [string] -and [IO.Path]::GetFullPath($left).TrimEnd('\') -ieq [IO.Path]::GetFullPath($right).TrimEnd('\'))
  }
  function Assert-NoReparse($file) {
    Assert-Absolute $file
    $cursor = [IO.Path]::GetFullPath($file)
    while ($cursor) {
      if (Test-Path -LiteralPath $cursor) {
        $entry = Get-Item -LiteralPath $cursor -Force -ErrorAction Stop
        Assert-Fact (($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0)
      }
      $parent = [IO.Directory]::GetParent($cursor)
      if (!$parent -or $parent.FullName -ieq $cursor) { break }
      $cursor = $parent.FullName
    }
  }
  function File-Hash($file) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([IO.File]::ReadAllBytes($file))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
  }
  function Text-Hash($value) {
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').ToLowerInvariant() }
    finally { $hash.Dispose() }
  }
  function Assert-Identity {
    Assert-Fact (!$ownedProcess.HasExited)
    $native = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $d.pid) -ErrorAction Stop
    Assert-Fact ($native -and $native.ProcessId -eq $d.pid -and $native.CreationDate.ToUniversalTime().ToString('o') -ceq $d.creationTime)
    Assert-Fact ([Math]::Abs(($ownedProcess.StartTime.ToUniversalTime() - $native.CreationDate.ToUniversalTime()).TotalMilliseconds) -le 2)
    Assert-Fact ($native.ExecutablePath -is [string] -and $native.ExecutablePath -ieq $d.executable)
    Assert-Fact ($native.CommandLine -is [string] -and (Text-Hash $native.CommandLine) -ceq $d.commandHash)
    $owner = Invoke-CimMethod -InputObject $native -MethodName GetOwnerSid -ErrorAction Stop
    Assert-Fact ($owner.ReturnValue -eq 0 -and $owner.Sid -ceq $d.ownerSid -and $owner.Sid -ceq $currentSid)
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $d.port -ErrorAction Stop | Where-Object { $_.LocalAddress -ceq $d.host })
    Assert-Fact ($listeners.Count -eq 1 -and $listeners[0].OwningProcess -eq $d.pid)
  }
  function Assert-IdleHealth {
    Assert-NoReparse $d.configPath
    Assert-Fact ((File-Hash $d.configPath) -ceq $d.configSha256)
    $request = [Net.HttpWebRequest]::Create($d.origin + '/healthz')
    $request.Proxy = $null
    $request.AllowAutoRedirect = $false
    $request.Timeout = 3000
    $request.ReadWriteTimeout = 3000
    $response = $request.GetResponse()
    try {
      Assert-Fact ([int]$response.StatusCode -eq 200)
      $reader = [IO.StreamReader]::new($response.GetResponseStream())
      try { $body = $reader.ReadToEnd(); Assert-Fact ($body.Length -le 1048576); $health = $body | ConvertFrom-Json }
      finally { $reader.Dispose() }
    } finally { $response.Dispose() }
    Assert-Fact ($health.service -ceq 'ziwei_user' -and $health.agentId -ceq 'ziwei_user' -and $health.pid -eq $d.pid)
    Assert-Fact ($health.clientBuild -ceq $d.build -and $health.workspace -ceq $d.workspace -and $health.deviceId -ceq $d.deviceId)
    Assert-Fact ($health.connectionState -ceq 'draining' -and $health.executionQuarantined -ceq $false)
    Assert-Zero $health.activeActionCount
    Assert-Zero $health.pollingCount
    Assert-Zero $health.quarantinedActionCount
    $life = $health.lifecycle
    Assert-Fact ($life -and $life.nonce -ceq $d.nonce -and (Same-Path $life.root $d.root) -and (Same-Path $life.configPath $d.configPath))
    Assert-Fact ($life.configSha256 -ceq $d.configSha256 -and (Same-Path $life.runtimeDir $d.runtimeDir) -and $life.startedAt -ceq $d.startedAt)
    Assert-Zero $life.managedAuxiliaryCount
    $maintenance = $health.maintenance
    Assert-Fact ($maintenance -and $maintenance.gatewaySafe -ceq $true -and $maintenance.gatewayWorkers -is [Array] -and @($maintenance.gatewayWorkers).Count -eq 0)
    Assert-Zero $maintenance.pendingDeliveryCount
    Assert-Zero $maintenance.blockedDeliveryCount
    # The recorded historical file issue is preserved. Neither safe nor stopSafe
    # is used as a substitute for this root instance's explicit idle checks.
    Assert-Fact ($health.connectionErrors -is [Array] -and @($health.connectionErrors).Count -eq 0)
    Assert-Fact ($health.connections -is [Array] -and @($health.connections).Count -eq @($d.connections).Count)
    $seen = @{}
    foreach ($expected in $d.connections) {
      $key = $expected.workspace + '|' + $expected.deviceId + '|' + $expected.primary
      Assert-Fact (!$seen.ContainsKey($key))
      $seen[$key] = $true
      $matches = @($health.connections | Where-Object { $_.workspace -ceq $expected.workspace -and $_.deviceId -ceq $expected.deviceId -and $_.primary -is [bool] -and $_.primary -ceq $expected.primary })
      Assert-Fact ($matches.Count -eq 1)
    }
  }
  function Assert-FileCAS {
    foreach ($row in $d.directories) {
      Assert-Fact ($row.exists -is [bool] -and $row.names -is [Array])
      Assert-NoReparse $row.path
      if (!$row.exists) { Assert-Fact (!(Test-Path -LiteralPath $row.path)); continue }
      $directory = Get-Item -LiteralPath $row.path -Force -ErrorAction Stop
      Assert-Fact $directory.PSIsContainer
      $actualNames = [string[]]@(Get-ChildItem -LiteralPath $row.path -Force -ErrorAction Stop | ForEach-Object { $_.Name })
      $expectedNames = [string[]]$row.names
      [Array]::Sort($actualNames, [StringComparer]::Ordinal)
      [Array]::Sort($expectedNames, [StringComparer]::Ordinal)
      Assert-Fact ($actualNames.Count -eq $expectedNames.Count)
      for ($index = 0; $index -lt $actualNames.Count; $index++) { Assert-Fact ($actualNames[$index] -ceq $expectedNames[$index]) }
    }
    foreach ($row in $d.files) {
      Assert-Fact ($row.exists -is [bool])
      Assert-NoReparse $row.path
      if (!$row.exists) { Assert-Fact (!(Test-Path -LiteralPath $row.path)); continue }
      $file = Get-Item -LiteralPath $row.path -Force -ErrorAction Stop
      Assert-Fact (!$file.PSIsContainer -and $row.sha256 -is [string] -and $row.sha256 -cmatch '^[a-f0-9]{64}$')
      Assert-Fact ((File-Hash $row.path) -ceq $row.sha256)
    }
  }
  Assert-Fact ($d -and ($d.pid -is [int] -or $d.pid -is [long]) -and $d.pid -gt 0 -and $d.waitMs -eq 8000)
  Assert-Fact ($d.build -ceq '161cc99010d6cdee4e3d8834135ac2ed4e8fb2031b746755b7d53de0b76dfb0b')
  Assert-Fact ($d.workspace -ceq 'bigtron' -and $d.deviceId -ceq 'device_11af6d85-6c5c-4cbe-9a25-31599a474e5d')
  Assert-Fact ($d.origin -ceq 'http://127.0.0.1:20242' -and $d.host -ceq '127.0.0.1' -and $d.port -eq 20242)
  Assert-Fact ($d.commandHash -is [string] -and $d.commandHash -cmatch '^[a-f0-9]{64}$' -and $d.configSha256 -is [string] -and $d.configSha256 -cmatch '^[a-f0-9]{64}$')
  Assert-Fact ($d.nonce -is [string] -and $d.nonce -cmatch '^[A-Za-z0-9_-]{16,128}$')
  Assert-Fact ($d.connections -is [Array] -and @($d.connections).Count -gt 0 -and $d.files -is [Array] -and @($d.files).Count -gt 0 -and $d.directories -is [Array] -and @($d.directories).Count -gt 0)
  foreach ($connection in $d.connections) {
    Assert-Fact ($connection.workspace -is [string] -and $connection.workspace -cmatch '^[a-z0-9][a-z0-9_-]{1,62}$' -and $connection.deviceId -is [string] -and $connection.deviceId -cmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$' -and $connection.primary -is [bool])
  }
  Assert-Fact (@($d.connections | Where-Object { $_.primary -eq $true }).Count -eq 1)
  Assert-Fact (@($d.connections | Where-Object { $_.primary -eq $true -and $_.workspace -ceq $d.workspace -and $_.deviceId -ceq $d.deviceId }).Count -eq 1)
  foreach ($file in @($d.root, $d.executable, $d.configPath, $d.runtimeDir, $d.exitFile)) { Assert-NoReparse $file }
  Assert-Fact (!(Test-Path -LiteralPath $d.exitFile) -and (Test-Path -LiteralPath ([IO.Path]::GetDirectoryName($d.exitFile)) -PathType Container))
  $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  Assert-Fact ($d.ownerSid -is [string] -and $d.ownerSid -ceq $currentSid)
  $ownedProcess = Get-Process -Id $d.pid -ErrorAction Stop
  $heldHandle = $ownedProcess.Handle
  Assert-Fact ($heldHandle -ne [IntPtr]::Zero)
  Assert-Fact ([Math]::Abs(([DateTime]::Parse($d.startedAt).ToUniversalTime() - [DateTime]::Parse($d.creationTime).ToUniversalTime()).TotalMilliseconds) -le 15000)
  Assert-Identity
  Assert-IdleHealth
  Assert-FileCAS
  Assert-Identity
  Assert-IdleHealth
  Assert-FileCAS
  Assert-Fact (@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = ' + $d.pid) -Property ProcessId -ErrorAction Stop).Count -eq 0)
  Assert-Fact ((File-Hash $d.configPath) -ceq $d.configSha256 -and !$ownedProcess.HasExited)
  $terminationRequested = $true
  $ownedProcess.Kill()
  Assert-Fact ($ownedProcess.WaitForExit($d.waitMs) -and $ownedProcess.HasExited)
  $exitObserved = $true
  $receipt = [pscustomobject]@{ scope = 'owned-daemon-root-only'; stopped = $true; pid = [int]$d.pid; creationTime = $d.creationTime; exitedAt = $ownedProcess.ExitTime.ToUniversalTime().ToString('o') }
  Assert-NoReparse $d.exitFile
  $receiptBytes = [Text.UTF8Encoding]::new($false).GetBytes(($receipt | ConvertTo-Json -Compress) + "`n")
  $exitStream = [IO.File]::Open($d.exitFile, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $exitStream.Write($receiptBytes, 0, $receiptBytes.Length); $exitStream.Flush($true) }
  finally { $exitStream.Dispose() }
  $receipt | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok = $false; code = 'OWNED_IDLE_STOP_REFUSED'; line = [int]$_.InvocationInfo.ScriptLineNumber; hresult = [int]$_.Exception.HResult; terminationRequested = $terminationRequested; exitObserved = $exitObserved } | ConvertTo-Json -Compress
  exit 1
} finally {
  if ($null -ne $ownedProcess) { $ownedProcess.Dispose() }
}
