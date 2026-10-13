function externalDelivery(value){
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>(/webhook/i.test(key)&&Boolean(item))||(/output.?mode/i.test(key)&&item==='webhook')||(item&&typeof item==='object'&&externalDelivery(item)));
}
export function previewRequestAllowed({method,path,body,native=false}){
  let deliveryBody=body;
  if(native&&/^\/api\/workspaces\/[^/]+\/bots(?:\/[^/]+)?$/.test(path)&&body?.config?.gateway?.platforms?.webhook){
    const channel=body.config.gateway.platforms.webhook;
    if(!['127.0.0.1','localhost'].includes(channel.extra?.host))return false;
    deliveryBody=structuredClone(body);delete deliveryBody.config.gateway.platforms.webhook;
  }
  if(externalDelivery(deliveryBody))return false;
  if(/\/(?:ziwei-connect|phone-mcp|client-maintenance|client-update|terminal-mcp|daemon)(?:\/|$)/.test(path)||path.startsWith('/mcp/')||path.startsWith('/terminal-mcp/'))return false;
  if(native&&/^\/api\/workspaces\/[^/]+\/hermes\/profiles(?:\/requests(?:\/[^/]+)?)?$/.test(path))return method==='GET'||method==='POST'&&path.endsWith('/requests');
  if(method==='GET'){
    if(['/healthz','/__preview/health','/api/auth/status','/api/auth/me','/api/workspaces','/a2a/v1/agents'].includes(path))return true;
    if(/^\/api\/workspaces\/[^/]+\/(summary|tasks|runtimes|models|skills|skill-sources|documents|automations|automation-templates|members|devices|employees|calendar|settings|notifications|bots|employee-templates|conversations)(?:\/.*)?$/.test(path))return true;
    if(/^\/api\/workspaces\/[^/]+\/mcp\/(status|discovery)$/.test(path))return true;
    if(/^\/api\/(conversations|documents|tasks|task-attachments|automations|automation-runs)\/[^/]+(?:\/.*)?$/.test(path))return true;
    return false;
  }
  if(method==='POST'&&['/api/workspaces','/api/auth/logout'].includes(path))return true;
  if(method==='POST'&&/^\/api\/workspaces\/[^/]+\/conversations$/.test(path))return true;
  if(native&&method==='POST'&&/^\/api\/workspaces\/[^/]+\/bots\/[^/]+\/(native\/actions|collaboration)$/.test(path))return true;
  if(/^\/api\/workspaces\/[^/]+\/bots(?:\/[^/]+(?:\/(validate|control|routines)(?:\/[^/]+(?:\/run)?)?)?)?$/.test(path))return ['POST','PATCH','DELETE'].includes(method);
  if(/^\/api\/workspaces\/[^/]+\/employees(?:\/[^/]+(?:\/bot)?)?$/.test(path))return ['POST','PATCH','DELETE'].includes(method);
  if(/^\/api\/workspaces\/[^/]+\/employee-templates\/[^/]+\/instances$/.test(path))return method==='POST';
  if(/^\/api\/conversations\/[^/]+(?:\/(messages|archive))?$/.test(path))return ['POST','PATCH'].includes(method);
  return false;
}
