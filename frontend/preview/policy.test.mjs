import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRequestAllowed} from './policy.mjs';
test('preview permits real local Bot configuration and fixture workflow only',()=>{
  for(const [method,path] of [['GET','/api/workspaces/preview-bots/models'],['GET','/api/workspaces/preview-bots/conversations'],['POST','/api/workspaces/preview-bots/conversations'],['POST','/api/workspaces/preview-bots/bots'],['POST','/api/workspaces/preview-bots/employees/e/bot'],['POST','/api/workspaces/preview-bots/bots/e/routines/r/run'],['DELETE','/api/workspaces/preview-bots/bots/e/routines/r'],['POST','/api/conversations/c/messages']])assert.equal(previewRequestAllowed({method,path}),true,`${method} ${path}`);
});
test('URL import, webhook dispatch, native discovery and external controls are rejected in preview',()=>{
  for(const [method,path] of [['POST','/api/workspaces/preview-bots/skills/import'],['POST','/api/workspaces/preview-bots/documents/git/export'],['POST','/api/automation-runs/r/result'],['GET','/api/workspaces/preview-bots/hermes/profiles'],['POST','/api/workspaces/preview-bots/mcp/retry'],['GET','/api/workspaces/preview-bots/ziwei-connect/status'],['POST','/a2a/v1/actions']])assert.equal(previewRequestAllowed({method,path}),false,`${method} ${path}`);
  assert.equal(previewRequestAllowed({method:'POST',path:'/api/workspaces/preview-bots/bots/e/routines',body:{webhookUrl:'https://external.invalid/'}}),false);
});
test('native browser entry is explicit and does not open device or external delivery paths',()=>{
  const request={method:'POST',path:'/api/workspaces/preview-bots/bots/e/native/actions'};
  assert.equal(previewRequestAllowed(request),false);assert.equal(previewRequestAllowed({...request,native:true}),true);
  assert.equal(previewRequestAllowed({method:'POST',path:'/a2a/v1/actions',native:true}),false);
  assert.equal(previewRequestAllowed({...request,native:true,body:{webhookUrl:'https://external.invalid/'}}),false);
  const gateway={method:'PATCH',path:'/api/workspaces/preview-bots/bots/e',native:true,body:{config:{gateway:{platforms:{webhook:{enabled:true,extra:{host:'127.0.0.1',port:42000}}}}}}};
  assert.equal(previewRequestAllowed(gateway),true);gateway.body.config.gateway.platforms.webhook.extra.host='0.0.0.0';assert.equal(previewRequestAllowed(gateway),false);
});
test('profile request endpoints are limited to native preview and preserve the original API',()=>{for(const [method,path] of [['GET','/api/workspaces/preview-bots/hermes/profiles'],['GET','/api/workspaces/preview-bots/hermes/profiles/requests/original'],['POST','/api/workspaces/preview-bots/hermes/profiles/requests']]){assert.equal(previewRequestAllowed({method,path}),false);assert.equal(previewRequestAllowed({method,path,native:true}),true);}assert.equal(previewRequestAllowed({method:'POST',path:'/api/workspaces/preview-bots/hermes/profiles/requests',native:true,body:{webhookUrl:'https://external.invalid'}}),false);});
