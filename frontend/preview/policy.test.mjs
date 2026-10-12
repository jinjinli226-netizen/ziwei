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
