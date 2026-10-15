# Windows PowerShell 5.1. ASCII only; no network, process termination, or credentials.
# Default: inspect. Delete only this verified legacy test HOME with -Apply.
[CmdletBinding()]
param([string]$ConfigPath = '', [string]$InstallRoot = '', [string]$RuntimeDir = '', [switch]$Apply)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$targetOrigin = 'https://qzelynth.top'
$targetWorkspace = 'bigtron'
$targetEmployee = 'employee_af9cc485-b8b5-472e-bf8e-70abb88b912e'
$targetKey = '282315f753fc066234b67def41bb3e9106a3b14d14a79fa3857c37003844753b'
$sourceHomeExpected = 'C:\Users\25941\AppData\Local\hermes'

function Property-Value($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}
function Full-LocalPath([string]$Value) {
    if ($Value -notmatch '^[A-Za-z]:[\\/]') { throw 'LOCAL_ABSOLUTE_PATH_REQUIRED' }
    return [IO.Path]::GetFullPath($Value)
}
function Assert-NoReparse([string]$Value) {
    $current = Full-LocalPath $Value
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -Force -LiteralPath $current
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT_REFUSED' }
        }
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
}
function Read-JsonFile([string]$File, [long]$Limit = 1048576) {
    Assert-NoReparse $File
    $item = Get-Item -Force -LiteralPath $File
    if ($item.PSIsContainer -or $item.Length -gt $Limit) { throw 'INVALID_JSON_FILE' }
    try { return ([IO.File]::ReadAllText($File, [Text.Encoding]::UTF8) | ConvertFrom-Json) }
    catch { throw 'INVALID_JSON_FILE' } # Never echo configuration text or tokens.
}
function Sha256-Bytes([byte[]]$Bytes) {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant() }
    finally { $hasher.Dispose() }
}
function Confirm-Target([string]$Candidate) {
    $targetHome = Full-LocalPath $Candidate
    Assert-NoReparse $targetHome
    $directory = Get-Item -Force -LiteralPath $targetHome
    if (-not $directory.PSIsContainer -or $directory.Name -cne $targetKey -or $directory.Parent.Name -ine 'bot-instances') { throw 'TARGET_PATH_MISMATCH' }
    $marker = Join-Path $targetHome 'ziwei-instance.json'
    $metadata = Read-JsonFile $marker 16384
    if ((Property-Value $metadata 'version') -ne 1 -or
        (Property-Value $metadata 'templateId') -cne 'ziwei-hermes-bot' -or
        (Property-Value $metadata 'key') -cne $targetKey -or
        (Property-Value $metadata 'origin') -cne $targetOrigin -or
        (Property-Value $metadata 'workspace') -cne $targetWorkspace -or
        (Property-Value $metadata 'employeeId') -cne $targetEmployee -or
        (Property-Value $metadata 'sourceProfile') -cne 'default' -or
        $null -ne $metadata.PSObject.Properties['mode']) { throw 'TARGET_MARKER_MISMATCH' }
    $sourceHome = Full-LocalPath ([string](Property-Value $metadata 'sourceHome'))
    if ($sourceHome.TrimEnd('\') -ine $sourceHomeExpected -or
        $targetHome.TrimEnd('\') -ieq $sourceHome.TrimEnd('\') -or
        $sourceHome.StartsWith($targetHome.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
        $targetHome.StartsWith($sourceHome.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'SHARED_SOURCE_REFUSED' }
    $identityJson = ConvertTo-Json -InputObject @($targetOrigin, $targetWorkspace, $targetEmployee) -Compress
    if ((Sha256-Bytes ([Text.Encoding]::UTF8.GetBytes($identityJson))) -cne $targetKey) { throw 'TARGET_KEY_MISMATCH' }
    return [pscustomobject]@{ path = $targetHome; markerHash = (Sha256-Bytes ([IO.File]::ReadAllBytes($marker))) }
}
function Assert-SafeTree([string]$Directory) {
    # Enumerate one directory at a time; never recurse through a junction.
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($Directory)
    $count = 0
    while ($pending.Count -gt 0) {
        foreach ($item in @(Get-ChildItem -Force -LiteralPath ($pending.Pop()))) {
            $count++
            if ($count -gt 100000) { throw 'TREE_TOO_LARGE_FOR_BOUNDED_CHECK' }
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'REPARSE_POINT_REFUSED' }
            if ($item.PSIsContainer) { $pending.Push($item.FullName) }
        }
    }
}

try {
    if ($env:OS -ne 'Windows_NT') { throw 'WINDOWS_ONLY' }
    $roots = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $configs = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $installs = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    if ($RuntimeDir) { [void]$roots.Add((Full-LocalPath $RuntimeDir)) }
    if ($ConfigPath) { [void]$configs.Add((Full-LocalPath $ConfigPath)) }
    if ($env:ZIWEI_CONFIG) { [void]$configs.Add((Full-LocalPath $env:ZIWEI_CONFIG)) }
    foreach ($userDirectory in @($env:ZIWEI_USER_HOME, $(if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Ziwei\ziwei_user' }))) {
        if ($userDirectory) {
            $userDirectory = Full-LocalPath $userDirectory
            [void]$roots.Add((Join-Path $userDirectory 'runtime'))
            [void]$configs.Add((Join-Path $userDirectory 'ziwei_user.json'))
        }
    }
    $installCandidates = @($InstallRoot)
    if ($PSScriptRoot) { $installCandidates += [IO.Directory]::GetParent($PSScriptRoot).FullName }
    foreach ($command in @(Get-Command ziwei_user, ziwei_user.cmd, ziwei_user.ps1 -ErrorAction SilentlyContinue)) {
        if ($command.Source -and (Test-Path -LiteralPath $command.Source -PathType Leaf)) {
            $installCandidates += Join-Path ([IO.Path]::GetDirectoryName($command.Source)) 'node_modules\ziwei'
        }
    }
    foreach ($candidate in $installCandidates) {
        if (-not $candidate) { continue }
        $candidate = Full-LocalPath $candidate
        $package = Join-Path $candidate 'package.json'
        if (-not (Test-Path -LiteralPath $package -PathType Leaf)) { continue }
        if ((Property-Value (Read-JsonFile $package) 'name') -cne 'ziwei') { continue }
        [void]$installs.Add($candidate)
        [void]$configs.Add((Join-Path $candidate 'data\ziwei_user.json'))
        [void]$roots.Add((Join-Path $candidate '.local\runtime'))
    }
    if ($InstallRoot -and -not $installs.Contains((Full-LocalPath $InstallRoot))) { throw 'ZIWEI_INSTALL_NOT_FOUND' }
    $loadedConfigs = @()
    foreach ($file in $configs) {
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
            if ($ConfigPath -and $file -ieq (Full-LocalPath $ConfigPath)) { throw 'EXPLICIT_CONFIG_NOT_FOUND' }
            continue
        }
        $loadedConfigs += Read-JsonFile $file
        # Only this configuration's immediate runtime neighbor; no disk scan.
        [void]$roots.Add((Join-Path ([IO.Path]::GetDirectoryName($file)) 'runtime'))
    }
    $baseRoots = @($roots)
    foreach ($configuration in $loadedConfigs) {
        foreach ($connection in @(Property-Value $configuration 'sharedWorkspaces')) {
            if ($null -eq $connection) { continue }
            $workspace = [string](Property-Value $connection 'workspace')
            $device = [string](Property-Value $connection 'deviceId')
            if ($workspace -cne $targetWorkspace -or $device -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$') { continue }
            foreach ($base in $baseRoots) { [void]$roots.Add((Join-Path $base ('shared-workspaces\' + $workspace + '\' + $device))) }
        }
    }
    $matches = @()
    foreach ($runtime in $roots) {
        $candidate = Join-Path $runtime ('bot-instances\' + $targetKey)
        if (Test-Path -LiteralPath $candidate) { $matches += Confirm-Target $candidate }
    }
    if ($matches.Count -eq 0) { throw 'TARGET_HOME_NOT_FOUND_IN_KNOWN_RUNTIME_DIRECTORIES' }
    if ($matches.Count -ne 1) { throw 'MULTIPLE_TARGET_HOMES_REFUSED' }
    $verified = $matches[0]
    Assert-SafeTree $verified.path
    if ($Apply) {
        $rechecked = Confirm-Target $verified.path
        if ($rechecked.markerHash -cne $verified.markerHash) { throw 'TARGET_MARKER_CHANGED' }
        Assert-SafeTree $verified.path
        # User explicitly requested deletion without a process-exit precondition.
        # Lock/access failures terminate this script; never terminate other processes.
        Remove-Item -LiteralPath $verified.path -Recurse -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $verified.path) { throw 'TARGET_HOME_STILL_EXISTS' }
    }
    [pscustomobject]@{
        state = $(if ($Apply) { 'deleted' } else { 'inspected' })
        employeeId = $targetEmployee; workspace = $targetWorkspace; home = $verified.path
        markerSha256 = $verified.markerHash; removed = [bool]$Apply
        homeExists = [bool](Test-Path -LiteralPath $verified.path)
        processTerminationAttempted = $false; executionConfirmedStopped = $false
        sharedSourceTouched = $false; observedAt = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json -Compress
} catch {
    # IO errors (including locks/access denied) retain their original message.
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
