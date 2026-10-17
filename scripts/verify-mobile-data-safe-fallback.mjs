import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const FALLBACK_BASE='8629091c2993e32625b25cfe7835805541286f4f';
export const FORWARD_SOURCE='20da8856beb7f008d8c3b85f65103f53b9deef19';
export const REPOSITORY_SHA256='f81d9aa44c3ebaf3c44df7280fff561a89fb59622e187311409f090062781878';
const BASE_REPOSITORY_SHA256='9948602090f50980be31d14e2dd23b4388b12f87b7118d8121ae0e8c1584e37a';
export const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const run=(command,args,options={})=>{
  const value=spawnSync(command,args,{maxBuffer:256*1024*1024,...options});
  if(value.error||value.status!==0)throw new Error(`${command} failed: ${value.error?.message||value.stderr?.toString()||value.status}`);
  return value.stdout;
};
const git=(repository,...args)=>run('git',['-C',repository,...args]);
const extract=String.raw`
import io,pathlib,sys,tarfile
base=pathlib.Path(sys.argv[1]);seen=set();total=0
with tarfile.open(fileobj=io.BytesIO(sys.stdin.buffer.read())) as bundle:
 for index,item in enumerate(bundle):
  rel=pathlib.PurePosixPath(item.name)
  if index>=20000 or item.name in seen or rel.is_absolute() or '..' in rel.parts or not(item.isdir() or item.isfile()) or item.size>32*1024*1024: raise RuntimeError('UNSAFE_FIXED_GIT_ARCHIVE')
  seen.add(item.name);total+=item.size
  if total>256*1024*1024: raise RuntimeError('FIXED_GIT_ARCHIVE_TOO_LARGE')
  target=base.joinpath(*rel.parts)
  if item.isdir():target.mkdir(parents=True,exist_ok=True)
  else:
   target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(bundle.extractfile(item).read())
`;

// Test-only source preparation. Never substitutes methods or shares a repository
// instance: the tests import the actual full modules in these frozen trees.
export function prepareFrozenSources(){
  const sourceRepo=path.resolve(process.env.ZIWEI_ASSIGNMENT_SOURCE_REPO||projectRoot);
  const requested=process.env.ZIWEI_ASSIGNMENT_SOURCE_COMMIT||FORWARD_SOURCE;
  assert.equal(requested,FORWARD_SOURCE,'Only the reviewed forward commit is accepted');
  for(const commit of [FALLBACK_BASE,FORWARD_SOURCE])assert.equal(git(sourceRepo,'rev-parse','--verify',`${commit}^{commit}`).toString().trim(),commit);
  assert.equal(sha(git(sourceRepo,'show',`${FALLBACK_BASE}:backend/repository.mjs`)),BASE_REPOSITORY_SHA256);
  assert.equal(sha(git(sourceRepo,'show',`${FORWARD_SOURCE}:backend/repository.mjs`)),REPOSITORY_SHA256);
  // Git's attributes may check text out as CRLF. Compare the canonical text blob.
  assert.equal(sha(fs.readFileSync(path.join(projectRoot,'backend/repository.mjs'),'utf8').replaceAll('\r\n','\n')),REPOSITORY_SHA256,'Fallback runtime must equal the reviewed repository blob');
  for(const file of ['backend/app.mjs','backend/db.mjs'])assert.equal(
    fs.readFileSync(path.join(projectRoot,file),'utf8').replaceAll('\r\n','\n'),
    git(sourceRepo,'show',`${FALLBACK_BASE}:${file}`).toString().replaceAll('\r\n','\n'),`${file} must retain the old product source`);
  assert.equal(fs.existsSync(path.join(projectRoot,'backend/mobile-notifications.mjs')),false,'Fallback must not introduce the new feed');
  const dependencies=fs.realpathSync(process.env.ZIWEI_ASSIGNMENT_DEPENDENCIES||path.join(projectRoot,'node_modules'));
  assert(fs.existsSync(path.join(dependencies,'express/package.json')),'Install the existing project dependencies first');
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-assignment-fallback-')));
  const roots={fallback:projectRoot};
  try{
    for(const [name,commit] of [['base',FALLBACK_BASE],['forward',FORWARD_SOURCE]]){
      const destination=path.join(directory,name);fs.mkdirSync(destination);
      const archive=git(sourceRepo,'archive','--format=tar',commit,'backend','src','scripts','package.json');
      run('python3',['-c',extract,destination],{input:archive});
      fs.symlinkSync(dependencies,path.join(destination,'node_modules'),'dir');roots[name]=destination;
    }
    return {directory,roots,identity:{baseCommit:FALLBACK_BASE,forwardCommit:FORWARD_SOURCE,repositorySha256:REPOSITORY_SHA256,baseRepositorySha256:BASE_REPOSITORY_SHA256,sourceRepo,modulesAreUnmodifiedGitArchives:true},cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
  }catch(error){fs.rmSync(directory,{recursive:true,force:true});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),settings={};
  for(let i=0;i<args.length;i+=2){assert(['--source-repo','--source-commit','--dependencies','--report'].includes(args[i])&&args[i+1],`Unknown or incomplete argument: ${args[i]}`);settings[args[i]]=args[i+1];}
  const report=settings['--report']?path.resolve(settings['--report']):null;
  if(report)fs.mkdirSync(path.dirname(report),{recursive:true});
  const env={...process.env,
    ...(settings['--source-repo']?{ZIWEI_ASSIGNMENT_SOURCE_REPO:path.resolve(settings['--source-repo'])}:{}),
    ...(settings['--source-commit']?{ZIWEI_ASSIGNMENT_SOURCE_COMMIT:settings['--source-commit']}:{}),
    ...(settings['--dependencies']?{ZIWEI_ASSIGNMENT_DEPENDENCIES:path.resolve(settings['--dependencies'])}:{}),
    ...(report?{ZIWEI_ASSIGNMENT_REPORT:report}:{}),
    ZIWEI_SERVER_CODE_ROLLOUT_CONFIG:'',ZIWEI_SERVER_CODE_ROLLOUT_CONFIG_SHA256:''};
  const child=spawnSync(process.execPath,['--test','--test-reporter=tap',path.join(projectRoot,'backend/task-assignment-binding.test.mjs'),path.join(projectRoot,'backend/task-assignment-fallback.test.mjs')],{cwd:projectRoot,env,encoding:'utf8',maxBuffer:8*1024*1024});
  const exitCode=Number.isInteger(child.status)?child.status:1;
  process.stdout.write(child.stdout||'');process.stderr.write(child.stderr||'');
  if(report){
    const value=fs.existsSync(report)?JSON.parse(fs.readFileSync(report,'utf8')):{};
    fs.writeFileSync(report,JSON.stringify({...value,ok:exitCode===0,exitCode,signal:child.signal||null,error:child.error?.message||null},null,2)+'\n');
    fs.writeFileSync(report+'.tap',(child.stdout||'')+(child.stderr||''));
  }
  process.exitCode=exitCode;
}
