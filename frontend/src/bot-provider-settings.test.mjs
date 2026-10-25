import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,generateKeyPairSync,privateDecrypt,constants,createDecipheriv} from 'node:crypto';
import {botProviderModelOptions,switchBotProvider,sealBotProviderKey,canonicalCredentialBinding} from './bot-provider-settings.js';
test('provider switch clears incompatible model route and reasoning; DeepSeek does not offer GPT',()=>{
  const draft={employee:{model:'gpt-fixture'},config:{provider:'openai',baseUrl:'https://old.invalid',reasoningEffort:'max'}};
  switchBotProvider(draft,'deepseek');assert.equal(draft.employee.model,null);assert.equal(draft.config.baseUrl,undefined);assert.equal(draft.config.reasoningEffort,undefined);
  assert.equal(botProviderModelOptions('deepseek',[{id:'gpt-fixture'}]).some(item=>item.value==='gpt-fixture'),false);
  assert.equal(botProviderModelOptions('anthropic',[{id:'gpt-fixture'},{id:'claude-fixture'}]).some(item=>item.value==='gpt-fixture'),false);
});
test('browser envelope decrypts only for bound device and metadata',async()=>{
  const pair=generateKeyPairSync('rsa',{modulusLength:3072});
  const metadata={devicePublicKey:pair.publicKey.export({type:'spki',format:'pem'}),binding:{employeeId:'employee_fixture',workspace:'fixture',version:1}};
  const envelope=await sealBotProviderKey('synthetic-key-only',metadata,webcrypto),label=Buffer.from(canonicalCredentialBinding(metadata.binding));
  const raw=privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:label},Buffer.from(envelope.wrappedKey,'base64'));
  const decipher=createDecipheriv('aes-256-gcm',raw,Buffer.from(envelope.iv,'base64'));decipher.setAAD(label);decipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
  assert.equal(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString(),'synthetic-key-only');
  assert.throws(()=>privateDecrypt({key:pair.privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:Buffer.from('other employee')},Buffer.from(envelope.wrappedKey,'base64')));
  assert.equal(JSON.stringify(envelope).includes('synthetic-key-only'),false);
});
