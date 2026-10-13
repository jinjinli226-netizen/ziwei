"""Bounded current original boot log/cache/delivery coverage, no source writes.

Only the previously enumerated native userHome roots are read. Complete file
enumeration in that directory is not proof that original PEB/HOME overrides or
Job/detached workers are covered. No arbitrary environment/auth output.
"""
import argparse, collections, datetime, hashlib, importlib.util, json, pathlib, re, sys
sha=lambda data:hashlib.sha256(data).hexdigest()
now=lambda:datetime.datetime.now(datetime.timezone.utc).isoformat()
def native_datetime(value):
    microsoft=re.fullmatch(r'/Date\((-?\d+)(?:[+-]\d{4})?\)/',value)
    return datetime.datetime.fromtimestamp(int(microsoft.group(1))/1000,datetime.timezone.utc) if microsoft else datetime.datetime.fromisoformat(value.replace('Z','+00:00'))
def load_module(name,file):
    spec=importlib.util.spec_from_file_location(name,file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
def logger_projection(data,pid,workspace):
    records=[];invalid=0;wrong=0
    for line in data.decode('utf-8-sig','strict').splitlines():
        try:row=json.loads(line)
        except ValueError:invalid+=1;continue
        if not isinstance(row,dict):invalid+=1;continue
        if row.get('pid')!=pid:continue
        wrong+=int(row.get('workspace') not in [None,workspace])
        records.append({key:row[key] for key in ['at','pid','event','workspace','actionId','type','runtime','code','exitCode'] if key in row and isinstance(row[key],(str,int,float,bool))})
    return {'samePidRecords':len(records),'firstAt':min((row.get('at','') for row in records),default=None),
            'lastAt':max((row.get('at','') for row in records),default=None),'invalidLines':invalid,'wrongWorkspaceRecords':wrong,
            'eventCounts':dict(collections.Counter(row.get('event') for row in records)),
            'actionRecords':[row for row in records if row.get('actionId')],
            'bootEvents':[row for row in records if row.get('event') in ['started','exited','stopped']]}
def main():
    p=argparse.ArgumentParser();p.add_argument('--helper',required=True);p.add_argument('--helper-sha256',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('NEW_PRIVATE_OUTPUT_REQUIRED')
    if sha(pathlib.Path(args.helper).read_bytes())!=args.helper_sha256:raise RuntimeError('REVIEWED_HELPER_CHANGED')
    g=load_module('g',args.helper);source=load_module('s',pathlib.Path(__file__).with_name('r01-windows-source-readonly.py'))
    native=load_module('n',pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py')).native_file
    started=now();before,processes=source.identity(g,native);pid=before['process']['pid'];g.require(pid==12132,'ORIGINAL_BOOT_CHANGED')
    logs=g.USER_HOME/'logs';names=sorted(file.name for file in native(g,logs).iterdir());files=[];rows=[]
    for name in names:
        file=logs/name;exact=native(g,file)
        if not exact.is_file():continue
        data=exact.read_bytes();record={'path':str(file),'nativeFinalPath':g.final_path(exact),'sha256':sha(data),'bytes':len(data),'sameReadStable':exact.read_bytes()==data}
        if name.startswith('daemon.log'):
            record['logger']=logger_projection(data,pid,g.WORKSPACE);rows.append(record['logger'])
        files.append(record)
    cache=g.USER_HOME/'runtime/action-state.json';exact=native(g,cache);data=exact.read_bytes();state=json.loads(data.decode('utf-8-sig'))
    cache_ref={'path':str(cache),'nativeFinalPath':g.final_path(exact),'sha256':sha(data),'bytes':len(data),'sameReadStable':exact.read_bytes()==data,
               'completedCount':len(state.get('completed',[])),'startedCount':len(state.get('started',[])) if isinstance(state.get('started'),list) else None,
               'topLevelKeys':sorted(state),'bootAssignmentOfHistoricalCacheEntries':'not-proven'}
    deliveries=[];delivery=g.USER_HOME/'runtime/action-delivery'
    if delivery.exists():
        for file in sorted(native(g,delivery).rglob('*')):
            logical=pathlib.Path(str(file).removeprefix('\\\\?\\'));exact=native(g,logical)
            if exact.is_file():
                value=exact.read_bytes();deliveries.append({'path':str(logical),'nativeFinalPath':g.final_path(exact),'sha256':sha(value),'bytes':len(value)})
    after,_=source.identity(g,native);keys=['process','installedBuild','config','nonceDigest','startedAt','connections','listeners']
    boots=[event for row in rows for event in row['bootEvents']];starts=[event for event in boots if event.get('event')=='started']
    counts=collections.Counter()
    for row in rows:counts.update(row['eventCounts'])
    births=before['process']['nativeBirth']['createdAt'];birth=native_datetime(births)
    start_matches=bool(len(starts)==1 and abs((datetime.datetime.fromisoformat(starts[0]['at'].replace('Z','+00:00'))-birth).total_seconds())<15)
    maintenance=[];maintenance_root=g.USER_HOME/'maintenance'
    for folder in sorted(native(g,maintenance_root).iterdir()):
        logical=pathlib.Path(str(folder).removeprefix('\\\\?\\'));log=logical/'maintenance.jsonl'
        if not log.exists():continue
        exact=native(g,log);body=exact.read_bytes();events=[json.loads(line) for line in body.decode('utf-8-sig').splitlines() if line]
        worker_pids=sorted(set(row['pid'] for row in events if isinstance(row.get('pid'),int)))
        maintenance.append({'directory':str(logical),'logPath':str(log),'logSha256':sha(body),'workerPids':worker_pids,
            'currentPidMatches':[source.process_projection(value) for value in processes if value['ProcessId'] in worker_pids],
            'historicalWorkerBirthCaptured':False,'sameGenerationCurrentMatchesProven':False,
            'heartbeatCount':sum(row.get('event')=='maintenance_heartbeat' for row in events),
            'exitEvents':[g.selected(row,['at','pid','event','exitCode']) for row in events if row.get('event')=='maintenance_exit']})
    report={'kind':'r01-windows-original-boot-coverage','captureStartedAt':started,'captureCompletedAt':now(),'originalIdentity':{key:before[key] for key in keys},
        'identityStable':all(before[key]==after[key] for key in keys),'loggerFiles':files,'loggerDirectoryEntries':names,
        'loggerDirectoryEnumerationStable':names==sorted(file.name for file in native(g,logs).iterdir()),'loggerBootStartMatchesNativeBirth':start_matches,
        'sameBootEventCounts':dict(counts),'sameBootActionRecords':[event for row in rows for event in row['actionRecords']],
        'cache':cache_ref,'deliveryFiles':deliveries,'maintenanceWorkers':maintenance,
        'declaredUserHomeLoggerFilesEnumerated':True,'allPossibleLoggerRootsComplete':None,'sourceSpawnCategoriesCompletelyProven':False,
        'originalJobMembershipComplete':False,'originalProcessEnvironmentAndOverrides':'unknown','history8668BootPid':51880,
        'history51CacheEntriesAssignedToCurrentBoot':False,'serviceActions':0,'modelCalls':0,'phoneActions':0,'formalGatePassed':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=True,indent=2);stream.write('\n')
if __name__=='__main__':
    try:main()
    except Exception as error:
        if '--output' in sys.argv:
            file=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in file.parents and not file.exists():
                file.parent.mkdir(parents=True,exist_ok=True)
                with file.open('x',encoding='utf-8') as stream:json.dump({'kind':'failed-native-read','code':getattr(error,'code',type(error).__name__),'formalGatePassed':False},stream)
        sys.exit(1)
