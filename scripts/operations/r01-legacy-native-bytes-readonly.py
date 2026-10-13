"""Copy only the three already approved native legacy byte sources into R .local.

No old collector execution, state mutation, arbitrary HOME/auth reads or stdout
content. Exact Win32 final paths and expected immutable log hashes are required.
"""
import argparse, hashlib, importlib.util, json, pathlib, sys
sha=lambda data:hashlib.sha256(data).hexdigest()
def load(name,file):
    spec=importlib.util.spec_from_file_location(name,file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
def main():
    p=argparse.ArgumentParser();p.add_argument('--helper',required=True);p.add_argument('--helper-sha256',required=True);p.add_argument('--directory',required=True);args=p.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];directory=pathlib.Path(args.directory).resolve()
    if root/'.local' not in directory.parents or directory.exists():raise RuntimeError('NEW_PRIVATE_DIRECTORY_REQUIRED')
    if sha(pathlib.Path(args.helper).read_bytes())!=args.helper_sha256:raise RuntimeError('REVIEWED_HELPER_CHANGED')
    g=load('g',args.helper);native=load('n',pathlib.Path(__file__).with_name('v2-windows-preflight-readonly.py')).native_file
    approved=[('logger-start.raw',g.USER_HOME/'logs/daemon.log.1791689059232','447bf1c4db2b8a51f15f71e433803e030ec84ba3124b407987e1f3bd53c02403'),
              ('logger-end.raw',g.USER_HOME/'logs/daemon.log.1791772341015','4794319aa2c10cab415febc45305e29e3b1c5dd13400b1dc92e4e8b6ba248456'),
              ('current-cache.raw',g.USER_HOME/'runtime/action-state.json',None)]
    values=[]
    for name,file,expected in approved:
        exact=native(g,file);data=exact.read_bytes();digest=sha(data)
        if expected and digest!=expected or exact.read_bytes()!=data:raise RuntimeError('APPROVED_SOURCE_CHANGED')
        values.append((name,data,{'sourcePath':str(file),'nativeFinalPath':g.final_path(exact),'sha256':digest,'bytes':len(data)}))
    directory.mkdir(parents=True)
    rows=[]
    for name,data,metadata in values:
        file=directory/name
        with file.open('xb') as stream:stream.write(data)
        rows.append({'path':str(file),**metadata})
    with (directory/'manifest.json').open('x',encoding='utf-8') as stream:json.dump({'kind':'r01-approved-legacy-native-bytes','sources':rows,'sourceWrites':0,'serviceActions':0,'modelCalls':0,'phoneActions':0,'formalGatePassed':False},stream,ensure_ascii=True,indent=2)
if __name__=='__main__':
    try:main()
    except Exception as error:
        if '--directory' in sys.argv:
            candidate=pathlib.Path(sys.argv[sys.argv.index('--directory')+1]).resolve();root=pathlib.Path(__file__).resolve().parents[2]
            if root/'.local' in candidate.parents:
                candidate.mkdir(parents=True,exist_ok=True)
                if not (candidate/'failure.json').exists():
                    with (candidate/'failure.json').open('x',encoding='utf-8') as stream:json.dump({'code':getattr(error,'code',type(error).__name__),'formalGatePassed':False},stream)
        sys.exit(1)
