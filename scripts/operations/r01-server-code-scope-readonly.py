"""Read only the existing Linux server code-switch scope; not a native proof.

No secret environment values, action bodies or key bytes are emitted. The FD census
observes /proc metadata without opening any foreign SQLite file descriptor.
"""
import collections,datetime,hashlib,json,os,pathlib,sqlite3,subprocess,time
sha=lambda value:hashlib.sha256(value).hexdigest()
canonical=lambda value:json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
MAIN=pathlib.Path('/opt/ziwei/data/ziwei.sqlite')
unit='ziwei-api.service'
def service():
    keys=['MainPID','ExecMainStartTimestamp','ActiveState','User','Group','WorkingDirectory','EnvironmentFiles','FragmentPath','ControlGroup','KillMode','KillSignal','TimeoutStopUSec']
    return dict(line.split('=',1) for line in subprocess.check_output(['systemctl','show',unit,*[argument for key in keys for argument in ['-p',key]]],text=True,timeout=10).splitlines() if '=' in line)
before=service();pid=int(before['MainPID']);process=pathlib.Path('/proc')/str(pid)
report={'kind':'r01-server-code-scope-readonly','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'service':before,'current':str(pathlib.Path('/opt/ziwei/current').resolve()),'database':{'canonicalPath':str(MAIN.resolve()),'identity':{'dev':str(MAIN.stat().st_dev),'ino':str(MAIN.stat().st_ino)},'bytes':MAIN.stat().st_size},'sourceDatabaseSqlWrites':0,'sourceFilesystemWritesAsserted':False,'sqliteReadMayUpdateSharedMemory':True,'serviceActions':0,'nativeScopeProofMinted':False}
report['process']={'cwd':str((process/'cwd').resolve()),'executable':str((process/'exe').resolve()),'commandSha256':sha((process/'cmdline').read_bytes())}
values=dict(part.split(b'=',1) for part in (process/'environ').read_bytes().split(b'\0') if b'=' in part)
chosen=values.get(b'ZIWEI_ENV_ENCRYPTION_KEY') or values.get(b'ZIWEI_SECRET_KEY') or b''
key=chosen.decode().strip()
actual_database=pathlib.Path(values.get(b'ZIWEI_DB_FILE',str(pathlib.Path(report['process']['cwd'])/'data/ziwei.sqlite').encode()).decode()).resolve(strict=True)
if actual_database!=MAIN.resolve(strict=True) or actual_database.stat().st_dev!=MAIN.stat().st_dev or actual_database.stat().st_ino!=MAIN.stat().st_ino:raise RuntimeError('SERVICE_DATABASE_BINDING_CHANGED')
original_identity=(MAIN.stat().st_dev,MAIN.stat().st_ino)
actual_objects=pathlib.Path(values.get(b'ZIWEI_OBJECT_STORE_DIR',str(pathlib.Path(report['process']['cwd'])/'data/objects').encode()).decode()).resolve(strict=True)
if actual_objects!=pathlib.Path('/opt/ziwei/data/objects'):raise RuntimeError('SERVICE_OBJECT_STORE_BINDING_CHANGED')
report['storageBinding']={'databaseCanonicalPath':str(actual_database),'objectStoreDir':str(actual_objects)}
if key:
    report['environmentKey']={'kind':'configured','sha256':sha(key.encode()),'effectiveKeySha256':sha(hashlib.sha256(key.encode()).digest()),'valuePrinted':False}
else:
    file=(pathlib.Path(report['process']['cwd'])/'.local/employee-env.key').resolve(strict=True);info=file.lstat()
    if file.is_symlink() or info.st_nlink!=1 or info.st_mode&0o077 or not file.is_file():raise RuntimeError('EXISTING_ENV_KEY_PATH_REQUIRES_REVIEW')
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        with os.fdopen(fd,'rb') as stream:
            fd=None;opened_info=os.fstat(stream.fileno())
            if (opened_info.st_dev,opened_info.st_ino,opened_info.st_size,opened_info.st_mtime_ns)!=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns):raise RuntimeError('EXISTING_ENV_KEY_CHANGED')
            raw=stream.read()
            after=os.fstat(stream.fileno())
            if (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)!=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns):raise RuntimeError('EXISTING_ENV_KEY_CHANGED')
    finally:
        if fd is not None:os.close(fd)
    current=file.lstat()
    if (current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns)!=(info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns):raise RuntimeError('EXISTING_ENV_KEY_CHANGED')
    if len(raw)<32:raise RuntimeError('EXISTING_ENV_KEY_SIZE_REQUIRES_REVIEW')
    report['environmentKey']={'kind':'file','canonicalPath':str(file),'sha256':sha(raw),'bytes':len(raw),'effectiveKeySha256':sha(raw[:32]),'valuePrinted':False}
report['pathEnvironment']={name:values[name.encode()].decode() for name in ['ZIWEI_DB_FILE','ZIWEI_OBJECT_STORE_DIR'] if name.encode() in values}
values.clear();key=None
paths=[MAIN,pathlib.Path(str(MAIN)+'-wal'),pathlib.Path(str(MAIN)+'-shm'),pathlib.Path(str(MAIN)+'-journal')]
identities={(file.stat().st_dev,file.stat().st_ino):str(file) for file in paths if file.exists()}
opened=[];unreadable=[];raced=[]
for directory in pathlib.Path('/proc').iterdir():
    if not directory.name.isdigit():continue
    try:fds=list((directory/'fd').iterdir())
    except FileNotFoundError:raced.append(int(directory.name));continue
    except PermissionError:unreadable.append(int(directory.name));continue
    for fd in fds:
        try:
            info=fd.stat();target=identities.get((info.st_dev,info.st_ino))
            if not target:continue
            text=(directory/'fdinfo'/fd.name).read_text();flags=next(int(line.split(':',1)[1].strip(),8) for line in text.splitlines() if line.startswith('flags:'));access=flags&os.O_ACCMODE
            opened.append({'pid':int(directory.name),'fd':int(fd.name),'databasePath':target,'accessMode':access,'writable':access in [os.O_WRONLY,os.O_RDWR]})
        except FileNotFoundError:continue
        except PermissionError:unreadable.append(int(directory.name))
report['databaseFdCensus']={'openFiles':opened,'writablePids':sorted(set(row['pid'] for row in opened if row['writable'])),'unreadableProcessIds':sorted(set(unreadable)),'racedProcessIds':sorted(set(raced)),'writersStopped':False,'scope':'Observed server DB/WAL/SHM open FDs only; no Windows/native claim.'}
src=sqlite3.connect('file:'+str(MAIN)+'?mode=ro',uri=True,timeout=3);src.execute('PRAGMA query_only=ON');db=sqlite3.connect(':memory:');deadline=time.monotonic()+30
try:
    def progress(*args):
        if time.monotonic()>deadline:raise TimeoutError('READ_ONLY_SNAPSHOT_DEADLINE')
    src.backup(db,pages=64,sleep=.01,progress=progress)
finally:src.close()
db.row_factory=sqlite3.Row
rows=[dict(row) for row in db.execute('SELECT * FROM a2a_actions')]
report['actions']={'count':len(rows),'statusCounts':dict(collections.Counter(row['status'] for row in rows)),'pendingOrAckedIds':[row['id'] for row in rows if row['status'] in ['pending','acked']],'allFieldsSha256':sha(canonical(sorted(sha(canonical(row).encode()) for row in rows)).encode())}
subject=next(row for row in rows if row['id']=='action_8668054e-e2e9-476b-acb1-d20f561eb661')
report['retainedSubject']={'actionId':subject['id'],'status':subject['status'],'ackedAt':subject['acked_at'],'resultBytes':len((subject['result_json'] or '').encode()),'rowCanonicalSha256':sha(canonical(subject).encode()),'payloadSha256':sha((subject['payload_json'] or '').encode()),'resultSha256':sha((subject['result_json'] or '').encode()),'digestAlgorithm':'SHA256 compact sorted-key UTF8 JSON of existing row; not a native action proof'}
for table in ['automation_runs','webhook_deliveries','ziwei_connect_runs']:
    report[table+'StatusCounts']=dict(db.execute('SELECT status,count(*) FROM '+table+' GROUP BY status').fetchall())
report['existingRolloutTables']=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('version_preservation','production_preservation_identity','server_code_rollout')")]
report['integrity']=db.execute('PRAGMA integrity_check').fetchone()[0];report['foreignKeyErrors']=len(db.execute('PRAGMA foreign_key_check').fetchall());db.close()
if report['integrity']!='ok' or report['foreignKeyErrors']:raise RuntimeError('EXISTING_DATABASE_INTEGRITY_FAILED')
report['protectedServiceStable']=service()==before and (MAIN.stat().st_dev,MAIN.stat().st_ino)==original_identity
if not report['protectedServiceStable']:raise RuntimeError('ORIGINAL_SERVICE_CHANGED')
report['completedUTC']=datetime.datetime.now(datetime.timezone.utc).isoformat();print(json.dumps(report,ensure_ascii=True,indent=2))
