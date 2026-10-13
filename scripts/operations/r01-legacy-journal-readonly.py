"""Native local legacy journal projection; invoked as same-user read-only worker."""
import argparse,hashlib,importlib.util,json,pathlib,sys,datetime
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--helper',required=True);parser.add_argument('--helper-sha256',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('PRIVATE_OUTPUT_REQUIRED')
    helper=pathlib.Path(args.helper)
    if hashlib.sha256(helper.read_bytes()).hexdigest()!=args.helper_sha256:raise RuntimeError('HELPER_CHANGED')
    spec=importlib.util.spec_from_file_location('g',helper);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
    source=pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py');spec=importlib.util.spec_from_file_location('ops_reader',source);reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    before=reader.snapshot(g);runtime=g.USER_HOME/'runtime';files=[]
    for file in sorted(runtime.rglob('*')):
        if not file.is_file() or not any(part in str(file.relative_to(runtime)).lower() for part in ['action','delivery','journal','gateway','state']):continue
        exact=reader.native_file(g,file);data=exact.read_bytes();item={'path':str(file),'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data)}
        if file.suffix=='.json':
            try:value=json.loads(data.decode('utf-8-sig'))
            except Exception:item['jsonReadable']=False;files.append(item);continue
            item['jsonReadable']=True
            if isinstance(value,dict):
                item['keys']=sorted(value.keys())
                item['meta']={key:value.get(key) for key in ['version','state','status','retainEvidence','serverStatus','confirmedAt','resultDigest','actionDigest','dispatcherStatus'] if key in value}
                action=value.get('action');item['actionId']=action.get('id') if isinstance(action,dict) else None
                records=value.get('records') or value.get('actions')
                if isinstance(records,dict):
                    item['records']=[{'keySha256':hashlib.sha256(str(key).encode()).hexdigest(),**{field:record.get(field) for field in ['id','status','startedAt','finishedAt','code','executionState'] if field in record}} for key,record in records.items() if isinstance(record,dict)]
                elif isinstance(records,list):item['recordCount']=len(records)
                for name in ['completed','started']:
                    if not isinstance(value.get(name),list):continue
                    item[name+'Count']=len(value[name]);projections=[]
                    for record in value[name]:
                        if not isinstance(record,dict):continue
                        identity=record.get('identity') or {};result=record.get('result') or {};key=str(record.get('key') or '')
                        projections.append({'keySha256':hashlib.sha256(key.encode()).hexdigest(),'knownExpiredAction':('action_8668054e-e2e9-476b-acb1-d20f561eb661' in key or record.get('actionId')=='action_8668054e-e2e9-476b-acb1-d20f561eb661' or result.get('actionId')=='action_8668054e-e2e9-476b-acb1-d20f561eb661'),
                            'actionId':record.get('actionId') or result.get('actionId'),'nativeRuntime':record.get('nativeRuntime'),'legacy':record.get('legacy'),
                            'identity':{field:identity.get(field) for field in ['actionId','workspace','deviceId'] if field in identity},
                            'quarantine':{field:(record.get('quarantine') or {}).get(field) for field in ['stopConfirmed','code'] if field in (record.get('quarantine') or {})},
                            'result':{field:result.get(field) for field in ['status','code','executionState'] if field in result},
                            'resultSha256':hashlib.sha256(json.dumps(result,sort_keys=True,separators=(',',':')).encode()).hexdigest()})
                    item[name]=projections
        files.append(item)
    # Scope-limited historical observation: existing daemon rotations only;
    # messages/prompt/headers/auth are never emitted. No disk-wide search.
    target='action_8668054e-e2e9-476b-acb1-d20f561eb661';logfiles=[];matches=[];lifecycle=[];pids=set()
    for file in sorted((g.USER_HOME/'logs').glob('daemon.log*')):
        if not file.is_file():continue
        exact=reader.native_file(g,file);data=exact.read_bytes()
        logfiles.append({'path':str(file),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
        for line in data.decode('utf-8','replace').splitlines():
            try:value=json.loads(line)
            except Exception:continue
            if not isinstance(value,dict):continue
            meta={field:value.get(field) for field in ['at','event','pid','actionId','workspace','deviceId','state','status','type','exitCode','code','signal'] if field in value and (value[field] is None or isinstance(value[field],(bool,int,float)) or field not in ['code','signal'] and isinstance(value[field],str))}
            if value.get('event') in ['started','stopped','exited','connection_drain_requested','connection_drain_cancelled']:lifecycle.append(meta)
            if target in line:
                matches.append({'file':str(file),'lineSha256':hashlib.sha256(line.encode()).hexdigest(),'meta':meta})
                if isinstance(value.get('pid'),int):pids.add(value['pid'])
    after=reader.snapshot(g)
    report={'kind':'r01-native-legacy-journal-projection','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'identityStable':all(before[key]==after[key] for key in ['config','installedBuild','nativeProcess','credentialFiles']),'runtime':str(runtime),'files':files,'focusedHistoricalLogFiles':logfiles,'focusedLegacyMatches':matches,'matchedPidLifecycle':[item for item in lifecycle if item.get('pid') in pids],'matchedPids':sorted(pids),'matchedPidCurrentProcesses':[{'pid':pid,'currentlyExists':g.native_process(pid) is not None} for pid in sorted(pids)],'formalDrainProven':False,'startStopUpdateCalls':0,'databaseWrites':0,'modelCalls':0,'phoneActions':0}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=True,indent=2)
if __name__=='__main__':
    try:main()
    except Exception as error:
        # No raw exception/secret disclosure. Output failure still remains new.
        if '--output' in sys.argv:
            output=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in output.parents and not output.exists():
                output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'errorCode':getattr(error,'code',type(error).__name__),'formalDrainProven':False}),encoding='utf-8')
        sys.exit(1)
