"""R01 native snapshot using an explicitly hashed, pre-existing V1 reader.

No maintenance command, model call, phone action or credential change. All
config/HOME/auth contents are retained privately by reference and hashes only.
"""
import argparse,datetime,hashlib,importlib.util,json,pathlib,sys

def sha(file):return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def native_file(reader,file):
    # MSIX may redirect a conventional per-file AppData read even though its
    # parent resolves normally. Use the explicit Win32 namespace and prove the
    # returned handle's final path is exactly the requested native path.
    file=pathlib.Path(file)
    if not file.is_absolute() or str(file).startswith('\\\\'):raise RuntimeError('NATIVE_PATH_INVALID')
    exact=pathlib.Path('\\\\?\\'+str(file))
    if reader.final_path(exact).casefold()!=str(exact).casefold():raise RuntimeError('NATIVE_PATH_REDIRECTED')
    return exact

def snapshot(reader):
    for file in [reader.USER_HOME,reader.PACKAGE_ROOT,reader.GLOBAL_ENTRY,reader.NODE,reader.NPM_CLI,reader.CODEX_HOME]:reader.assert_plain(file)
    config_file=native_file(reader,reader.CONFIG_FILE)
    content=config_file.read_bytes();config=json.loads(content.decode('utf-8-sig'))
    health=json.loads(reader.get_bytes('http://127.0.0.1:20242/readyz',2*1024*1024,12))
    life=health.get('lifecycle') or {};process=reader.native_process(health.get('pid'))
    command=(process or {}).get('CommandLine') or ''
    expected=str(reader.PACKAGE_ROOT/'daemon/ziwei_user.mjs').casefold()
    build=reader.build_identity(reader.PACKAGE_ROOT)
    require=reader.require
    require(process is not None and process['ProcessId']==health.get('pid'),'NATIVE_PROCESS_MISMATCH')
    require((expected in command.casefold() or expected.replace('\\','/') in command.casefold()) and str(process.get('ExecutablePath')).casefold()==str(reader.NODE).casefold(),'NATIVE_ENTRY_MISMATCH')
    require(health.get('service')=='ziwei_user' and health.get('ready') is True and health.get('connectionState')=='connected','NATIVE_CLIENT_NOT_READY')
    require(str(life.get('root','')).casefold()==str(reader.PACKAGE_ROOT).casefold() and str(life.get('configPath','')).casefold()==str(reader.CONFIG_FILE).casefold(),'NATIVE_LIFECYCLE_PATH_MISMATCH')
    config_sha=hashlib.sha256(content).hexdigest()
    require(config_sha==life.get('configSha256') and life.get('nonce'),'NATIVE_CONFIG_RUNNING_MISMATCH')
    require(config.get('workspace')==health.get('workspace')==reader.WORKSPACE and config.get('deviceId')==health.get('deviceId')==reader.DEVICE and config.get('apiBase')=='https://qzelynth.top' and config.get('healthPort')==20242,'NATIVE_BINDING_MISMATCH')
    require(build==health.get('clientBuild'),'NATIVE_INSTALLED_RUNNING_BUILD_MISMATCH')
    age=health.get('lastHeartbeatAgeMs');require(isinstance(age,(int,float)) and 0<=age<=45000,'NATIVE_HEARTBEAT_STALE')
    jobs=[];states=[];credentials=[]
    for file in sorted((reader.USER_HOME/'maintenance').glob('*/result.json')):
        result=reader.load_json(native_file(reader,file));jobs.append({'directory':file.parent.name,**reader.selected(result,['state','operation'])})
    for file in sorted((reader.USER_HOME/'runtime').rglob('action-*.json')):
        exact=native_file(reader,file);states.append({'path':str(file),'sha256':sha(exact),'bytes':exact.stat().st_size})
    for connection in [config]+config.get('sharedWorkspaces',[]):
        if connection.get('deviceTokenFile'):
            file=pathlib.Path(connection['deviceTokenFile']);credentials.append({'path':str(file),'sha256':sha(native_file(reader,file))})
    return {'config':{'path':str(reader.CONFIG_FILE),'nativeFinalPath':reader.final_path(config_file),'sha256':config_sha,
                      **reader.selected(config,['workspace','deviceId','connectionState','apiBase','healthPort','workdir']),
                      'sharedBindings':[reader.selected(c,['workspace','deviceId','enabled','apiBase','workdir']) for c in config.get('sharedWorkspaces',[])]},
            'installedBuild':build,'globalEntry':{'path':str(reader.GLOBAL_ENTRY),'sha256':sha(reader.GLOBAL_ENTRY)},
            'credentialFiles':credentials,'codex':reader.codex_summary(),
            'nativeProcess':{'pid':process['ProcessId'],'executable':process['ExecutablePath'],'creationDate':process.get('CreationDate'),'commandSha256':hashlib.sha256(command.encode()).hexdigest()},
            'health':{**reader.selected(health,['service','ready','pid','workspace','deviceId','clientBuild','connectionState','activeActionCount','pollingCount','lastHeartbeatAgeMs']),
                      'lifecycle':reader.selected(life,['root','configPath','configSha256','startedAt','managedAuxiliaryCount'])},
            'maintenanceJobs':jobs,'actionStateFiles':states}
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--helper',required=True);parser.add_argument('--helper-sha256',required=True)
    parser.add_argument('--output',required=True);args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('NEW_PRIVATE_OUTPUT_REQUIRED')
    helper=pathlib.Path(args.helper).resolve()
    if sha(helper)!=args.helper_sha256:raise RuntimeError('REVIEWED_HELPER_CHANGED')
    spec=importlib.util.spec_from_file_location('native_reader',helper)
    reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    before=snapshot(reader)
    life=json.loads(reader.get_bytes('http://127.0.0.1:20242/readyz',2*1024*1024,12))['lifecycle']
    before['nonceSha256']=hashlib.sha256(life['nonce'].encode()).hexdigest()
    diagnostics=reader.USER_HOME/'diagnostics'
    logs=reader.USER_HOME/'logs'
    logfiles=[{'path':str(file),'bytes':file.stat().st_size,'modifiedUTC':datetime.datetime.fromtimestamp(file.stat().st_mtime,datetime.timezone.utc).isoformat()}
              for file in sorted(logs.glob('*')) if file.is_file()]
    state=reader.load_json(native_file(reader,diagnostics/'client-exit-watch.state.json'))
    observer=reader.native_process(state.get('watcherPid'))
    safe_observer={key:state.get(key) for key in ['watcherPid','watchedPid','lastHeartbeatAt','lastHeartbeatAtMs','cleanExit','lastEvent','intervalMs']}
    safe_observer['running']=observer is not None
    safe_observer['commandSha256']=hashlib.sha256((observer.get('CommandLine') or '').encode()).hexdigest() if observer else None
    homes=[]
    # Default Windows source plus Creator/owned markers. Configured/PEB source
    # roots still require the final formal collector; this inventory is partial.
    for folder in [reader.USER_HOME/'runtime',reader.USER_PROFILE/'AppData/Local/hermes']:
        if not folder.is_dir():continue
        for marker in sorted(folder.rglob('ziwei-instance.json')):
            homes.append({'path':str(marker.parent),'markerSha256':sha(native_file(reader,marker)),
                          'files':[{'relativePathSha256':hashlib.sha256(str(file.relative_to(marker.parent)).encode()).hexdigest(),
                                    'bytes':file.stat().st_size,'sha256':sha(native_file(reader,file))}
                                   for file in sorted(marker.parent.rglob('*')) if file.is_file()]})
    after=snapshot(reader)
    stable=all(before[key]==after[key] for key in ['config','installedBuild','globalEntry','credentialFiles','codex','nativeProcess'])
    ready=json.loads(reader.get_bytes('http://127.0.0.1:20242/readyz',2*1024*1024,12))
    stable=stable and hashlib.sha256(ready['lifecycle']['nonce'].encode()).hexdigest()==before['nonceSha256']
    report={'kind':'r01-windows-readonly-preflight','snapshot':before,'after':after,'originalIdentityStable':stable,
            'observer':safe_observer,'logs':logfiles,'homes':homes,'capturedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'helperSha256':args.helper_sha256,'readerSourceSha256':sha(__file__),'maintenanceCommands':0,
            'modelCalls':0,'phoneActions':0,'formalGatePassed':False,'nativeClaimDrainProven':False,
            'homeInventoryComplete':False,'configuredAndPebSourceHomeChecked':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=True,indent=2);stream.write('\n')
    print(json.dumps({'evidence':str(output),'sha256':sha(output),'originalIdentityStable':stable,
                      'installedBuild':before['installedBuild'],'health':before['health'],'nativeProcess':before['nativeProcess'],
                      'config':before['config'],'nonceSha256':before['nonceSha256'],'observer':safe_observer,
                      'homeCount':len(homes),'actionStateFiles':len(before['actionStateFiles']),
                      'logs':logfiles,'formalGatePassed':False},ensure_ascii=True,indent=2))
    if not stable:sys.exit(1)

if __name__=='__main__':
    try:main()
    except Exception as error:
        code=getattr(error,'code',type(error).__name__)
        if str(error) in ['NATIVE_PATH_INVALID','NATIVE_PATH_REDIRECTED','NEW_PRIVATE_OUTPUT_REQUIRED','REVIEWED_HELPER_CHANGED']:code=str(error)
        failure={'errorCode':code,'formalGatePassed':False}
        # Retain failure projection too; never replace a previous successful or
        # failed attempt. No exception text, paths from exceptions or secrets.
        if '--output' in sys.argv:
            candidate=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve()
            root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in candidate.parents and not candidate.exists():
                candidate.parent.mkdir(parents=True,exist_ok=True)
                with candidate.open('x',encoding='utf-8') as stream:json.dump(failure,stream)
        print(json.dumps(failure));sys.exit(1)
