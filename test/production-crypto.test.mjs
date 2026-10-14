import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
let api={};try{api=await import('../backend/production-preservation.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-production-crypto-'));const keyRef=path.join(root,'key');fs.writeFileSync(keyRef,crypto.randomBytes(32),{mode:0o600});return {root,trust:{schemaVersion:1,algorithm:'hmac-sha256',hosts:[{hostId:'fixture-host',keyId:'fixture-key',keyRef,bindingDigest:'a'.repeat(64)}],approvedSpecs:[{operationId:'fixture-operation',specHash:'b'.repeat(64)}],backupHostId:'fixture-host'}};};
test('direct encoder preserves UTF16 key order including numeric-looking keys',()=>{
 assert.equal(typeof api.canonicalProduction,'function');
 assert.equal(api.canonicalProduction({'2':'two','10':'ten',z:{b:2,a:1}}),'{"10":"ten","2":"two","z":{"a":1,"b":2}}');
 assert.equal(api.canonicalProduction({'\ue000':1,'\ud800':2,'😀':3}),'{"\\ud800":2,"😀":3,"":1}');
 assert.equal(api.canonicalProduction([-0,1,null]),'[0,1,null]');
});
test('rejects non-JSON inputs without calling accessors, toJSON or proxies',()=>{
 assert.equal(typeof api.canonicalProduction,'function');let calls=0;
 const getter=Object.defineProperty({},'secret',{get(){calls++;return 1;}});
 const serializer={toJSON(){calls++;return {};}};
 const proxy=new Proxy({}, {ownKeys(){calls++;return [];}});
 const cyclic={};cyclic.self=cyclic;
 const extra=[];extra.hidden=1;
 for(const input of [getter,serializer,proxy,cyclic,extra,[,1],new Date(),new Map(),Object.create({toJSON(){calls++;}}),{[Symbol('x')]:1},{x:Symbol('x')},{x:undefined},{x:NaN},{x:Infinity},{x:1n},()=>1]) assert.throws(()=>api.canonicalProduction(input),{code:'PRODUCTION_NON_JSON'});
 assert.equal(calls,0);
});
test('HMAC uses raw bytes, trust-selected key, exact envelope and expected domain',t=>{
 assert.equal(typeof api.signProductionEnvelope,'function');const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const payload={domain:'ziwei-production-request-v1',command:'seal',challenge:crypto.randomUUID()};
 const envelope=api.signProductionEnvelope({hostId:'fixture-host',payload,trust:f.trust});
 assert.deepEqual(api.verifyProductionEnvelope({envelope,trust:f.trust,expected:payload}),payload);
 assert.equal(envelope.signature,crypto.createHmac('sha256',fs.readFileSync(f.trust.hosts[0].keyRef)).update(api.canonicalProduction(payload)).digest('hex'));
 for(const change of [{algorithm:'none'},{hostId:'attacker'},{keyId:'other'},{signature:envelope.signature.toUpperCase()},{extra:true}]) assert.throws(()=>api.verifyProductionEnvelope({envelope:{...envelope,...change},trust:f.trust,expected:payload}));
 assert.throws(()=>api.verifyProductionEnvelope({envelope,trust:f.trust,expected:{domain:'ziwei-production-backup-proof-v1'}}),{code:'PRODUCTION_PROOF_BINDING'});
 fs.writeFileSync(f.trust.hosts[0].keyRef,crypto.randomBytes(31));assert.throws(()=>api.signProductionEnvelope({hostId:'fixture-host',payload,trust:f.trust}),{code:'PRODUCTION_KEY_INVALID'});
});
