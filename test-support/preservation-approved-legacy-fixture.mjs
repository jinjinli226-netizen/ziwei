import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {legacyFixture} from './preservation-legacy-source-fixture.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function approvedLegacyFixture(t){
 const f=legacyFixture(t),logDir=f.authorization.generation.logDir;
 const producer=path.join(f.root,'inspect.py'),calls=path.join(f.root,'calls.json'),sourceRead=path.join(f.root,'source-read.json');
 const source="import datetime\nfor p in sorted((base/'logs').glob('daemon.log*')):\n pass\nx=datetime.timezone.utc";fs.writeFileSync(producer,source);
 const captured=JSON.parse(fs.readFileSync(f.descriptors.inspect.path));captured.pid=99;captured.actionStates??=[];for(const row of captured.logs)row.finalPath='\\\\?\\'+row.path;
 const capBytes=Buffer.from(JSON.stringify(captured));fs.writeFileSync(f.descriptors.inspect.path,capBytes);Object.assign(f.authorization.artifacts.inspect,{bytes:capBytes.length,sha256:sha(capBytes)});
 const records=[{type:'custom_tool_call',callId:'launch',timestamp:'2026-10-11T17:10:32.000Z',input:'Invoke-CimMethod Win32_Process inspect.py'},{type:'custom_tool_call_output',callId:'launch',output:'{"script":"inspect.py","returnValue":0,"readerPID":99}'},{type:'custom_tool_call',callId:'read',timestamp:'2026-10-11T17:10:34.000Z',input:'Get-Content result.json | ConvertFrom-Json | ConvertTo-Json'},{type:'custom_tool_call_output',callId:'read',output:JSON.stringify({readerPID:99,captureUTC:captured.captureUTC,logCount:2,actionStateCount:1,errorType:null})}];
 records.push({type:'custom_tool_call',callId:'copy',input:'Copy-Item approved-source/inspect.py approved-target'});
 const sourceRecords=[{type:'custom_tool_call',callId:'code',input:'Get-Content inspect.py'},{type:'custom_tool_call_output',callId:'code',output:source}];
 fs.writeFileSync(calls,JSON.stringify(records));fs.writeFileSync(sourceRead,JSON.stringify(sourceRecords));
 const descriptor=file=>({path:file,sourcePath:file,sha256:sha(fs.readFileSync(file)),bytes:fs.statSync(file).size});
 f.authorization.loggerCoverage={producer:descriptor(producer),capture:f.descriptors.inspect,callRecords:descriptor(calls),codeReadCallRecords:descriptor(sourceRead),loggerStart:f.descriptors.loggerStart,loggerEnd:f.descriptors.loggerEnd,logDir,originalPid:f.authorization.generation.pid,actionId:f.action.id,actionCreatedAt:f.action.created_at,generation:f.authorization.generation};
 f.authorization.loggerCoverage.sourceRelation={producerRead:{callId:'code',inputSha256:sha(sourceRecords[0].input)},copy:{callId:'copy',inputSha256:sha(records.find(row=>row.callId==='copy').input)},launch:{callId:'launch',inputSha256:sha(records[0].input)},resultRead:{callId:'read',inputSha256:sha(records[2].input)}};
 const policyPath=path.join(f.root,'policy.json');fs.writeFileSync(policyPath,JSON.stringify(f.authorization));
 const binding=f.request.binding,original=binding.clients[0];const refs=[];
 const ref=(kind,file)=>({kind,canonicalPath:file.path,sha256:file.sha256,actionId:f.action.id});
 refs.push(ref('legacy-action-assessment',descriptor(policyPath)));
 for(const [role,file] of Object.entries(f.authorization.artifacts))refs.push(ref(role==='archive'?'legacy-source-archive':role==='cache'?'legacy-action-cache':role.startsWith('logger')?'legacy-action-logger':'legacy-action-assessment',file));
 for(const role of ['producer','callRecords','codeReadCallRecords'])refs.push(ref('legacy-source-code',f.authorization.loggerCoverage[role]));
 binding.nativeSourceRefs=refs;binding.deviceIds=[f.authorization.deviceId];binding.workspaceIds=[f.authorization.workspaceId];binding.hostId=f.authorization.hostId;
 return{...f,policyPath,refs};
}
