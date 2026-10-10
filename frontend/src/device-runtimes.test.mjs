import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
let helpers={};
try{helpers=await import('./device-runtimes.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}

test('team device rows consume device-scoped runtimes rather than repeat the workspace catalog',async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
  assert.match(source,/v-for="runtime in deviceRuntimeRows\(device\)"/);
  assert.match(source,/employeesForRuntime\(runtime,device\)/);
});
test('legacy workspace versions cannot become another device evidence',()=>{
  assert.equal(typeof helpers.deviceRuntimes,'function','Device-scoped runtime mapper is required');
  const rows=helpers.deviceRuntimes({id:'second',status:'online'},[{id:'catalog',name:'Codex',device_id:'first',cli_status:'available',cli_version:'FIRST'}]);
  assert.equal(rows[0].cli_version,null);assert.equal(helpers.runtimePresentation(rows[0]).state,'not_reported');
  const own=helpers.deviceRuntimes({id:'second',status:'online',runtimes:[{name:'Codex',cli_status:'available',cli_version:'SECOND'}]},[]);
  assert.equal(own[0].cli_version,'SECOND');
});
test('presentation separates available, not installed, failed, missing, stale and offline evidence',()=>{
  assert.equal(typeof helpers.runtimePresentation,'function','Runtime state presentation is required');
  for(const [state,label] of [['available','可用'],['not_found','未发现 CLI'],['failed','检测失败'],['not_reported','未上报'],['stale','发现已过期'],['device_offline','设备离线'],['unavailable','CLI 不可用']]){
    const result=helpers.runtimePresentation({discovery_state:state,detection:{state,reason:'fixture reason'},cli_status:state==='available'?'available':'unavailable'});
    assert.equal(result.label,label);assert.equal(result.online,state==='available');
  }
  const rows=helpers.deviceRuntimes({id:'off',status:'offline',runtimes:[{name:'Codex',cli_status:'available',cli_version:'LAST'}]},[]);
  assert.equal(helpers.runtimePresentation(rows[0]).label,'设备离线');
});
test('Windows client maintenance is a separate local dialog and never generates pairing',async()=>{
  const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
  assert.ok(source.includes('showClientMaintenance=true'),'A separate maintenance entry is required');
  assert.ok(source.includes('<ClientMaintenancePanel'),'Maintenance instructions must be mounted independently of connection pairing');
  const panel=await readFile(new URL('./components/ClientMaintenancePanel.vue',import.meta.url),'utf8');
  for(const command of ['ziwei_user stop','ziwei_user update','ziwei_user update-status --json','ziwei_user uninstall','https://qzelynth.top/downloads/cli/update-windows.ps1'])assert.ok(panel.includes(command),command);
  assert.ok(!panel.includes('createDevicePairing')&&!panel.includes('api.'),'Instructions cannot invoke pairing or business APIs');
});
