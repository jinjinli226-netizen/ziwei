import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {assertPreviewNativeAction} from './native-policy.mjs';
const home=path.resolve('preview-home'),action=config=>({payload:{hermesBot:{sourceProfile:'default',config}}});
test('native preview permits isolated HOME and loopback providers only',()=>{
  assert.equal(assertPreviewNativeAction(action({mcpServers:{local:{url:'http://127.0.0.1:4283/mcp'}},voice:{stt:{enabled:true,baseUrl:'http://localhost:4283/v1'}}}),home),true);
  for(const config of [{mcpServers:{remote:{url:'https://external.invalid/mcp'}}},{mcpServers:{shell:{command:'powershell'}}},{voice:{tts:{enabled:true,baseUrl:'https://external.invalid/v1'}}}])assert.throws(()=>assertPreviewNativeAction(action(config),home));
  assert.throws(()=>assertPreviewNativeAction({payload:{hermesBot:{sourceProfile:'preview-fixture'}}},home));
  assert.throws(()=>assertPreviewNativeAction({...action({}),payload:{...action({}).payload,workdir:path.dirname(home)}},home));
  assert.throws(()=>assertPreviewNativeAction(action({mcpServers:{otherProject:{url:'http://127.0.0.1:9999/mcp'}}}),home,'http://127.0.0.1:4283'));
  assert.throws(()=>assertPreviewNativeAction(action({voice:{tts:{provider:'openai'}}}),home));
  assert.throws(()=>assertPreviewNativeAction({payload:{...action({}).payload,nativeOperation:{resource:'gateway',operation:'connect',input:{platform:'webhook'}}}},home));
});
