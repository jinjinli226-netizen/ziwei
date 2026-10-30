import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {createDshNative} from './dsh-native.js';
import {DSH_NATIVE_OPERATIONS} from '../../src/dsh-native-contract.mjs';
import {nativeInstallAttempt} from './dsh-native-plugins.js';

async function mount(t,name,values={},callbacks={}){
  async function compile(name){
    const file=new URL('./components/'+name+'.vue',import.meta.url),{descriptor,errors}=parse(await readFile(file,'utf8'));assert.deepEqual(errors,[]);
    const script=compileScript(descriptor,{id:'plugins-'+name}),template=compileTemplate({id:'plugins-'+name,filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
    async function evaluate(source){let code=source;const bindings={};for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
      const spec=match[2];let value;if(spec==='vue')value=vue;else if(spec.endsWith('.vue')){const child=spec.split('/').at(-1).replace('.vue','');value={default:child==='DshPluginsPanel'?{props:['workspace','employee','actorId','active','externalBlocked'],emits:['state'],setup:(props,{emit})=>()=>vue.h('section',{'data-legacy-panel':props.employee.id,'data-active':props.active,'data-blocked':props.externalBlocked,onLegacyState:value=>emit('state',value)},'已发布启动组合')}:await compile(child)};}else value=await import(new URL(spec,file));
      if(match[1].startsWith('{'))for(const part of match[1].slice(1,-1).split(',')){const[key,alias]=part.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];}else bindings[match[1]]=value.default;code=code.replace(match[0],'');
    }return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));}
    const component=await evaluate(script.content);component.render=await evaluate(template.code);return component;
  }
  const component=await compile(name);let state;const setup=component.setup;component.setup=(p,context)=>state=setup(p,context);
  const node=type=>({type,props:{},text:'',children:[],parent:null,style:{}}),remove=el=>{if(el.parent)el.parent.children.splice(el.parent.children.indexOf(el),1);};
  const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:()=>node('#comment'),setText:(el,text)=>el.text=text,setElementText:(el,text)=>{el.text=text;el.children=[];},patchProp:(el,key,_old,value)=>el.props[key]=value,insert(el,parent,anchor){remove(el);el.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,el);},remove,parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null});
  const props=vue.reactive(values),events=[],listeners=Object.fromEntries(component.emits.map(key=>['on'+key.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join(''),value=>{events.push([key,value]);callbacks[key]?.(value);} ])),root=node('root'),app=renderer.createApp({render:()=>vue.h(component,{...props,...listeners})});app.mount(root);t.after(()=>app.unmount());
  const all=(predicate,target=root)=>[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>all(predicate,child))],text=(target=root)=>[target.text,...target.children.map(text)].join(' '),settle=async()=>{await new Promise(setImmediate);await vue.nextTick();};await settle();
  return{props,events,state,all,text,settle,button:label=>all(el=>el.type==='button'&&(el.props['aria-label']===label||text(el).trim()===label))[0],input:label=>all(el=>['input','textarea','select'].includes(el.type)&&el.props['aria-label']===label)[0]};
}

const plugins=()=>({bundles:[{name:'native-bundle',version:'1.2',enabled:true,installed:true,availability:'profile',removable:true},{name:'locked',enabled:true,readOnlyReason:'native-required',removable:false}],plugins:[{entryId:'entry-one',moduleName:'native-tool',patchId:'patch-one',enabled:true,fiberPhase:'active'},{entryId:'entry-two',moduleName:'conditional',enabled:'conditional',fiberPhase:null,readOnlyReason:'preset'}],inventory:{agentPresets:[{id:'standard',rows:[{moduleName:'preset-tool',fiberPhase:'pending'}]}]}});

test('runtime actions use exact bundle and entry identifiers, and removal requires confirmation',async t=>{
  const h=await mount(t,'DshRuntimePlugins',{value:plugins(),editable:true,busy:false,canOperate:()=>true,namespaces:['patch-one']});
  assert.match(h.text(),/1\.2/);assert.match(h.text(),/active/);h.button('停用插件包：native-bundle').props.onClick();h.button('停用运行条目：entry-one').props.onClick();h.button('配置运行条目：entry-one').props.onClick();
  assert.deepEqual(h.events,[['action',{operation:'setBundleEnabled',input:{name:'native-bundle',enabled:false}}],['action',{operation:'setPluginEnabled',input:{id:'entry-one',enabled:false}}],['configure','patch-one']]);
  h.button('卸载插件包：native-bundle').props.onClick();await h.settle();assert.equal(h.events.length,3);h.button('确认卸载插件包').props.onClick();assert.deepEqual(h.events.at(-1),['action',{operation:'removeBundle',input:{name:'native-bundle'}}]);
  assert.equal(h.button('停用插件包：locked').props.disabled,true);assert.equal(h.button('启用运行条目：entry-two'),undefined);
});

test('runtime search retains native phase and unsupported operations stay disabled',async t=>{
  const h=await mount(t,'DshRuntimePlugins',{value:plugins(),editable:true,canOperate:()=>false});assert.equal(h.button('停用插件包：native-bundle').props.disabled,true);assert.match(h.text(),/尚未接入/);
  h.input('搜索运行插件').props.onInput({target:{value:'entry-one'}});await h.settle();assert.match(h.text(),/native-tool/);assert.doesNotMatch(h.text(),/conditional/);
});

const page=()=>({title:'原生索引',total:2,nextOffset:20,fetchedAt:123,entries:[{name:'plugin-demo',title:'动态插件',description:'来自当前索引',defaultVersion:'2.0',installation:{status:'update-available',installedVersion:'1.0'},versions:[{version:'2.0',compatibility:{compatible:true},install:{spec:'plugin-demo@2.0',registry:'https://registry.example.test'}},{version:'3.0',compatibility:{compatible:false,exempted:false},install:{spec:'plugin-demo@3.0'}}]}]});
test('market search pagination and selected versions use only original native page metadata',async t=>{
  const h=await mount(t,'DshPluginMarket',{indexes:[{url:'https://index.example.test',title:'索引'}],page:null,editable:true,canOperate:()=>true});
  h.input('搜索原生插件市场').props.onInput({target:{value:'demo'}});h.button('搜索市场').props.onClick();assert.deepEqual(h.events[0],['action',{operation:'search',input:{url:'https://index.example.test',query:{text:'demo',sort:{kind:'relevance'},offset:0,limit:20}}}]);
  h.props.page=page();await h.settle();h.button('下一页').props.onClick();assert.equal(h.events.at(-1)[1].input.query.fetchedAt,123);assert.equal(h.events.at(-1)[1].input.query.offset,20);
  h.button('检查安装版本：plugin-demo').props.onClick();assert.deepEqual(h.events.at(-1),['inspect',{spec:'plugin-demo@2.0',registry:'https://registry.example.test',replaceName:'plugin-demo'}]);
  const option=h.all(el=>el.type==='option'&&el.props.value==='3.0')[0];assert.equal(option.props.disabled,true);
});

test('installation requires accepted source receipt and never treats unknown or cancel request as success',async t=>{
  const h=await mount(t,'DshPluginInstall',{source:{spec:'plugin-demo@2.0'},inspection:null,attempt:null,editable:true,canOperate:()=>true});assert.equal(h.button('确认安装').props.disabled,true);h.button('检查插件来源').props.onClick();assert.deepEqual(h.events[0],['inspect',{spec:'plugin-demo@2.0'}]);
  h.props.inspection={actionId:'inspect-action',input:{spec:'plugin-demo@2.0'},data:{status:'accepted',bundle:true,name:'plugin-demo',version:'2.0'}};await h.settle();h.button('确认安装').props.onClick();assert.deepEqual(h.events.at(-1),['action',{operation:'installBundle',input:{sourceActionId:'inspect-action',enabled:true}}]);
  h.props.attempt={actionId:'install-action',status:'unknown',data:{installActionId:'install-action',log:'safe install log',nativePhase:'applying',nativeCancellation:{status:'too-late'}}};await h.settle();assert.equal(h.button('确认安装').props.disabled,true);assert.match(h.text(),/未确认/);assert.match(h.text(),/safe install log/);h.button('查询原安装回执').props.onClick();assert.deepEqual(h.events.at(-1),['action',{operation:'waitForInstall',input:{sourceActionId:'install-action'}}]);h.button('取消原安装').props.onClick();assert.deepEqual(h.events.at(-1),['action',{operation:'cancelInstall',input:{sourceActionId:'install-action'}}]);
});

test('replacement and build script approval require explicit choices from the original receipt',async t=>{
  const h=await mount(t,'DshPluginInstall',{source:{spec:'plugin-demo@2.0',replaceName:'plugin-demo'},inspection:{actionId:'inspection',input:{spec:'plugin-demo@2.0'},data:{status:'accepted',bundle:true}},attempt:null,editable:true,canOperate:()=>true});
  assert.equal(h.button('确认安装').props.disabled,true);const replacement=h.all(el=>el.type==='input'&&el.props.type==='checkbox')[1];replacement.props.onChange({target:{checked:true}});await h.settle();h.button('确认安装').props.onClick();assert.equal(h.events.at(-1)[1].input.replaceName,'plugin-demo');
  h.props.attempt={actionId:'original-install',status:'failed',data:{installActionId:'original-install',receipt:{application:'failed',pendingBuilds:['build-a','build-b']}}};await h.settle();assert.equal(h.button('批准所选构建并重试安装').props.disabled,true);h.all(el=>el.type==='input'&&el.props.type==='checkbox')[2].props.onChange({target:{checked:true}});await h.settle();h.button('批准所选构建并重试安装').props.onClick();assert.deepEqual(h.events.at(-1),['action',{operation:'installBundle',input:{sourceActionId:'original-install',enabled:true,approvedBuilds:['build-a']}}]);
});

function nativeFixture(t,outcome=()=>({status:'applied',data:{}}),unsupported=[]){
  const subject={workspace:'team',employeeId:'employee',deviceId:'pc',profile:'alpha',runtime:'DSH'},scope={kind:'bot'},calls=[];
  const description={writable:true,namespaces:[{ns:'patch-one',revision:7,applies:'live',value:{label:'base'},secrets:[],schema:{uid:1,refs:{1:{type:'object',dict:{label:2,headers:3}},2:{type:'string'},3:{type:'dict',inner:2,meta:{role:'secret'}}}}}]};
  const view=()=>({schemaVersion:1,workspace:'team',employeeId:'employee',subject,scope,subjectHash:'native-subject-hash',resources:{plugins:{status:'observed',stale:false,data:plugins()},settings:{status:'observed',stale:false,data:description},market:{status:'observed',stale:false,data:{indexes:[{url:'https://index.example.test',title:'native index'}]}}},pending:[]});
  let sequence=0;const api={dshNativeState:async()=>view(),dshNativeCapabilities:async()=>({schemaVersion:1,workspace:'team',employeeId:'employee',clientReported:true,operations:DSH_NATIVE_OPERATIONS.map(entry=>({...entry,supported:entry.implemented&&!unsupported.includes(entry.resource+'.'+entry.operation)}))}),submitDshNative:async(id,body)=>{calls.push(body);const result=outcome(body),action={id:'action-'+(++sequence),status:'succeeded',type:'employee.dsh.operation',payload:{dshOperation:{subject,scope,resource:body.resource,operation:body.operation}},result:{dshNative:{schemaVersion:1,source:'dsh-native',subject,scope,resource:body.resource,operation:body.operation,...result}}};return{...view(),action};}};
  const controller=createDshNative({api,wrap:vue.reactive,storage:null,keyFactory:()=> 'fixture-key-'+sequence,setTimer:()=>0,clearTimer(){}});t.after(()=>controller.dispose());
  return{controller,calls,description,props:{controller,workspace:'team',actorId:'owner',employee:{id:'employee',target_device_id:'pc',runtime_profile:'alpha',runtime:'DSH'},active:true}};
}

test('aggregate panel preserves the legacy combination and routes runtime events through the shared controller',async t=>{
  const fixture=nativeFixture(t);await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});const h=await mount(t,'DshNativePluginsPanel',fixture.props);
  assert.equal(h.all(el=>el.props['data-legacy-panel']==='employee').length,1);h.button('运行条目').props.onClick();await h.settle();h.button('停用运行条目：entry-one').props.onClick();await h.settle();assert.equal(fixture.calls.length,1);assert.equal(fixture.calls[0].resource,'plugins');assert.deepEqual(fixture.calls[0].input,{id:'entry-one',enabled:false});
  h.props.employee={...h.props.employee,id:'other'};await h.settle();assert.doesNotMatch(h.text(),/native-tool/);assert.match(h.text(),/核对当前员工/);
});

test('aggregate panel takes market/inspection results from their real action and keeps unsupported install disabled',async t=>{
  const fixture=nativeFixture(t,body=>body.operation==='search'?{status:'observed',data:page()}:{status:'observed',data:{status:'accepted',bundle:true,name:'plugin-demo',version:'2.0'}},['plugins.installBundle']);await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});const h=await mount(t,'DshNativePluginsPanel',fixture.props);
  h.button('插件市场').props.onClick();await h.settle();h.button('搜索市场').props.onClick();await h.settle();assert.match(h.text(),/动态插件/);h.button('检查安装版本：plugin-demo').props.onClick();await h.settle();assert.equal(fixture.calls.at(-1).operation,'inspectSource');assert.equal(fixture.calls.at(-1).input.spec,'plugin-demo@2.0');assert.match(h.text(),/原生已接受来源/);assert.equal(h.button('确认安装').props.disabled,true);h.button('确认安装').props.onClick();await h.settle();assert.equal(fixture.calls.filter(row=>row.operation==='installBundle').length,0);
});

test('aggregate settings preserves unknown drafts and blocks the legacy writer',async t=>{
  const fixture=nativeFixture(t,()=>({status:'unknown',data:{writeAccepted:true}}));await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});const h=await mount(t,'DshNativePluginsPanel',{...fixture.props,secureAvailable:true});
  h.button('插件配置').props.onClick();await h.settle();h.input('label').props.onInput({target:{value:'draft'}});h.all(el=>el.type==='form')[0].props.onSubmit({preventDefault(){}});await h.settle();assert.equal(fixture.calls[0].operation,'mutate');assert.equal(h.input('label').props.value,'draft');assert.ok(fixture.controller.state.request);assert.match(h.text(),/原生结果未知/);assert.equal(h.all(el=>el.props['data-legacy-panel'])[0].props['data-blocked'],true);
});

test('legacy pending request keeps its tracker active and blocks new native writes',async t=>{
  const fixture=nativeFixture(t);await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});const h=await mount(t,'DshNativePluginsPanel',fixture.props),legacy=h.all(el=>el.props['data-legacy-panel'])[0];
  legacy.props.onLegacyState({busy:false,pending:true});h.button('运行条目').props.onClick();await h.settle();assert.equal(legacy.props['data-active'],true);assert.equal(h.button('停用运行条目：entry-one').props.disabled,true);h.button('停用运行条目：entry-one').props.onClick();await h.settle();assert.equal(fixture.calls.length,0);assert.match(h.text(),/启动组合还有未核实/);
  legacy.props.onLegacyState({busy:false,pending:false});await h.settle();assert.equal(h.button('停用运行条目：entry-one').props.disabled,false);
});

test('aggregate secret settings use only the external secure event and capability gates secret editing',async t=>{
  const fixture=nativeFixture(t);await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});const h=await mount(t,'DshNativePluginsPanel',fixture.props);h.button('插件配置').props.onClick();await h.settle();assert.equal(h.input('headers').props.disabled,true);
  h.props.secureAvailable=true;await h.settle();h.input('headers').props.onInput({target:{value:'{"Authorization":"private"}'}});h.input('label').props.onInput({target:{value:'changed'}});h.all(el=>el.type==='form')[0].props.onSubmit({preventDefault(){}});await h.settle();assert.equal(fixture.calls.length,0);assert.deepEqual(h.events,[['secure',{resource:'settings',operation:'mutateSecure',input:{ns:'patch-one',expectedRevision:7},secret:{ops:[{op:'set',path:['label'],value:'changed'},{op:'set',path:['headers'],value:{Authorization:'private'}}]}}]]);assert.equal(h.input('headers').props.value,'');
  h.props.secureBusy=true;await h.settle();assert.equal(h.input('label').props.disabled,true);assert.equal(h.all(el=>el.props['data-legacy-panel'])[0].props['data-blocked'],true);h.all(el=>el.type==='form')[0].props.onSubmit({preventDefault(){}});await h.settle();assert.equal(fixture.calls.length,0);
});

test('aggregate restores original install evidence and honors supported native install without enabling it implicitly',async t=>{
  const fixture=nativeFixture(t,body=>body.operation==='inspectSource'?{status:'observed',data:{status:'accepted',bundle:true,name:'plugin-demo',version:'2.0'}}:{status:'unknown',data:{installActionId:'action-2',log:'original install log'}});await fixture.controller.select({workspace:'team',actorId:'owner',employeeId:'employee'},{active:true});
  const h=await mount(t,'DshNativePluginsPanel',fixture.props);h.button('安装任务').props.onClick();await h.settle();h.input('原生插件安装来源').props.onInput({target:{value:'plugin-demo@2.0'}});h.button('检查插件来源').props.onClick();await h.settle();h.all(el=>el.type==='input'&&el.props.type==='checkbox').at(-1).props.onChange({target:{checked:false}});await h.settle();h.button('确认安装').props.onClick();await h.settle();assert.deepEqual(fixture.calls.at(-1).input,{sourceActionId:'action-1',enabled:false});assert.match(h.text(),/original install log/);assert.equal(h.button('查询原安装回执').props.disabled,false);assert.equal(h.button('取消原安装').props.disabled,false);
  const reopened=await mount(t,'DshNativePluginsPanel',fixture.props);reopened.button('安装任务').props.onClick();await reopened.settle();assert.match(reopened.text(),/original install log/);assert.match(reopened.text(),/action-2/);assert.equal(reopened.button('查询原安装回执').props.disabled,false);
});

test('native install attempt keeps original identity and enabled choice across wait and cancellation',()=>{
  const action=(operation,id,status,data)=>({id,status:'succeeded',payload:{dshOperation:{operation}},result:{dshNative:{status,data}}});
  const original=nativeInstallAttempt(action('installBundle','original','unknown',{installActionId:'original',log:'first'}),null,{enabled:false});assert.equal(original.enabled,false);
  const cancelled=nativeInstallAttempt(action('cancelInstall','cancel-control','observed',{installActionId:'original',nativeCancellation:{status:'too-late'}}),original,{sourceActionId:'original'});assert.equal(cancelled.actionId,'original');assert.equal(cancelled.status,'unknown');assert.equal(cancelled.enabled,false);assert.equal(cancelled.data.log,'first');
  const waited=nativeInstallAttempt(action('waitForInstall','wait-control','applied',{installActionId:'original',log:'final'}),cancelled);assert.equal(waited.actionId,'original');assert.equal(waited.status,'applied');assert.equal(waited.data.nativeCancellation,undefined);
});
