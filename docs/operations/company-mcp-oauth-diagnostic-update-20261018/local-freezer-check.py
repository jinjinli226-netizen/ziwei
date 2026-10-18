"""Pure local target and artifact boundary regression. Never execute generated PowerShell."""
import hashlib,json,runpy,tempfile
from pathlib import Path
HERE=Path(__file__).resolve().parent
m=runpy.run_path(str(HERE/'build-entry.py'),run_name='local_fixture')
with tempfile.TemporaryDirectory(prefix='scope-entry-local-') as directory:
 p=Path(directory);archive=b'isolated fixture archive';bootstrap=b'isolated fixture bootstrap'
 (p/'windows-client.tgz').write_bytes(archive);(p/'update-windows.ps1').write_bytes(bootstrap)
 manifest={'candidateCommit':'a'*40,'clientBuild':'b'*64,'previousClientBuild':m['SOURCE_BUILD'],'baseOfficialArchiveSha256':m['BASE_ARCHIVE'],'offlineRuntimeClosure':{'verified':True,'clientArchiveSha256':hashlib.sha256(archive).hexdigest()},'artifacts':[{'name':name,'sha256':hashlib.sha256(body).hexdigest(),'bytes':len(body)}for name,body in [('windows-client.tgz',archive),('update-windows.ps1',bootstrap)]]}
 def check(value):
  (p/'manifest.json').write_text(json.dumps(value));return m['checked_pins'](p/'manifest.json')
 assert check(manifest)['TARGET_BUILD']=='b'*64
 for mutate in [lambda x:x.update(previousClientBuild='0'*64),lambda x:x.update(clientBuild=m['SOURCE_BUILD']),lambda x:x['offlineRuntimeClosure'].update(verified=False),lambda x:x['artifacts'][0].update(sha256='0'*64)]:
  value=json.loads(json.dumps(manifest));mutate(value)
  try:check(value)
  except RuntimeError:pass
  else:raise AssertionError('Missing target rejection')
 rendered=m['render'](b'worker fixture',b'stop fixture',b'handle fixture',check(manifest))
 assert b'__TARGET_'not in rendered and b'__EMBEDDED_SOURCES__'not in rendered
print(json.dumps({'ok':True,'sourceMismatchRejected':True,'sameBuildRejected':True,'unverifiedClosureRejected':True,'changedArtifactRejected':True,'windowsExecuted':False}))
