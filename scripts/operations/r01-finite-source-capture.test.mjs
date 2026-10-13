import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeFiniteCapture,recheckFiniteCapture,codeDigest} from './r01-finite-source-capture.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'r01-capture-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const evidence=path.join(root,'evidence');fs.mkdirSync(evidence);
  const producer=path.join(root,'producer.py');fs.writeFileSync(producer,'# isolated fixture\n');
  const code=[{path:producer,sha256:sha(fs.readFileSync(producer))}];
  const descriptor={schemaVersion:1,hostId:'fixture-linux',evidenceDirectory:evidence,
    producer:{id:'r01-finite-source-capture-v1',code,codeDigest:codeDigest(code)},
    namespace:{kind:'systemd-cgroup',service:'fixture.service'},staticReferences:[]};
  const source=path.join(evidence,'source.json');
  fs.writeFileSync(source,JSON.stringify({kind:'r01-linux-source-observation',identityStable:true,
    scope:{workerScopeComplete:null,namespaceComplete:null},serviceActions:0,modelCalls:0,phoneActions:0}));
  const observation={path:source,sha256:sha(fs.readFileSync(source)),kind:'native-observation',scope:'fixture.service'};
  const binding={operationId:'op-fixture',specHash:'a'.repeat(64),challenge:'fixture-fresh-challenge',
    databaseIdentity:{databaseId:'fixture-db'},freezeDigest:'b'.repeat(64),bindingDigest:'c'.repeat(64),
    command:'seal',kind:'collect'};
  return {root,evidence,descriptor,observation,binding};
}
test('baseline preserves missing scope and never creates stopped or signed proof',t=>{
  const f=fixture(t),result=writeFiniteCapture({...f,phase:'baseline-readonly',output:path.join(f.evidence,'capture.json'),binding:null});
  assert.equal(result.capture.controllerStatus,'NOT_RUN');
  assert.equal(result.capture.namespaceComplete,null);assert.equal(result.capture.workerScopeComplete,null);
  assert.equal(result.capture.formalGatePassed,false);assert.equal(result.capture.authentication,'not-performed-by-producer');
  assert.equal(result.capture.binding,null);assert.equal(result.capture.observation.sha256,f.observation.sha256);
});
test('fresh binding changes capture bytes while retained source byte digest remains unchanged',t=>{
  const f=fixture(t);const specBefore=JSON.stringify(f.descriptor);
  const a=writeFiniteCapture({...f,phase:'before-stop',output:path.join(f.evidence,'a.json')});
  const b=writeFiniteCapture({...f,phase:'before-stop',binding:{...f.binding,challenge:'different-fresh-challenge'},output:path.join(f.evidence,'b.json')});
  assert.equal(a.capture.retainedSourceDigest,b.capture.retainedSourceDigest);assert.notEqual(a.sha256,b.sha256);
  assert.equal(JSON.stringify(f.descriptor),specBefore);assert.equal(a.capture.binding.specHash,f.binding.specHash);
});
test('after-stop requires actual controller receipt bytes; receipt alone never proves complete scope',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');
  assert.throws(()=>writeFiniteCapture({...f,phase:'after-stop',output}),/CAPTURE_CONTROLLER_REQUIRED/);
  const file=path.join(f.evidence,'controller.json');fs.writeFileSync(file,JSON.stringify({phase:'stop',outcome:'uncertain'}));
  const controllerReferences=[{path:file,sha256:sha(fs.readFileSync(file)),kind:'controller-receipt',scope:'fixture.service'}];
  const result=writeFiniteCapture({...f,phase:'after-stop',output,controllerReferences});
  assert.equal(result.capture.controllerStatus,'RECORDED_UNVERIFIED');assert.equal(result.capture.namespaceComplete,null);
});
test('changed observation and changed producer refuse before output creation',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');fs.appendFileSync(f.observation.path,' ');
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_REFERENCE_CHANGED/);assert.equal(fs.existsSync(output),false);
  f.observation.sha256=sha(fs.readFileSync(f.observation.path));fs.appendFileSync(f.descriptor.producer.code[0].path,'# changed');
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_PRODUCER_CHANGED/);
});
test('write-once output cannot replace a retained attempt',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');const original=writeFiniteCapture({...f,phase:'before-stop',output});
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_OUTPUT_EXISTS/);
  assert.equal(sha(fs.readFileSync(output)),original.sha256);
});
test('reference outside approved evidence directory refuses even with matching digest',t=>{
  const f=fixture(t),outside=path.join(f.root,'outside.json');fs.writeFileSync(outside,'{}');
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output:path.join(f.evidence,'capture.json'),observation:{...f.observation,path:outside,sha256:sha(fs.readFileSync(outside))}}),/CAPTURE_SCOPE_INVALID/);
});
test('explicit static external artifact pin is retained; unapproved external receipt refuses',t=>{
  const f=fixture(t),file=path.join(f.root,'archive.tgz');fs.writeFileSync(file,'retained fixture archive');
  const reference={path:file,sha256:sha(fs.readFileSync(file)),kind:'legacy-archive',scope:'one-subject-fixture'};
  f.descriptor.staticReferences=[reference];const result=writeFiniteCapture({...f,phase:'before-stop',output:path.join(f.evidence,'capture.json')});
  assert.equal(result.capture.staticReferences[0].sha256,reference.sha256);
  assert.throws(()=>writeFiniteCapture({...f,phase:'after-stop',output:path.join(f.evidence,'bad.json'),controllerReferences:[reference]}),/CAPTURE_SCOPE_INVALID/);
});
test('spec cannot pin a generated capture digest or contain runtime challenge',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');f.descriptor.captureSha256='d'.repeat(64);
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_DESCRIPTOR_INVALID/);
  delete f.descriptor.captureSha256;f.descriptor.namespace.challenge='fresh';
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_CIRCULAR_DESCRIPTOR/);
});
test('nested producer and code references cannot smuggle dynamic spec or capture pins',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');f.descriptor.producer.captureDigest='d'.repeat(64);
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_PRODUCER_INVALID/);
  delete f.descriptor.producer.captureDigest;f.descriptor.producer.code[0].specHash='a'.repeat(64);
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_PRODUCER_INVALID/);
});
test('recheck binds exact retained bytes and complete binding; tamper or wrong instance binding refuses',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');const a=writeFiniteCapture({...f,phase:'before-stop',output});
  assert.equal(recheckFiniteCapture({descriptor:f.descriptor,path:output,sha256:a.sha256,binding:f.binding}).sha256,a.sha256);
  assert.throws(()=>recheckFiniteCapture({descriptor:f.descriptor,path:output,sha256:a.sha256,binding:{...f.binding,bindingDigest:'e'.repeat(64)}}),/CAPTURE_BINDING_CHANGED/);
  fs.appendFileSync(f.observation.path,' ');
  assert.throws(()=>recheckFiniteCapture({descriptor:f.descriptor,path:output,sha256:a.sha256,binding:f.binding}),/CAPTURE_REFERENCE_CHANGED/);
});
test('no request binding means no formal phase; service-action observations refuse',t=>{
  const f=fixture(t),output=path.join(f.evidence,'capture.json');
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output,binding:null}),/CAPTURE_BINDING_REQUIRED/);
  fs.writeFileSync(f.observation.path,JSON.stringify({kind:'r01-linux-source-observation',serviceActions:1,modelCalls:0,phoneActions:0}));
  f.observation.sha256=sha(fs.readFileSync(f.observation.path));
  assert.throws(()=>writeFiniteCapture({...f,phase:'before-stop',output}),/CAPTURE_SOURCE_KIND_INVALID/);
});
