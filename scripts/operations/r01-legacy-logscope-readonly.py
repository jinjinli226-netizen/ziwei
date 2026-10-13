"""Bounded same-boot logger audit of the already enumerated original log files."""
import argparse,datetime,hashlib,importlib.util,json,pathlib,re,sys
sha=lambda data:hashlib.sha256(data).hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--helper',required=True);p.add_argument('--helper-sha256',required=True);p.add_argument('--historical-directory',required=True);p.add_argument('--projection',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('PRIVATE_NEW_OUTPUT_REQUIRED')
    directory=pathlib.Path(args.historical_directory);projection=pathlib.Path(args.projection)
    if sha(pathlib.Path(args.helper).read_bytes())!=args.helper_sha256 or sha(projection.read_bytes())!='41d82c46894238be49fac17247d66c981eb0cf1237168e7b57d955255ab8dc62':raise RuntimeError('TRUSTED_SOURCE_CHANGED')
    expected={'context-result.json':'89071077023b66a9ad7597f02e02f563da58eebd0b9c23b9ff7f3449d89a263c','result.json':'6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06','native-snapshot.json':'a8ffa54827ddc9c2cbb23464e10d09e6916eb3af0e9c8e4d087a81c7f6048c6c'}
    original={}
    for name,digest in expected.items():
        data=(directory/name).read_bytes()
        if sha(data)!=digest:raise RuntimeError('HISTORICAL_SOURCE_CHANGED')
        original[name]=json.loads(data.decode('utf-8-sig'))
    spec=importlib.util.spec_from_file_location('g',args.helper);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
    source=pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py');spec=importlib.util.spec_from_file_location('reader',source);reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    before=reader.snapshot(g);old=original['native-snapshot.json'];config=old['config'];pid=old['nativeProcess']['pid']
    g.require(pid==51880 and config['plainAppData'] is True and config['workspace']=='bigtron' and config['deviceId']==g.DEVICE and config['sha256']==before['config']['sha256'] and old['configMatchesRunningInstance'] is True and old['installedBuildMatchesRunning'] is True,'BOOT_OR_SCOPE_MISMATCH')
    target='action_8668054e-e2e9-476b-acb1-d20f561eb661';files=[];events=[];records=[];scope_errors=[]
    for reference in json.loads(projection.read_text(encoding='utf-8'))['focusedHistoricalLogFiles']:
        file=pathlib.Path(reference['path'])
        g.require(file.parent==g.USER_HOME/'logs' and file.name.startswith('daemon.log'),'LOG_SCOPE_MISMATCH')
        exact=reader.native_file(g,file);data=exact.read_bytes();rows=[];invalid=0;target_invalid=0
        for line in data.decode('utf-8-sig','strict').splitlines():
            try:value=json.loads(line)
            except Exception:
                invalid+=1;target_invalid+=int(target in line);continue
            if not isinstance(value,dict):invalid+=1;continue
            if value.get('pid')==pid:
                rows.append(value)
                if value.get('workspace') not in [None,'bigtron']:scope_errors.append({'file':str(file),'at':value.get('at'),'wrongWorkspace':True})
                if value.get('event') in ['started','stopped','exited']:events.append({key:value.get(key) for key in ['at','pid','event','code'] if key in value})
                if target in line:records.append({'file':str(file),'at':value.get('at'),'pid':pid,'event':value.get('event'),'workspace':value.get('workspace'),'actionId':value.get('actionId'),'lineSha256':sha(line.encode()),'exactAbortTimeout':value.get('error')=='The operation was aborted due to timeout'})
        if rows:
            g.require(file.name!='daemon.log' and sha(data)==reference['sha256'] and exact.read_bytes()==data,'HISTORICAL_LOG_CHANGED')
            files.append({'path':str(file),'nativeFinalPath':g.final_path(exact),'sha256':sha(data),'bytes':len(data),'samePidRecords':len(rows),'firstAt':min(row['at'] for row in rows),'lastAt':max(row['at'] for row in rows),'invalidLines':invalid,'targetInvalidLines':target_invalid})
    creation_raw=old['nativeProcess']['creationDate']
    microsoft=re.fullmatch(r'/Date\((-?\d+)(?:[+-]\d{4})?\)/',creation_raw)
    created=datetime.datetime.fromtimestamp(int(microsoft.group(1))/1000,datetime.timezone.utc) if microsoft else datetime.datetime.fromisoformat(creation_raw.replace('Z','+00:00'))
    starts=[event for event in events if event['event']=='started'];stops=[event for event in events if event['event']=='exited']
    boot=bool(len(starts)==1 and len(stops)==1 and abs((datetime.datetime.fromisoformat(starts[0]['at'].replace('Z','+00:00'))-created).total_seconds())<15 and starts[0]['at']<'2026-10-11T14:26:36.151Z'<stops[0]['at'])
    positive_started=any(record['event']=='action.started' for record in records)
    target_complete=bool(len(records)==1 and records[0]['event']=='a2a_action_failed' and records[0]['actionId']==target and records[0]['exactAbortTimeout'] and not positive_started and not scope_errors and files and all(file['invalidLines']==0 for file in files))
    after=reader.snapshot(g)
    result={'kind':'r01-original-legacy-logscope-audit','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'originalSources':expected,'originalGeneration':{'pid':pid,'createdAt':old['nativeProcess']['creationDate'],'build':old['installedBuild'],'configSha256':config['sha256']},'observedPhysicalLogRoot':str(g.USER_HOME/'logs'),'observedPhysicalRuntimeRoot':str(g.USER_HOME/'runtime'),'historicalRuntimeFinalPath':old['actionStates'][0]['finalPath'],'historicalEnvHomeCaptured':False,'retainedSameBootFiles':files,'bootEvents':events,'targetRecords':records,'sameBootWindowVerified':boot,'targetLoggerCoverageVerified':target_complete,'scopeErrors':scope_errors,'currentIdentityStable':all(before[key]==after[key] for key in ['config','installedBuild','nativeProcess']),'nativeJobOrTreeFabricated':False,'sourceWrites':0,'modelCalls':0,'phoneActions':0,'productionAcceptance':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=True,indent=2)
if __name__=='__main__':
    try:main()
    except Exception as error:
        if '--output' in sys.argv:
            output=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in output.parents and not output.exists():output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'code':getattr(error,'code',type(error).__name__),'productionAcceptance':False}),encoding='utf-8')
        sys.exit(1)
