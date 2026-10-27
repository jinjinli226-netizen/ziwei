import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForClientReady} from '../src/client-start-readiness.mjs';

const build='a'.repeat(64),pid=123;
function clock(){let value=0;return{now:()=>value,sleep:async ms=>{value+=ms;},advance:ms=>{value+=ms;}};}

test('a correctly bound daemon can finish first connection after the former 15-second window',async()=>{
  const time=clock();
  const result=await waitForClientReady({expectedPid:pid,expectedBuild:build,...time,
    probeReady:async()=>({ok:time.now()>=26000,body:{pid,clientBuild:build}})});
  assert.equal(result.ok,true);assert.equal(result.body.pid,pid);
  assert.ok(time.now()>=26000&&time.now()<=60000);
});

test('startup has a real deadline including time spent probing',async()=>{
  const time=clock();let probes=0;
  const result=await waitForClientReady({expectedPid:pid,expectedBuild:build,timeoutMs:5000,...time,
    probeReady:async()=>{probes++;time.advance(1000);return{ok:false};}});
  assert.equal(result.ok,false);assert.ok(time.now()>=5000&&time.now()<=6000);assert.ok(probes<=4);
});

test('a ready endpoint from a different process or build immediately rejects',async()=>{
  for(const body of [{pid:124,clientBuild:build},{pid,clientBuild:'b'.repeat(64)}]){
    const time=clock();
    await assert.rejects(waitForClientReady({expectedPid:pid,expectedBuild:build,...time,
      probeReady:async()=>({ok:true,body})}),{code:'CLIENT_START_IDENTITY_MISMATCH'});
  }
});

test('invalid launch identity or unbounded startup budgets never begin probing',async()=>{
  let probes=0;
  for(const patch of [{expectedPid:0},{expectedBuild:'unknown'},{timeoutMs:Infinity},{timeoutMs:0}]){
    await assert.rejects(waitForClientReady({expectedPid:pid,expectedBuild:build,...patch,
      probeReady:async()=>{probes++;return{ok:true,body:{pid,clientBuild:build}};}}));
  }
  assert.equal(probes,0);
});
