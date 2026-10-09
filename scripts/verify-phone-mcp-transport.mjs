#!/usr/bin/env node
/** Anonymous release probe. No employee credentials or phone commands are used. */
import assert from 'node:assert/strict';

const option=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];};
const base=new URL(option('--origin','https://qzelynth.top'));
const workspace=option('--workspace','phone_ai');
if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || base.pathname!=='/')throw new Error('Use an HTTPS origin without credentials or path');
if(!/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(workspace))throw new Error('Invalid workspace');
const checks=[];
async function probe(path,{method='GET',body,expectedStatus,expectedCode}={}){
 const response=await fetch(new URL(path,base),{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const contentType=response.headers.get('content-type') || '';
 assert.match(contentType,/application\/json/,`${path}: expected backend JSON; verify reverse-proxy route`);
 const value=await response.json();assert.equal(response.status,expectedStatus,`${path}: unexpected status`);
 if(expectedCode)assert.equal(value.code,expectedCode,`${path}: unexpected authentication boundary`);
 if(expectedStatus===200)assert.equal(value.ok,true,`${path}: main service is unhealthy`);
 checks.push({path,method,status:response.status,contentType});
}
await probe('/healthz',{expectedStatus:200});
await probe(`/mcp/v1/workspaces/${encodeURIComponent(workspace)}/health`,{expectedStatus:401});
await probe(`/terminal-mcp/v1/workspaces/${encodeURIComponent(workspace)}/employees/employee_transport_probe/call`,{method:'POST',body:{name:'ziwei_phone_list',arguments:{}},expectedStatus:401,expectedCode:'PHONE_CAPABILITY_INVALID'});
console.log(JSON.stringify({at:new Date().toISOString(),origin:base.origin,passed:true,anonymous:true,realPhoneActions:0,checks}));
