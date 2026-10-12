import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {previewNativePeer,previewGatewayResult} from './native-runtime.mjs';
import {ActionDispatcher} from '../../src/daemon.mjs';
test('preview Gateway uncertainty reaches product dispatcher quarantine with original evidence',async()=>{
  const action={id:'preview-uncertain',type:'hermes.bot.native',payload:{hermesBot:{employeeId:'employee_preview',revision:1},nativeOperation:{resource:'gateway',operation:'disconnect'}}};
  const result=previewGatewayResult({success:false,code:'EXECUTION_UNCERTAIN',processExit:{treeConfirmed:false}},action,'0.21.3');assert.equal(result.code,'EXECUTION_UNCERTAIN');assert.equal(result.result.nativeOperation.data.processExit.treeConfirmed,false);
  const dispatcher=new ActionDispatcher({execute:async()=>result});const receipt=await dispatcher.dispatch(action);assert.equal(receipt.code,'EXECUTION_UNCERTAIN');assert.equal(dispatcher.quarantined,true);
});
test('owned loopback peer accepts native multipart STT and returns labelled provider and MCP output',async()=>{
  const app=express();app.use(express.json());app.use((req,res,next)=>previewNativePeer(req,res).then(handled=>{if(!handled)next();}).catch(next));const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const base=`http://127.0.0.1:${server.address().port}/__preview/native-peer`;
  try{const form=new FormData();form.set('file',new Blob(['RIFF-binary-test'],{type:'audio/wav'}),'audio.wav');const stt=await fetch(base+'/v1/audio/transcriptions',{method:'POST',body:form});assert.equal(stt.status,200);assert.match(await stt.text(),/本地协议测试/);
    const model=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'preview-local-model'})});assert.match((await model.json()).choices[0].message.content,/本地测试 provider/);
    const mcp=await fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{arguments:{query:'owned query'}}})});assert.match((await mcp.json()).result.content[0].text,/本地测试 MCP.*owned query/);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
