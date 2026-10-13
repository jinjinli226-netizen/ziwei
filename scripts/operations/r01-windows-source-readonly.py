"""Same-user hidden native Windows source inventory; no maintenance/business.

All reads prove exact Win32 final paths, including every file. Never follows
MSIX redirects. Current PID/PPID inventory and empty counters are not historic
Job membership or detached-worker provenance. Missing scopes remain unknown.
"""
import argparse, collections, datetime, hashlib, importlib.util, json, os, pathlib, subprocess, sys

sha=lambda data:hashlib.sha256(data).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def powershell(code):
    raw=subprocess.check_output(['powershell.exe','-NoProfile','-NonInteractive','-Command',
        "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; "+code],timeout=25,creationflags=0x08000000)
    return json.loads(raw.decode('utf-8-sig')) if raw.strip() else []
def array(value):return value if isinstance(value,list) else [value] if value else []
def process_projection(value):
    return {'pid':value['ProcessId'],'ppid':value.get('ParentProcessId'),'name':value.get('Name'),
            'executable':value.get('ExecutablePath'),'nativeBirth':{'kind':'windows-cim-creation-date','createdAt':value.get('CreationDate')},
            'argvSha256':sha((value.get('CommandLine') or '').encode()),'commandVisible':value.get('CommandLine') is not None,
            'executableVisible':value.get('ExecutablePath') is not None}
def exit_projections(value,pointer='$'):
    out=[]
    if isinstance(value,list):
        for index,item in enumerate(value):out+=exit_projections(item,pointer+'/'+str(index))
    elif isinstance(value,dict):
        if 'treeConfirmed' in value or 'rootPid' in value:
            fields={key:value.get(key) for key in ['supervisor','launched','treeConfirmed','activeProcesses','rootConfirmed','rootPid','rootExitCode','failureCode','jobAssigned','breakawayAllowed'] if key in value}
            out.append({'pointer':pointer,'valueDigest':sha(json.dumps(value,sort_keys=True,separators=(',',':')).encode()),**fields,
                        'treeZeroReported':value.get('treeConfirmed') is True and value.get('activeProcesses')==0,
                        'originalJobProvenanceVerified':False})
        for key,item in value.items():out+=exit_projections(item,pointer+'/'+key)
    return out
def installed_build(g,native):
    fixed=['package.json','backend/a2a-auth.mjs','scripts/ziwei-user.mjs','scripts/ziwei-cli.mjs','scripts/start-ziwei-user.mjs',
           'scripts/ziwei-mcp.mjs','scripts/ziwei-terminal-mcp.mjs','scripts/client-lifecycle.mjs','scripts/client-legacy-identity.mjs',
           'scripts/client-legacy-identity.ps1','scripts/client-maintenance-helper.mjs','scripts/client-update.mjs','scripts/client-update-worker.mjs']
    paths=fixed[:]
    for folder in ['daemon','src']:
        for file in (g.PACKAGE_ROOT/folder).rglob('*'):
            if file.is_file() and file.suffix in ['.mjs','.py','.ps1']:paths.append(str(file.relative_to(g.PACKAGE_ROOT)))
    digest=hashlib.sha256();files=[]
    for relative in sorted(set(paths)):
        file=g.PACKAGE_ROOT/relative
        if not file.exists():continue
        exact=native(g,file);data=exact.read_bytes()
        digest.update(relative.replace('\\','/').encode());digest.update(b'\0');digest.update(data);digest.update(b'\0')
        files.append({'path':str(file),'sha256':sha(data),'bytes':len(data)})
    return digest.hexdigest(),files
def identity(g,native):
    config_file=native(g,g.CONFIG_FILE);config_data=config_file.read_bytes();config=json.loads(config_data.decode('utf-8-sig'))
    health=json.loads(g.get_bytes('http://127.0.0.1:20242/readyz',2*1024*1024,12));life=health.get('lifecycle') or {}
    inventory=array(powershell('Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Depth 4 -Compress'))
    owner=next((item for item in inventory if item['ProcessId']==health.get('pid')),None)
    listeners=array(powershell('Get-NetTCPConnection -State Listen -LocalPort 20242 | Select-Object LocalAddress,LocalPort,OwningProcess | ConvertTo-Json -Compress'))
    build,files=installed_build(g,native);config_sha=sha(config_data)
    g.require(owner and str(owner.get('ExecutablePath')).casefold()==str(g.NODE).casefold(),'NATIVE_EXE_MISMATCH')
    entry=str(g.PACKAGE_ROOT/'daemon/ziwei_user.mjs');command=owner.get('CommandLine') or ''
    g.require(entry.casefold() in command.casefold() or entry.replace('\\','/').casefold() in command.casefold(),'NATIVE_ENTRY_MISMATCH')
    g.require(listeners and all(item['OwningProcess']==health['pid'] for item in listeners),'NATIVE_LISTENER_OWNER_MISMATCH')
    g.require(life.get('nonce') and life.get('configSha256')==config_sha and str(life.get('root')).casefold()==str(g.PACKAGE_ROOT).casefold() and str(life.get('configPath')).casefold()==str(g.CONFIG_FILE).casefold(),'NATIVE_LIFECYCLE_BINDING_MISMATCH')
    g.require(build==health.get('clientBuild') and config.get('workspace')==health.get('workspace')==g.WORKSPACE and config.get('deviceId')==health.get('deviceId')==g.DEVICE,'NATIVE_BUILD_SCOPE_MISMATCH')
    bindings=[]
    for index,connection in enumerate([config]+config.get('sharedWorkspaces',[])):
        runtime=g.USER_HOME/'runtime' if index==0 else g.USER_HOME/'runtime/shared-workspaces'/connection['workspace']/connection['deviceId']
        bindings.append({**g.selected(connection,['workspace','deviceId','apiBase','enabled','workdir','hermesHomePath','defaultRuntime']),
                         'primary':index==0,'observedConventionalRuntimePath':str(runtime)})
    return {'identityKind':'api-lifecycle-and-windows-cim','process':process_projection(owner),'listeners':listeners,
            'installedBuild':build,'sourceFiles':files,'physicalRoot':str(g.PACKAGE_ROOT),'entryPath':entry,
            'config':{'path':str(g.CONFIG_FILE),'nativeFinalPath':g.final_path(config_file),'sha256':config_sha},
            'nonceDigest':sha(life['nonce'].encode()),'startedAt':life.get('startedAt'),'connections':bindings,
            'health':g.selected(health,['ready','connectionState','activeActionCount','pollingCount','lastHeartbeatAgeMs']),
            'healthConnectionBindings':[g.selected(item,['workspace','deviceId','primary','configured','ready']) for item in health.get('connections',[])],
            'managedAuxiliaryCount':life.get('managedAuxiliaryCount'),'managedAuxiliaryCountIsCompleteWorkerProof':False},inventory
def inventory_roots(g,native):
    files=[];directories=[];proofs=[];jobs=[];issues=[];total=0
    for category in ['runtime','maintenance','logs','diagnostics']:
        root=g.USER_HOME/category
        if not root.exists():directories.append({'path':str(root),'category':category,'exists':False});continue
        def walk(folder):
            nonlocal total
            exact=native(g,folder);entries=sorted(exact.iterdir(),key=lambda p:p.name)
            directories.append({'path':str(folder),'category':category,'exists':True,'entries':[file.name for file in entries]})
            for child in entries:
                file=folder/child.name;exact_file=native(g,file)
                if exact_file.is_dir():walk(file);continue
                if not exact_file.is_file():raise RuntimeError('SOURCE_FILE_KIND_UNKNOWN')
                size=exact_file.stat().st_size;total+=size
                if len(files)>=10000 or size>64*1024*1024 or total>512*1024*1024:raise RuntimeError('FINITE_SOURCE_LIMIT')
                data=exact_file.read_bytes();record={'path':str(file),'nativeFinalPath':g.final_path(exact_file),'category':category,
                                                  'sha256':sha(data),'bytes':len(data),'sameReadStable':exact_file.read_bytes()==data}
                files.append(record)
                if not record['sameReadStable']:issues.append({'code':'SOURCE_CHANGED_DURING_READ','path':str(file)})
                objects=[]
                relative_parts=file.relative_to(root).parts
                native_json=category in ['runtime','diagnostics'] or category=='maintenance' and len(relative_parts)<=2
                # Staged package/source/dependency JSON is opaque byte evidence,
                # not a worker receipt; JSONC tsconfig must not invent live debt.
                if file.suffix=='.json' and native_json:
                    try:objects=[json.loads(data.decode('utf-8-sig'))]
                    except (UnicodeError,ValueError):issues.append({'code':'JSON_SOURCE_UNREADABLE','path':str(file)})
                elif (file.suffix in ['.jsonl','.log'] and native_json) or category=='logs' and file.name.startswith('daemon.log'):
                    invalid=0;events=[]
                    for line in data.decode('utf-8-sig','strict').splitlines():
                        try:obj=json.loads(line)
                        except ValueError:invalid+=1;continue
                        objects.append(obj)
                        if isinstance(obj,dict) and any(token in str(obj.get('event','')) for token in ['maintenance','update','uninstall','started','exited','heartbeat']):
                            events.append(g.selected(obj,['at','pid','event','workerPid','parentPid','exitCode','code']))
                    record['invalidJsonLines']=invalid;record['lifecycleEvents']=events
                for obj in objects:
                    proofs.extend({**proof,'sourcePath':str(file),'sourceSha256':record['sha256']} for proof in exit_projections(obj))
                if category=='maintenance' and len(relative_parts)==2 and file.name in ['job.json','result.json']:
                    obj=objects[0] if len(objects)==1 and isinstance(objects[0],dict) else {}
                    jobs.append({'directory':str(file.parent),'file':file.name,'sourceSha256':record['sha256'],
                                 **g.selected(obj,['state','operation','workerPid','parentPid','startedAt','finishedAt','code'])})
        walk(root)
    directory_changes=[]
    for record in directories:
        if record.get('exists') and sorted(file.name for file in native(g,pathlib.Path(record['path'])).iterdir())!=record['entries']:
            directory_changes.append(record['path'])
    return {'files':files,'directories':directories,'processExitReports':proofs,'maintenanceRecords':jobs,'issues':issues,
            'directoryMembershipChanges':directory_changes,'allExistingMaintenanceDirectoriesEnumeratedAtSnapshot':True,
            'originalWorkerBirthRecordsComplete':False,'historicJobProvenanceComplete':False}
def main():
    p=argparse.ArgumentParser();p.add_argument('--helper',required=True);p.add_argument('--helper-sha256',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('NEW_PRIVATE_OUTPUT_REQUIRED')
    if sha(pathlib.Path(args.helper).read_bytes())!=args.helper_sha256:raise RuntimeError('REVIEWED_HELPER_CHANGED')
    spec=importlib.util.spec_from_file_location('g',args.helper);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
    source=pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py');spec=importlib.util.spec_from_file_location('r',source);r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
    g.require(os.environ.get('USERPROFILE','').casefold()==str(g.USER_PROFILE).casefold(),'NATIVE_USER_MISMATCH')
    for file in [g.USER_HOME,g.PACKAGE_ROOT,g.NODE]:g.assert_plain(file)
    started=now();before,inventory=identity(g,r.native_file);sources=inventory_roots(g,r.native_file);after,_=identity(g,r.native_file)
    keys=['identityKind','process','installedBuild','sourceFiles','physicalRoot','entryPath','config','nonceDigest','startedAt','connections','listeners']
    stable=all(before[key]==after[key] for key in keys)
    report={'kind':'r01-windows-source-observation','schemaVersion':1,'captureStartedAt':started,'captureCompletedAt':now(),
        'before':before,'after':after,'identityStable':stable,'nativeProcessInventory':[process_projection(value) for value in inventory],
        'operatingSystem':powershell('Get-CimInstance Win32_OperatingSystem | Select-Object LastBootUpTime | ConvertTo-Json -Compress'),
        'sourceScopes':sources,'scope':{'namespaceComplete':None,'workerScopeComplete':None,'historicPreStopLineage':'unknown',
        'originalJobMembership':'unknown','originalProcessEnvironmentAndOverrides':'unknown','configuredAndPebHomesComplete':False,
        'allConnectionRuntimeRootsProven':False,'rawCommandTreeProof':'unknown','actualStoppedCapture':'NOT_RUN'},
        'helperSha256':args.helper_sha256,'nativePathReaderSha256':sha(source.read_bytes()),'readerSourceSha256':sha(pathlib.Path(__file__).read_bytes()),
        'serviceActions':0,'modelCalls':0,'phoneActions':0,'formalGatePassed':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=True,indent=2);stream.write('\n')
if __name__=='__main__':
    try:main()
    except Exception as error:
        if '--output' in sys.argv:
            output=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in output.parents and not output.exists():
                output.parent.mkdir(parents=True,exist_ok=True)
                with output.open('x',encoding='utf-8') as stream:json.dump({'kind':'failed-native-read','code':getattr(error,'code',str(error) if str(error) in ['NATIVE_PATH_INVALID','NATIVE_PATH_REDIRECTED','NEW_PRIVATE_OUTPUT_REQUIRED','REVIEWED_HELPER_CHANGED','SOURCE_FILE_KIND_UNKNOWN','FINITE_SOURCE_LIMIT'] else type(error).__name__),'formalGatePassed':False},stream)
        sys.exit(1)
