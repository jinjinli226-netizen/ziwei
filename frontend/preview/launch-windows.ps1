param(
    [Parameter(Mandatory=$true)][string]$StateRoot,
    [string]$NodePath='C:\Program Files\nodejs\node.exe'
)
$ErrorActionPreference='Stop'
$previewCodeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$previewEntry=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot 'supervisor.mjs')).ProviderPath
$StateRoot=(Resolve-Path -LiteralPath $StateRoot).ProviderPath
$NodePath=(Resolve-Path -LiteralPath $NodePath).ProviderPath
if([IO.Path]::GetFileName($StateRoot) -ne 'bot-preview' -or
   [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($StateRoot)) -ne '.local' -or
   [IO.Path]::GetFileName($NodePath) -ne 'node.exe' -or
   $NodePath -match '["\r\n]' -or $previewEntry -match '["\r\n]' -or
   -not (Test-Path -LiteralPath (Join-Path $StateRoot 'data\preview.sqlite') -PathType Leaf)) {
    throw 'Use the verified owned preview state and native supervisor entry.'
}
if(Get-NetTCPConnection -State Listen -LocalPort 5283,4283 -ErrorAction SilentlyContinue) {
    throw 'Preview ports are already listening; inspect and reuse the existing owner.'
}
# The same native supervisor runs outside the short-lived tool process tree.
# Only runtime paths enter the independent process; provider secrets do not.
$previewEnvironment=[System.Collections.Generic.List[string]]::new()
$runtimeNames=@('PATH','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','PROGRAMDATA')
Get-ChildItem Env: | Where-Object {$_.Name -in $runtimeNames} | ForEach-Object {
    $previewEnvironment.Add($_.Name+'='+$_.Value)
}
$previewHome=Join-Path $StateRoot 'runtime-home'
$previewEnvironment.Add('HOME='+$previewHome)
$previewEnvironment.Add('USERPROFILE='+$previewHome)
$previewEnvironment.Add('APPDATA='+(Join-Path $previewHome 'AppData\Roaming'))
$previewEnvironment.Add('LOCALAPPDATA='+(Join-Path $previewHome 'AppData\Local'))
$previewEnvironment.Add('CODEX_HOME='+(Join-Path $previewHome 'codex'))
$previewEnvironment.Add('ZIWEI_PREVIEW_DATA_ROOT='+$StateRoot)
$previewEnvironment.Add('ZIWEI_PREVIEW_LAUNCH_MODE=windows-independent')
$startup=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{
    ShowWindow=[uint16]0
    CreateFlags=[uint32](0x01000000 -bor 0x00000400 -bor 0x00000008)
    EnvironmentVariables=[string[]]$previewEnvironment
}
$created=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine='"'+$NodePath+'" "'+$previewEntry+'"'
    CurrentDirectory=$previewCodeRoot
    ProcessStartupInformation=$startup
}
if($created.ReturnValue -ne 0){throw ('Independent preview launch failed: '+$created.ReturnValue)}
@{pid=[int]$created.ProcessId;mode='windows-independent';entry=$previewEntry;stateRoot=$StateRoot} | ConvertTo-Json -Compress
