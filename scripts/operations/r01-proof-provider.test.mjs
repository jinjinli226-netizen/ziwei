import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let api={};try{api=await import('./r01-proof-provider.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const specHash='a'.repeat(64),dbId={path:'owned-db',identity:'b'.repeat(64)};
const request=()=>({challenge:crypto.randomBytes(32).toString('hex'),operationId:'fixture-op',specHash,databaseIdentity:dbId,freezeDigest:'c'.repeat(64),actionProjection:{digest:'d'.repeat(64)},requiredHosts:['win-host','api-host']});
const trust=()=>({schemaVersion:1,hosts:{'win-host':{hostId:'win-host',collectorSha256:'e'.repeat(64)},'api-host':{hostId:'api-host',collectorSha256:'f'.repeat(64)}}});
function create(options={}){assert.equal(typeof api.createProofProvider,'function','trusted provider is not implemented');return api.createProofProvider({trust:trust(),runTransport:async(host,input)=>({fixture:true,hostId:host.hostId,stage:input.stage,request:input.request}),verifyEnvelope:async(value,context)=>value.fixture===true&&value.hostId===context.host.hostId&&JSON.stringify(value.request)===JSON.stringify(context.request),...options});}

test('forwards both hosts and exact product request without manufacturing safe',async()=>{const provider=create(),input=request(),proofs=await provider.collect(input);assert.equal(proofs.length,2);assert.deepEqual(proofs.map(p=>p.hostId),input.requiredHosts);assert.deepEqual(proofs[0].request,input);assert.equal('safe' in proofs[0],false);});
test('missing independently trusted host rejects before any transport',async()=>{let calls=0;const provider=create({trust:{schemaVersion:1,hosts:{}} ,runTransport:async()=>{calls++;}});await assert.rejects(provider.collect(request()),{code:'OPS_HOST_NOT_TRUSTED'});assert.equal(calls,0);});
test('requires explicit trusted product envelope verifier',()=>{assert.equal(typeof api.createProofProvider,'function');assert.throws(()=>api.createProofProvider({trust:trust(),runTransport:async()=>({})}),{code:'OPS_VERIFIER_REQUIRED'});});
test('duplicate required host refuses rather than double execution',async()=>{const provider=create(),input=request();input.requiredHosts=['win-host','win-host'];await assert.rejects(provider.collect(input),{code:'OPS_REQUIRED_HOSTS_INVALID'});});
test('challenge replay after successful collection rejects',async()=>{const provider=create(),input=request();await provider.collect(input);await assert.rejects(provider.collect(input),{code:'OPS_CHALLENGE_REUSED'});});
test('challenge stays consumed when transport times out; no automatic retry',async()=>{let calls=0;const provider=create({runTransport:async()=>{calls++;throw Object.assign(new Error('fixture timeout'),{code:'TRANSPORT_TIMEOUT'});}}),input=request();await assert.rejects(provider.collect(input),{code:'TRANSPORT_TIMEOUT'});await assert.rejects(provider.collect(input),{code:'OPS_CHALLENGE_REUSED'});assert.equal(calls,1);});
test('peer signature/binding rejection returns no evidence',async()=>{const provider=create({runTransport:async(host,input)=>({fixture:true,hostId:host.hostId,request:{...input.request,specHash:'0'.repeat(64)}})});await assert.rejects(provider.collect(request()),{code:'OPS_ENVELOPE_REJECTED'});});
test('unknown verifier result cannot default to acceptance',async()=>{const provider=create({verifyEnvelope:async()=>undefined});await assert.rejects(provider.collect(request()),{code:'OPS_ENVELOPE_REJECTED'});});
test('spec-supplied key or trust override refuses before remote dispatch',async()=>{const provider=create(),input=request();input.key='peer-self-key';await assert.rejects(provider.collect(input),{code:'OPS_REQUEST_FIELDS_INVALID'});});
test('recheck binds prior collection and fresh challenge',async()=>{const provider=create(),input=request();const first=await provider.collect(input);const recheck={freshChallenge:crypto.randomBytes(32).toString('hex'),operationId:input.operationId,specHash:input.specHash,databaseIdentity:input.databaseIdentity,freezeDigest:input.freezeDigest,priorEvidenceDigest:api.canonicalDigest(first),requiredHosts:input.requiredHosts};const values=await provider.recheck(recheck);assert.equal(values[0].stage,'recheck');assert.equal(values[0].request.priorEvidenceDigest,recheck.priorEvidenceDigest);});
test('recheck with wrong operation or prior digest refuses',async()=>{const provider=create(),input=request();await provider.collect(input);await assert.rejects(provider.recheck({freshChallenge:crypto.randomBytes(32).toString('hex'),operationId:'other',specHash,databaseIdentity:dbId,freezeDigest:input.freezeDigest,priorEvidenceDigest:'9'.repeat(64),requiredHosts:input.requiredHosts}),{code:'OPS_RECHECK_BINDING_INVALID'});});

test('pinned process transport uses stdin and rejects changed collector',async()=>{
  assert.equal(typeof api.createPinnedProcessTransport,'function','pinned transport is not implemented');
  const directory=fs.mkdtempSync(path.join(root,'.local','ops-transport-'));
  const source=path.join(directory,'collector.mjs');fs.writeFileSync(source,"let input='';for await(const c of process.stdin)input+=c;process.stdout.write(JSON.stringify({request:JSON.parse(input),fixture:true}));");
  const host={hostId:'owned-fixture',transport:{kind:'pinned-process',executable:process.execPath,executableSha256:hash(fs.readFileSync(process.execPath)),entry:source,collectorSha256:hash(fs.readFileSync(source)),cwd:directory,args:[]}};
  const transport=api.createPinnedProcessTransport({privateRoot:directory});const input={stage:'collect',request:request()};
  assert.deepEqual((await transport(host,input)).request,input);
  fs.appendFileSync(source,'\n// changed');await assert.rejects(transport(host,input),{code:'OPS_COLLECTOR_CHANGED'});
});
test('pinned process rejects untrusted shell args and outside private root',async()=>{
  assert.equal(typeof api.createPinnedProcessTransport,'function');const directory=fs.mkdtempSync(path.join(root,'.local','ops-transport-'));
  const transport=api.createPinnedProcessTransport({privateRoot:directory});await assert.rejects(transport({hostId:'wrong',transport:{kind:'shell',entry:'C:/not-owned.mjs'}},{stage:'collect',request:request()}),{code:'OPS_TRANSPORT_KIND_INVALID'});
});

function signedFixture({wrongKey=false,stale=false,alterChallenge=false,tamperSignature=false}={}){
  const directory=fs.mkdtempSync(path.join(root,'.local','ops-hmac-'));fs.mkdirSync(path.join(directory,'trust'));
  const signer=path.join(directory,'trust','source.key'),verifier=path.join(directory,'trust','verifier.key'),key=crypto.randomBytes(32);
  fs.writeFileSync(signer,key,{mode:0o600});fs.writeFileSync(verifier,wrongKey?crypto.randomBytes(32):key,{mode:0o600});
  const sign=(payload,keyFile)=>crypto.createHmac('sha256',fs.readFileSync(keyFile)).update(JSON.stringify(payload)).digest('hex');
  return create({runTransport:async(host,input)=>{
    const payload={hostId:host.hostId,keyId:'fixture-ops-key',algorithm:'HMAC-SHA256',stage:input.stage,request:input.request,issuedAt:Date.now()-(stale?120000:0)};
    if(alterChallenge)payload.request={...payload.request,challenge:crypto.randomBytes(32).toString('hex')};
    return {payload,signature:tamperSignature?'0'.repeat(64):sign(payload,signer)};
  },verifyEnvelope:async(envelope,context)=>{
    if(!envelope.payload||envelope.payload.keyId!=='fixture-ops-key'||envelope.payload.algorithm!=='HMAC-SHA256'||envelope.payload.hostId!==context.host.hostId||envelope.payload.stage!==context.stage||JSON.stringify(envelope.payload.request)!==JSON.stringify(context.request)||Date.now()-envelope.payload.issuedAt>30000)return false;
    const actual=Buffer.from(envelope.signature||'','hex'),expected=Buffer.from(sign(envelope.payload,verifier),'hex');return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);
  }});
}
test('real fixture HMAC uses separate private signer/verifier refs and two fresh challenges',async()=>{const provider=signedFixture(),input=request(),proofs=await provider.collect(input);assert.equal(proofs.length,2);const recheck={freshChallenge:crypto.randomBytes(32).toString('hex'),operationId:input.operationId,specHash,databaseIdentity:dbId,freezeDigest:input.freezeDigest,priorEvidenceDigest:api.canonicalDigest(proofs),requiredHosts:input.requiredHosts};assert.equal((await provider.recheck(recheck)).length,2);assert.equal('key' in proofs[0],false);});
for(const [name,option] of [['wrong independent verifier key',{wrongKey:true}],['stale signed evidence',{stale:true}],['different signed challenge',{alterChallenge:true}],['tampered signature',{tamperSignature:true}]])test(name+' rejects evidence',async()=>{await assert.rejects(signedFixture(option).collect(request()),{code:'OPS_ENVELOPE_REJECTED'});});
