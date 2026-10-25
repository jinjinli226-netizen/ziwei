import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {sealBrowserAnswer} from './bot-interaction.js';
import {openSecret} from '../../src/bot-secret-crypto.mjs';
test('browser secure interaction encryption matches device binding and rejects another request',async()=>{const keys=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),binding={requestId:'r',workspaceId:'w',employeeId:'e',actionId:'a',purpose:'hermes-interaction'},value={password:'synthetic-password'},envelope=await sealBrowserAnswer(keys.publicKey,binding,value);assert(!JSON.stringify(envelope).includes(value.password));assert.deepEqual(JSON.parse(openSecret(keys.privateKey,binding,envelope)),value);assert.throws(()=>openSecret(keys.privateKey,{...binding,requestId:'other'},envelope));});
