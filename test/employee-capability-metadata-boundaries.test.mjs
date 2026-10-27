import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collectEmployeeCapabilityInventory} from '../src/employee-capability-inventory.mjs';
const subject={workspace:'fixture',employeeId:'employee_fixture',deviceId:'device_fixture',runtime:'Hermes',profile:'fixture',revision:1,controlEpoch:1};
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'capability-boundary-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));fs.mkdirSync(path.join(home,'skills'));return home;}
const collect=(home,patch={})=>collectEmployeeCapabilityInventory({subject,runtimeContext:{home},machineInventory:{items:[]},...patch});
test('directory enumeration reads at most the bound plus one and always closes the iterator',async t=>{
 const home=fixture(t);fs.writeFileSync(path.join(home,'config.yaml'),'skills: {}\n');let reads=0,closed=0;
 const value=await collect(home,{io:{opendirSync(){return{readSync(){reads++;return{name:'file'+reads,isDirectory:()=>false,isSymbolicLink:()=>false};},closeSync(){closed++;}};},readdirSync(){throw Error('UNBOUNDED_ENUMERATION_FORBIDDEN');}}});
 assert.equal(reads,201);assert.equal(closed,1);assert.equal(value.sections.skills.status,'partial');assert.equal(value.sections.skills.reason,'inventory_truncated');
});
for(const config of [null,'skills: [unclosed'])test(`unreadable native policy cannot turn a readable empty skills root into exact zero (${config===null?'missing':'malformed'})`,async t=>{
 const home=fixture(t);if(config!==null)fs.writeFileSync(path.join(home,'config.yaml'),config);
 const value=await collect(home);assert.equal(value.sections.skills.status,'unknown');assert.equal(value.sections.skills.reason,'native_configuration_unreadable');
});
test('unknown native enablement remains partial with real skill metadata and never exports body',async t=>{
 const home=fixture(t);fs.mkdirSync(path.join(home,'skills','demo'));fs.writeFileSync(path.join(home,'skills','demo','SKILL.md'),'---\nname: demo\ndescription: Safe fixture\n---\nPRIVATE_BODY_NEVER_EXPORTED');
 const value=await collect(home);assert.equal(value.sections.skills.items.length,1);assert.equal(value.sections.skills.status,'partial');assert.equal(value.sections.skills.reason,'native_configuration_unreadable');assert(!JSON.stringify(value).includes('PRIVATE_BODY_NEVER_EXPORTED'));
});
test('valid quoted TOML MCP names with dots stay visible without reading authentication',async t=>{
 const home=fixture(t);fs.writeFileSync(path.join(home,'config.toml'),'[mcp_servers."key.with.dot"]\ncommand="fixture-never-executed"\nenabled=false\n[mcp_servers."key.with.dot".env]\nTOKEN="PRIVATE_NEVER_EXPORTED"\n[mcp_servers.\'literal.dot\']\nurl="https://fixture.invalid"\n');
 const value=await collect(home,{subject:{...subject,runtime:'Codex',profile:null}});assert.equal(value.sections.mcp.status,'ready');assert.deepEqual(value.sections.mcp.items.map(x=>x.name),['key.with.dot','literal.dot']);assert.equal(value.sections.mcp.items[0].enabled,'disabled');assert(!JSON.stringify(value).includes('PRIVATE_NEVER_EXPORTED'));
});
test('unsupported MCP table spelling is explicit partial rather than a complete empty list',async t=>{
 const home=fixture(t);fs.writeFileSync(path.join(home,'config.toml'),'[mcp_servers."name with spaces"]\ncommand="fixture"\n');const value=await collect(home,{subject:{...subject,runtime:'Codex',profile:null}});assert.equal(value.sections.mcp.status,'partial');assert.equal(value.sections.mcp.reason,'native_configuration_partial');
});

for(const header of ['[ mcp_servers.foo ]','[mcp_servers . foo]','[ "mcp_servers" . foo ]',"[ 'mcp_servers' . foo ]",'["mcp_\\u0073ervers".foo]','[[ mcp_servers.foo ]]'])test(`unrecognized legal MCP-like TOML header fails closed (${header})`,async t=>{
 const home=fixture(t);fs.writeFileSync(path.join(home,'config.toml'),header+'\ncommand="fixture-never-executed"\n');
 const value=await collect(home,{subject:{...subject,runtime:'Codex',profile:null}});
 assert.equal(value.sections.mcp.status,'partial');assert.equal(value.sections.mcp.reason,'native_configuration_partial');assert.equal(value.sections.mcp.items.length,0);
});
