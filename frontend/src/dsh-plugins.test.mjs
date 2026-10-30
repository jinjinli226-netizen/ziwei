import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshPlugins,dshRuntimeEntries} from './dsh-plugins.js';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import * as icons from 'lucide-vue-next';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';

const scope=(employeeId='one',patch={})=>({workspace:'team',actorId:'owner',employeeId,deviceId:'pc',profile:'alpha',runtime:'DSH',...patch});
const catalog=()=>[{id:'native-required',name:'原生必需',description:'基础能力',required:true,enabled:true},{id:'custom-extra',name:'设备动态插件',description:'来自原生目录',required:false,enabled:false}];
function view(subject=scope(),patch={}){const {actorId,...nativeSubject}=subject;return{schemaVersion:1,workspace:subject.workspace,employeeId:subject.employeeId,subject:nativeSubject,status:'ready',stale:false,reasonCode:null,plugins:catalog(),runtime:{status:'unavailable',reasonCode:'NOT_OBSERVED'},configuration:{status:'available',writable:true,namespaces:[]},snapshot:{source:'dsh-native',checkedAt:'2026-10-30T10:00:00Z',actionId:null},pending:null,lastAttempt:null,restartRequired:true,...patch};}
const pending=(subject=scope(),operation='apply',id='action-one')=>view(subject,{status:'pending',pending:{actionId:id,status:'pending',operation},lastAttempt:{actionId:id,status:'pending',operation}});
const completed=(subject=scope(),operation='apply',id='action-one')=>view(subject,{actionId:id,snapshot:{source:'dsh-native',checkedAt:'2026-10-30T10:01:00Z',actionId:id},lastAttempt:{actionId:id,status:'succeeded',operation}});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
function setup(t,api,options={}){const timers=new Set(),ui=createDshPlugins({api,keyFactory:()=> 'same-key',storage:null,setTimer:fn=>{timers.add(fn);return fn;},clearTimer:fn=>timers.delete(fn),...options});t.after(()=>ui.dispose());return{ui,timers,tick:async()=>{const fn=timers.values().next().value;assert.ok(fn);timers.delete(fn);await fn();}};}

test('DSH plugins exposes its own native state controller',async()=>{
  const module=await import('./dsh-plugins.js').catch(()=>({}));
  assert.equal(typeof module.createDshPlugins,'function');
});

test('opening DSH reads then refreshes its native catalog once and never calls Hermes',async t=>{
  const calls=[],{ui}=setup(t,{employeePlugins:async(w,id)=>{calls.push(['get',w,id]);return view();},refreshEmployeePlugins:async(w,id,body)=>{calls.push(['refresh',w,id,body]);return completed(scope(),'inspect');}});
  await ui.select(scope(),{active:false});assert.equal(calls.length,0);
  await ui.select(scope(),{active:true});await ui.select(scope(),{active:true});
  assert.deepEqual(calls.map(row=>row[0]),['get','refresh']);assert.equal(ui.state.value.plugins[1].id,'custom-extra');
  await ui.select(scope('hermes',{runtime:'Hermes'}),{active:true});assert.equal(calls.length,2);assert.equal(ui.state.value,null);
});

test('required entries cannot be disabled and save waits for the original action terminal receipt',async t=>{
  let reads=0;const writes=[],{ui,tick}=setup(t,{employeePlugins:async()=>++reads===1?completed(scope(),'inspect'):completed(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async(w,id,body)=>{writes.push({w,id,body});return pending();}});
  await ui.select(scope(),{active:true});assert.equal(ui.toggle('native-required',false),false);assert.equal(ui.toggle('custom-extra',true),true);
  await ui.save();assert.deepEqual(writes[0].body,{enabled:['native-required','custom-extra'],idempotencyKey:'same-key'});assert.doesNotMatch(ui.state.notice,/已保存/);
  await ui.save();assert.equal(writes.length,1);await tick();assert.match(ui.state.notice,/已保存/);assert.equal(ui.state.request,null);
});

test('late replies from an old employee, device, profile or actor cannot replace the current scope',async t=>{
  for(const patch of [{employeeId:'two'},{deviceId:'pc-two'},{profile:'beta'},{actorId:'other'}]){
    const wait=deferred();let reads=0;const next={...scope(),...patch};
    const{ui}=setup(t,{employeePlugins:async()=>++reads===1?wait.promise:view(next),refreshEmployeePlugins:async()=>completed(next,'inspect')});
    const old=ui.select(scope(),{active:true});await ui.select(next,{active:true});wait.resolve(view());await old;
    assert.equal(ui.state.subject.actorId,next.actorId);assert.deepEqual(ui.state.value.subject,view(next).subject);
  }
});

test('network-unknown save keeps the same enabled set and key through readback and explicit retry',async t=>{
  const writes=[];const{ui}=setup(t,{employeePlugins:async()=>view(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async(w,id,body)=>{writes.push(body);if(writes.length===1)throw new TypeError('private network details');return pending();}});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.save();assert.equal(ui.state.unknown,true);assert.equal(ui.toggle('custom-extra',false),false);await ui.save();assert.equal(writes.length,1);
  await ui.load();assert.equal(ui.state.unknown,true);assert.equal(ui.state.request.idempotencyKey,'same-key');await ui.retry();assert.deepEqual(writes[0],writes[1]);assert.equal(ui.state.unknown,false);
});

test('duplicate retry follows its explicit original action instead of a newer pending action',async t=>{
  let writes=0,reads=0;const{ui}=setup(t,{employeePlugins:async()=>++reads===1?view():completed(scope(),'apply','other-action'),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async()=>{if(++writes===1)throw Error('response lost');return{...pending(scope(),'apply','other-action'),duplicate:true,actionId:'original-action'};}});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.save();await ui.retry();assert.equal(ui.state.request.actionId,'original-action');await ui.load();assert.equal(ui.state.request.actionId,'original-action');assert.equal(ui.state.unknown,true);assert.doesNotMatch(ui.state.notice,/已保存/);
});

test('unknown and stale reads preserve the local draft while fresh catalogs merge new required entries',async t=>{
  let reads=0;const{ui}=setup(t,{employeePlugins:async()=>++reads===1?view():reads===2?view(scope(),{status:'unknown',stale:true,reasonCode:'DEVICE_OFFLINE',plugins:[]}):view(scope(),{plugins:[...catalog(),{id:'new-required',name:'新增必需',required:true,enabled:true}]}),refreshEmployeePlugins:async()=>completed(scope(),'inspect')});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.load();assert.deepEqual(ui.state.draft,['native-required','custom-extra']);assert.equal(ui.editable(),false);assert.equal(ui.state.notice,'');
  await ui.load();assert.deepEqual(ui.state.draft,['native-required','custom-extra','new-required']);
});

test('a timed-out original action is a failure even if its stored status still says pending',async t=>{
  let reads=0,refreshes=0;const{ui}=setup(t,{employeePlugins:async()=>++reads===1?view():view(scope(),{status:'unknown',plugins:[],reasonCode:'OPERATION_TIMEOUT',lastAttempt:{actionId:'action-one',status:'pending',operation:'apply',reasonCode:'OPERATION_TIMEOUT'}}),refreshEmployeePlugins:async()=>{refreshes++;return completed(scope(),'inspect');},updateEmployeePlugins:async()=>pending()});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.save();await ui.load();assert.equal(ui.state.request,null);assert.match(ui.state.error,/超时/);assert.doesNotMatch(ui.state.notice,/已保存/);await ui.refresh();assert.equal(refreshes,2);
});

test('an unresolved save survives panel disposal and restores the exact request within its actor scope',async t=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},writes=[];
  const api={employeePlugins:async()=>view(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async(w,id,body)=>{writes.push(body);throw Error('response lost');}};
  const first=setup(t,api,{storage}).ui;await first.select(scope(),{active:true});first.toggle('custom-extra',true);await first.save();first.dispose();
  const second=setup(t,api,{storage}).ui;await second.select(scope(),{active:true});assert.equal(second.state.unknown,true);assert.deepEqual(second.state.draft,['native-required','custom-extra']);await second.retry();assert.deepEqual(writes[0],writes[1]);
});

test('hiding the panel pauses pending polling and returning resumes it without a new mutation',async t=>{
  const{ui,timers}=setup(t,{employeePlugins:async()=>pending(scope(),'inspect')});await ui.select(scope(),{active:true});assert.equal(timers.size,1);await ui.select(scope(),{active:false});assert.equal(timers.size,0);await ui.select(scope(),{active:true});assert.equal(timers.size,1);
});

test('an invalid success view cannot discard the original mutation identity or unlock another save',async t=>{
  let writes=0;const{ui}=setup(t,{employeePlugins:async()=>view(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async()=>{writes++;return{schemaVersion:2,pending:null};}});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.save();assert.equal(ui.state.unknown,true);assert.equal(ui.state.request.idempotencyKey,'same-key');assert.equal(ui.editable(),false);await ui.save();assert.equal(writes,1);
});

test('a 202 offline view without an action is not treated as a saved plugin combination',async t=>{
  const{ui}=setup(t,{employeePlugins:async()=>view(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async()=>view(scope(),{status:'unknown',reasonCode:'DEVICE_OFFLINE',plugins:[]})});
  await ui.select(scope(),{active:true});ui.toggle('custom-extra',true);await ui.save();assert.equal(ui.state.request,null);assert.match(ui.state.notice,/离线/);assert.doesNotMatch(ui.state.notice,/已保存/);assert.equal(ui.editable(),false);
});

test('polling is GET-only, bounded and cleared on scope change or disposal',async t=>{
  let reads=0,posts=0;const{ui,timers,tick}=setup(t,{employeePlugins:async()=>{reads++;return pending(scope(),'inspect');},refreshEmployeePlugins:async()=>{posts++;return pending(scope(),'inspect');}},{pollLimit:2});
  await ui.select(scope(),{active:true});await tick();await tick();assert.equal(reads,3);assert.equal(posts,0);assert.equal(timers.size,0);assert.match(ui.state.notice,/等待上限/);
  await ui.load();assert.equal(timers.size,1);ui.dispose();assert.equal(timers.size,0);
});

test('enabled catalog and bundle flags never substitute for native Loader fiberPhase evidence',()=>{
  assert.deepEqual(dshRuntimeEntries({status:'unavailable',entries:[{enabled:true,fiberPhase:'active'}]}),[]);
  const rows=dshRuntimeEntries({status:'observed',entries:[{entryId:'entry',moduleName:'native',enabled:true}],agentPresets:[{id:'preset',rows:[{entryId:'preset-entry',moduleName:'conditional-tool',enabled:'conditional',fiberPhase:'active'}]}]});
  assert.equal(rows[0].phase,'未观察');assert.equal(rows[1].phase,'active');assert.equal(rows[1].enabled,'conditional');
});

test('plugin API uses only the explicit workspace and employee with the original mutation payload',async t=>{
  const previous={window:globalThis.window,fetch:globalThis.fetch},calls=[];
  globalThis.window={location:{origin:'https://plugins.test',pathname:'/wrong/inbox'},dispatchEvent(){}};
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,status:200,json:async()=>view()};};
  t.after(()=>Object.assign(globalThis,previous));
  const source=(await readFile(new URL('./api.js',import.meta.url),'utf8')).replace("'./api-base.js'",JSON.stringify(new URL('./api-base.js',import.meta.url).href)).replace("'./bounded-read.js'",JSON.stringify(new URL('./bounded-read.js',import.meta.url).href)).replaceAll('import.meta.env.','({VITE_API_URL:"",DEV:false}).');
  const{api}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  await api.employeePlugins('team/a','employee/b');await api.refreshEmployeePlugins('team/a','employee/b',{idempotencyKey:'refresh-key'});await api.updateEmployeePlugins('team/a','employee/b',{idempotencyKey:'same-key',enabled:['native-required']});
  assert.deepEqual(calls.map(row=>row.url),['https://plugins.test/api/workspaces/team%2Fa/employees/employee%2Fb/plugins','https://plugins.test/api/workspaces/team%2Fa/employees/employee%2Fb/plugins/refresh','https://plugins.test/api/workspaces/team%2Fa/employees/employee%2Fb/plugins']);
  assert.deepEqual(calls.slice(1).map(row=>[row.options.method,JSON.parse(row.options.body)]),[['POST',{idempotencyKey:'refresh-key'}],['PUT',{idempotencyKey:'same-key',enabled:['native-required']}]]);
});

async function panelHarness(t,api){
  const file=new URL('./components/DshPluginsPanel.vue',import.meta.url),{descriptor,errors}=parse(await readFile(file,'utf8'));
  assert.deepEqual(errors,[]);const script=compileScript(descriptor,{id:'plugins-panel'}),template=compileTemplate({id:'plugins-panel',filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  async function evaluate(source){const bindings={};let code=source;
    for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){const spec=match[2],value=spec==='vue'?vue:spec==='lucide-vue-next'?icons:spec==='../api.js'?{api}:await import(new URL(spec,file));for(const part of match[1].slice(1,-1).split(',')){const[key,alias]=part.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];}code=code.replace(match[0],'');}
    return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));
  }
  const component=await evaluate(script.content);component.render=await evaluate(template.code);let state;const setup=component.setup;component.setup=(props,context)=>state=setup(props,context);
  const node=type=>({type,props:{},children:[],parent:null,text:''});
  const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:()=>node('#comment'),setText:(el,text)=>el.text=text,setElementText:(el,text)=>{el.text=text;el.children=[];},patchProp:(el,key,_old,value)=>el.props[key]=value,insert(child,parent,anchor){child.parent=parent;const at=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(at<0?parent.children.length:at,0,child);},remove(child){child.parent?.children.splice(child.parent.children.indexOf(child),1);},parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null});
  const props=vue.reactive({workspace:'team',actorId:'owner',employee:{id:'one',runtime:'DSH',runtime_profile:'alpha',target_device_id:'pc'},active:true}),root=node('root'),app=renderer.createApp({render:()=>vue.h(component,props)});app.mount(root);t.after(()=>app.unmount());
  const all=(predicate,target=root)=>[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>all(predicate,child))],text=(target=root)=>[target.text,...target.children.map(text)].join('');
  const settle=async()=>{await new Promise(setImmediate);await vue.nextTick();};await settle();
  return{props,state,text,all,settle,button:label=>all(el=>el.type==='button'&&(el.props['aria-label']===label||text(el).trim()===label))[0]};
}

test('the actual Vue panel edits the dynamic catalog, locks required plugins and waits for receipt',async t=>{
  const writes=[];let reads=0;
  const h=await panelHarness(t,{employeePlugins:async()=>++reads===1?view():completed(),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async(w,id,body)=>{writes.push(body);return pending();}});
  const boxes=h.all(el=>el.type==='input'&&el.props.type==='checkbox');assert.equal(boxes.length,2);assert.equal(boxes[0].props.disabled,true);
  const notices=()=>h.all(el=>el.props.role==='status').map(el=>h.text(el)).join(' ');
  boxes[1].props.onChange({target:{checked:true}});await h.settle();h.button('保存插件组合').props.onClick();await h.settle();assert.equal(writes.length,1);assert.doesNotMatch(notices(),/插件组合已保存/);assert.match(h.text(),/原生 DSH/);
  assert.equal(h.button('回读状态').props.disabled,false);h.button('回读状态').props.onClick();await h.settle();assert.match(notices(),/插件组合已保存/);assert.match(h.text(),/下次启动生效/);assert.match(h.text(),/尚无运行时加载证据/);
});

test('legacy combination respects an external native request lock while keeping GET readback available',async t=>{
  const writes=[];const h=await panelHarness(t,{employeePlugins:async()=>completed(scope(),'inspect'),refreshEmployeePlugins:async()=>completed(scope(),'inspect'),updateEmployeePlugins:async(...args)=>writes.push(args)});
  const box=h.all(el=>el.type==='input'&&el.props['aria-label']==='启用插件：设备动态插件')[0];box.props.onChange({target:{checked:true}});await h.settle();h.props.externalBlocked=true;await h.settle();assert.equal(box.props.disabled,true);assert.equal(h.button('保存插件组合').props.disabled,true);h.button('保存插件组合').props.onClick();await h.settle();assert.equal(writes.length,0);assert.equal(h.button('回读状态').props.disabled,false);assert.match(h.text(),/原生管理还有未核实/);
});
