"""R01 server projection: stdin execution; no server files written or services controlled.

This is an observation, never a drain/seal authorization. Full DB row values,
environment contents, Nginx credentials and journal messages are not emitted.
"""
import collections, datetime, hashlib, json, pathlib, re, sqlite3, subprocess, tarfile, time, urllib.request

sha = lambda b: hashlib.sha256(b).hexdigest()
quote = lambda s: '"'+s.replace('"','""')+'"'
canon = lambda value: json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),default=lambda b:{'blobSha256':sha(b)})
out = {'captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mutations':0,'serviceActions':0,'configurationWrites':0,'phoneActions':0,'modelCalls':0}
current = pathlib.Path('/opt/ziwei/current').resolve()
control = pathlib.Path('/opt/ziwei-control/current').resolve()
downloads = pathlib.Path('/opt/ziwei-control/shared/downloads/cli')
def selected(value,fields):
    return {f:value.get(f) for f in fields if f in value}
out['mainRelease'] = str(current)
out['controlRelease'] = str(control)
out['mainMarker'] = selected(json.loads((current/'RELEASE.json').read_text()),['commit','release','previous','control','deployedAt','publicationScope','frontendCommit','frontendSourceRelease','frontendAssetsUnchanged','nginxSha256','nginxReloads','servicesRestarted','officialClientCommit','officialClientPublished','sourceSha256'])
if (control/'RELEASE.json').exists():
    out['controlMarker'] = selected(json.loads((control/'RELEASE.json').read_text()),['commit','release','deployedAt'])
out['persistentLinks'] = {key:str((current/key).resolve()) for key in ['data','.local']}
out['protectedFileHashes'] = {}
for p in [current/'RELEASE.json',current/'frontend/dist/index.html',pathlib.Path('/etc/nginx/sites-available/ziwei'),pathlib.Path('/opt/ziwei/data/management-mcp-signing.key'),downloads/'ziwei-latest.tgz',downloads/'release.json',downloads/'update-windows.ps1']:
    out['protectedFileHashes'][str(p)] = {'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
out['officialMetadata'] = selected(json.loads((downloads/'release.json').read_text()),['version','commit','sourceBuild','clientBuild','clientBuildPlatform','sha256','bytes','publishedAt','mainSiteCommit','publicationScope','clientOnlyPublication','mainSiteCommitUnchanged','conversationImages','windowsWorkdir'])
with tarfile.open(downloads/'ziwei-latest.tgz','r:gz') as archive:
    out['officialArchiveRegularFiles'] = len([member for member in archive.getmembers() if member.isfile()])
out['frontendFiles'] = {str(p.relative_to(current/'frontend/dist')):{'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size} for p in sorted((current/'frontend/dist').rglob('*')) if p.is_file()}
out['frontendIndexAssetReferences'] = re.findall(r'(?:src|href)="([^\"]+\.(?:js|css))"',(current/'frontend/dist/index.html').read_text())
out['backendFiles'] = {}
for relative in ['backend/app.mjs','backend/repository.mjs','backend/a2a-auth.mjs','daemon/ziwei_user.mjs','src/action-scheduler.mjs','src/action-dispatcher.mjs','src/local-action.mjs']:
    p = current/relative
    if p.is_file():
        out['backendFiles'][relative] = {'sha256':sha(p.read_bytes()),'bytes':p.stat().st_size}
out['services'] = {}
for name in ['ziwei-api.service','ziwei-control-api.service','nginx.service']:
    lines = subprocess.check_output(['systemctl','show',name,'-p','MainPID','-p','NRestarts','-p','ActiveState','-p','ExecMainStartTimestamp','-p','FragmentPath','-p','StandardOutput','-p','StandardError'],text=True,timeout=10).splitlines()
    out['services'][name] = dict(line.split('=',1) for line in lines if '=' in line)
    item = out['services'][name]
    unit = pathlib.Path(item['FragmentPath'])
    item['unitSha256'] = sha(unit.read_bytes()) if unit.is_file() else None
    pid = int(item.get('MainPID') or 0)
    cmdline = pathlib.Path('/proc')/str(pid)/'cmdline'
    if cmdline.is_file():
        command = cmdline.read_bytes()
        item['commandSha256'] = sha(command)
        item['entryPaths'] = [part.decode() for part in command.split(b'\x00')
                              if part.endswith(b'.mjs') and part.startswith(b'/opt/ziwei')]
        item['processExecutable'] = str((pathlib.Path('/proc')/str(pid)/'exe').resolve())
    journal = subprocess.run(['journalctl','--no-pager','-u',name,'-n','25','-o','json'],capture_output=True,text=True,timeout=10)
    events = [json.loads(line) for line in journal.stdout.splitlines() if line.startswith('{')]
    item['journalProjection'] = {'commandExitCode':journal.returncode,'observedRecords':len(events),
        'lastTimestampUsec':events[-1].get('__REALTIME_TIMESTAMP') if events else None,
        'messageContentsEmitted':False}
out['persistentJournalDirectoryPresent'] = pathlib.Path('/var/log/journal').is_dir()
out['listeningPorts'] = []
for line in subprocess.check_output(['ss','-ltnp'],text=True,timeout=10).splitlines()[1:]:
    fields = line.split()
    if len(fields)>3:
        out['listeningPorts'].append({'address':fields[3], 'pids':re.findall(r'pid=(\d+)',line)})
nginx = pathlib.Path('/etc/nginx/sites-available/ziwei').read_text()
effective = subprocess.run(['nginx','-T'],capture_output=True,text=True,check=True).stdout
out['nginxSafeDirectives'] = [line.strip() for line in nginx.splitlines() if re.match(r'^\s*(?:server_name|location|client_max_body_size)\b',line)]
out['nginxEffectiveBodyDirectives'] = [line.strip() for line in effective.splitlines() if re.match(r'^\s*client_max_body_size\b',line)]
out['nginxLoopbackUpstreams'] = re.findall(r'proxy_pass\s+(https?://(?:127\.0\.0\.1|localhost):\d+[^\s;]*);',effective)
out['terminalMcpV1LocationPresent'] = bool(re.search(r'location[^\n]*\/terminal-mcp\/v1',effective))
out['databases'] = {}
for label,source in [('main','/opt/ziwei/data/ziwei.sqlite'),('control','/var/lib/ziwei-control/control-plane.sqlite')]:
    start = int(time.time()*1000)
    src = sqlite3.connect('file:'+source+'?mode=ro',uri=True,timeout=3)
    db = sqlite3.connect(':memory:')
    try:
        deadline = time.monotonic()+30
        def bounded_backup(status,remaining,total):
            if time.monotonic()>deadline: raise TimeoutError('Read-only snapshot deadline')
        src.execute('PRAGMA query_only=ON')
        src.backup(db,pages=64,sleep=.01,progress=bounded_backup)
    finally:
        src.close()
    db.row_factory = sqlite3.Row
    info = {'source':source,'snapshotStartedMs':start,'snapshotCompletedMs':int(time.time()*1000),'integrity':db.execute('PRAGMA integrity_check').fetchone()[0],'foreignKeyErrors':len(db.execute('PRAGMA foreign_key_check').fetchall()),'tables':{}}
    for table,sql in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        columns = list(db.execute('PRAGMA table_info('+quote(table)+')'))
        keys = [r['name'] for r in sorted(columns,key=lambda r:r['pk']) if r['pk']]
        rows = [dict(r) for r in db.execute('SELECT * FROM '+quote(table))]
        info['tables'][table] = {'count':len(rows),'schemaSha256':sha(str(sql).encode()),'primaryKeys':keys,'primaryKeySetSha256':sha(canon(sorted(sha(canon({k:r[k] for k in keys}).encode()) for r in rows)).encode()),'allFieldsSha256':sha(canon(sorted(sha(canon(r).encode()) for r in rows)).encode())}
        if label=='main' and table=='a2a_actions':
            info['actionStatusCounts'] = dict(collections.Counter(r.get('status') for r in rows))
        if label=='main' and table=='devices':
            info['formalDevice'] = [selected(r,['id','workspace_id','status','pid','client_build','heartbeat_at','last_seen']) for r in rows if r.get('id')=='device_bfd9a3d2-c2cc-4a36-8bd8-465bea492493']
    db.close()
    if info['integrity'] != 'ok' or info['foreignKeyErrors']:
        raise RuntimeError('Read-only snapshot integrity failed')
    out['databases'][label] = info
objects = current/'data/objects'
out['objects'] = {'root':str(objects.resolve()),'exists':objects.is_dir(),'files':[]}
if objects.is_dir():
    for file in sorted(objects.rglob('*')):
        if file.is_symlink(): raise RuntimeError('Object link requires review')
        if file.is_file(): out['objects']['files'].append({'relativePathSha256':sha(str(file.relative_to(objects)).encode()),'bytes':file.stat().st_size,'sha256':sha(file.read_bytes())})
out['health'] = {}
for label,url in [('public','https://qzelynth.top/healthz'),('mainLocal','http://127.0.0.1:4178/healthz'),('controlLocal','http://127.0.0.1:5191/api/health')]:
    with urllib.request.urlopen(url,timeout=15) as response:
        body = json.loads(response.read())
        out['health'][label] = {'status':response.status,**selected(body,['ok','version','commit','build'])}
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(NoRedirect)
out['publicFiles']={}
for relative,file in [(f'/downloads/cli/{name}',downloads/name) for name in ['ziwei-latest.tgz','release.json','update-windows.ps1']]+[(relative,current/'frontend/dist'/relative.lstrip('/')) for relative in out['frontendIndexAssetReferences']]:
    url='https://qzelynth.top'+relative
    with opener.open(urllib.request.Request(url,headers={'Cache-Control':'no-cache'}),timeout=20) as response:
        payload=response.read(50*1024*1024+1)
        if response.status!=200 or response.geturl()!=url or len(payload)>50*1024*1024:raise RuntimeError('Public identity mismatch')
        out['publicFiles'][relative]={'status':response.status,'bytes':len(payload),'sha256':sha(payload),'matchesDisk':sha(payload)==sha(file.read_bytes())}
        if not out['publicFiles'][relative]['matchesDisk']:raise RuntimeError('Public bytes differ from disk')
out['protectedIdentityStable']=(str(pathlib.Path('/opt/ziwei/current').resolve())==out['mainRelease'] and
    str(pathlib.Path('/opt/ziwei-control/current').resolve())==out['controlRelease'] and
    all(sha(pathlib.Path(file).read_bytes())==value['sha256'] for file,value in out['protectedFileHashes'].items()))
for name,value in out['services'].items():
    actual=dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',name,'-p','MainPID','-p','ExecMainStartTimestamp'],text=True,timeout=10).splitlines() if '=' in line)
    out['protectedIdentityStable']=out['protectedIdentityStable'] and all(actual[k]==value[k] for k in actual)
if not out['protectedIdentityStable']:raise RuntimeError('Protected service or file identity changed during observation')
out['completedUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
print(json.dumps(out,ensure_ascii=True,indent=2))
