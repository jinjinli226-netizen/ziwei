import { fail } from './contract.mjs';
const PREFIX='/api/internal/member-provisioning/';
function send(response,status,value){response.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(JSON.stringify(value));}
async function body(request){if(request.body!==undefined){if(Buffer.byteLength(JSON.stringify(request.body))>65536)fail(400,'BODY_TOO_LARGE');return request.body;}let bytes=0;const chunks=[];for await(const chunk of request){bytes+=chunk.length;if(bytes>65536)fail(400,'BODY_TOO_LARGE');chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail(400,'INVALID_JSON');}}
/** Returns false for unrelated routes so native routers retain their behavior. */
export function createMemberProvisioningHandler({service,verifier}={}){
 return async(request,response)=>{
  if(typeof request.url!=='string'||!request.url.startsWith(PREFIX))return false;
  try{
   const action=request.url.slice(PREFIX.length);if(!['grant','revoke','status'].includes(action))fail(400,'NONCANONICAL_PROVISIONING_ROUTE');
   if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED');
   if(!service?.configured||!verifier?.configured)fail(503,'MEMBER_PROVISIONER_NOT_CONFIGURED');
   if(request.headers.origin!==undefined||request.headers.cookie!==undefined)fail(403,'BACKEND_CALLER_REQUIRED');
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type']||''))fail(415,'JSON_REQUIRED');
   let count=0;for(let i=0;i<(request.rawHeaders?.length??0);i+=2)if(request.rawHeaders[i].toLowerCase()==='authorization')count++;
   const authorization=request.headers.authorization;if(count>1||typeof authorization!=='string'||!authorization.startsWith('Bearer '))fail(403,'PROVISIONER_FORBIDDEN');
   await verifier.verify(authorization.slice(7),action);
   const envelope=await body(request);if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||Object.keys(envelope).sort().join(',')!=='action,context,schemaVersion'||envelope.schemaVersion!==1||envelope.action!==action)fail(400,'INVALID_PROVISIONING_ENVELOPE');
   send(response,200,await service[action](envelope.context));
  }catch(error){request.resume();const status=[400,401,403,409].includes(error.status)?error.status:503;const code=status===400?'invalid_request':status===401?'unauthenticated':status===403?'forbidden':status===409?['NATIVE_EMAIL_REVIEW_REQUIRED','EXISTING_SUBJECT_REVIEW_REQUIRED','UNREVIEWED_NATIVE_ID'].includes(error.code)?'native_review_required':'operation_conflict':'adapter_unavailable';if(!response.headersSent)send(response,status,{error:{code}});else response.destroy();}
  return true;
 };
}
