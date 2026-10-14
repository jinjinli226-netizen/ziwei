$ErrorActionPreference='Stop'
try {
 $ziweiSystemModuleRoot=[IO.Path]::Combine([Environment]::SystemDirectory,'WindowsPowerShell\v1.0\Modules')
 if($ziweiSystemModuleRoot -ine 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules' -or $PSHOME -ine [IO.Directory]::GetParent($ziweiSystemModuleRoot).FullName){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
 $env:PSModulePath=$ziweiSystemModuleRoot
 $global:PSModuleAutoLoadingPreference='None'
 function Import-ZiweiSystemModule([string]$Name) {
  $ziweiManifest=[IO.Path]::Combine($ziweiSystemModuleRoot,$Name,$Name+'.psd1')
  $ziweiModulePath=$ziweiManifest;$ziweiModuleBase=$PSHOME;$ziweiCommandType='Cmdlet'
  switch -Exact ($Name) {
   'Microsoft.PowerShell.Utility' {$ziweiCommands=@('ConvertFrom-Json','ConvertTo-Json','Add-Type');$ziweiAssembly='C:\Windows\Microsoft.Net\assembly\GAC_MSIL\Microsoft.PowerShell.Commands.Utility\v4.0_3.0.0.0__31bf3856ad364e35\Microsoft.PowerShell.Commands.Utility.dll'}
   'CimCmdlets' {$ziweiCommands=@('Get-CimInstance','Invoke-CimMethod');$ziweiModuleBase=[IO.Path]::Combine($ziweiSystemModuleRoot,$Name);$ziweiModulePath='C:\Windows\Microsoft.Net\assembly\GAC_MSIL\Microsoft.Management.Infrastructure.CimCmdlets\v4.0_1.0.0.0__31bf3856ad364e35\Microsoft.Management.Infrastructure.CimCmdlets.dll';$ziweiAssembly=$ziweiModulePath}
   'Microsoft.PowerShell.Security' {$ziweiCommands=@('Get-AuthenticodeSignature');$ziweiAssembly='C:\Windows\Microsoft.Net\assembly\GAC_MSIL\Microsoft.PowerShell.Security\v4.0_3.0.0.0__31bf3856ad364e35\Microsoft.PowerShell.Security.dll'}
   'NetTCPIP' {$ziweiCommands=@('Get-NetTCPConnection');$ziweiModuleBase=[IO.Path]::Combine($ziweiSystemModuleRoot,$Name);$ziweiCommandType='Function'}
   default {throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
  }
  $ziweiCommandModuleName=$Name;$ziweiCommandModulePath=$ziweiModulePath
  if($Name -ceq 'NetTCPIP'){$ziweiCommandModuleName='MSFT_NetTCPConnection';$ziweiCommandModulePath=[IO.Path]::Combine($ziweiModuleBase,'MSFT_NetTCPConnection.cdxml')}
  foreach($ziweiModule in @(Microsoft.PowerShell.Core\Get-Module -Name $Name -All)) {
   if($ziweiModule.Path -ine $ziweiModulePath -or $ziweiModule.ModuleBase -ine $ziweiModuleBase){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
  }
  if($Name -ceq 'NetTCPIP') {foreach($ziweiModule in @(Microsoft.PowerShell.Core\Get-Module -Name $ziweiCommandModuleName -All)){if($ziweiModule.Path -ine $ziweiCommandModulePath -or $ziweiModule.ModuleBase -ine $ziweiModuleBase){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}}}
  Microsoft.PowerShell.Core\Import-Module -Name $ziweiManifest -Scope Global -Force -ErrorAction Stop
  foreach($ziweiCommandName in $ziweiCommands) {
   $ziweiMatches=@(Microsoft.PowerShell.Core\Get-Command -Name ($Name+'\'+$ziweiCommandName) -All -ErrorAction Stop)
   if($ziweiMatches.Count -ne 1){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
   $ziweiCommand=$ziweiMatches[0]
   if($ziweiCommand.ModuleName -cne $ziweiCommandModuleName -or [string]$ziweiCommand.CommandType -cne $ziweiCommandType -or $ziweiCommand.Module.Path -ine $ziweiCommandModulePath -or $ziweiCommand.Module.ModuleBase -ine $ziweiModuleBase -or ($ziweiCommandType -ceq 'Cmdlet' -and $ziweiCommand.ImplementingType.Assembly.Location -ine $ziweiAssembly)){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
  }
  if($env:PSModulePath -ine $ziweiSystemModuleRoot -or $global:PSModuleAutoLoadingPreference -cne 'None'){throw 'SOURCE_WINDOWS_MODULE_UNPROVEN'}
 }
 Import-ZiweiSystemModule 'Microsoft.PowerShell.Utility'
 Import-ZiweiSystemModule 'CimCmdlets'
} catch {
 [Console]::Error.WriteLine('SOURCE_WINDOWS_MODULE_UNPROVEN');exit 1
}
# ZIWEI_SYSTEM_MODULE_PRELUDE_END
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 $ziweiPhase='SOURCE_WINDOWS_NATIVE_UNREADABLE'
 $ziweiInput=[Console]::In.ReadToEnd()|Microsoft.PowerShell.Utility\ConvertFrom-Json
 if($ziweiInput.kind -eq 'os-boot') {
  $ziweiBootTime=(CimCmdlets\Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime()
  $ziweiBootHasher=[Security.Cryptography.SHA256]::Create()
  try{$ziweiBootId=[BitConverter]::ToString($ziweiBootHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ziweiBootTime.ToString('o')))).Replace('-','').ToLowerInvariant()}finally{$ziweiBootHasher.Dispose()}
  [pscustomobject]@{bootId=$ziweiBootId;startedAt=$ziweiBootTime.ToString('yyyy-MM-ddTHH:mm:ss.fffZ')}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress
  exit 0
 }
 $ziweiTargetId=[int]$ziweiInput.pid
 if($ziweiTargetId -lt 1 -or $ziweiTargetId -eq $PID){throw 'SOURCE_WINDOWS_PID_INVALID'}
 $ziweiRecord=CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
 if(!$ziweiRecord){[pscustomobject]@{state='absent';pid=$ziweiTargetId}|Microsoft.PowerShell.Utility\ConvertTo-Json -Compress;exit 0}
 if([IntPtr]::Size -ne 8){throw 'SOURCE_WINDOWS_ARCHITECTURE'}
  Microsoft.PowerShell.Utility\Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ZiweiSourceReader {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public IntPtr ExitStatus, Peb, Affinity, Priority, Pid, Parent; }
  [StructLayout(LayoutKind.Sequential)] struct Region { public IntPtr Base, AllocationBase; public uint AllocationProtect; public UIntPtr Size; public uint State, Protect, Type; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsWow64Process(IntPtr h, out bool wow);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr p, byte[] bytes, UIntPtr size, out UIntPtr read);
  [DllImport("kernel32.dll", SetLastError=true)] static extern UIntPtr VirtualQueryEx(IntPtr h, IntPtr p, out Region info, UIntPtr size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr h, ref uint length, StringBuilder name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref uint size);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr h, int kind, out Basic info, int size, out int returned);
  [DllImport("shell32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CommandLineToArgvW(string command, out int count);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  static byte[] Read(IntPtr h, long address, int size) {
    if(address <= 0 || size < 0 || size > 1048576) throw new Exception("Invalid memory range");
    byte[] b=new byte[size]; UIntPtr n;
    if(!ReadProcessMemory(h,new IntPtr(address),b,new UIntPtr((uint)size),out n) || n.ToUInt64()!=(ulong)size) throw new Exception("Process read failed");
    return b;
  }
  static string Unicode(IntPtr h, long address) {
    byte[] u=Read(h,address,16); int length=BitConverter.ToUInt16(u,0), maximum=BitConverter.ToUInt16(u,2);
    if(length%2!=0 || length>maximum || length>32766) throw new Exception("Invalid process string");
    return length==0 ? "" : Encoding.Unicode.GetString(Read(h,BitConverter.ToInt64(u,8),length));
  }
  static string Package(IntPtr h) {
    uint length=0; int status=GetPackageFullName(h,ref length,null);
    if(status==15700) return "";
    if(status!=122 || length<1 || length>4096) throw new Exception("Package identity unavailable");
    StringBuilder b=new StringBuilder((int)length); if(GetPackageFullName(h,ref length,b)!=0) throw new Exception("Package identity unavailable"); return b.ToString();
  }
  public static string[] Arguments(string command) {
    int count; IntPtr argv=CommandLineToArgvW(command,out count); if(argv==IntPtr.Zero) throw new Exception("Command identity unavailable");
    try { if(count<1 || count>64) throw new Exception("Command argument count invalid"); string[] a=new string[count]; for(int i=0;i<count;i++) a[i]=Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv,i*IntPtr.Size)); return a; } finally { LocalFree(argv); }
  }
  public static Dictionary<string,object> ConsoleIdentity(int pid){
    IntPtr h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)throw new Exception("SOURCE_WINDOWS_CONSOLE_UNPROVEN");
    try{bool wow;if(!IsWow64Process(h,out wow)||wow||Package(h)!=""||Package(GetCurrentProcess())!="")throw new Exception("SOURCE_WINDOWS_CONSOLE_UNPROVEN");long created,exited,kernel,user;if(!GetProcessTimes(h,out created,out exited,out kernel,out user))throw new Exception("SOURCE_WINDOWS_CONSOLE_UNPROVEN");uint size=32768;var image=new StringBuilder((int)size);if(!QueryFullProcessImageName(h,0,image,ref size))throw new Exception("SOURCE_WINDOWS_CONSOLE_UNPROVEN");return new Dictionary<string,object>{{"creationFileTime",created.ToString()},{"executable",image.ToString()}};}finally{CloseHandle(h);}
  }
  public static long Birth(int pid){IntPtr h=OpenProcess(0x1000,false,pid);if(h==IntPtr.Zero)throw new Exception("SOURCE_WINDOWS_BIRTH_UNAVAILABLE");try{long created,exited,kernel,user;if(!GetProcessTimes(h,out created,out exited,out kernel,out user))throw new Exception("SOURCE_WINDOWS_BIRTH_UNAVAILABLE");return created;}finally{CloseHandle(h);}}
  public static Dictionary<string,object> Inspect(int pid) {
    IntPtr h=OpenProcess(0x0410,false,pid); if(h==IntPtr.Zero) throw new Exception("Process identity unavailable");
    try {
      bool wow; if(!IsWow64Process(h,out wow) || wow) throw new Exception("Unsupported process architecture");
      if(Package(h)!="" || Package(GetCurrentProcess())!="") throw new Exception("SOURCE_WINDOWS_PACKAGE_CONTEXT"); long created,exited,kernel,user; if(!GetProcessTimes(h,out created,out exited,out kernel,out user))throw new Exception("SOURCE_WINDOWS_BIRTH_UNAVAILABLE"); Basic info; int returned; if(NtQueryInformationProcess(h,0,out info,Marshal.SizeOf(typeof(Basic)),out returned)!=0) throw new Exception("Process identity unavailable");
      long parameters=BitConverter.ToInt64(Read(h,info.Peb.ToInt64()+0x20,8),0);
      string cwd=Unicode(h,parameters+0x38), command=Unicode(h,parameters+0x70);
      long cursor=BitConverter.ToInt64(Read(h,parameters+0x80,8),0); bool done=false,previousNul=false,inValue=false,keep=false,executionValue=false,nodeOptionsPresent=false; int consumed=0;
      var selected=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      var key=new StringBuilder(); var chosenValue=new StringBuilder();
      string[] allowed={"HOME","USERPROFILE","HOMEDRIVE","HOMEPATH","LOCALAPPDATA","APPDATA","ZIWEI_CONFIG","ZIWEI_USER_HOME","ZIWEI_RUNTIME_DIR","ZIWEI_SDK_ROOT","HERMES_HOME","HERMES_MANAGED_DIR"};
      while(consumed<1048576 && !done) {
        Region region; if(VirtualQueryEx(h,new IntPtr(cursor),out region,new UIntPtr((uint)Marshal.SizeOf(typeof(Region)))).ToUInt64()==0 || region.State!=0x1000 || (region.Protect&0x101)!=0) throw new Exception("Environment unavailable");
        long remaining=region.Base.ToInt64()+(long)region.Size.ToUInt64()-cursor;
        int size=(int)Math.Min(Math.Min(4096,remaining),1048576-consumed); size-=size%2; if(size<2) throw new Exception("Environment unavailable");
        byte[] block=Read(h,cursor,size); cursor+=size;consumed+=size;
        try { for(int i=0;i<block.Length;i+=2) {
          char value=(char)(block[i]|(block[i+1]<<8));
          if(value=='\0') {
            if(previousNul){done=true;break;}
            if(keep){string name=key.ToString().ToUpperInvariant();if(selected.ContainsKey(name))throw new Exception("Ambiguous path environment");selected.Add(name,chosenValue.ToString());}
            key.Length=0;chosenValue.Length=0;inValue=false;keep=false;executionValue=false;previousNul=true;continue;
          }
          previousNul=false;
          if(!inValue && value=='='){inValue=true;string name=key.ToString().ToUpperInvariant();keep=Array.IndexOf(allowed,name)>=0;executionValue=name=="NODE_OPTIONS";continue;}
          if(!inValue){if(key.Length<128)key.Append(value);else {inValue=true;keep=false;}}
          else if(keep){if(chosenValue.Length>=32766)throw new Exception("Path environment exceeds bound");chosenValue.Append(value);}
          else if(executionValue){nodeOptionsPresent=true;}
        }} finally {Array.Clear(block,0,block.Length);}
      }
      if(!done)throw new Exception("Environment exceeds bound");
      return new Dictionary<string,object>{{"cwd",cwd},{"command",command},{"environment",selected},{"nodeOptionsPresent",nodeOptionsPresent},{"samePackageContext",true},{"creationFileTime",created.ToString()}};
    } finally { CloseHandle(h); }
  }
}
'@
 if($ziweiInput.createdAt -and [DateTime]::FromFileTimeUtc([ZiweiSourceReader]::Birth($ziweiTargetId)).ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -cne $ziweiInput.createdAt){throw 'SOURCE_WINDOWS_BIRTH_CHANGED'}
 $ziweiOwner=CimCmdlets\Invoke-CimMethod -InputObject $ziweiRecord -MethodName GetOwnerSid
 if($ziweiOwner.ReturnValue -ne 0 -or $ziweiOwner.Sid -ne [Security.Principal.WindowsIdentity]::GetCurrent().User.Value){throw 'SOURCE_WINDOWS_OWNER'}
 if($ziweiInput.kind -eq 'console-host'){$ziweiPhase='SOURCE_WINDOWS_CONSOLE_HANDLE'}
 $ziweiMemory=if($ziweiInput.kind -eq 'console-host'){[ZiweiSourceReader]::ConsoleIdentity($ziweiTargetId)}else{[ZiweiSourceReader]::Inspect($ziweiTargetId)}
 if($ziweiInput.kind -eq 'console-host'){$ziweiPhase='SOURCE_WINDOWS_CONSOLE_ARGUMENTS'}
 $ziweiArgv=[ZiweiSourceReader]::Arguments($ziweiRecord.CommandLine)
 if($ziweiInput.kind -ne 'console-host' -and $ziweiMemory.command -cne $ziweiRecord.CommandLine){throw 'SOURCE_WINDOWS_COMMAND'}
 $ziweiCreated=[DateTime]::FromFileTimeUtc([long]$ziweiMemory.creationFileTime).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
 if($ziweiRecord.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -cne $ziweiCreated){throw 'SOURCE_WINDOWS_BIRTH_CHANGED'}
 if($ziweiInput.createdAt -and $ziweiInput.createdAt -cne $ziweiCreated){throw 'SOURCE_WINDOWS_BIRTH_CHANGED'}
 if($ziweiInput.kind -eq 'console-host'){
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_SCOPE'
  $ziweiConsoleImage=[IO.Path]::Combine([Environment]::SystemDirectory,'conhost.exe')
  if($ziweiMemory.executable -ine $ziweiConsoleImage -or $ziweiRecord.ExecutablePath -ine $ziweiConsoleImage -or $ziweiRecord.ParentProcessId -ne $ziweiInput.parentPid -or $ziweiArgv.Count -lt 2 -or $ziweiArgv.Count -gt 3 -or $ziweiArgv[1] -notmatch '^0x[0-9a-f]+$' -or ($ziweiArgv.Count -eq 3 -and $ziweiArgv[2] -cne '-ForceV1')){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiParent=CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId = $($ziweiInput.parentPid)"
  if(!$ziweiParent -or $ziweiParent.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -cne $ziweiInput.parentCreatedAt -or $ziweiRecord.CreationDate -lt $ziweiParent.CreationDate -or @(CimCmdlets\Get-CimInstance Win32_Process -Filter "ParentProcessId = $ziweiTargetId").Count){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_SIGNATURE'
  Import-ZiweiSystemModule 'Microsoft.PowerShell.Security'
  $ziweiSignature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $ziweiConsoleImage
  if($ziweiSignature.Status -ne 'Valid' -or $ziweiSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_AFTER'
  $ziweiConsoleAfter=CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
  if(!$ziweiConsoleAfter -or $ziweiConsoleAfter.CreationDate -ne $ziweiRecord.CreationDate -or $ziweiConsoleAfter.CommandLine -cne $ziweiRecord.CommandLine -or $ziweiConsoleAfter.ParentProcessId -ne $ziweiParent.ProcessId){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_HASH'
  $ziweiImageHasher=[Security.Cryptography.SHA256]::Create();$ziweiImageStream=[IO.File]::OpenRead($ziweiConsoleImage)
  try{$ziweiConsoleHash=[BitConverter]::ToString($ziweiImageHasher.ComputeHash($ziweiImageStream)).Replace('-','').ToLowerInvariant()}finally{$ziweiImageStream.Dispose();$ziweiImageHasher.Dispose()}
  [pscustomobject]@{state='present';kind='console-host';pid=$ziweiTargetId;parentPid=[int]$ziweiParent.ProcessId;parentCreatedAt=$ziweiInput.parentCreatedAt;createdAt=$ziweiCreated;creationFileTime=$ziweiMemory.creationFileTime;executable=$ziweiConsoleImage;imageSha256=$ziweiConsoleHash;signature='Microsoft Corporation';children=@()}|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 3 -Compress
  exit 0
 }
 if($ziweiArgv.Count -ne 2){throw 'SOURCE_WINDOWS_COMMAND'}
 $ziweiEntry=if([IO.Path]::IsPathRooted($ziweiArgv[1])){[IO.Path]::GetFullPath($ziweiArgv[1])}else{[IO.Path]::GetFullPath([IO.Path]::Combine($ziweiMemory.cwd,$ziweiArgv[1]))}
 if($ziweiInput.entryPath -and $ziweiInput.entryPath -ine $ziweiEntry){throw 'SOURCE_WINDOWS_ENTRY_CHANGED'}
 $ziweiAfter=CimCmdlets\Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
 if(!$ziweiAfter -or $ziweiAfter.CreationDate -ne $ziweiRecord.CreationDate -or $ziweiAfter.CommandLine -cne $ziweiRecord.CommandLine){throw 'SOURCE_WINDOWS_BIRTH_CHANGED'}
 $ziweiHasher=[Security.Cryptography.SHA256]::Create()
 try{$ziweiDigest=[BitConverter]::ToString($ziweiHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ziweiRecord.CommandLine))).Replace('-','').ToLowerInvariant();$ziweiBoot=[BitConverter]::ToString($ziweiHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes((CimCmdlets\Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')))).Replace('-','').ToLowerInvariant()}finally{$ziweiHasher.Dispose()}
 [pscustomobject]@{state='present';pid=$ziweiTargetId;parentPid=[int]$ziweiRecord.ParentProcessId;createdAt=$ziweiCreated;creationFileTime=$ziweiMemory.creationFileTime;bootId=$ziweiBoot;cwd=$ziweiMemory.cwd;entryPath=$ziweiEntry;executable=$ziweiRecord.ExecutablePath;commandDigest=$ziweiDigest;paths=$ziweiMemory.environment;nodeOptionsPresent=$ziweiMemory.nodeOptionsPresent;samePackageContext=$ziweiMemory.samePackageContext}|Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 5 -Compress
} catch {
 $ziweiError=if($_.Exception.Message -match 'SOURCE_WINDOWS_[A-Z_]+'){$Matches[0]}else{if($ziweiInput.kind -eq 'console-host'){$ziweiPhase+'_'+$_.Exception.GetType().Name.ToUpperInvariant()}else{$ziweiPhase}}
 [Console]::Error.WriteLine($ziweiError);exit 1
}
