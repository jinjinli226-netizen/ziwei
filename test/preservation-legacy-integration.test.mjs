import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {legacyFixture} from '../test-support/preservation-legacy-source-fixture.mjs';
import {loadApprovedLegacySource} from '../backend/preservation-legacy-integration.mjs';
import {auditLoggerCoverage} from '../backend/preservation-legacy-coverage.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
import {approvedLegacyFixture as approvedFixture} from '../test-support/preservation-approved-legacy-fixture.mjs';

test('approved static references construct the independent coverage callback and bind one original raw action',t=>{
 const f=approvedFixture(t),loaded=loadApprovedLegacySource({binding:f.request.binding,requestBinding:f.requestBinding});
 assert.equal(auditLoggerCoverage({pins:f.authorization.loggerCoverage}).qualified,true,JSON.stringify(auditLoggerCoverage({pins:f.authorization.loggerCoverage}).findings));
 assert(loaded.legacySource);const proof=loaded.legacySource.neverDispatchedProof({productionRequest:f.request,connection:f.connection,action:f.action,state:f.state});
 assert.equal(proof.verified,true);assert.equal(proof.actionId,f.action.id);assert(loaded.files.some(row=>row.path===f.policyPath));assert.equal(loaded.guardPolicy.actionDigest,f.authorization.subject.actionDigest);assert.equal(loaded.guardPolicy.authorizationDigest,proof.authorizationDigest);
});
test('missing policy has no default exception and unsigned changed coverage bytes refuse',t=>{
 const f=approvedFixture(t);assert.equal(loadApprovedLegacySource({binding:{...f.request.binding,nativeSourceRefs:[]},requestBinding:f.requestBinding}).legacySource,null);
 fs.appendFileSync(f.authorization.loggerCoverage.callRecords.path,' ');assert.throws(()=>loadApprovedLegacySource({binding:f.request.binding,requestBinding:f.requestBinding}));
});
for(const change of [f=>{f.refs.pop();},f=>{f.request.binding.hostId='other';},f=>{f.refs[0].actionId='other';},f=>{f.refs[1].sha256='f'.repeat(64);}])test('finite policy cannot authorize a foreign host/action or absent/changed evidence ref',t=>{const f=approvedFixture(t);change(f);assert.throws(()=>loadApprovedLegacySource({binding:f.request.binding,requestBinding:f.requestBinding}));});
