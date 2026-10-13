"""Finite native Linux observation, run over SSH stdin. No source files written.

No service mutation, API maintenance call, key/environment read or business work.
OS generation is systemd InvocationId + boot_id + native /proc start ticks;
InvocationId is explicitly not an API self-reported nonce or ISO birth.
"""
import collections, datetime, hashlib, json, os, pathlib, re, shlex, sqlite3, subprocess, time, urllib.request

sha = lambda data: hashlib.sha256(data).hexdigest()
now = lambda: datetime.datetime.now(datetime.timezone.utc).isoformat()
PROPERTIES = ['MainPID','InvocationID','ControlGroup','KillMode','SendSIGKILL','Delegate','Restart',
              'ActiveState','SubState','ExecMainStartTimestamp','FragmentPath','DropInPaths','User','NRestarts']
SERVICES = ['ziwei-api.service','ziwei-control-api.service','nginx.service']
issues = []
def command(args):
    return subprocess.check_output(args,text=True,timeout=15)
def file_record(file):
    file=pathlib.Path(file);data=file.read_bytes()
    return {'path':str(file),'physicalPath':str(file.resolve()),'sha256':sha(data),'bytes':len(data)}
def proc(pid):
    directory=pathlib.Path('/proc')/str(pid)
    try:
        # Field 22 starttime remains kernel ticks, not a fabricated ISO timestamp.
        stat=directory.joinpath('stat').read_text().rsplit(') ',1)[1].split()
        argv=directory.joinpath('cmdline').read_bytes();cgroup=directory.joinpath('cgroup').read_bytes()
        try:executable=os.readlink(directory/'exe')
        except FileNotFoundError:
            # Kernel threads and zombies can still have stat/cgroup but no exe.
            # Missing exe alone must not be reported as a vanished process.
            return {'pid':int(pid),'ppid':int(stat[1]),'state':stat[0],
                    'nativeBirth':{'kind':'linux-proc-start-ticks','startTicks':stat[19]},'visible':False,
                    'reason':'executable-unavailable','processStatRead':True,'argvSha256':sha(argv),'cgroupSha256':sha(cgroup)}
        return {'pid':int(pid),'ppid':int(stat[1]),'nativeBirth':{'kind':'linux-proc-start-ticks','startTicks':stat[19]},
                'executable':executable,'argvSha256':sha(argv),'argvEncoding':'nul-delimited-bytes',
                'entryPaths':[part.decode('utf-8','strict') for part in argv.split(b'\0') if part.startswith(b'/opt/ziwei') and part.endswith(b'.mjs')],
                'cgroup':cgroup.decode(),'cgroupSha256':sha(cgroup)}
    except FileNotFoundError:return {'pid':int(pid),'visible':False,'reason':'vanished-during-read'}
    except (PermissionError,OSError,UnicodeError,ValueError):return {'pid':int(pid),'visible':False,'reason':'native-read-incomplete'}
def cgroup_snapshot(group,cgroup_root='/sys/fs/cgroup'):
    root=pathlib.Path(cgroup_root);directory=root/group.lstrip('/')
    result={'kind':'cgroup-v2','path':str(directory),'serviceControlGroup':group,'directories':[],'members':[],
            'visibilityComplete':False,'recursiveMembershipStable':False,'issues':[]}
    if not group or '..' in pathlib.PurePosixPath(group).parts or not (root/'cgroup.controllers').is_file():
        result['issues'].append('CGROUP_V2_UNAVAILABLE');return result
    def walk():
        directories=[];members=[]
        def visit(folder):
            if folder.is_symlink() or folder.resolve()!=folder:raise RuntimeError('CGROUP_PATH_LINKED')
            names=sorted(child.name for child in folder.iterdir());data=(folder/'cgroup.procs').read_bytes()
            pids=sorted(set(int(line) for line in data.splitlines()))
            directories.append({'path':str(folder),'entries':names,'members':pids,'membersSha256':sha(data)})
            members.extend(pids)
            for name in names:
                child=folder/name
                if child.is_dir():visit(child)
        visit(directory)
        return directories,sorted(set(members))
    try:
        first,pids=walk();processes=[proc(pid) for pid in pids];second,pids_after=walk()
        result.update(directories=first,members=processes,recursiveMembershipStable=first==second and pids==pids_after,
                      visibilityComplete=all(item.get('visible') is not False for item in processes))
        if not result['recursiveMembershipStable']:result['issues'].append('CGROUP_MEMBERSHIP_CHANGED')
        if not result['visibilityComplete']:result['issues'].append('CGROUP_MEMBER_NOT_VISIBLE')
        for item in processes:
            if item.get('visible') is not False and '0::'+group not in item['cgroup'].splitlines():
                # Children legitimately belong to recursive descendant cgroups.
                if not any(line.startswith('0::'+group.rstrip('/')+'/') for line in item['cgroup'].splitlines()):
                    result['issues'].append('CGROUP_MEMBER_BINDING_CHANGED')
    except (OSError,ValueError,RuntimeError):result['issues'].append('CGROUP_READ_INCOMPLETE')
    return result
def service(name):
    value=dict(line.split('=',1) for line in command(['systemctl','show',name]+[part for key in PROPERTIES for part in ['-p',key]]).splitlines() if '=' in line)
    # systemd's actual D-Bus/show property uses uppercase ID.
    invocation=value.pop('InvocationID',None)
    value['identityKind']='systemd-invocation';value['invocationIdSha256']=sha(invocation.encode()) if invocation else None
    value['apiSelfReportedNonce']=None
    value['unitFiles']=[file_record(file) for file in [value.get('FragmentPath')]+shlex.split(value.get('DropInPaths','')) if file]
    value['originalProcess']=proc(int(value.get('MainPID') or 0)) if int(value.get('MainPID') or 0)>0 else None
    value['namespace']=cgroup_snapshot(value.get('ControlGroup',''))
    # This is narrow containment metadata, never full historic worker provenance.
    value['containmentObserved']=bool(value['invocationIdSha256'] and value.get('KillMode')=='control-group' and
        value.get('SendSIGKILL')=='yes' and value.get('Delegate')=='no' and value['namespace']['visibilityComplete'] and
        value['namespace']['recursiveMembershipStable'] and not value['namespace']['issues'])
    return value
def source_manifest(root):
    contents=[];directories=[]
    def walk(folder,prefix=''):
        names=sorted(child.name for child in folder.iterdir());directories.append({'path':str(folder),'entries':names})
        for name in names:
            if name in ['node_modules','.git','.local','data']:continue
            file=folder/name;relative=prefix+'/'+name if prefix else name
            if file.is_symlink():raise RuntimeError('API_SOURCE_LINKED')
            if file.is_dir():walk(file,relative)
            elif file.is_file():contents.append({'path':relative,'sha256':sha(file.read_bytes())})
            else:raise RuntimeError('API_SOURCE_KIND_UNKNOWN')
    walk(root)
    # Same recursive, sorted [{path,sha256},...] JSON.stringify byte algorithm
    # documented by frozen E03 source CLI. This is disk identity, not runtime build.
    return {'root':str(root),'buildDigest':sha(json.dumps(contents,ensure_ascii=False,separators=(',',':')).encode()),
            'contents':contents,'directories':directories,'runningCodeIdentityProven':False}
def legacy_action():
    src=sqlite3.connect('file:/opt/ziwei/data/ziwei.sqlite?mode=ro',uri=True,timeout=3);src.execute('PRAGMA query_only=ON')
    db=sqlite3.connect(':memory:');deadline=time.monotonic()+20
    def bounded(*args):
        if time.monotonic()>deadline:raise TimeoutError('READONLY_SNAPSHOT_DEADLINE')
    try:src.backup(db,pages=64,sleep=.01,progress=bounded)
    finally:src.close()
    db.row_factory=sqlite3.Row
    row=db.execute('SELECT * FROM a2a_actions WHERE id=?',('action_8668054e-e2e9-476b-acb1-d20f561eb661',)).fetchone()
    counts=dict(db.execute('SELECT status,count(*) FROM a2a_actions GROUP BY status').fetchall());db.close()
    if not row:return {'present':False,'statusCounts':counts}
    raw=dict(row)
    # Exact nativeActionDigest algorithm from E02 clean 12a68314: spread raw row,
    # add parsed payload/result, canonical JSON object keys using JS localeCompare.
    # Raw action never leaves the server; the disposable Node process only hashes.
    js="""import {createHash} from 'node:crypto';let text='';for await(const part of process.stdin)text+=part;const row=JSON.parse(text);const parse=value=>{try{return JSON.parse(value);}catch{return null;}};const normalized=row=>({...row,payload:row.payload||parse(row.payload_json)||{},result:row.result||parse(row.result_json)});const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);process.stdout.write(createHash('sha256').update(canonical(normalized(row))).digest('hex'));"""
    result=subprocess.run(['/opt/node-v24.13.0-linux-x64/bin/node','--input-type=module','-e',js],input=json.dumps(raw).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15,check=True)
    action_digest=result.stdout.decode()
    if not re.fullmatch('[a-f0-9]{64}',action_digest):raise RuntimeError('NATIVE_ACTION_DIGEST_INVALID')
    return {'present':True,'database':'/opt/ziwei/data/ziwei.sqlite','statusCounts':counts,
        'fields':{key:raw.get(key) for key in ['id','workspace_id','type','status','acked_at','completed_at','created_at','updated_at']},
        'rawActionDigest':action_digest,'algorithm':'E02-12a68314-nativeActionDigest-raw-plus-parsed-payload-result',
        'algorithmSourceSha256':sha(js.encode()),'payloadSha256':sha((raw.get('payload_json') or '').encode()),
        'resultSha256':sha((raw.get('result_json') or '').encode()),'dedupeKeySha256':sha(raw['dedupe_key'].encode())}

def main():
    started=now();before={name:service(name) for name in SERVICES}
    root=pathlib.Path('/opt/ziwei/current').resolve();manifest=source_manifest(root)
    listeners=[]
    for line in command(['ss','-ltnp']).splitlines()[1:]:
        fields=line.split()
        if len(fields)>3:listeners.append({'address':fields[3],'pids':[int(pid) for pid in re.findall(r'pid=(\d+)',line)]})
    with urllib.request.urlopen('http://127.0.0.1:4178/healthz',timeout=10) as response:
        health=json.loads(response.read(64*1024))
    health={'status':response.status,**{key:health[key] for key in ['ok','service','time'] if key in health},
            'selfReportedPid':None,'selfReportedNonce':None,'runningDatabaseIdentity':None,'runningFenceIdentity':None}
    inventory=[proc(int(file.name)) for file in sorted(pathlib.Path('/proc').iterdir(),key=lambda p:p.name) if file.name.isdigit()]
    after={name:service(name) for name in SERVICES}
    stable_keys=['MainPID','invocationIdSha256','ControlGroup','KillMode','SendSIGKILL','Delegate','Restart','ActiveState','SubState','ExecMainStartTimestamp','unitFiles','originalProcess']
    stable=all(all(before[name].get(key)==after[name].get(key) for key in stable_keys) for name in SERVICES)
    stable=stable and source_manifest(root)==manifest and root==pathlib.Path('/opt/ziwei/current').resolve()
    boot=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    out={'kind':'r01-linux-source-observation','schemaVersion':1,'captureStartedAt':started,'captureCompletedAt':now(),
         'bootId':boot,'clockTicksPerSecond':os.sysconf('SC_CLK_TCK'),'nativeNamespaces':{name:os.readlink('/proc/'+name+'/ns/pid') for name in ['self','1']},
         'services':before,'afterServices':after,'identityStable':stable,'apiSource':manifest,'listeners':listeners,'health':health,
         'processInventory':inventory,'processInventoryReadFailures':[item for item in inventory if item.get('visible') is False],
         'legacySubject':legacy_action(),'scope':{'namespaceComplete':None,'workerScopeComplete':None,
         'historicPreStopLineage':'NOT_RUN','actualStoppedCapture':'NOT_RUN','noChildProcessesClaim':False},
         'serviceActions':0,'databaseWrites':0,'modelCalls':0,'phoneActions':0,'signingKeyReads':0,'formalGatePassed':False}
    print(json.dumps(out,ensure_ascii=True,separators=(',',':')))
if __name__=='__main__':main()
