import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';

const implementation=await import('../backend/preservation-legacy-archive.mjs').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};
  throw error;
});
const verify=(...args)=>{assert.equal(typeof implementation.verifyLegacyArchive,'function','archive verifier is implemented');return implementation.verifyLegacyArchive(...args);};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fixed=['package.json','backend/a2a-auth.mjs','scripts/ziwei-user.mjs','scripts/ziwei-cli.mjs','scripts/start-ziwei-user.mjs','scripts/ziwei-mcp.mjs','scripts/ziwei-terminal-mcp.mjs','scripts/client-lifecycle.mjs','scripts/client-maintenance-helper.mjs','scripts/client-update.mjs','scripts/client-update-worker.mjs'];
const protocol=['src/management-bootstrap.mjs','daemon/ziwei_user.mjs','src/daemon.mjs','src/daemon-action-scheduler.mjs','src/local-action.mjs','src/runtime-adapters.mjs'];
const other=['LICENSE','README.md','daemon/config.example.json','daemon/config.mjs','daemon/ziwei-daemon.mjs','daemon/ziwei_user.example.json','src/creator-runtime-home.mjs','src/domain.mjs','src/employee-runtime.mjs','src/hermes-mcp-bootstrap.py','src/redaction.mjs','src/runtime-cli-discovery.mjs','src/windows-workdir.mjs'];
function historicalBuild(members,installed){
  const hash=createHash('sha256');
  const names=[...new Set([...fixed,...members.keys()].filter(name=>fixed.includes(name)||/^(daemon|src)\/.*\.(mjs|py)$/.test(name)))].sort();
  for(const name of names){
    let bytes=members.get(name);
    if(installed&&name==='scripts/ziwei-user.mjs'&&bytes.subarray(0,2).toString()==='#!'){
      const end=bytes.indexOf(10);if(end>=0&&bytes[end-1]===13)bytes=Buffer.concat([bytes.subarray(0,end-1),bytes.subarray(end)]);
    }
    hash.update(name).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}
function header(name,size,{type='0',link='',magic='ustar\0',prefix=''}={}){
  const value=Buffer.alloc(512);
  const write=(text,start,length)=>value.write(text,start,length,'ascii');
  write(name,0,100);write('0000644\0',100,8);write('0000000\0',108,8);write('0000000\0',116,8);
  write(size.toString(8).padStart(11,'0')+'\0',124,12);write('00000000000\0',136,12);value.fill(32,148,156);
  write(type,156,1);write(link,157,100);write(magic,257,6);write('00',263,2);write(prefix,345,155);
  const checksum=value.reduce((sum,byte)=>sum+byte,0);write(checksum.toString(8).padStart(6,'0')+'\0 ',148,8);
  return value;
}
function tar(entries,{end=true,tail=Buffer.alloc(0)}={}){
  return Buffer.concat([...entries.flatMap(row=>[header(row.name,row.bytes.length,row),row.bytes,Buffer.alloc((512-row.bytes.length%512)%512)]),...(end?[Buffer.alloc(1024)]:[]),tail]);
}
function fixture(){
  const members=new Map([...fixed,...protocol,...other].map(name=>[name,Buffer.from(name==='scripts/ziwei-user.mjs'?'#!/usr/bin/env node\r\n// second line remains CRLF\r\n':'// fixture '+name+'\r\n')]));
  assert.equal(members.size,30);
  const entries=[...members].map(([name,bytes])=>({name:'package/'+name,bytes}));
  const options={expectedSha256:null,expectedBytes:null,memberManifest:[...members].map(([path,bytes])=>({path,bytes:bytes.length,sha256:sha(bytes)})),protocolSha256:Object.fromEntries(protocol.map(name=>[name,sha(Buffer.from(members.get(name).toString().replace(/\r\n/g,'\n')))])),expectedInstalledBuild:historicalBuild(members,true)};
  const bytes=gzipSync(tar(entries));options.expectedSha256=sha(bytes);options.expectedBytes=bytes.length;
  return {members,entries,options,bytes};
}
function repack(f,entries=f.entries,tarOptions){const bytes=gzipSync(tar(entries,tarOptions));return {bytes,options:{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length}};}
const refused=(bytes,options,code)=>assert.throws(()=>verify(bytes,options),error=>error.code===code);

test('verifies the exact 30-member byte manifest and exposes defensive member copies',()=>{
  const f=fixture(),before=Buffer.from(f.bytes),result=verify(f.bytes,f.options);
  assert.equal(result.kind,'legacy-source-archive-v1');assert.equal(result.memberCount,30);
  assert.equal(result.archiveSha256,sha(f.bytes));assert.equal(result.installedBuild,f.options.expectedInstalledBuild);
  assert.equal(result.sourceBuild,historicalBuild(f.members,false));assert.deepEqual(f.bytes,before);
  assert.ok(Object.isFrozen(result)&&Object.isFrozen(result.members)&&result.members.every(Object.isFrozen));
  assert.ok(Object.isFrozen(result.protocols)&&result.protocols.every(Object.isFrozen));
  assert.throws(()=>{result.members[0].path='changed';},TypeError);
  const original=result.readMemberBytes('src/daemon.mjs');original.fill(0);
  assert.deepEqual(result.readMemberBytes('src/daemon.mjs'),f.members.get('src/daemon.mjs'));
  refused(f.bytes,{...f.options,request:{approved:true}},'LEGACY_ARCHIVE_POLICY_INVALID');
});

test('normalizes only the npm bin shebang for installed build and retains all other CRLF bytes',()=>{
  const f=fixture(),result=verify(new Uint8Array(f.bytes),f.options);
  assert.notEqual(result.sourceBuild,result.installedBuild);
  assert.deepEqual(result.readMemberBytes('scripts/ziwei-user.mjs'),f.members.get('scripts/ziwei-user.mjs'));
  assert.equal(result.protocols.find(row=>row.path==='src/daemon.mjs').normalizedSha256,f.options.protocolSha256['src/daemon.mjs']);
  const allLf=new Map([...f.members].map(([name,bytes])=>[name,Buffer.from(bytes.toString().replace(/\r\n/g,'\n'))]));
  refused(f.bytes,{...f.options,expectedInstalledBuild:historicalBuild(allLf,false)},'LEGACY_ARCHIVE_BUILD_MISMATCH');
});

test('refuses compressed hash and byte pin mismatch before decoding',()=>{
  const f=fixture();refused(f.bytes,{...f.options,expectedSha256:'0'.repeat(64)},'LEGACY_ARCHIVE_PIN_MISMATCH');
  refused(f.bytes,{...f.options,expectedBytes:f.bytes.length+1},'LEGACY_ARCHIVE_PIN_MISMATCH');
});

test('accepts portable USTAR empty owner IDs while refusing empty size and time fields',()=>{
  const f=fixture(),source=tar(f.entries);
  source.fill(0,108,124);source.fill(32,148,156);
  source.write(source.subarray(0,512).reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
  const bytes=gzipSync(source),options={...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length};
  assert.equal(verify(bytes,options).memberCount,30);
  for(const [start,end] of [[124,136],[136,148]]){
    const invalid=Buffer.from(source);invalid.fill(0,start,end);invalid.fill(32,148,156);
    invalid.write(invalid.subarray(0,512).reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    const changed=gzipSync(invalid);refused(changed,{...options,expectedSha256:sha(changed),expectedBytes:changed.length},'LEGACY_ARCHIVE_TAR_INVALID');
  }
});

test('refuses altered raw member bytes and protocol normalization hashes',()=>{
  const f=fixture(),entries=f.entries.map(row=>({...row,bytes:Buffer.from(row.bytes)}));entries[0].bytes[0]^=1;
  const changed=repack(f,entries);refused(changed.bytes,changed.options,'LEGACY_ARCHIVE_MEMBER_MISMATCH');
  refused(f.bytes,{...f.options,protocolSha256:{...f.options.protocolSha256,'src/daemon.mjs':'0'.repeat(64)}},'LEGACY_ARCHIVE_PROTOCOL_MISMATCH');
});

test('refuses links, directories and PAX/GNU extension headers',()=>{
  const f=fixture();for(const type of ['1','2','5','x','g','L','K']){
    const entries=f.entries.map((row,index)=>index===0?{...row,type,link:type==='1'||type==='2'?'package/README.md':''}:row);
    const changed=repack(f,entries);refused(changed.bytes,changed.options,'LEGACY_ARCHIVE_TAR_INVALID');
  }
});

test('refuses duplicate, case-colliding, missing and extra archive members',()=>{
  const f=fixture();for(const entries of [[...f.entries,f.entries[0]],[...f.entries,{...f.entries[0],name:f.entries[0].name.toLowerCase()}],f.entries.slice(1),[...f.entries,{name:'package/extra.txt',bytes:Buffer.from('extra')}]]){
    const changed=repack(f,entries);refused(changed.bytes,changed.options,'LEGACY_ARCHIVE_TAR_INVALID');
  }
});

test('refuses unsafe manifest paths and archive traversal or absolute paths',()=>{
  const f=fixture();for(const path of ['../escape','/absolute','C:/drive','src\\escape','src//empty','src/./dot','src/NUL','src/name.']){
    const manifest=f.options.memberManifest.map((row,index)=>index===0?{...row,path}:row);
    refused(f.bytes,{...f.options,memberManifest:manifest},'LEGACY_ARCHIVE_POLICY_INVALID');
  }
  for(const name of ['package/../escape','/absolute','C:/drive','package/src\\escape']){
    const changed=repack(f,f.entries.map((row,index)=>index===0?{...row,name}:row));refused(changed.bytes,changed.options,'LEGACY_ARCHIVE_TAR_INVALID');
  }
});

test('refuses invalid checksum, nonzero padding, missing terminator and nonzero tail',()=>{
  const f=fixture(),cases=[];
  const checksum=tar(f.entries);checksum[148]^=1;cases.push(checksum);
  const padding=tar(f.entries);padding[512+f.entries[0].bytes.length]=1;cases.push(padding);
  cases.push(tar(f.entries,{end:false}),tar(f.entries,{tail:Buffer.from([1])}));
  for(const source of cases){const bytes=gzipSync(source);refused(bytes,{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length},'LEGACY_ARCHIVE_TAR_INVALID');}
});

test('refuses unsupported tar formats and malformed gzip bytes',()=>{
  const f=fixture(),changed=repack(f,f.entries.map((row,index)=>index===0?{...row,magic:'ustar '}:row));
  refused(changed.bytes,changed.options,'LEGACY_ARCHIVE_TAR_INVALID');
  for(const bytes of [f.bytes.subarray(0,f.bytes.length-4),Buffer.from('not gzip'),Buffer.from(f.bytes)]){
    if(bytes.length===f.bytes.length)bytes[3]=4;
    refused(bytes,{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length},'LEGACY_ARCHIVE_GZIP_INVALID');
  }
});

test('refuses concatenated gzip members, compressed trailing bytes and invalid trailers',()=>{
  const f=fixture();
  const crc=Buffer.from(f.bytes);crc[crc.length-8]^=1;
  const size=Buffer.from(f.bytes);size[size.length-4]^=1;
  for(const bytes of [Buffer.concat([f.bytes,gzipSync(Buffer.alloc(1024))]),Buffer.concat([f.bytes,Buffer.from([0])]),crc,size])refused(bytes,{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length},'LEGACY_ARCHIVE_GZIP_INVALID');
});

test('refuses non-octal, base-256 and out-of-bounds declared tar sizes',()=>{
  const f=fixture();
  for(const value of [Buffer.from('8'.padStart(11,'0')+'\0'),Buffer.from([128,...Array(11).fill(0)]),Buffer.from('77777777777\0')]){
    const source=tar(f.entries);value.copy(source,124);source.fill(32,148,156);
    source.write(source.subarray(0,512).reduce((sum,byte)=>sum+byte,0).toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');
    const bytes=gzipSync(source);assert.throws(()=>verify(bytes,{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length}),error=>['LEGACY_ARCHIVE_TAR_INVALID','LEGACY_ARCHIVE_LIMIT'].includes(error.code));
  }
});

test('reads intrinsic byte storage without invoking callbacks attached to input bytes',()=>{
  const f=fixture(),bytes=new Uint8Array(f.bytes);let called=false;
  Object.defineProperty(bytes,'length',{get(){called=true;throw Error('input getter invoked');}});
  Object.defineProperty(bytes,'buffer',{get(){called=true;throw Error('input getter invoked');}});
  assert.equal(verify(bytes,f.options).memberCount,30);assert.equal(called,false);
  refused(Buffer.alloc(1024*1024+1),f.options,'LEGACY_ARCHIVE_LIMIT');
});

test('enforces independent compressed, inflated and member bounds',()=>{
  const f=fixture();
  for(const limits of [{maxCompressedBytes:32},{maxInflatedBytes:1024},{maxMemberBytes:16}])refused(f.bytes,{...f.options,limits},'LEGACY_ARCHIVE_LIMIT');
  refused(f.bytes,{...f.options,limits:{maxInflatedBytes:64*1024*1024}},'LEGACY_ARCHIVE_POLICY_INVALID');
  const bytes=gzipSync(Buffer.alloc(5*1024*1024));refused(bytes,{...f.options,expectedSha256:sha(bytes),expectedBytes:bytes.length},'LEGACY_ARCHIVE_LIMIT');
});

test('refuses incomplete policy, ambiguous manifests and callback-bearing policy objects',()=>{
  const f=fixture();
  for(const options of [{...f.options,memberManifest:f.options.memberManifest.slice(1)},{...f.options,memberManifest:f.options.memberManifest.map((row,index)=>index===1?{...row,path:f.options.memberManifest[0].path}:row)},{...f.options,protocolSha256:{}},{...f.options,expectedInstalledBuild:'not a hash'}])refused(f.bytes,options,'LEGACY_ARCHIVE_POLICY_INVALID');
  let called=false;const options={...f.options};Object.defineProperty(options,'expectedSha256',{get(){called=true;return f.options.expectedSha256;},enumerable:true});
  refused(f.bytes,options,'LEGACY_ARCHIVE_POLICY_INVALID');assert.equal(called,false);
  assert.throws(()=>verify(f.bytes,f.options).readMemberBytes('../escape'),{code:'LEGACY_ARCHIVE_MEMBER_UNKNOWN'});
});
