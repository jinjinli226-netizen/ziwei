/** Independent finite logger coverage verifier, separate from the E02 action
 * interpreter. It verifies bytes and the original producer/call/output link;
 * analysis JSON coverage flags and current counters have no authority.
 */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// Exact legacy encoder used by the E02 coverage candidate. Pins come from the
// independent approved source policy, never from candidate coverage flags.
const legacyDigest=value=>sha(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const json=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,''));
function plainRead(file){if(!path.isAbsolute(file)||path.resolve(file)!==file)fail('LOGGER_PATH');for(let p=file;;p=path.dirname(p)){if(fs.lstatSync(p).isSymbolicLink())fail('LOGGER_PATH');if(p===path.dirname(p))break;}if(fs.realpathSync.native(file).toLowerCase()!==file.toLowerCase())fail('LOGGER_PATH');const before=fs.lstatSync(file,{bigint:true});if(!before.isFile()||before.nlink!==1n||before.size>16n*1024n*1024n)fail('LOGGER_PATH');const bytes=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeNs!==after.mtimeNs)fail('LOGGER_PATH');return bytes;}
function readPin(ref,readBytes){const bytes=Buffer.from(readBytes(ref.path));if(bytes.length!==ref.bytes||sha(bytes)!==ref.sha256)fail('LOGGER_PIN_CHANGED');return bytes;}
function objects(text){
 const out=[];for(let start=text.indexOf('{'),count=0;start>=0&&count<256;start=text.indexOf('{',start+1),count++){
  let depth=0,quoted=false,escaped=false;
  for(let end=start;end<text.length;end++){const char=text[end];if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false;continue;}if(char==='"')quoted=true;else if(char==='{')depth++;else if(char==='}'&&--depth===0){try{out.push(JSON.parse(text.slice(start,end+1)));}catch{}break;}}
 }return out;
}
function outputTexts(record){const texts=[];function visit(value,depth=0){if(depth>12)return;if(typeof value==='string'){texts.push(value);try{visit(JSON.parse(value),depth+1);}catch{}}else if(Array.isArray(value))value.forEach(item=>visit(item,depth+1));else if(value&&typeof value==='object')Object.values(value).forEach(item=>visit(item,depth+1));}visit(record.output);return texts;}
function normalized(value){if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value)))return new Date(value).toISOString();if(Array.isArray(value))return value.map(normalized);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,normalized(item)]));return value;}
const equal=(a,b)=>JSON.stringify(normalized(a))===JSON.stringify(normalized(b));
function strictLog(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');if(text&&!text.endsWith('\n'))fail('LOGGER_RECORD_BOUNDARY');
 const lines=text.split('\n');lines.pop();return lines.map(line=>{if(!line.trim())fail('LOGGER_EMPTY_RECORD');const value=JSON.parse(line);if(!value||Array.isArray(value)||typeof value!=='object'||typeof value.at!=='string'||!Number.isFinite(Date.parse(value.at)))fail('LOGGER_RECORD_INVALID');return value;});
}
export function auditLoggerCoverage({pins,readBytes=plainRead,candidate=null}){
 try{
  const producer=readPin(pins.producer,readBytes),capturedBytes=readPin(pins.capture,readBytes),recordsBytes=readPin(pins.callRecords,readBytes),captured=json(capturedBytes),records=json(recordsBytes),code=producer.toString('utf8');
  const findings=[];
  const relation=pins.sourceRelation,exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
  const roles=['producerRead','copy','launch','resultRead'];
  if(!exact(relation,roles)||roles.some(role=>!exact(relation[role],['callId','inputSha256'])||typeof relation[role].callId!=='string'||!relation[role].callId||!/^[a-f0-9]{64}$/.test(relation[role].inputSha256))||new Set(roles.map(role=>relation?.[role]?.callId)).size!==4)fail('LOGGER_CALL_BINDING');
  const codeRecords=json(readPin(pins.codeReadCallRecords,readBytes));
  for(const role of roles){const input=relation[role],selected=(role==='producerRead'?codeRecords:records).filter(row=>row.type==='custom_tool_call'&&row.callId===input.callId);if(selected.length!==1||typeof selected[0].input!=='string'||sha(selected[0].input)!==input.inputSha256)fail('LOGGER_CALL_BINDING');}
  const copyCall=records.find(row=>row.type==='custom_tool_call'&&row.callId===relation.copy.callId);if(!copyCall.input.includes('Copy-Item'))fail('LOGGER_CALL_BINDING');
  const fullGlob=code.includes("sorted((base/'logs').glob('daemon.log*'))")&&!/\b(?:islice|limit)\b|glob\([^\n]+\)\s*\[:/.test(code);
  if(!fullGlob)findings.push('PRODUCER_ENUMERATION_NOT_QUALIFIED');if(Object.hasOwn(captured,'error'))findings.push('CAPTURE_PARTIAL_ERROR');
  const launched=records.filter(row=>row.type==='custom_tool_call'&&typeof row.input==='string'&&row.input.includes('Invoke-CimMethod')&&row.input.includes('Win32_Process')&&row.input.includes('inspect.py'));
  const launchOutputs=records.filter(row=>row.type==='custom_tool_call_output'&&launched.some(call=>call.callId===row.callId)).flatMap(outputTexts).flatMap(objects).filter(value=>value.script==='inspect.py');
  const invocationLinked=launched.length===1&&launchOutputs.length===1&&launchOutputs[0].returnValue===0&&launchOutputs[0].readerPID===captured.pid;
  if(!invocationLinked)findings.push('INVOCATION_OUTPUT_PID_UNLINKED');
  const reads=records.filter(row=>row.type==='custom_tool_call'&&typeof row.input==='string'&&row.input.includes('result.json')&&row.input.includes('Get-Content'));
  const observed=records.filter(row=>row.type==='custom_tool_call_output'&&reads.some(call=>call.callId===row.callId)).flatMap(outputTexts).flatMap(objects);
  const summary=observed.find(value=>value.readerPID===captured.pid&&value.logCount===captured.logs?.length&&value.actionStateCount===captured.actionStates?.length&&value.errorType===null&&Date.parse(value.captureUTC)===Date.parse(captured.captureUTC));
  const full=observed.filter(value=>value.pid===captured.pid&&Array.isArray(value.logs)&&Array.isArray(value.actionStates)&&equal(value,captured));
  // A documented console conversion can qualify the whole decoded capture
  // relation; a small summary only proves its own fields, never file inventory.
  const converted=reads.some(call=>call.input.includes('ConvertFrom-Json')&&call.input.includes('ConvertTo-Json'));
  let sourceAtCallLinked=false;
  if(pins.codeReadCallRecords){
   const normalCode=code.replace(/\r\n?/g,'\n').trim();
   const calls=codeRecords.filter(row=>row.type==='custom_tool_call'&&row.input?.includes('Get-Content')&&row.input?.includes('inspect.py'));
   sourceAtCallLinked=calls.length===1&&codeRecords.filter(row=>row.type==='custom_tool_call_output'&&row.callId===calls[0].callId).flatMap(outputTexts).some(text=>text.replace(/\r\n?/g,'\n').includes(normalCode));
  }
  const launchAt=launched.length===1?Date.parse(launched[0].timestamp):NaN,readAt=reads.length===1?Date.parse(reads[0].timestamp):NaN,captureAt=Date.parse(captured.captureUTC);
  const originalReadWindow=Number.isFinite(launchAt)&&Number.isFinite(readAt)&&launchAt<=captureAt&&captureAt<=readAt;
  const rawUtcCompatible=typeof captured.captureUTC==='string'&&captured.captureUTC.endsWith('+00:00')&&code.includes('datetime.timezone.utc');
  // Exact approved raw capture + contemporaneous inspected source, actual WMI
  // PID and the subsequent same-file summary can establish this finite source
  // link. The observed +08 console display is normalized only for those fields;
  // it is never alleged to be the raw persisted file or a full stdout object.
  const rawProducerLinked=sourceAtCallLinked&&originalReadWindow&&rawUtcCompatible&&Boolean(summary)&&invocationLinked;
  const representationLinked=full.length===1&&(JSON.stringify(full[0])===JSON.stringify(captured)||converted)||rawProducerLinked;
  if(!representationLinked)findings.push('FULL_CAPTURE_REPRESENTATION_LINK_UNPROVEN');
  if(!Array.isArray(captured.logs)||captured.logs.length!==2||new Set(captured.logs.map(row=>row.path)).size!==2||captured.logs.some(row=>row.finalPath!=='\\\\?\\'+row.path))findings.push('CAPTURE_NATIVE_INVENTORY_INVALID');
  const first=readPin(pins.loggerStart,readBytes),last=readPin(pins.loggerEnd,readBytes),firstRows=strictLog(first),lastRows=strictLog(last);
  const activeSourcePath=path.win32.join(pins.logDir,'daemon.log');
  const rotationTimes=[pins.loggerStart,pins.loggerEnd].map(ref=>{
   if(path.win32.dirname(ref.sourcePath)!==pins.logDir||!/^daemon\.log\.\d+$/.test(path.win32.basename(ref.sourcePath)))fail('LOGGER_SOURCE_PATH');
   const value=Number(path.win32.basename(ref.sourcePath).slice('daemon.log.'.length));if(!Number.isSafeInteger(value)||value<=0)fail('LOGGER_SOURCE_PATH');return value;
  });
  if(!(rotationTimes[0]<=captureAt&&captureAt<rotationTimes[1]))fail('LOGGER_ROTATION_RELATION');
  const active=captured.logs?.find(row=>row.path===activeSourcePath),rotation=captured.logs?.find(row=>row.path===pins.loggerStart.sourcePath);
  if(!active||!rotation||rotation.bytes!==first.length||Date.parse(rotation.lastAt)!==Date.parse(firstRows.at(-1)?.at)||!Number.isSafeInteger(active.bytes)||active.bytes<1||active.bytes>last.length)fail('LOGGER_CAPTURE_BYTE_RELATION');
  const prefix=last.subarray(0,active.bytes),prefixRows=strictLog(prefix);
  if(Date.parse(prefixRows.at(-1)?.at)!==Date.parse(active.lastAt))fail('LOGGER_CAPTURE_LAST_AT');
  const all=[...firstRows,...lastRows],sameBoot=all.filter(row=>row.pid===pins.originalPid),bootStarts=sameBoot.filter(row=>row.event==='started'),bootExits=sameBoot.filter(row=>row.event==='exited');
  const subject=all.filter(row=>row.actionId===pins.actionId);
  if(bootStarts.length!==1||bootExits.length!==1||Date.parse(bootStarts[0].at)>Date.parse(pins.actionCreatedAt)||Date.parse(bootExits[0].at)<Date.parse(pins.actionCreatedAt)||subject.length!==1||subject[0].pid!==pins.originalPid||subject[0].event!=='a2a_action_failed')findings.push('LOGGER_ORIGINAL_BOOT_OR_SUBJECT_INVALID');
  if(candidate){
   const loggerDigest=legacyDigest([pins.loggerStart,pins.loggerEnd].map((ref,index)=>({path:ref.sourcePath,sha256:sha([first,last][index]),bytes:[first,last][index].length})));
   if(!pins.generation||pins.generation.pid!==pins.originalPid||pins.generation.logDir!==pins.logDir||candidate.historicalGenerationDigest!==legacyDigest(pins.generation)||candidate.loggerDigest!==loggerDigest||candidate.kind!=='legacy-logger-coverage-v1'||candidate.logDir!==pins.logDir||candidate.capture.path!==pins.capture.sourcePath||candidate.capture.sha256!==pins.capture.sha256||candidate.capture.bytes!==capturedBytes.length||!equal(candidate.capture.captureUTC,captured.captureUTC)||!equal(candidate.capture.entries,[...captured.logs].map(row=>({path:row.path,bytes:row.bytes})).sort((a,b)=>a.path.localeCompare(b.path)))||candidate.activePrefixSha256!==sha(prefix)||candidate.chain.length!==2||candidate.chain.some((row,index)=>row.path!==[pins.loggerStart,pins.loggerEnd][index].sourcePath||row.sha256!==[pins.loggerStart,pins.loggerEnd][index].sha256||row.bytes!==[first,last][index].length||row.rotationAt!==rotationTimes[index]))findings.push('CANDIDATE_INPUT_CHANGED');
  }
  return{schemaVersion:1,kind:'r01-logger-coverage-qualification',qualified:findings.length===0,findings,
   producerSha256:sha(producer),captureSha256:sha(capturedBytes),callRecordsSha256:sha(recordsBytes),fullGlobSourceRule:fullGlob,invocationLinked,
   normalizedSummaryLinked:Boolean(summary),normalizedFullCaptureLinked:full.length===1,rawProducerCaptureLinked:rawProducerLinked,sourceAtCallLinked,originalReadWindow,rawUtcCompatible,observedNormalizationScope:full.length?'whole-capture-decoded-object':summary?'summary-fields-only':'none',rawStdoutByteIdentityClaimed:false,
   loggerRecords:{first:firstRows.length,last:lastRows.length,activePrefix:prefixRows.length,strictUtf8:true,invalidJson:0,skippedRecords:0},activePrefixSha256:sha(prefix),originalBootRecords:sameBoot.length,subjectRecords:subject.length,
   originalActionProofMinted:false,namespaceComplete:null};
 }catch(error){return{schemaVersion:1,kind:'r01-logger-coverage-qualification',qualified:false,findings:[/^LOGGER_[A-Z_]+$/.test(error.code||'')?error.code:'LOGGER_RAW_SOURCE_REFUSED'],originalActionProofMinted:false,namespaceComplete:null};}
}
export function createLoggerCoverageVerifier({pins,readBytes=plainRead}){
 const approved=JSON.parse(JSON.stringify(pins));return candidate=>{
  if(!candidate||typeof candidate!=='object'||Array.isArray(candidate)||Object.getPrototypeOf(candidate)!==Object.prototype||candidate.kind!=='legacy-logger-coverage-v1')return false;
  const keys=['schemaVersion','kind','logDir','historicalGenerationDigest','capture','chain','activePrefixSha256','loggerDigest'];
  if(Object.keys(candidate).length!==keys.length||keys.some(key=>!Object.hasOwn(candidate,key))||candidate.schemaVersion!==1||!/^([a-f0-9]{64})$/.test(candidate.historicalGenerationDigest||'')||!/^([a-f0-9]{64})$/.test(candidate.loggerDigest||''))return false;
  const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).length===fields.length&&fields.every(key=>Object.hasOwn(value,key));
  if(!exact(candidate.capture,['path','sha256','bytes','captureUTC','entries'])||!Array.isArray(candidate.capture.entries)||candidate.capture.entries.length!==2||!Array.isArray(candidate.chain)||candidate.chain.length!==2)return false;
  for(let index=0;index<2;index++)if(!Object.hasOwn(candidate.chain,index)||!exact(candidate.chain[index],['path','sha256','bytes','rotationAt'])||!Object.hasOwn(candidate.capture.entries,index)||!exact(candidate.capture.entries[index],['path','bytes']))return false;
  return auditLoggerCoverage({pins:approved,readBytes,candidate}).qualified===true;
 };
}
