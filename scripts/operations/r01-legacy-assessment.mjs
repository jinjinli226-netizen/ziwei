import crypto from 'node:crypto';
const fail=code=>{throw Object.assign(new Error(code),{code});};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export async function readJsonInput(stream){const chunks=[];let bytes=0;for await(const chunk of stream){const value=Buffer.from(chunk);bytes+=value.length;if(bytes>4*1024*1024)fail('LEGACY_JSON_INPUT_TOO_LARGE');chunks.push(value);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}

/** Reconstruct only the known V1 serialization of the retained completed
 * prefix. The historical SHA+length must match exactly; absence/counts or a
 * guessed timestamp are never accepted without that byte identity. This does
 * not write/rebuild the original state, expose native bodies or prove dispatch.
 */
export function reconstructLegacyCache({state,anchor,dedupeKeySha256,actionId=null,searchBeforeMs=1000,searchAfterMs=100,completedPrefixLengths=null}={}){
  if(![1,2].includes(state?.version)||!Array.isArray(state.completed)||state.version===2&&!Array.isArray(state.started))fail('LEGACY_STATE_SCHEMA_UNSUPPORTED');
  if(!anchor||!/^[a-f0-9]{64}$/.test(anchor.sha256||'')||!Number.isSafeInteger(anchor.bytes)||anchor.bytes<1||!Number.isFinite(Date.parse(anchor.modifiedAt))||!/^[a-f0-9]{64}$/.test(dedupeKeySha256||''))fail('LEGACY_CACHE_ANCHOR_INVALID');
  if(!Number.isSafeInteger(searchBeforeMs)||!Number.isSafeInteger(searchAfterMs)||searchBeforeMs<0||searchAfterMs<0||searchBeforeMs+searchAfterMs>3000)fail('LEGACY_CACHE_SEARCH_BOUNDS_INVALID');
  const completed=state.completed.map(row=>{if(!row||typeof row.key!=='string'||!row.result||typeof row.result!=='object')fail('LEGACY_STATE_SCHEMA_UNSUPPORTED');return {key:row.key,result:row.result};});
  const lengths=completedPrefixLengths||[completed.length];
  if(!Array.isArray(lengths)||lengths.length<1||lengths.length>128||new Set(lengths).size!==lengths.length||lengths.some(value=>!Number.isSafeInteger(value)||value<0||value>completed.length))fail('LEGACY_CACHE_PREFIX_BOUNDS_INVALID');
  const modified=Date.parse(anchor.modifiedAt),candidates=new Set();if(state.version===1&&typeof state.updatedAt==='string')candidates.add(state.updatedAt);
  for(let ms=modified-searchBeforeMs;ms<=modified+searchAfterMs;ms++)candidates.add(new Date(ms).toISOString());
  let matchedUpdatedAt=null,historicalCompletedCount=null;
  for(const length of lengths){
    const prefix=completed.slice(0,length),sample=Buffer.from(JSON.stringify({version:1,updatedAt:new Date(modified).toISOString(),completed:prefix}));
    if(sample.length!==anchor.bytes)continue;
    for(const updatedAt of candidates){const bytes=Buffer.from(JSON.stringify({version:1,updatedAt,completed:prefix}));if(bytes.length===anchor.bytes&&sha(bytes)===anchor.sha256){matchedUpdatedAt=updatedAt;historicalCompletedCount=length;break;}}
    if(matchedUpdatedAt)break;
  }
  if(!matchedUpdatedAt)fail('LEGACY_CACHE_ANCHOR_NOT_RECONSTRUCTED');
  const dedupePresent=completed.some(row=>sha(row.key)===dedupeKeySha256||actionId&&row.result.actionId===actionId);
  const matchingStarted=(state.started||[]).some(row=>typeof row?.key==='string'&&sha(row.key)===dedupeKeySha256||actionId&&row?.actionId===actionId);
  const historicalDedupePresent=completed.slice(0,historicalCompletedCount).some(row=>sha(row.key)===dedupeKeySha256||actionId&&row.result.actionId===actionId);
  return {schemaVersion:1,kind:'legacy-v1-cache-byte-audit',historicalBytesVerified:true,historicalSha256:anchor.sha256,historicalBytes:anchor.bytes,matchedUpdatedAt,historicalCompletedCount,currentCompletedCount:completed.length,completedCount:completed.length,dedupeKeySha256,historicalDedupePresent,dedupePresent,matchingStarted,neverDispatchedEligible:!dedupePresent&&!matchingStarted,productionAcceptance:false};
}
