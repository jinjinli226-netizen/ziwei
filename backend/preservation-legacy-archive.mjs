import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {types} from 'node:util';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const caps=Object.freeze({maxCompressedBytes:1024*1024,maxInflatedBytes:4*1024*1024,maxMemberBytes:1024*1024});
const fixedBuildFiles=Object.freeze(['package.json','backend/a2a-auth.mjs','scripts/ziwei-user.mjs','scripts/ziwei-cli.mjs','scripts/start-ziwei-user.mjs','scripts/ziwei-mcp.mjs','scripts/ziwei-terminal-mcp.mjs','scripts/client-lifecycle.mjs','scripts/client-maintenance-helper.mjs','scripts/client-update.mjs','scripts/client-update-worker.mjs']);
const protocolFiles=Object.freeze(['src/management-bootstrap.mjs','daemon/ziwei_user.mjs','src/daemon.mjs','src/daemon-action-scheduler.mjs','src/local-action.mjs','src/runtime-adapters.mjs']);
const typedArrayPrototype=Object.getPrototypeOf(Uint8Array.prototype);
const storageGetters=Object.fromEntries(['buffer','byteOffset','byteLength'].map(key=>[key,Object.getOwnPropertyDescriptor(typedArrayPrototype,key).get]));
function fields(value,required,optional=[]){
  if(!value||types.isProxy(value)||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(required.some(key=>!Object.hasOwn(descriptors,key))||keys.some(key=>typeof key!=='string'||![...required,...optional].includes(key)||!Object.hasOwn(descriptors[key],'value')))fail('LEGACY_ARCHIVE_POLICY_INVALID');
  return Object.fromEntries(keys.map(key=>[key,descriptors[key].value]));
}
function dense(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('LEGACY_ARCHIVE_POLICY_INVALID');
  if(Object.getOwnPropertyDescriptor(value,'length').value!==30)fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const descriptors=Object.getOwnPropertyDescriptors(value),length=descriptors.length.value;
  if(Reflect.ownKeys(descriptors).length!==length+1)fail('LEGACY_ARCHIVE_POLICY_INVALID');
  return Array.from({length},(_,index)=>{
    const descriptor=descriptors[String(index)];if(!descriptor||!Object.hasOwn(descriptor,'value'))fail('LEGACY_ARCHIVE_POLICY_INVALID');return descriptor.value;
  });
}
function safePath(value){
  if(typeof value!=='string'||!value||value.length>255||!/^[A-Za-z0-9._/-]+$/.test(value))return false;
  return value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!part.endsWith('.')&&!/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
function policy(input){
  const value=fields(input,['expectedSha256','expectedBytes','memberManifest','protocolSha256','expectedInstalledBuild'],['limits']);
  if(!hex(value.expectedSha256)||!hex(value.expectedInstalledBuild)||!Number.isSafeInteger(value.expectedBytes)||value.expectedBytes<1)fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const limits={...caps};
  if(value.limits!==undefined)for(const [key,bound] of Object.entries(fields(value.limits,[],Object.keys(caps)))){
    if(!Number.isSafeInteger(bound)||bound<1||bound>caps[key])fail('LEGACY_ARCHIVE_POLICY_INVALID');limits[key]=bound;
  }
  if(value.expectedBytes>limits.maxCompressedBytes)fail('LEGACY_ARCHIVE_LIMIT');
  const manifest=dense(value.memberManifest),names=new Set(),folded=new Set();
  if(manifest.length!==30)fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const members=manifest.map(entry=>{
    const row=fields(entry,['path','bytes','sha256']);
    if(!safePath(row.path)||!hex(row.sha256)||!Number.isSafeInteger(row.bytes)||row.bytes<0||names.has(row.path)||folded.has(row.path.toLowerCase()))fail('LEGACY_ARCHIVE_POLICY_INVALID');
    if(row.bytes>limits.maxMemberBytes)fail('LEGACY_ARCHIVE_LIMIT');
    names.add(row.path);folded.add(row.path.toLowerCase());return Object.freeze(row);
  }).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  if([...fixedBuildFiles,...protocolFiles].some(name=>!names.has(name)))fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const protocols=fields(value.protocolSha256,protocolFiles);
  if(Object.values(protocols).some(value=>!hex(value)))fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const minimumTarBytes=1024+members.reduce((sum,row)=>sum+512+Math.ceil(row.bytes/512)*512,0);
  if(minimumTarBytes>limits.maxInflatedBytes)fail('LEGACY_ARCHIVE_LIMIT');
  return {expectedSha256:value.expectedSha256,expectedBytes:value.expectedBytes,expectedInstalledBuild:value.expectedInstalledBuild,members,protocols,limits};
}
function crc32(bytes){
  let value=0xffffffff;
  for(const byte of bytes){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}
  return (value^0xffffffff)>>>0;
}
function inflate(bytes,limit){
  // The reviewed package has one plain gzip member. Refuse optional header
  // extensions and prove deflate consumes exactly the bytes before its trailer.
  if(bytes.length<18||bytes[0]!==31||bytes[1]!==139||bytes[2]!==8||bytes[3]!==0)fail('LEGACY_ARCHIVE_GZIP_INVALID');
  let result;
  try{result=inflateRawSync(bytes.subarray(10,-8),{maxOutputLength:limit,info:true});}
  catch(error){fail(error.code==='ERR_BUFFER_TOO_LARGE'?'LEGACY_ARCHIVE_LIMIT':'LEGACY_ARCHIVE_GZIP_INVALID');}
  if(result.engine.bytesWritten!==bytes.length-18||result.buffer.length!==bytes.readUInt32LE(bytes.length-4)||crc32(result.buffer)!==bytes.readUInt32LE(bytes.length-8))fail('LEGACY_ARCHIVE_GZIP_INVALID');
  return result.buffer;
}
function tarString(bytes){
  const end=bytes.indexOf(0),text=(end<0?bytes:bytes.subarray(0,end)).toString('latin1');
  if(end>=0&&!bytes.subarray(end).every(byte=>byte===0))fail('LEGACY_ARCHIVE_TAR_INVALID');
  return text;
}
function octal(bytes){
  const text=bytes.toString('latin1');
  if(!/^ *[0-7]+[\0 ]*$/.test(text))fail('LEGACY_ARCHIVE_TAR_INVALID');
  const value=Number.parseInt(text.trim().replace(/[\0 ]+$/,''),8);
  if(!Number.isSafeInteger(value)||value<0)fail('LEGACY_ARCHIVE_TAR_INVALID');return value;
}
function unpack(tar,approved){
  if(tar.length%512!==0)fail('LEGACY_ARCHIVE_TAR_INVALID');
  const expected=new Map(approved.members.map(row=>[row.path,row])),members=new Map(),folded=new Set();let offset=0,ended=false;
  while(offset+512<=tar.length){
    const header=tar.subarray(offset,offset+512);
    if(header.every(byte=>byte===0)){
      if(tar.length-offset!==1024||!tar.subarray(offset).every(byte=>byte===0))fail('LEGACY_ARCHIVE_TAR_INVALID');ended=true;break;
    }
    if(members.size>=30||!header.subarray(257,263).equals(Buffer.from('ustar\0'))||!header.subarray(263,265).equals(Buffer.from('00'))||![0,48].includes(header[156])||!header.subarray(157,257).every(byte=>byte===0)||!header.subarray(500).every(byte=>byte===0))fail('LEGACY_ARCHIVE_TAR_INVALID');
    const checksum=octal(header.subarray(148,156)),actual=header.reduce((sum,byte,index)=>sum+(index>=148&&index<156?32:byte),0);
    if(checksum!==actual)fail('LEGACY_ARCHIVE_TAR_INVALID');
    for(const [start,end] of [[100,108],[136,148]])octal(header.subarray(start,end));
    // npm's portable tar leaves uid/gid all NUL; these never affect file bytes.
    for(const [start,end] of [[108,116],[116,124]])if(!header.subarray(start,end).every(byte=>byte===0))octal(header.subarray(start,end));
    const name=tarString(header.subarray(0,100)),prefix=tarString(header.subarray(345,500)),full=prefix?prefix+'/'+name:name;
    if(!full.startsWith('package/'))fail('LEGACY_ARCHIVE_TAR_INVALID');
    const relative=full.slice(8),size=octal(header.subarray(124,136)),record=expected.get(relative);
    if(!safePath(relative)||members.has(relative)||folded.has(relative.toLowerCase())||!record)fail('LEGACY_ARCHIVE_TAR_INVALID');
    if(size>approved.limits.maxMemberBytes)fail('LEGACY_ARCHIVE_LIMIT');
    const start=offset+512,end=start+size,next=start+Math.ceil(size/512)*512;
    if(next>tar.length||!tar.subarray(end,next).every(byte=>byte===0))fail('LEGACY_ARCHIVE_TAR_INVALID');
    const body=tar.subarray(start,end);
    if(size!==record.bytes||sha(body)!==record.sha256)fail('LEGACY_ARCHIVE_MEMBER_MISMATCH');
    members.set(relative,Buffer.from(body));folded.add(relative.toLowerCase());offset=next;
  }
  if(!ended||members.size!==30)fail('LEGACY_ARCHIVE_TAR_INVALID');return members;
}
function build(members,installed){
  // Copied from the reviewed rule as an algorithm, never imported/executed
  // from archive source: default JS sort, relative path/NUL/raw bytes/NUL.
  const names=[...new Set([...fixedBuildFiles,...[...members.keys()].filter(name=>/^(daemon|src)\/.*\.(mjs|py)$/.test(name))])].sort(),hash=createHash('sha256');
  for(const name of names){
    let bytes=members.get(name);
    if(installed&&name==='scripts/ziwei-user.mjs'&&bytes.subarray(0,2).equals(Buffer.from('#!'))){
      const end=bytes.indexOf(10);if(end>=0&&bytes[end-1]===13)bytes=Buffer.concat([bytes.subarray(0,end-1),bytes.subarray(end)]);
    }
    hash.update(name).update('\0').update(bytes).update('\0');
  }
  return hash.digest('hex');
}

/** Code-only byte verifier. It never opens paths, extracts files or executes
 * package code. Pins must come from an independently approved caller policy. */
export function verifyLegacyArchive(archiveBytes,parameters){
  const approved=policy(parameters);
  if(!types.isUint8Array(archiveBytes))fail('LEGACY_ARCHIVE_POLICY_INVALID');
  const length=storageGetters.byteLength.call(archiveBytes);
  if(length>approved.limits.maxCompressedBytes)fail('LEGACY_ARCHIVE_LIMIT');
  const bytes=Buffer.from(new Uint8Array(storageGetters.buffer.call(archiveBytes),storageGetters.byteOffset.call(archiveBytes),length));
  if(bytes.length!==approved.expectedBytes||sha(bytes)!==approved.expectedSha256)fail('LEGACY_ARCHIVE_PIN_MISMATCH');
  const tar=inflate(bytes,approved.limits.maxInflatedBytes),members=unpack(tar,approved),protocols=[];
  for(const name of protocolFiles){
    const body=members.get(name),normalized=Buffer.from(body.toString('utf8').replace(/\r\n/g,'\n'));
    if(sha(normalized)!==approved.protocols[name])fail('LEGACY_ARCHIVE_PROTOCOL_MISMATCH');
    protocols.push(Object.freeze({path:name,bytes:body.length,sha256:sha(body),normalizedSha256:sha(normalized)}));
  }
  const sourceBuild=build(members,false),installedBuild=build(members,true);
  if(installedBuild!==approved.expectedInstalledBuild)fail('LEGACY_ARCHIVE_BUILD_MISMATCH');
  const manifest=Object.freeze(approved.members),protocolMetadata=Object.freeze(protocols);
  const policyDigest=sha(JSON.stringify({archiveSha256:approved.expectedSha256,archiveBytes:approved.expectedBytes,members:manifest,protocols:protocolMetadata,installedBuild,limits:approved.limits}));
  const readMemberBytes=name=>{
    if(typeof name!=='string'||!members.has(name))fail('LEGACY_ARCHIVE_MEMBER_UNKNOWN');return Buffer.from(members.get(name));
  };
  Object.freeze(readMemberBytes);
  return Object.freeze({schemaVersion:1,kind:'legacy-source-archive-v1',archiveSha256:sha(bytes),archiveBytes:bytes.length,tarBytes:tar.length,memberCount:members.size,memberBytes:manifest.reduce((sum,row)=>sum+row.bytes,0),sourceBuild,installedBuild,policyDigest,members:manifest,protocols:protocolMetadata,readMemberBytes});
}
