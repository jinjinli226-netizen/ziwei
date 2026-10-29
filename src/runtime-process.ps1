param([Parameter(Mandatory=$true)][string]$Nonce, [Parameter(Mandatory=$true)][string]$ReceiptDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($Nonce -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { exit 120 }
$source = @'
using System;
using System.IO;
using System.Text;
using System.Threading;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Web.Script.Serialization;
using Microsoft.Win32.SafeHandles;

public static class ZiweiRuntimeJob {
  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags; public short show, reservedSize; public IntPtr reserved2,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO info; public IntPtr attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long processTime, jobTime; public uint flags; public UIntPtr minWork, maxWork; public uint activeLimit; public UIntPtr affinity; public uint priority, scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong rOps,wOps,oOps,rBytes,wBytes,oBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXTENDED_LIMIT info,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out ACCOUNTING info,uint size,IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process,uint exitCode);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CreatePipe(out IntPtr read,out IntPtr write,ref SECURITY_ATTRIBUTES attributes,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,uint flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string application,StringBuilder command,IntPtr processAttributes,IntPtr threadAttributes,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUPINFOEX startup,out PROCESS_INFORMATION process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  static void Check(bool ok,string step) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(),step); }
  static void Close(ref IntPtr handle) { if(handle!=IntPtr.Zero) { CloseHandle(handle); handle=IntPtr.Zero; } }
  static uint Active(IntPtr job) { ACCOUNTING a; Check(QueryInformationJobObject(job,1,out a,(uint)Marshal.SizeOf(typeof(ACCOUNTING)),IntPtr.Zero),"QUERY_JOB"); return a.active; }
  static string Quote(string value) {
    StringBuilder b=new StringBuilder("\""); int slashes=0;
    foreach(char c in value) { if(c=='\\') { slashes++; continue; } if(c=='"') { b.Append('\\',slashes*2+1); b.Append(c); } else { b.Append('\\',slashes); b.Append(c); } slashes=0; }
    b.Append('\\',slashes*2); b.Append('"'); return b.ToString();
  }
  static Thread Pump(Stream source,Stream destination,bool closeDestination) {
    Thread t=new Thread(delegate() { try { byte[] bytes=new byte[16384]; int count; while((count=source.Read(bytes,0,bytes.Length))>0) { destination.Write(bytes,0,count); destination.Flush(); } } catch(IOException) {} catch(ObjectDisposedException) {} finally { if(closeDestination) try { destination.Dispose(); } catch {} } });
    t.IsBackground=true; t.Start(); return t;
  }
  static FileStream PipeStream(IntPtr handle,FileAccess access) { return new FileStream(new SafeFileHandle(handle,true),access,16384,false); }
  static Dictionary<string,object> Request(Stream input) {
    MemoryStream bytes=new MemoryStream(); int b;
    while((b=input.ReadByte())>=0 && b!=10) { if(bytes.Length>=2097152) throw new Exception("REQUEST_TOO_LARGE"); bytes.WriteByte((byte)b); }
    if(b!=10) throw new Exception("REQUEST_INCOMPLETE");
    return new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(bytes.ToArray()));
  }
  static void Receipt(string directory,string file,Dictionary<string,object> value) {
    string temporary=Path.Combine(directory,file+".tmp");
    File.WriteAllText(temporary,new JavaScriptSerializer().Serialize(value),new UTF8Encoding(false));
    File.Move(temporary,Path.Combine(directory,file));
  }
  static bool Cancelled(string directory,string nonce) { try { return File.ReadAllText(Path.Combine(directory,"cancel"))==nonce; } catch(FileNotFoundException) { return false; } }
  public static int Run(string nonce,string directory) {
    string jobName="Local\\Ziwei.Runtime."+nonce;
    Dictionary<string,object> result=new Dictionary<string,object> { {"schema",1},{"nonce",nonce},{"jobName",jobName},{"hostPid",System.Diagnostics.Process.GetCurrentProcess().Id},{"launched",false},{"rootPid",null},{"rootConfirmed",false},{"rootExitCode",null},{"treeConfirmed",false},{"activeProcesses",null},{"cancelled",false},{"backgroundProcessesRetained",false},{"failureCode",null},{"streamsComplete",false} };
    IntPtr job=IntPtr.Zero,parent=IntPtr.Zero,inputRead=IntPtr.Zero,inputWrite=IntPtr.Zero,outputRead=IntPtr.Zero,outputWrite=IntPtr.Zero,errorRead=IntPtr.Zero,errorWrite=IntPtr.Zero,environment=IntPtr.Zero,attributes=IntPtr.Zero,handleList=IntPtr.Zero;
    PROCESS_INFORMATION process=new PROCESS_INFORMATION();
    FileStream runtimeInput=null,runtimeOutput=null,runtimeError=null;
    Thread outputPump=null,errorPump=null;
    bool assigned=false,launched=false,attributesReady=false,rootReceiptWritten=false;
    string step="PREPARE";
    try {
      directory=Path.GetFullPath(directory);
      DirectorySecurity acl=new DirectorySecurity(); acl.SetAccessRuleProtection(true,false);
      acl.AddAccessRule(new FileSystemAccessRule(WindowsIdentity.GetCurrent().User,FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid,null),FileSystemRights.FullControl,InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit,PropagationFlags.None,AccessControlType.Allow));
      Directory.SetAccessControl(directory,acl);
      Stream standardInput=Console.OpenStandardInput();
      Dictionary<string,object> request=Request(standardInput);
      bool cleanupOnFailure=!request.ContainsKey("cleanupOnFailure") || !(request["cleanupOnFailure"] is bool) || (bool)request["cleanupOnFailure"];
      parent=OpenProcess(0x00100000,false,Convert.ToUInt32(request["parentPid"]));
      Check(parent!=IntPtr.Zero,"OPEN_PARENT");
      if(Cancelled(directory,nonce) || WaitForSingleObject(parent,0)==0) { result["cancelled"]=true; result["treeConfirmed"]=true; result["activeProcesses"]=0; result["failureCode"]="RUNTIME_CANCELLED_BEFORE_LAUNCH"; Receipt(directory,"result.json",result); return 0; }
      step="CREATE_JOB"; job=CreateJobObjectW(IntPtr.Zero,jobName); Check(job!=IntPtr.Zero,"CREATE_JOB");
      if(Marshal.GetLastWin32Error()==183) throw new Exception("JOB_NAME_COLLISION");
      EXTENDED_LIMIT limits=new EXTENDED_LIMIT(); limits.basic.flags=0x2000;
      step="SET_JOB_LIMIT"; Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),step);
      SECURITY_ATTRIBUTES sa=new SECURITY_ATTRIBUTES(); sa.length=Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); sa.inherit=1;
      step="CREATE_PIPES";
      Check(CreatePipe(out inputRead,out inputWrite,ref sa,0),step); Check(SetHandleInformation(inputWrite,1,0),step);
      Check(CreatePipe(out outputRead,out outputWrite,ref sa,0),step); Check(SetHandleInformation(outputRead,1,0),step);
      Check(CreatePipe(out errorRead,out errorWrite,ref sa,0),step); Check(SetHandleInformation(errorRead,1,0),step);
      IntPtr attributeSize=IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref attributeSize);
      attributes=Marshal.AllocHGlobal(attributeSize); Check(InitializeProcThreadAttributeList(attributes,1,0,ref attributeSize),"INITIALIZE_HANDLE_LIST"); attributesReady=true;
      handleList=Marshal.AllocHGlobal(IntPtr.Size*3);
      Marshal.WriteIntPtr(handleList,0,inputRead); Marshal.WriteIntPtr(handleList,IntPtr.Size,outputWrite); Marshal.WriteIntPtr(handleList,IntPtr.Size*2,errorWrite);
      Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handleList,new IntPtr(IntPtr.Size*3),IntPtr.Zero,IntPtr.Zero),"SET_HANDLE_LIST");
      STARTUPINFOEX startup=new STARTUPINFOEX(); startup.info.cb=Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.info.flags=0x100; startup.info.input=inputRead; startup.info.output=outputWrite; startup.info.error=errorWrite; startup.attributes=attributes;
      Dictionary<string,object> env=(Dictionary<string,object>)request["env"];
      SortedDictionary<string,string> sorted=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
      foreach(KeyValuePair<string,object> item in env) sorted[item.Key]=Convert.ToString(item.Value);
      StringBuilder block=new StringBuilder(); foreach(KeyValuePair<string,string> item in sorted) block.Append(item.Key).Append('=').Append(item.Value).Append('\0'); block.Append('\0');
      environment=Marshal.StringToHGlobalUni(block.ToString());
      string command=(string)request["command"];
      StringBuilder arguments=new StringBuilder(Quote(command)); foreach(object argument in (IEnumerable)request["args"]) arguments.Append(' ').Append(Quote((string)argument));
      step="CREATE_SUSPENDED";
      Check(CreateProcessW(command,arguments,IntPtr.Zero,IntPtr.Zero,true,0x00000004|0x00000400|0x08000000|0x00080000,environment,(string)request["cwd"],ref startup,out process),step);
      step="ASSIGN_JOB"; Check(AssignProcessToJobObject(job,process.process),step); assigned=true;
      Close(ref inputRead); Close(ref outputWrite); Close(ref errorWrite);
      runtimeInput=PipeStream(inputWrite,FileAccess.Write); inputWrite=IntPtr.Zero;
      runtimeOutput=PipeStream(outputRead,FileAccess.Read); outputRead=IntPtr.Zero;
      runtimeError=PipeStream(errorRead,FileAccess.Read); errorRead=IntPtr.Zero;
      outputPump=Pump(runtimeOutput,Console.OpenStandardOutput(),false);
      errorPump=Pump(runtimeError,Console.OpenStandardError(),false);
      step="RESUME"; Check(ResumeThread(process.thread)!=0xffffffff,step); launched=true; result["launched"]=true; result["rootPid"]=process.pid;
      Receipt(directory,"started.json",result);
      Pump(standardInput,runtimeInput,true);
      step="WAIT_ROOT";
      while(true) {
        uint wait=WaitForSingleObject(process.process,50);
        if(wait==0) break;
        if(wait!=258) throw new Win32Exception(Marshal.GetLastWin32Error(),step);
        if(Cancelled(directory,nonce) || WaitForSingleObject(parent,0)==0) { result["cancelled"]=true; Check(TerminateJobObject(job,1),"CANCEL_JOB"); break; }
      }
      step="WAIT_ROOT_EXIT"; Check(WaitForSingleObject(process.process,10000)==0,step);
      uint exitCode; Check(GetExitCodeProcess(process.process,out exitCode),"ROOT_EXIT_CODE");
      result["rootConfirmed"]=true; result["rootExitCode"]=exitCode;
      if(Cancelled(directory,nonce) || WaitForSingleObject(parent,0)==0) result["cancelled"]=true;
      uint count;
      bool failedRootCleanup=cleanupOnFailure && exitCode!=0;
      if((bool)result["cancelled"] || failedRootCleanup) {
        step=failedRootCleanup?"REAP_FAILED_JOB":"REAP_JOB";
        Check(TerminateJobObject(job,1),step);
        DateTime deadline=DateTime.UtcNow.AddSeconds(10); count=Active(job);
        while(count>0 && DateTime.UtcNow<deadline) { Thread.Sleep(20); count=Active(job); }
        result["activeProcesses"]=count; result["treeConfirmed"]=count==0;
        if(count!=0) throw new Exception("JOB_NOT_EMPTY");
      } else {
        step="WAIT_JOB_ACCOUNTING";
        // The root handle can signal just before Job accounting removes that root.
        // Wait only briefly; a real detached service must remain alive and observable.
        DateTime accountingDeadline=DateTime.UtcNow.AddMilliseconds(250); count=Active(job);
        while(count>0 && DateTime.UtcNow<accountingDeadline) { Thread.Sleep(10); count=Active(job); }
        result["activeProcesses"]=count; result["treeConfirmed"]=count==0;
      }
      result["streamsComplete"]=outputPump.Join(1000) && errorPump.Join(1000);
      if(!(bool)result["streamsComplete"] && count==0) throw new Exception("STREAM_DRAIN_UNCONFIRMED");
      // Cancellation can arrive after the root exits, while accounting or streams drain.
      if(!(bool)result["cancelled"] && (Cancelled(directory,nonce) || WaitForSingleObject(parent,0)==0)) {
        result["cancelled"]=true; step="REAP_JOB";
        Check(TerminateJobObject(job,1),step);
        DateTime deadline=DateTime.UtcNow.AddSeconds(10); count=Active(job);
        while(count>0 && DateTime.UtcNow<deadline) { Thread.Sleep(20); count=Active(job); }
        result["activeProcesses"]=count; result["treeConfirmed"]=count==0;
        if(count!=0) throw new Exception("JOB_NOT_EMPTY");
        result["streamsComplete"]=outputPump.Join(1000) && errorPump.Join(1000);
      }
      if(!(bool)result["cancelled"] && !failedRootCleanup) {
        // An ordinary completed CLI may intentionally leave a development service.
        // Keep kill-on-close through all waits; release only at terminal handoff.
        step="RELEASE_COMPLETED_JOB"; limits.basic.flags=0;
        Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(EXTENDED_LIMIT))),step);
        result["backgroundProcessesRetained"]=count>0 && (bool)result["rootConfirmed"] && result["failureCode"]==null;
        if((bool)result["backgroundProcessesRetained"]) {
          // Keep the original handle: a Job cannot be reopened after its last handle closes.
          result["retainedHandoff"]=true; Receipt(directory,"result.json",result); rootReceiptWritten=true;
          while((count=Active(job))>0 && WaitForSingleObject(parent,0)!=0) {
            if(Cancelled(directory,nonce)) {
              result["cancelled"]=true; step="REAP_RETAINED_JOB";
              Check(TerminateJobObject(job,1),step);
              DateTime deadline=DateTime.UtcNow.AddSeconds(10);
              while((count=Active(job))>0 && DateTime.UtcNow<deadline) Thread.Sleep(20);
              if(count!=0) throw new Exception("JOB_NOT_EMPTY");
              break;
            }
            Thread.Sleep(30);
          }
          result["activeProcesses"]=count; result["treeConfirmed"]=count==0;
          result["backgroundProcessesRetained"]=count>0 && !(bool)result["cancelled"];
          result["retainedHandoff"]=false;
        }
      }
    } catch(Exception error) {
      result["backgroundProcessesRetained"]=false;
      Win32Exception native=error as Win32Exception;
      result["failureCode"]="RUNTIME_"+step+"_"+(native==null?error.GetType().Name:native.NativeErrorCode.ToString());
      // No unsupervised program is ever resumed, including an assignment failure.
      if(process.process!=IntPtr.Zero) {
        if(assigned && job!=IntPtr.Zero) TerminateJobObject(job,1); else TerminateProcess(process.process,1);
        if(WaitForSingleObject(process.process,10000)==0) { result["rootConfirmed"]=true; uint code; if(launched && GetExitCodeProcess(process.process,out code)) result["rootExitCode"]=code; }
      }
      if(job!=IntPtr.Zero) { try { DateTime until=DateTime.UtcNow.AddSeconds(5); uint count=Active(job); while(count>0 && DateTime.UtcNow<until) { Thread.Sleep(20); count=Active(job); } result["activeProcesses"]=count; result["treeConfirmed"]=count==0; } catch {} }
    } finally {
      Close(ref job); Close(ref parent); Close(ref process.thread); Close(ref process.process);
      Close(ref inputRead); Close(ref inputWrite); Close(ref outputRead); Close(ref outputWrite); Close(ref errorRead); Close(ref errorWrite);
      if(attributesReady) DeleteProcThreadAttributeList(attributes);
      if(attributes!=IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if(handleList!=IntPtr.Zero) Marshal.FreeHGlobal(handleList);
      if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
    }
    Receipt(directory,rootReceiptWritten?"cleanup.json":"result.json",result);
    return result["failureCode"]==null?0:121;
  }
}
'@
try {
  Add-Type -TypeDefinition $source -ReferencedAssemblies System.Web.Extensions -Language CSharp
  $result = [ZiweiRuntimeJob]::Run($Nonce, $ReceiptDirectory)
  exit $result
} catch { exit 122 }
