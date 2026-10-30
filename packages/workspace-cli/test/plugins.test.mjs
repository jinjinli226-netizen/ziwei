import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getOperation,createOperationRequest} from '../src/registry.mjs';
import {nativeOperationView} from '../src/transport.mjs';
import {runCli} from '../src/main.mjs';
import {CredentialStore} from '../src/config.mjs';
import {createMcpClient,createMcpHandler,toolDefinitions} from '../../../scripts/ziwei-mcp.mjs';

test('employee plugin commands use the employee binding and native endpoints on both transports',()=>{
  for(const [action,method,suffix] of [['get','GET',''],['refresh','POST','/refresh'],['apply','PUT','']]){
    const op=getOperation(`employees.plugins.${action}`);
    assert.ok(op);assert.equal(op.readOnly,action==='get');
    const input={id:'employee/one',...(action==='apply'?{enabled:['@deepseek-ai/dsh-base'],idempotencyKey:'plugins-1'}:{})};
    for(const mode of ['native','managed']){
      const request=createOperationRequest(op,input,{mode,workspace:'team'});
      assert.equal(request.method,method);
      assert.equal(request.path,`${mode==='native'?'/api':'/mcp/v1'}/workspaces/team/employees/employee%2Fone/plugins${suffix}`);
      if(action==='get')assert.deepEqual(request.query,{});
      else assert.deepEqual(request.body,action==='apply'?{enabled:input.enabled,idempotencyKey:'plugins-1'}:{});
    }
  }
});

test('plugin snapshots and queued writes never imply actual runtime loading',()=>{
  const get=getOperation('employees.plugins.get'),apply=getOperation('employees.plugins.apply');
  assert.ok(get);assert.ok(apply);
  const snapshot={status:'ready',snapshot:{plugins:[{id:'native-bundle',enabled:true}],restartRequired:true}};
  assert.deepEqual(nativeOperationView(snapshot,get,200,{id:'employee'}),{native:snapshot});
  const queued={...snapshot,status:'pending',pending:{actionId:'original-plugin-action',status:'pending'}};
  const view=nativeOperationView(queued,apply,202,{id:'employee'});
  assert.equal(view.operation.state,'accepted');assert.equal(view.operation.completed,false);
  assert.equal(view.operation.serverReceiptId,'original-plugin-action');
  assert.match(view.operation.resultQuery.command,/actions get --id "original-plugin-action"/);
  assert.equal(view.native.snapshot.restartRequired,true);
});

test('plugin CLI rejects external locations and writes without the original idempotency key before transport',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-plugin-input-'));
  try{
    for(const input of [
      {id:'employee',enabled:['native-bundle']},
      {id:'employee',enabled:['native-bundle'],idempotencyKey:'plugins-1',baseUrl:'http://elsewhere.invalid'},
      {id:'employee',enabled:['native-bundle'],idempotencyKey:'plugins-1',path:'other/home'},
    ]){
      let output='';
      const result=await runCli(['employees','plugins','apply','--input',JSON.stringify(input)],{env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:value=>{output+=value;},fetchImpl:async()=>assert.fail('invalid input must not dispatch')});
      assert.equal(result.exitCode,2);assert.equal(JSON.parse(output).error.code,'USAGE');
    }
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('management MCP forwards only the original plugin API and preserves queued receipts',async()=>{
  const calls=[],queued={status:'pending',pending:{actionId:'plugin-action',status:'pending'}};
  const client=createMcpClient({workspace:'team',baseUrl:'https://workspace.example.test',token:'synthetic-test-token',fetchImpl:async(url,init)=>{calls.push({url:new URL(url),init});return Response.json(queued,{status:202});}});
  const handler=createMcpHandler(client);
  for(const [tool,method,suffix,args] of [
    ['ziwei_get_employee_plugins','GET','',{id:'employee'}],
    ['ziwei_refresh_employee_plugins','POST','/refresh',{id:'employee',idempotencyKey:'refresh-1'}],
    ['ziwei_apply_employee_plugins','PUT','',{id:'employee',enabled:['@deepseek-ai/dsh-base'],idempotencyKey:'apply-1'}],
  ]){
    assert.ok(toolDefinitions.find(item=>item.name===tool));
    const result=await handler({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool,arguments:args}});
    assert.deepEqual(JSON.parse(result.result.content[0].text),queued);
    const {url,init}=calls.at(-1);assert.equal(url.pathname,`/mcp/v1/workspaces/team/employees/employee/plugins${suffix}`);assert.equal(init.method,method);
    if(method==='GET')assert.equal(init.body,undefined);
    else{const{id,...body}=args;assert.deepEqual(JSON.parse(init.body),body);}
  }
});

test('CLI submits a plugin selection once using its selected authorized server and retains the original action query',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'workspace-plugin-submit-')),origin='https://workspace.example.test';
  try{
    const store=new CredentialStore(root);
    await store.save({origin,profile:'default',account:'default',purpose:'person'},{mode:'native',legacyCompatibility:true,session:'synthetic-plugin-session',workspace:'team',identitySource:'legacy-native'});
    let output='',writes=0;
    const result=await runCli(['employees','plugins','apply','--api',origin,'--input',JSON.stringify({id:'employee',enabled:['@deepseek-ai/dsh-base'],idempotencyKey:'selection-1'})],{
      env:{ZIWEI_WORKSPACE_CONFIG_DIR:root},stdout:value=>{output+=value;},fetchImpl:async(url,init)=>{
        if(new URL(url).pathname==='/api/identity/config')return Response.json({service:'workspace',mode:'legacy',legacyAllowed:true});
        writes++;assert.equal(url.origin,origin);assert.equal(url.pathname,'/api/workspaces/team/employees/employee/plugins');
        assert.equal(init.method,'PUT');assert.equal(init.headers.cookie,'ziwei_session=synthetic-plugin-session');
        assert.deepEqual(JSON.parse(init.body),{enabled:['@deepseek-ai/dsh-base'],idempotencyKey:'selection-1'});
        return Response.json({status:'pending',pending:{actionId:'selection-original-action',status:'pending'}},{status:202});
      },
    });
    assert.equal(result.exitCode,0);assert.equal(writes,1);
    const {data}=JSON.parse(output);assert.equal(data.operation.completed,false);assert.equal(data.operation.state,'accepted');
    assert.match(data.operation.resultQuery.command,/selection-original-action/);
    assert.equal(output.includes('synthetic-plugin-session'),false);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
