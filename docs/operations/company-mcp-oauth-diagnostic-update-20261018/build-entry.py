"""Local only: render pending entry or freeze five sources from a verified client manifest."""
import argparse,base64,hashlib,json,re
from pathlib import Path

HERE=Path(__file__).resolve().parent
SOURCE_BUILD='5a642107fa32d8e8f09ea139a9f964e7f50c77d9648788ae5aba6e96ac509fec'
BASE_ARCHIVE='e386b28ab38fddfa53c88091418f372a2c91ebd8c1402b19d3db22b1d60e157c'
NAMES=('owned-idle-stop.mjs','owned-idle-handle.ps1','owned-idle-stop.test.mjs','tk-self-update-owned-idle.ps1','register-company-oauth-wait-update.ps1')
sha=lambda b:hashlib.sha256(b).hexdigest()
def need(value,code):
    if not value:raise RuntimeError(code)
def render(worker,stop,handle,pins=None):
    text=(HERE/'register-company-oauth-wait-update.ps1.in').read_text()
    if pins:
        for key,value in pins.items():text=text.replace('__'+key+'__',str(value))
    embedded=[]
    for variable,data in (('Worker',worker),('Stop',stop),('Handle',handle)):
        embedded.append("$%sBytes=[Convert]::FromBase64String('%s');$%sSha='%s'"%(variable,base64.b64encode(data).decode(),variable,sha(data)))
    return text.replace('__EMBEDDED_SOURCES__','\n '.join(embedded)).encode()
def checked_pins(manifest_file):
    manifest_file=Path(manifest_file).resolve(strict=True);m=json.loads(manifest_file.read_text())
    need(re.fullmatch('[a-f0-9]{40}',m.get('candidateCommit','')) and re.fullmatch('[a-f0-9]{64}',m.get('clientBuild','')),'INVALID_TARGET')
    need(m['clientBuild']!=SOURCE_BUILD and m.get('previousClientBuild')==SOURCE_BUILD and m.get('baseOfficialArchiveSha256')==BASE_ARCHIVE,'SOURCE_BUILD_OR_PACKAGE_MISMATCH')
    need(m.get('offlineRuntimeClosure',{}).get('verified') is True,'COLD_PACKAGE_PROOF_REQUIRED')
    artifacts={}
    for name in ('windows-client.tgz','update-windows.ps1'):
        rows=[r for r in m.get('artifacts',[]) if r.get('name')==name];need(len(rows)==1,'ARTIFACT_REQUIRED')
        file=manifest_file.parent/name;need(file.is_file() and not file.is_symlink(),'ARTIFACT_NOT_PLAIN');body=file.read_bytes()
        need(sha(body)==rows[0].get('sha256') and len(body)==rows[0].get('bytes'),'ARTIFACT_CHANGED')
        artifacts[name]=rows[0]
    need(m['offlineRuntimeClosure'].get('clientArchiveSha256')==artifacts['windows-client.tgz']['sha256'],'ARCHIVE_PROOF_MISMATCH')
    return {'TARGET_COMMIT':m['candidateCommit'],'TARGET_BUILD':m['clientBuild'],'TARGET_ARCHIVE_SHA':artifacts['windows-client.tgz']['sha256'],'TARGET_BOOTSTRAP_SHA':artifacts['update-windows.ps1']['sha256'],'TARGET_BOOTSTRAP_BYTES':artifacts['update-windows.ps1']['bytes']}
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--manifest');parser.add_argument('--output');args=parser.parse_args()
    pins=checked_pins(args.manifest) if args.manifest else None
    stop=(HERE/NAMES[0]).read_bytes();handle=(HERE/NAMES[1]).read_bytes();tests=(HERE/NAMES[2]).read_bytes()
    worker_template=HERE/(NAMES[3]+'.in')
    worker=(worker_template if worker_template.is_file() else HERE/NAMES[3]).read_bytes()
    need(SOURCE_BUILD.encode() in stop and SOURCE_BUILD.encode() in handle,'SOURCE_SCOPE_CHANGED')
    need(sha(handle).encode() in stop and sha(stop).encode() in worker and sha(handle).encode() in worker,'HELPER_CLOSURE_CHANGED')
    if pins:
        text=worker.decode()
        for key,value in pins.items():text=text.replace('__'+key+'__',str(value))
        worker=text.encode()
    entry=render(worker,stop,handle,pins)
    files=dict(zip(NAMES,(stop,handle,tests,worker,entry)))
    if pins:
        output=Path(args.output or HERE/('frozen-'+pins['TARGET_COMMIT'][:12])).resolve()
        need(output.parent==HERE and not output.exists(),'OUTPUT_MUST_BE_NEW_DIRECT_CHILD');output.mkdir()
        for name,data in files.items():need(b'__TARGET_' not in data,'TARGET_NOT_FROZEN');(output/name).write_bytes(data)
    else:
        need(not args.output,'OUTPUT_REQUIRES_FROZEN_TARGET');output=HERE
        destination=HERE/NAMES[-1];need(not destination.exists(),'PENDING_ENTRY_ALREADY_EXISTS');destination.write_bytes(entry)
    report={'schemaVersion':1,'preparationOnly':True,'task':'Ziwei.TK.OAuthWait.Update.20261018','sourceBuild':SOURCE_BUILD,'targetFrozen':bool(pins),'target':pins,'sourceFiles':{name:{'sha256':sha(data),'bytes':len(data)} for name,data in files.items()},'priorWorkerSha256':'7fd4dc4ed078c92909215022b262899604f5f751c94be3eb192173e37f3c8e0f','historyDeleted':False,'windowsExecuted':False,'taskRegistered':False,'productionModified':False}
    report_file=output/('artifacts.json' if pins else 'pending-artifacts.json');need(not report_file.exists(),'MANIFEST_ALREADY_EXISTS');report_file.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'output':str(output),'targetFrozen':bool(pins),'entrySha256':sha(entry),'preparationOnly':True,'windowsExecuted':False}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'ok':False,'code':str(error) if isinstance(error,RuntimeError) else type(error).__name__}));raise SystemExit(1)
