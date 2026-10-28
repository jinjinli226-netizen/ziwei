import { createHash } from 'node:crypto';
export const FORMAL_ISSUER='https://auth.qzelynth.top/realms/ziwei';
export const SITES=Object.freeze(['workspace','collaboration']);
export const ROLES=Object.freeze(['member','owner']);
export const rolesForSite=site=>site==='workspace'?ROLES:Object.freeze(['member']);
export function fail(status,code,message=code){throw Object.assign(new Error(message),{status,code});}
export function canonical(value){return JSON.stringify(sort(value));}
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
export const digest=value=>createHash('sha256').update(canonical(value),'utf8').digest('hex');
export function validateContext(context,site,action){
 const c=context;if(!c||typeof c!=='object'||Array.isArray(c))fail(400,'INVALID_CONTEXT');
 const keys=['schemaVersion','memberId','generation','operationId','requestDigest','issuer','subject','site','role','display','nativeId'];
 if(Object.keys(c).some(k=>!keys.includes(k))||c.schemaVersion!==1||c.site!==site||!SITES.includes(site)||c.issuer!==FORMAL_ISSUER||!rolesForSite(site).includes(c.role))fail(400,'INVALID_CONTEXT');
 for(const key of ['memberId','generation'])if(typeof c[key]!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(c[key]))fail(400,'INVALID_CONTEXT');
 if(typeof c.subject!=='string'||!c.subject||c.subject.length>255||/[\s\x00-\x1f\x7f]/.test(c.subject))fail(400,'INVALID_CONTEXT');
 if(c.nativeId!==undefined&&(typeof c.nativeId!=='string'||!c.nativeId||c.nativeId.length>512||/[\x00-\x1f\x7f]/.test(c.nativeId)))fail(400,'INVALID_CONTEXT');
 if(!c.display||Object.keys(c.display).sort().join(',')!=='email,realName'||typeof c.display.realName!=='string'||c.display.realName!==c.display.realName.trim()||!c.display.realName||c.display.realName.length>100||/[\x00-\x1f\x7f]/.test(c.display.realName)||typeof c.display.email!=='string'||c.display.email!==c.display.email.trim().toLowerCase()||c.display.email.length>254||!/^\S+@\S+\.\S+$/.test(c.display.email))fail(400,'INVALID_CONTEXT');
 const intentAction=action==='status'?c.operationId?.endsWith('-grant')?'grant':c.operationId?.endsWith('-revoke')?'revoke':null:action;
 if(!['grant','revoke'].includes(intentAction)||c.operationId!==`member-${c.memberId}-${c.generation}-${site}-${intentAction}`||c.operationId.length>180)fail(400,'INVALID_OPERATION');
 const {operationId,requestDigest,nativeId,...intent}=c;
 if(typeof requestDigest!=='string'||requestDigest!==digest({...intent,action:intentAction}))fail(409,'REQUEST_DIGEST_CONFLICT');
 return {context:JSON.parse(JSON.stringify(c)),action:intentAction};
}
export const uncertain=c=>({phase:'unknown',operationId:c.operationId,requestDigest:c.requestDigest});
