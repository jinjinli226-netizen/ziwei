# E03 Windows PowerShell execution-time module provenance

The `a8bc51dc8e5759ca86cdb092532e46e108b6320b` child environment constraint was insufficient. An isolated invocation of the already qualified system Windows PowerShell executable received only `C:\Windows\System32\WindowsPowerShell\v1.0\Modules` in `PSModulePath`, but startup changed its effective value to `C:\Program Files\WindowsPowerShell\Modules;C:\Windows\System32\WindowsPowerShell\v1.0\Modules`. Current commands still resolved to system modules; that observation did not establish a sole-system-directory invariant for future calls. This matches the documented startup construction logic in Microsoft's [Windows PowerShell 5.1 about_PSModulePath](https://raw.githubusercontent.com/MicrosoftDocs/PowerShell-Docs/main/reference/5.1/Microsoft.PowerShell.Core/About/about_PSModulePath.md).

The finite correction moves enforcement into the script, before its first JSON or CIM command and before the `absent` branch. It overwrites the process-local effective `PSModulePath`, sets `PSModuleAutoLoadingPreference` to `None`, checks existing modules for unexpected provenance, imports only closed-set absolute protected system manifests through the Core command, and verifies the actual exported command type/module/base/path and binary implementing assembly. All subsequent CIM, JSON, Add-Type, Authenticode, NetTCP and Core pipeline commands are module-qualified. Path composition uses .NET rather than an additional Management module dependency. Unknown module/import/provenance state refuses with `SOURCE_WINDOWS_MODULE_UNPROVEN`; it cannot become `absent`.

The pinned helper contains one complete prelude ending at an exact unique sentinel. Dynamic inventory/listener scripts extract that prelude from the same normalized string whose complete helper SHA was just verified. They do not reread the helper for extraction. Base imports are Utility+CimCmdlets; listener explicitly adds NetTCPIP, and the console-host branch explicitly adds Security. Imports inside the closed-set function use Global scope in the isolated child runspace so commands remain available after the function returns. The registry, profiles, user/AllUsers Modules directories and system modules are unchanged.

Provenance follows the actual layout observed after explicit imports, rather than assuming every module is a manifest or every command is a Cmdlet:

| Commands | Actual command module/type | Protected provenance |
|---|---|---|
| Get-CimInstance, Invoke-CimMethod | CimCmdlets / Cmdlet | Exact system Modules/CimCmdlets base and qualified `Microsoft.Management.Infrastructure.CimCmdlets` GAC assembly |
| ConvertFrom-Json, ConvertTo-Json, Add-Type | Microsoft.PowerShell.Utility / Cmdlet | Exact system Utility manifest, PSHOME base and qualified Utility GAC implementing assembly |
| Get-AuthenticodeSignature | Microsoft.PowerShell.Security / Cmdlet | Exact system Security manifest, PSHOME base and qualified Security GAC implementing assembly |
| Get-NetTCPConnection | MSFT_NetTCPConnection / Function, invoked through NetTCPIP | Exact protected NetTCPIP parent manifest/base and nested `MSFT_NetTCPConnection.cdxml` command provenance |

The helper normalized-LF SHA256 is `b8fd13d2c22c3ec25b081f4cb33157c24983f473264872ce0de3843f4016f643`. These fixed manifests/assembly paths retain the existing qualification for this canonical Windows installation; they do not add a generic platform fallback.

Qualification was deliberately limited to this correction:

- Red regression: the old helper accepted an in-memory impostor CimCmdlets module and returned `absent`. The corrected helper refuses it before reading stdin or issuing CIM, with no observation output.
- Three new native tests pass: effective execution-time path/autoload and seven command origins; impostor-before-absent refusal; genuine isolated listener owner/held process birth followed by genuine exited-process absence. No source IO callback replaces these queries.
- One existing native held-handle test passes, covering selected memory paths, wrong-birth refusal, PATH/PSModulePath shadowing, actual scope inventory and the system console-host signature branch.
- Lint passes for 127 source files, and `git diff --check` passes.

Port 46093 was checked against the persistent registry and actual listeners before the isolated listener test; it was unregistered and available. Independent parent diagnostics retain process start/PID, heartbeat and exit code/signal under the owned `.local/preservation-native-qualification/diagnostics` directory. The test closes its own isolated child through IPC. No production service, SDK launcher, model, device or formal lifecycle action was run. SDK auditing, the full suites and the full dual-host fixture were not repeated.

Owned local evidence:

| Artifact under `.local/preservation-native-qualification` | SHA256 |
|---|---|
| powershell-module-startup.json | `ba113b0c7e5f8aa7eb25530bc040dd8b703dae61c4a430d14bf38bb17ef99f01` |
| powershell-module-fixed.json | `0045e6c19f4b18c95a19f732d49a99017b047788221d9a081945a16150d50b8e` |
| powershell-module-listener.json | `4fa0d7c30a154023f8b276d2c6417625de3f56fd4a81c03c2046f2816ec22563` |

This closes the finite PowerShell module-resolution defect. It does not close the previously documented historical original SDK discovery-descendant gap or authorize a formal production PASS. E02/R/Q must use the corrected combined candidate; the original `a8bc51d` environment-only claim must not be frozen as the final invariant.
