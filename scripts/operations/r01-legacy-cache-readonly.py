"""Same-user native read of retained completed prefix; original state never written.

The existing historical native snapshot must match its independently supplied
SHA. Only the exact Win32 source file is read. Native bodies go to a private
stdin computation, never to tool output, logs or this result projection.
"""
import argparse,hashlib,importlib.util,json,pathlib,subprocess,sys,datetime
def digest(file):return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--helper',required=True);parser.add_argument('--helper-sha256',required=True);parser.add_argument('--historical-snapshot',required=True);parser.add_argument('--historical-snapshot-sha256',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('PRIVATE_NEW_OUTPUT_REQUIRED')
    if digest(args.helper)!=args.helper_sha256 or digest(args.historical_snapshot)!=args.historical_snapshot_sha256:raise RuntimeError('TRUSTED_SOURCE_CHANGED')
    spec=importlib.util.spec_from_file_location('g',args.helper);g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
    module=pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py');spec=importlib.util.spec_from_file_location('reader',module);reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
    before=reader.snapshot(g)
    old=json.loads(pathlib.Path(args.historical_snapshot).read_text(encoding='utf-8-sig'));state_anchor=old['actionStates'][0]
    current_file=g.USER_HOME/'runtime/action-state.json';exact=reader.native_file(g,current_file);current_bytes=exact.read_bytes();current=json.loads(current_bytes.decode('utf-8-sig'))
    g.require(state_anchor['path']==str(current_file) and state_anchor['finalPath']==str(exact),'OLD_CACHE_SCOPE_MISMATCH')
    g.require(old['config']['plainAppData'] is True and old['config']['workspace']==before['config']['workspace'] and old['config']['deviceId']==before['config']['deviceId'] and old['config']['apiBase']==before['config']['apiBase'],'OLD_SCOPE_IDENTITY_MISMATCH')
    cache_module=pathlib.Path(__file__).with_name('r01-legacy-assessment.mjs')
    js='import {reconstructLegacyCache,readJsonInput} from '+json.dumps(cache_module.as_uri())+'; try{process.stdout.write(JSON.stringify(reconstructLegacyCache(await readJsonInput(process.stdin))));}catch(error){process.stdout.write(JSON.stringify({code:error.code||"CACHE_AUDIT_FAILED",historicalBytesVerified:false}));process.exitCode=1;}'
    old_inspect=pathlib.Path(args.historical_snapshot).with_name('result.json')
    g.require(digest(old_inspect)=='6e5dce6563e61f71109a4b963784a3b22cc535ad6ed92c315d87df1ca1359d06','OLD_INSPECT_CHANGED')
    modified=json.loads(old_inspect.read_text(encoding='utf-8-sig'))['actionStates'][0]['modifiedUTC']
    # Historical counts recursively included nested result statuses; do not
    # invent a top-level count from them. Try only existing original-order
    # prefixes, bounded by this retained array. Accept exact historical bytes
    # and SHA simultaneously; counts/negative substring scans never suffice.
    request={'state':current,'anchor':{'sha256':state_anchor['sha256'],'bytes':state_anchor['bytes'],'modifiedAt':modified},'dedupeKeySha256':'6be18704a2c8dc626bddc16f78aec234160d9039ee64ea819639f8be5379b223','actionId':'action_8668054e-e2e9-476b-acb1-d20f561eb661','completedPrefixLengths':list(range(len(current['completed'])+1))}
    result=subprocess.run([str(g.NODE),'--input-type=module','-e',js],input=json.dumps(request,ensure_ascii=False).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30,creationflags=0x08000000)
    value=json.loads(result.stdout);after=reader.snapshot(g)
    projection={'kind':'r01-original-legacy-cache-audit','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'historicalSnapshotSha256':args.historical_snapshot_sha256,'historicalInspectSha256':digest(old_inspect),'currentStateSha256':hashlib.sha256(current_bytes).hexdigest(),'nativeStateFinalPath':g.final_path(exact),'currentStateUnchanged':exact.read_bytes()==current_bytes,'identityStable':all(before[key]==after[key] for key in ['config','installedBuild','nativeProcess']),'cacheAuditModuleSha256':digest(cache_module),'audit':value,'auditExitCode':result.returncode,'sourceStateWrites':0,'modelCalls':0,'phoneActions':0,'productionAcceptance':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(projection,stream,ensure_ascii=True,indent=2)
if __name__=='__main__':
    try:main()
    except Exception as error:
        if '--output' in sys.argv:
            output=pathlib.Path(sys.argv[sys.argv.index('--output')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in output.parents and not output.exists():
                output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps({'code':getattr(error,'code',type(error).__name__),'productionAcceptance':False}),encoding='utf-8')
        sys.exit(1)
