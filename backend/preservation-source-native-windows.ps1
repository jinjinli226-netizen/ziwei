$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
try {
 $ziweiPhase='SOURCE_WINDOWS_NATIVE_UNREADABLE'
 $ziweiInput=[Console]::In.ReadToEnd()|ConvertFrom-Json
 $ziweiTargetId=[int]$ziweiInput.pid
 if($ziweiTargetId -lt 1 -or $ziweiTargetId -eq $PID){throw 'SOURCE_WINDOWS_PID_INVALID'}
 $ziweiRecord=Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
 if(!$ziweiRecord){[pscustomobject]@{state='absent';pid=$ziweiTargetId}|ConvertTo-Json -Compress;exit 0}
 if([IntPtr]::Size -ne 8){throw 'SOURCE_WINDOWS_ARCHITECTURE'}
  Add-Type -TypeDefinition @'
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
 $ziweiOwner=Invoke-CimMethod -InputObject $ziweiRecord -MethodName GetOwnerSid
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
  $ziweiConsoleImage=Join-Path ([Environment]::SystemDirectory) 'conhost.exe'
  if($ziweiMemory.executable -ine $ziweiConsoleImage -or $ziweiRecord.ExecutablePath -ine $ziweiConsoleImage -or $ziweiRecord.ParentProcessId -ne $ziweiInput.parentPid -or $ziweiArgv.Count -lt 2 -or $ziweiArgv.Count -gt 3 -or $ziweiArgv[1] -notmatch '^0x[0-9a-f]+$' -or ($ziweiArgv.Count -eq 3 -and $ziweiArgv[2] -cne '-ForceV1')){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiParent=Get-CimInstance Win32_Process -Filter "ProcessId = $($ziweiInput.parentPid)"
  if(!$ziweiParent -or $ziweiParent.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ') -cne $ziweiInput.parentCreatedAt -or $ziweiRecord.CreationDate -lt $ziweiParent.CreationDate -or @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ziweiTargetId").Count){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_SIGNATURE'
  Import-Module (Join-Path ([Environment]::SystemDirectory) 'WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
  $ziweiSignature=Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $ziweiConsoleImage
  if($ziweiSignature.Status -ne 'Valid' -or $ziweiSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_AFTER'
  $ziweiConsoleAfter=Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
  if(!$ziweiConsoleAfter -or $ziweiConsoleAfter.CreationDate -ne $ziweiRecord.CreationDate -or $ziweiConsoleAfter.CommandLine -cne $ziweiRecord.CommandLine -or $ziweiConsoleAfter.ParentProcessId -ne $ziweiParent.ProcessId){throw 'SOURCE_WINDOWS_CONSOLE_UNPROVEN'}
  $ziweiPhase='SOURCE_WINDOWS_CONSOLE_HASH'
  $ziweiImageHasher=[Security.Cryptography.SHA256]::Create();$ziweiImageStream=[IO.File]::OpenRead($ziweiConsoleImage)
  try{$ziweiConsoleHash=[BitConverter]::ToString($ziweiImageHasher.ComputeHash($ziweiImageStream)).Replace('-','').ToLowerInvariant()}finally{$ziweiImageStream.Dispose();$ziweiImageHasher.Dispose()}
  [pscustomobject]@{state='present';kind='console-host';pid=$ziweiTargetId;parentPid=[int]$ziweiParent.ProcessId;parentCreatedAt=$ziweiInput.parentCreatedAt;createdAt=$ziweiCreated;creationFileTime=$ziweiMemory.creationFileTime;executable=$ziweiConsoleImage;imageSha256=$ziweiConsoleHash;signature='Microsoft Corporation';children=@()}|ConvertTo-Json -Depth 3 -Compress
  exit 0
 }
 if($ziweiArgv.Count -ne 2){throw 'SOURCE_WINDOWS_COMMAND'}
 $ziweiEntry=if([IO.Path]::IsPathRooted($ziweiArgv[1])){[IO.Path]::GetFullPath($ziweiArgv[1])}else{[IO.Path]::GetFullPath((Join-Path $ziweiMemory.cwd $ziweiArgv[1]))}
 if($ziweiInput.entryPath -and $ziweiInput.entryPath -ine $ziweiEntry){throw 'SOURCE_WINDOWS_ENTRY_CHANGED'}
 $ziweiAfter=Get-CimInstance Win32_Process -Filter "ProcessId = $ziweiTargetId"
 if(!$ziweiAfter -or $ziweiAfter.CreationDate -ne $ziweiRecord.CreationDate -or $ziweiAfter.CommandLine -cne $ziweiRecord.CommandLine){throw 'SOURCE_WINDOWS_BIRTH_CHANGED'}
 $ziweiHasher=[Security.Cryptography.SHA256]::Create()
 try{$ziweiDigest=[BitConverter]::ToString($ziweiHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ziweiRecord.CommandLine))).Replace('-','').ToLowerInvariant();$ziweiBoot=[BitConverter]::ToString($ziweiHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes((Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')))).Replace('-','').ToLowerInvariant()}finally{$ziweiHasher.Dispose()}
 [pscustomobject]@{state='present';pid=$ziweiTargetId;parentPid=[int]$ziweiRecord.ParentProcessId;createdAt=$ziweiCreated;creationFileTime=$ziweiMemory.creationFileTime;bootId=$ziweiBoot;cwd=$ziweiMemory.cwd;entryPath=$ziweiEntry;executable=$ziweiRecord.ExecutablePath;commandDigest=$ziweiDigest;paths=$ziweiMemory.environment;nodeOptionsPresent=$ziweiMemory.nodeOptionsPresent;samePackageContext=$ziweiMemory.samePackageContext}|ConvertTo-Json -Depth 5 -Compress
} catch {
 $ziweiError=if($_.Exception.Message -match 'SOURCE_WINDOWS_[A-Z_]+'){$Matches[0]}else{if($ziweiInput.kind -eq 'console-host'){$ziweiPhase+'_'+$_.Exception.GetType().Name.ToUpperInvariant()}else{$ziweiPhase}}
 [Console]::Error.WriteLine($ziweiError);exit 1
}
