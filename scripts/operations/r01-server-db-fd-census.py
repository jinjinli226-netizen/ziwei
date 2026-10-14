"""Observe stopped-server DB file descriptors; no SQLite connection or mutation.

The expected canonical DB and exact file identity must come from the current
operation's pre-stop capture. Unknown process scans never establish no writers.
"""
import argparse,json,os,pathlib,stat

def census(database,expected):
    path=pathlib.Path(database)
    if not path.is_absolute() or str(path)!=database or path.resolve(strict=True)!=path or path.is_symlink():raise RuntimeError('DB_CANONICAL_PATH_REQUIRED')
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or {'dev':str(info.st_dev),'ino':str(info.st_ino)}!=expected:raise RuntimeError('DB_IDENTITY_CHANGED')
    before=(info.st_dev,info.st_ino)
    files=[path,*[pathlib.Path(str(path)+suffix) for suffix in ['-wal','-shm','-journal']]]
    identities={(file.stat().st_dev,file.stat().st_ino):str(file) for file in files if file.exists()}
    rows=[];unknown=[];races=[]
    for process in pathlib.Path('/proc').iterdir():
        if not process.name.isdigit():continue
        try:fds=list((process/'fd').iterdir())
        except FileNotFoundError:races.append(int(process.name));continue
        except PermissionError:unknown.append(int(process.name));continue
        for fd in fds:
            try:
                item=fd.stat();target=identities.get((item.st_dev,item.st_ino))
                if not target:continue
                details=(process/'fdinfo'/fd.name).read_text();flags=next(int(line.split(':',1)[1].strip(),8) for line in details.splitlines() if line.startswith('flags:'))
                rows.append({'pid':int(process.name),'fd':int(fd.name),'databasePath':target,'writable':(flags&os.O_ACCMODE) in [os.O_WRONLY,os.O_RDWR]})
            except FileNotFoundError:races.append(int(process.name))
            except PermissionError:unknown.append(int(process.name))
    after=path.stat()
    if (after.st_dev,after.st_ino)!=before:raise RuntimeError('DB_IDENTITY_CHANGED')
    writers=sorted({row['pid'] for row in rows if row['writable']})
    return {'kind':'server-only-database-fd-census','databaseCanonicalPath':database,'identity':expected,'openFiles':rows,'writerPids':writers,'unreadableProcessIds':sorted(set(unknown)),'racedProcessIds':sorted(set(races)),'complete':not unknown and not races,'noObservedWriters':not writers and not unknown and not races,'sourceDatabaseConnectionsOpened':0,'sourceWrites':0,'serviceActions':0,'nativeScopeProofMinted':False}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--database',required=True);parser.add_argument('--dev',required=True);parser.add_argument('--ino',required=True);args=parser.parse_args()
    if os.name!='posix' or not pathlib.Path('/proc').is_dir():raise RuntimeError('LINUX_PROC_REQUIRED')
    print(json.dumps(census(args.database,{'dev':args.dev,'ino':args.ino}),indent=2))
