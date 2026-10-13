"""One bounded existing public archive audit, in memory; no unpack/run/install."""
import argparse,hashlib,json,pathlib,tarfile
SHA='e2a446c65def0f09cfb23d51142c2ca9666dc0d32c91d62d4a25bc71a9af377a'
SOURCE='86228203ecf5aeb33fbc4422b4c4268f321c113862e0443933897a277fcd614a'
WINDOWS='7c2d47abb3982eb31fbdd2245fe0550235efed9ec418848de901dfead8bdaf64'
GIT={
 'src/management-bootstrap.mjs':'bddce314efe7bc836d6b67f19d64aa98b8801527f2a64a173eac9982e086fb74',
 'daemon/ziwei_user.mjs':'7225a515885af09317d2f23976bb74f562ac3d6579eec1bd88ae0855cce35a2f',
 'src/daemon.mjs':'1e5ab24e166466e5036d74b4a46b44485f61e9c8fcecc6ce69f125f8a6a3ff41',
 'src/daemon-action-scheduler.mjs':'a2e2181e029d7e09b1b4ed82b26115013c792aaa1dfc1f19610e135e24c70a6e',
 'src/local-action.mjs':'88cf1bd4b32411c47eb6e277209ff453f858948ae24fc75611db2c599104fa3c',
 'src/runtime-adapters.mjs':'3295b1eabf47c58d47e7e3d80148909f1bf854d1f7043d68b0b4866b43c14b39'}
sha=lambda data:hashlib.sha256(data).hexdigest()
def main():
    p=argparse.ArgumentParser();p.add_argument('--archive',required=True);p.add_argument('--output',required=True);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve();archive=pathlib.Path(args.archive)
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('New private output required')
    if sha(archive.read_bytes())!=SHA or archive.stat().st_size!=95626:raise RuntimeError('Exact historical archive required')
    files={}
    with tarfile.open(archive,'r:gz') as tar:
        for member in tar.getmembers():
            if not member.isfile():raise RuntimeError('Nonregular member refused')
            name=member.name
            if not name.startswith('package/') or '\\' in name or '..' in name.split('/') or name in files or member.size>4*1024*1024:raise RuntimeError('Archive member scope invalid')
            files[name[len('package/'):]]=tar.extractfile(member).read()
    if len(files)!=30 or sum(map(len,files.values()))>16*1024*1024:raise RuntimeError('Historical manifest bounds differ')
    fixed=['package.json','backend/a2a-auth.mjs','scripts/ziwei-user.mjs','scripts/ziwei-cli.mjs','scripts/start-ziwei-user.mjs','scripts/ziwei-mcp.mjs','scripts/ziwei-terminal-mcp.mjs','scripts/client-lifecycle.mjs','scripts/client-maintenance-helper.mjs','scripts/client-update.mjs','scripts/client-update-worker.mjs']
    names=sorted(set(fixed+[name for name in files if name.startswith(('daemon/','src/')) and name.endswith(('.mjs','.py'))]))
    def identity(installed):
        h=hashlib.sha256()
        for name in names:
            if name not in files:continue
            value=files[name]
            if installed and name=='scripts/ziwei-user.mjs' and value.startswith(b'#!'):
                end=value.find(b'\n');value=value[:end+1].replace(b'\r\n',b'\n')+value[end+1:]
            h.update(name.encode());h.update(b'\0');h.update(value);h.update(b'\0')
        return h.hexdigest()
    source=identity(False);windows=identity(True)
    critical={name:{'archiveSha256':sha(files[name]),'bytes':len(files[name]),'crlfPairs':files[name].count(b'\r\n'),'normalizedGitSha256':sha(files[name].replace(b'\r\n',b'\n')),'normalizedMatchesExactGit':sha(files[name].replace(b'\r\n',b'\n'))==expected} for name,expected in GIT.items()}
    result={'kind':'r01-existing-0349-archive-byte-audit','archiveReference':str(archive),'archiveSha256':SHA,'archiveBytes':95626,'regularFiles':30,'sourceBuild':source,'windowsShebangNormalizedBuild':windows,'sourceBuildMatchesPublication':source==SOURCE,'windowsBuildMatchesOriginalNativeSnapshot':windows==WINDOWS,'criticalSource':critical,'fullFileManifest':[{'path':name,'bytes':len(value),'sha256':sha(value)} for name,value in sorted(files.items())],'archiveWrites':0,'unpackCalls':0,'oldModuleExecutions':0,'installCalls':0,'productionAcceptance':False}
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as f:json.dump(result,f,ensure_ascii=True,indent=2)
    print(json.dumps({key:result[key] for key in ['archiveSha256','regularFiles','sourceBuild','windowsShebangNormalizedBuild','sourceBuildMatchesPublication','windowsBuildMatchesOriginalNativeSnapshot','criticalSource','productionAcceptance']},indent=2))
if __name__=='__main__':main()
