import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {employeeReadiness} from './management-mcp.js';

const source=await readFile(new URL('./App.vue',import.meta.url),'utf8');
test('web DSH employee submission uses the selected native Bot and discards a prior runtime model choice',async()=>{
  const employeeForm={value:{name:'DSH Partner',runtime:'DSH'}},profile={value:'alpha'},requests=[],phones=[];
  const bindings={employeeCreating:{value:false},employeeForm,employeeReady:{value:employeeReadiness({devices:[{id:'pc',status:'online',runtimes:[{name:'DSH',cli_status:'available',profiles:[{name:'alpha',readiness:{ready:true}}]}]}]},{deviceId:'pc',runtime:'DSH',profile:'alpha'})},notify:()=>{},employeeDefaultWorkdirPayload:()=>({}),workspaceSlug:()=> 'qa',employeeEditId:{value:''},employeeEditorGeneration:0,employeeContinuePhoneSetup:{value:true},showEmployee:{value:true},employeeModel:{value:'previous-codex-model'},employeeRuntimeProfile:profile,employeeTargetDeviceId:{value:'pc'},employeeDescription:{value:''},employeePersona:{value:''},employeeVisibility:{value:'workspace'},employeeSkillIds:{value:[]},employeeRole:{value:''},employeeAvatar:{value:''},employeeCreateRequestKey:{value:'request'},api:{createEmployee:async body=>{requests.push(body);return{id:'employee'};}},load:async()=>{},openPhoneSkillSetup:id=>phones.push(id)};
  bindings.notify=()=>{};
  const begin=source.indexOf('async function addEmployee('),end=source.indexOf('\n}',begin);
  const submit=new Function(...Object.keys(bindings),`return (${source.slice(begin,end+2)});`)(...Object.values(bindings));await submit();
  assert.equal(requests.length,1);assert.equal(requests[0].runtime,'DSH');assert.equal(requests[0].runtimeProfile,'alpha');assert.equal(requests[0].model,null);assert.deepEqual(phones,[]);
});

test('the actual web template compiles with an explicit DSH Bot selector and native configuration disclosure',()=>{
  const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  const script=compileScript(descriptor,{id:'dsh-onboarding'}),template=compileTemplate({id:'dsh-onboarding',filename:'App.vue',source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  assert.match(descriptor.template.content,/绑定 DSH Bot/);assert.match(descriptor.template.content,/沿用所选 DSH Bot 的原生配置/);
});
