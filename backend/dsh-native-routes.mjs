export function mountDshNativeRoutes(app,{service,secretService,groupDispatchService,requireRole,mcpGuard,mcpEmployeeGuard,employeeContext,mcpContext}){
 for(const [prefix,guards,context] of [
  ['/api',[requireRole('owner','admin','member')],employeeContext],
  ['/mcp/v1',[mcpGuard,mcpEmployeeGuard],mcpContext],
 ]){
  const base=`${prefix}/workspaces/:slug/employees/:id/dsh/native`;
  const noStore=(req,res)=>{res.setHeader('Cache-Control','no-store');if(prefix==='/api')res.vary('Cookie');};
  app.get(`${base}/capabilities`,...guards,(req,res)=>{noStore(req,res);res.json(service.capabilities(req.params.slug,req.params.id,context(req)));});
  app.get(`${base}/state`,...guards,(req,res)=>{noStore(req,res);res.json(service.state(req.params.slug,req.params.id,{conversationId:req.query.conversationId},context(req)));});
  app.post(`${base}/refresh`,...guards,(req,res)=>{noStore(req,res);res.status(202).json(service.refresh(req.params.slug,req.params.id,req.body||{},context(req)));});
  app.post(`${base}/actions`,...guards,(req,res)=>{noStore(req,res);nativeReply(res,202,()=>service.action(req.params.slug,req.params.id,req.body||{},context(req)));});
  if(secretService){
   app.post(`${base}/secure-requests`,...guards,(req,res)=>{noStore(req,res);nativeReply(res,202,()=>secretService.prepare(req.params.slug,req.params.id,req.body||{},context(req)));});
   app.post(`${base}/secure-requests/:requestId/answer`,...guards,(req,res)=>{noStore(req,res);nativeReply(res,200,()=>secretService.answer(req.params.slug,req.params.id,req.params.requestId,req.body||{},context(req)));});
  }
 }
 if(secretService)app.post('/a2a/v1/actions/:id/dsh-native/secrets/:requestId/claim',(req,res)=>{res.setHeader('Cache-Control','no-store');res.json(secretService.claim(req.params.id,req.params.requestId,req.deviceCredential));});
 if(groupDispatchService)for(const operation of ['dispatch','cancel'])app.post(`/a2a/v1/actions/:id/dsh-group/${operation}`,(req,res)=>{res.setHeader('Cache-Control','no-store');res.status(202).json(groupDispatchService[operation](req.params.id,req.body||{},req.deviceCredential));});
}

function nativeReply(res,status,run){
 try{res.status(status).json(run());}
 catch(error){
  if(error.code!=='settings/conflict')throw error;
  const expected=error.details?.expectedRevision??error.details?.expected,actual=error.details?.actualRevision??error.details?.actual;
  res.status(409).json({code:'settings/conflict',error:'settings/conflict',...(Number.isSafeInteger(expected)?{expectedRevision:expected}:{}),...(Number.isSafeInteger(actual)?{actualRevision:actual}:{})});
 }
}
