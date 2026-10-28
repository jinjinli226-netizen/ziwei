import { createPublicKey, verify } from 'node:crypto';
import { fail, FORMAL_ISSUER, SITES } from './contract.mjs';
const exactAudience=(value,expected)=>value===expected||Array.isArray(value)&&value.length===1&&value[0]===expected;
const siteRoles=(value,audience)=>Array.isArray(value?.resource_access?.[audience]?.roles)?value.resource_access[audience].roles:[];
const scopes=value=>typeof value?.scope==='string'?new Set(value.scope.split(' ')):new Set();
const nonempty=x=>typeof x==='string'&&x.length>0&&x.length<=512&&!/[\s\x00-\x1f\x7f]/.test(x);
export async function boundedJson(fetcher,url,options={}){
 let response;try{response=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(5000)});}catch{fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');}
 if(!response.ok)fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');let size=0;const chunks=[];if(!response.body)fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');
 try{for await(const chunk of response.body){size+=chunk.length;if(size>65536)fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');}
}
export function createProvisionerVerifier(config={}){
 const {site,issuer,apiClientSecret,callerClientId,callerSubject}=config;
 const configured=SITES.includes(site)&&issuer===FORMAL_ISSUER&&typeof apiClientSecret==='string'&&apiClientSecret.length>=16&&!/[\r\n\0]/.test(apiClientSecret)&&nonempty(callerSubject)&&callerClientId===`ziwei-ecosystem-onboarding-${site}`;
 const fetcher=config.fetch??globalThis.fetch,audience=`ziwei-${site}-api`;let keys=null,keyExpiry=0;
 const denied=()=>fail(403,'PROVISIONER_FORBIDDEN');
 return Object.freeze({configured,async verify(raw,action){
  if(!configured)fail(503,'MEMBER_PROVISIONER_NOT_CONFIGURED');if(!['grant','revoke','status'].includes(action))denied();
  if(typeof raw!=='string'||raw.length>16384||!/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(raw))denied();
  const parts=raw.split('.');let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{denied();}
  const now=Math.floor(Date.now()/1000);
  if(header.alg!=='RS256'||!nonempty(header.kid)||header.jku!==undefined||header.jwk!==undefined||header.x5u!==undefined||header.crit!==undefined||header.b64!==undefined||claims.iss!==issuer||claims.typ!=='Bearer'||claims.sub!==callerSubject||claims.azp!==callerClientId||!exactAudience(claims.aud,audience)||!Number.isSafeInteger(claims.iat)||!Number.isSafeInteger(claims.exp)||claims.iat<0||claims.iat>now+5||claims.exp<=now||claims.exp<=claims.iat||claims.exp-claims.iat>300||now-claims.iat>305||claims.nbf!==undefined&&(!Number.isSafeInteger(claims.nbf)||claims.nbf>now+5))denied();
  if(!keys||keyExpiry<Date.now()||!keys.some(key=>key.kid===header.kid)){
   const doc=await boundedJson(fetcher,issuer+'/protocol/openid-connect/certs');if(!Array.isArray(doc?.keys)||doc.keys.length>100)fail(503,'PROVISIONER_IDENTITY_UNAVAILABLE');keys=doc.keys;keyExpiry=Date.now()+60000;
  }
  const matching=keys.filter(key=>key.kid===header.kid&&key.kty==='RSA'&&(!key.alg||key.alg==='RS256')&&(!key.use||key.use==='sig')&&!key.d);if(matching.length!==1)denied();
  try{if(!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:matching[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))denied();}catch(e){if(e?.status)throw e;denied();}
  const basic=Buffer.from(audience+':'+apiClientSecret).toString('base64');
  const current=await boundedJson(fetcher,issuer+'/protocol/openid-connect/token/introspect',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',authorization:'Basic '+basic},body:new URLSearchParams({token:raw,token_type_hint:'access_token'}).toString()});
  if(current.active!==true||current.token_type!=='Bearer'||current.sub!==callerSubject||current.client_id!==callerClientId||!exactAudience(current.aud,audience)||current.exp!==claims.exp||current.exp<=Math.floor(Date.now()/1000)||current.iss!==undefined&&current.iss!==issuer)denied();
  const permission=`${site}:members:${action}`;
  if(!siteRoles(claims,audience).includes('member-provisioner')||!siteRoles(current,audience).includes('member-provisioner')||!scopes(claims).has(permission)||!scopes(current).has(permission))denied();
  return Object.freeze({issuer,subject:callerSubject,clientId:callerClientId,audience,action});
 }});
}
