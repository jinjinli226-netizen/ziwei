import { createHash } from 'node:crypto';
const deny=()=>{throw new Error('Exact root-reviewed native binding plan rejected.');};
const text=x=>typeof x==='string'&&x.length>0&&x.length<=2048&&x===x.trim()&&!/[\u0000-\u001f\u007f]/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export const canonical=x=>JSON.stringify(x,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
export const digest=x=>createHash('sha256').update(canonical(x)).digest('hex');
/** Root-only offline operator plans are the production entry. Authorization is
 * the already approved deployment and exact plan SHA, not a second approver or
 * a signature fabricated by the executing process. */
export function verifyOperatorPlan(raw,{service,issuer,planSha256}){
  if(typeof raw!=='string'||!hex(planSha256)||createHash('sha256').update(raw).digest('hex')!==planSha256)deny();
  let p;try{p=JSON.parse(raw);}catch{deny();}
  if(!p||p.schemaVersion!==1||p.kind!=='root-offline-native-identity-plan'||p.service!==service||p.identityIssuer!==issuer||!text(p.operationId)||!text(p.operator)||!text(p.evidenceRef)||p.writersStopped!==true||!p.database||!text(p.database.canonicalPath)||!text(p.database.dev)||!text(p.database.ino)||!Number.isSafeInteger(p.previousServicePid)||p.previousServicePid<=0||!Array.isArray(p.bindings)||!p.bindings.length||p.bindings.length>100)deny();
  const subjects=new Set(),natives=new Set(),clients=new Set();
  for(const row of p.bindings){
    const fields=service==='workspace'?['subject','nativeUserId','workspaceIds','kind','employeeId','clientId','expectedNativeDigest','controlProofDigest','evidenceRef']:['subject','memberId','workspaceId','expectedUserId','kind','clientId','expectedNativeDigest','controlProofDigest','evidenceRef'];
    if(!row||Object.keys(row).some(k=>!fields.includes(k))||!text(row.subject)||subjects.has(row.subject)||!hex(row.expectedNativeDigest)||!hex(row.controlProofDigest)||!text(row.evidenceRef)||!['human','employee'].includes(row.kind))deny();subjects.add(row.subject);
    const key=service==='workspace'?`${row.kind}:${row.nativeUserId}:${row.employeeId||''}`:`${row.kind}:${row.workspaceId}:${row.memberId}`;
    if(natives.has(key))deny();natives.add(key);
    if(service==='workspace'&&(!text(row.nativeUserId)||!Array.isArray(row.workspaceIds)||!row.workspaceIds.length||row.workspaceIds.some(x=>!text(x))||new Set(row.workspaceIds).size!==row.workspaceIds.length))deny();
    if(service==='collaboration'&&(!text(row.memberId)||!text(row.workspaceId)||!text(row.expectedUserId)))deny();
    if(row.kind==='employee'){if(!text(row.clientId)||!new RegExp(`^ziwei-${service}-worker-[A-Za-z0-9_-]{1,128}$`).test(row.clientId)||clients.has(row.clientId)||service==='workspace'&&(!text(row.employeeId)||row.workspaceIds.length!==1))deny();clients.add(row.clientId);}else if(row.clientId||row.employeeId)deny();
  }
  return {...p,jti:p.operationId,sub:p.operator,proofDigest:planSha256,idempotent:true};
}
export function applyProvisioning(claims,adapter){return adapter.transaction(()=>{
  const prior=adapter.hasProof(claims.jti);
  if(prior){if(claims.idempotent&&prior.digest===claims.proofDigest)return {bindings:claims.bindings.length,proofConsumed:true,alreadyApplied:true};throw Error('Provisioning proof was already consumed.');}
  for(const row of claims.bindings)if(adapter.nativeDigest(row)!==row.expectedNativeDigest)throw Error('Original native row changed; independent review must be renewed.');
  for(const row of claims.bindings)adapter.bind({...row,issuer:claims.identityIssuer,verifiedBy:claims.sub});
  adapter.recordProof(claims.jti,claims.proofDigest,claims.sub);return {bindings:claims.bindings.length,proofConsumed:true};
});}
