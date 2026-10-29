import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {listDshSessions,cancelDshSession,executeDshRuntime} from '../src/dsh-runtime.mjs';
import {executeDshGroupRuntime} from '../src/dsh-group-runtime.mjs';
import {createDshAdapter} from '../backend/dsh-adapter.mjs';
import {createLocalActionExecutor} from '../src/local-action.mjs';
import {dshFixture} from './fixtures/dsh-protocol.mjs';

for(const [label,configured,expected] of [['native default',null,'http://127.0.0.1:7878'],['explicit local endpoint','http://127.0.0.1:17978','http://127.0.0.1:17978']]){
  test(`DSH ${label} is shared by runtime, group, backend and local executor without probing other hubs`,async t=>{
    const previous=process.env.ZIWEI_DSH_BASE_URL;
    t.after(()=>{if(previous===undefined)delete process.env.ZIWEI_DSH_BASE_URL;else process.env.ZIWEI_DSH_BASE_URL=previous;});
    if(configured)process.env.ZIWEI_DSH_BASE_URL=configured;else delete process.env.ZIWEI_DSH_BASE_URL;
    const group={id:'endpoint-group',title:'Test',members:['bot-a','bot-b'],sessions:{},messages:[]};
    const f=await dshFixture(t,{routes:(req,body,reply)=>{if(req.url!=='/api/groups/endpoint-group')return false;if(req.method==='PUT')Object.assign(group,body);reply({item:group});return true;}});
    const endpoints=[];
    const fetchImpl=(url,options)=>{endpoints.push(new URL(url).origin);return f.transport.fetchImpl(url,options);};
    class Socket extends f.transport.WebSocketImpl {constructor(url){endpoints.push(new URL(url.replace(/^ws/,'http')).origin);super(url);}}
    const transport={fetchImpl,WebSocketImpl:Socket};
    await listDshSessions({botName:'bot-a',fetchImpl});
    await cancelDshSession({botName:'bot-a',sessionId:'existing',fetchImpl});
    assert.equal((await executeDshRuntime({botName:'bot-a',prompt:'check',...transport})).status,'succeeded');
    await executeDshGroupRuntime({groupId:group.id,prompt:'check',...transport});
    await createDshAdapter({fetchImpl}).sessions('bot-a');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-dsh-endpoint-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const execute=createLocalActionExecutor({runtimeDir:directory,defaultWorkdir:directory,dshRuntime:async options=>{endpoints.push(options.baseUrl);return{status:'succeeded'};}});
    t.after(()=>execute.close());
    await execute({id:'endpoint-test',type:'conversation.execute',payload:{runtime:'DSH',profile:'bot-a',prompt:'check'}});
    assert.ok(endpoints.length>8);assert.deepEqual([...new Set(endpoints)],[expected]);
  });
}
