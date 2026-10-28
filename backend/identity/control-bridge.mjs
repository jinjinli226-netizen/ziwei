import {fail} from './common.mjs';
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
function managementRoute(method,uri){
 const path=uri.split('?')[0];
 return /^\/api\/(?:android-devices|terminal-console)(?:\/|$)/.test(path)
   || method==='POST'&&path==='/api/employees'
   || method==='GET'&&path==='/api/employee-access'
   || method==='POST'&&/^\/api\/employees\/[^/]+\/(?:access(?:\/revoke)?|control)$/.test(path);
}
export async function authorizeControlBridge(req,identity,{ownerUserId,session=false}={}){
 if(!local(req))fail('FORBIDDEN','Private local authorization endpoint.',403);
 if(typeof ownerUserId!=='string'||!ownerUserId)fail('IDENTITY_CONFIGURATION','Explicit Control native owner mapping is required.',503);
 const method=session?'GET':req.headers['x-original-method'],uri=session?'/api/android-devices':req.headers['x-original-uri'];
 if(!['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method)||typeof uri!=='string'||uri.length>8192||/[\r\n]/.test(uri)||!managementRoute(method,uri))fail('FORBIDDEN','Only the reviewed Control management route is allowed.',403);
 const read=['GET','HEAD'].includes(method);
 if(!read&&(req.headers.origin!==identity.config.origin||req.headers['sec-fetch-site']==='cross-site'))fail('FORBIDDEN','A same-origin management request is required.',403);
 const principal=await identity.authorizeRequest({headers:req.headers,method:'GET',url:'/api/identity/me',originalUrl:'/api/identity/me'}),claims=principal.identity;
 if(principal.user_id!==ownerUserId||claims.kind!=='human'||!claims.roles?.includes('admin')||!claims.roles?.includes(read?'read':'write')||!claims.scopes?.includes(read?'workspace:read':'workspace:write')||!principal.memberships.some(row=>['owner','admin'].includes(row.role)))fail('FORBIDDEN','Control requires the explicitly mapped native owner and current site permissions.',403);
 return {authenticated:true,username:principal.user.email||principal.user.id};
}
export function installControlIdentityBridge(app,identity,{env=process.env}={}){
 const run=session=>async(req,res,next)=>{try{res.setHeader('Cache-Control','no-store');res.json(await authorizeControlBridge(req,identity,{ownerUserId:env.ZIWEI_CONTROL_NATIVE_OWNER_ID,session}));}catch(error){next(error);}};
 app.get('/internal/identity/control-verify',run(false));
 app.get('/api/identity/control-session',run(true));
}
