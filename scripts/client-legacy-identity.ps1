param(
  [Parameter(Mandatory=$true)][int]$TargetProcessId,
  [Parameter(Mandatory=$true)][string]$ExpectedNode,
  [Parameter(Mandatory=$true)][string]$ExpectedEntry,
  [Parameter(Mandatory=$true)][string]$HealthHost,
  [Parameter(Mandatory=$true)][int]$HealthPort
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
  if ([IntPtr]::Size -ne 8) { throw 'Unsupported process architecture' }
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ZiweiLegacyReader {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public IntPtr ExitStatus, Peb, Affinity, Priority, Pid, Parent; }
  [StructLayout(LayoutKind.Sequential)] struct Region { public IntPtr Base, AllocationBase; public uint AllocationProtect; public UIntPtr Size; public uint State, Protect, Type; }
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsWow64Process(IntPtr h, out bool wow);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr p, byte[] bytes, UIntPtr size, out UIntPtr read);
  [DllImport("kernel32.dll", SetLastError=true)] static extern UIntPtr VirtualQueryEx(IntPtr h, IntPtr p, out Region info, UIntPtr size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern int GetPackageFullName(IntPtr h, ref uint length, StringBuilder name);
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
  public static Dictionary<string,object> Inspect(int pid) {
    IntPtr h=OpenProcess(0x0410,false,pid); if(h==IntPtr.Zero) throw new Exception("Process identity unavailable");
    try {
      bool wow; if(!IsWow64Process(h,out wow) || wow) throw new Exception("Unsupported process architecture");
      Basic info; int returned; if(NtQueryInformationProcess(h,0,out info,Marshal.SizeOf(typeof(Basic)),out returned)!=0) throw new Exception("Process identity unavailable");
      long parameters=BitConverter.ToInt64(Read(h,info.Peb.ToInt64()+0x20,8),0);
      string cwd=Unicode(h,parameters+0x38), command=Unicode(h,parameters+0x70);
      long cursor=BitConverter.ToInt64(Read(h,parameters+0x80,8),0); List<byte> bytes=new List<byte>(); bool done=false;
      while(bytes.Count<1048576 && !done) {
        Region region; if(VirtualQueryEx(h,new IntPtr(cursor),out region,new UIntPtr((uint)Marshal.SizeOf(typeof(Region)))).ToUInt64()==0 || region.State!=0x1000 || (region.Protect&0x101)!=0) throw new Exception("Environment unavailable");
        long remaining=region.Base.ToInt64()+(long)region.Size.ToUInt64()-cursor;
        int size=(int)Math.Min(Math.Min(4096,remaining),1048576-bytes.Count); size-=size%2; if(size<2) throw new Exception("Environment unavailable");
        byte[] block=Read(h,cursor,size); int previous=bytes.Count; bytes.AddRange(block); cursor+=size;
        for(int i=Math.Max(0,previous-2);i+3<bytes.Count;i+=2) if(bytes[i]==0 && bytes[i+1]==0 && bytes[i+2]==0 && bytes[i+3]==0) { bytes.RemoveRange(i,bytes.Count-i); done=true; break; }
      }
      if(!done) throw new Exception("Environment exceeds bound");
      var selected=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(string item in Encoding.Unicode.GetString(bytes.ToArray()).Split('\0')) {
        int equal=item.IndexOf('='); if(equal<1) continue; string key=item.Substring(0,equal);
        if(key.Equals("ZIWEI_CONFIG",StringComparison.OrdinalIgnoreCase) || key.Equals("ZIWEI_USER_HOME",StringComparison.OrdinalIgnoreCase)) { if(selected.ContainsKey(key)) throw new Exception("Ambiguous environment"); selected.Add(key,item.Substring(equal+1)); }
      }
      return new Dictionary<string,object>{{"cwd",cwd},{"command",command},{"environment",selected},{"samePackageContext",Package(h)==Package(GetCurrentProcess())}};
    } finally { CloseHandle(h); }
  }
}
'@
  $ziweiRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetProcessId"
  if (-not $ziweiRecord -or $TargetProcessId -eq $PID) { throw 'Process unavailable' }
  $ziweiOwner = Invoke-CimMethod -InputObject $ziweiRecord -MethodName GetOwnerSid
  if ($ziweiOwner.ReturnValue -ne 0 -or $ziweiOwner.Sid -ne [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value) { throw 'Process owner differs' }
  $ziweiMemory = [ZiweiLegacyReader]::Inspect($TargetProcessId)
  $ziweiArguments = [ZiweiLegacyReader]::Arguments($ziweiRecord.CommandLine)
  if ($ziweiArguments.Count -ne 2 -or [IO.Path]::GetFullPath($ziweiRecord.ExecutablePath) -ine [IO.Path]::GetFullPath($ExpectedNode) -or [IO.Path]::GetFullPath($ziweiArguments[0]) -ine [IO.Path]::GetFullPath($ExpectedNode) -or [IO.Path]::GetFullPath($ziweiArguments[1]) -ine [IO.Path]::GetFullPath($ExpectedEntry) -or $ziweiMemory.command -cne $ziweiRecord.CommandLine) { throw 'Process command differs' }
  $ziweiMatching = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object {
    if (-not $_.CommandLine) { return $false }
    $ziweiCandidateArgs = [ZiweiLegacyReader]::Arguments($_.CommandLine)
    @($ziweiCandidateArgs | Where-Object { $_ -ieq $ExpectedEntry }).Count -gt 0
  })
  if ($ziweiMatching.Count -ne 1 -or $ziweiMatching[0].ProcessId -ne $TargetProcessId) { throw 'Installation has multiple or ambiguous processes' }
  $ziweiListeners = @(Get-NetTCPConnection -State Listen -LocalPort $HealthPort -ErrorAction Stop | Where-Object { $_.LocalAddress -eq $HealthHost })
  if ($ziweiListeners.Count -ne 1 -or $ziweiListeners[0].OwningProcess -ne $TargetProcessId) { throw 'Health listener differs' }
  $ziweiAfter = Get-CimInstance Win32_Process -Filter "ProcessId = $TargetProcessId"
  if (-not $ziweiAfter -or $ziweiAfter.CreationDate -ne $ziweiRecord.CreationDate -or $ziweiAfter.CommandLine -cne $ziweiRecord.CommandLine) { throw 'Process changed' }
  $ziweiHasher = [Security.Cryptography.SHA256]::Create()
  try { $ziweiCommandHash = [BitConverter]::ToString($ziweiHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($ziweiRecord.CommandLine))).Replace('-','').ToLowerInvariant() } finally { $ziweiHasher.Dispose() }
  [pscustomobject]@{ pid=$TargetProcessId; creationTime=$ziweiRecord.CreationDate.ToUniversalTime().ToString('o'); commandHash=$ziweiCommandHash; cwd=$ziweiMemory.cwd; environment=$ziweiMemory.environment; samePackageContext=$ziweiMemory.samePackageContext; listenerPid=[int]$ziweiListeners[0].OwningProcess } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [Console]::Error.WriteLine('LEGACY_PROCESS_IDENTITY_UNAVAILABLE')
  exit 1
}
