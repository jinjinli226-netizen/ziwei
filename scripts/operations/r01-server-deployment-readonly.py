"""Known Ziwei deployment host entrypoints only; run over existing SSH stdin.
No environment/auth/DB/HOME read, root-wide research, service writes or probes.
Unit commands are reduced to hashes/keyword classifications, never emitted.
"""
import datetime, hashlib, json, pathlib, re, subprocess
sha=lambda data:hashlib.sha256(data).hexdigest()
def run(args):return subprocess.check_output(args,timeout=12,text=True)
def command_flags(text):
    return {key:bool(re.search(pattern,text,re.I)) for key,pattern in {
        'gitPullOrFetch':r'\bgit\s+(?:pull|fetch)\b','githubReference':r'github\.com|api\.github\.com',
        'remoteScriptFetch':r'\b(?:curl|wget)\b','deployOrPublishReference':r'deploy|publish|release',
        'ziweiRootReference':r'/opt/ziwei(?:-control)?/'}.items()}
def main():
    report={'kind':'r01-known-server-deployment-entrypoints','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':{}}
    for name in ['ziwei-api.service','ziwei-control-api.service']:
        names=['Id','MainPID','ActiveState','FragmentPath','DropInPaths','ExecStart','ExecStartPre','ExecStartPost']
        raw=run(['systemctl','show',name,'--no-pager',*[('--property='+field) for field in names]])
        values=dict(line.split('=',1) for line in raw.splitlines() if '=' in line)
        commands={field:{'sha256':sha(values.get(field,'').encode()),'present':bool(values.get(field)),**command_flags(values.get(field,''))} for field in ['ExecStart','ExecStartPre','ExecStartPost']}
        report['services'][name]={key:values.get(key) for key in ['Id','MainPID','ActiveState','FragmentPath','DropInPaths']};report['services'][name]['commands']=commands
    report['roots']={}
    for name in ['/opt/ziwei','/opt/ziwei-control']:
        root=pathlib.Path(name);entries=[]
        if root.is_dir():
            for item in root.iterdir():
                if re.search(r'deploy|publish|release|sync|\.git',item.name,re.I):entries.append({'name':item.name,'directory':item.is_dir(),'symlink':item.is_symlink()})
        current=root/'current';report['roots'][name]={'current':str(current.resolve()),'currentGitDirectoryPresent':(current/'.git').exists(),'currentGithubDirectoryPresent':(current/'.github').exists(),'namedEntrypoints':sorted(entries,key=lambda row:row['name'])}
    units=run(['systemctl','list-unit-files','--type=service','--type=timer','--no-pager','--no-legend'])
    report['namedRelevantUnits']=[line.split()[0] for line in units.splitlines() if line.split() and re.search(r'ziwei|git[-_]?sync|(?:^|[-_])deploy(?:[-_.]|$)|(?:^|[-_])publish(?:[-_.]|$)',line.split()[0],re.I)]
    report.update({'completedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'knownEntryScopeOnly':True,'allExternalAutomationAbsenceClaimed':False,'serviceActions':0,'remoteWrites':0,'formalGatePassed':False})
    print(json.dumps(report,ensure_ascii=True))
if __name__=='__main__':main()
