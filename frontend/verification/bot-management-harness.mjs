import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import * as icons from 'lucide-vue-next';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {defaultBotConfig} from '../src/bot-workbench.js';

const components=new URL('../src/components/',import.meta.url);
const escaped=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export function managerFixture(){
  const bot={id:'employee_hermes',workspace:'preview',revision:3,control_epoch:2,configuration_state:'configured',control_state:'active',employee:{id:'employee_hermes',name:'领航 · AI 出海新风向',description:'整理行业信息、撰写内容，与团队一起交付。',runtime:'Hermes',runtime_profile:'bot-navigator',target_device_id:'pc-preview',model_id:'deepseek-flash',status:'active',visibility:'workspace',skills:[]},config:{...defaultBotConfig(),provider:'deepseek'},validation:{status:'succeeded',revision:3},capabilities:[],main_conversation_id:'conversation_hermes',instance:{mode:'owned_profile',profile:'bot-navigator',templateProfile:'default',home:'D:/Ziwei/Bots/navigator',ownershipId:'owned-preview',provisioning:{actionId:'provision-preview',status:'provisioned',authentication:'configured'}},latest_run:null};
  const external=(id,name,runtime,description)=>({id,workspace:'preview',employee:{id,name,runtime,description,runtime_profile:runtime==='Codex'?null:'native-bot',target_device_id:'pc-preview',status:'active',visibility:'workspace'},main_conversation_id:'conversation_'+id});
  return{bot,roster:[bot,external('employee_dsh','社群主理人','DSH','社群内容策划与日常运营'),external('employee_codex','网站运维伙伴','Codex','维护网站、检查部署与运行记录')],discovery:{workspace:'preview',devices:[{id:'pc-preview',name:'工作电脑',status:'online',healthy:true,runtimes:[{name:'Hermes',cli_status:'available',profiles:[{name:'bot-navigator',owned_profile:true,initialization_source:false},{name:'default',authentication_configured:true}]}]}]},routines:[{id:'routine-preview',name:'每日行业简报',status:'active',next_run:'2026-10-30T01:00:00Z',timezone:'Asia/Shanghai',schedule:'0 9 * * *',prompt:'整理今日行业信息。'}],runs:[]};
}

function placeholder(name){return{name,inheritAttrs:false,setup(){return()=>vue.h('div',{'data-fixture-component':name});}};}

async function loadComponent(name,api,cache=new Map()){
  if(cache.has(name))return cache.get(name);
  const filename=new URL(name+'.vue',components),{descriptor,errors}=parse(await readFile(filename,'utf8'),{filename:filename.pathname});
  if(errors.length)throw new Error(JSON.stringify(errors));
  const id='management-'+name,script=compileScript(descriptor,{id}),template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id,compilerOptions:{bindingMetadata:script.bindings}});
  if(template.errors.length)throw new Error(JSON.stringify(template.errors));
  async function evaluate(source,exportReplacement){
    const bindings={};let code=source;
    for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
      const [statement,specifier,spec]=match;let value;
      if(spec==='vue')value={...vue,defineAsyncComponent:()=>placeholder('BotNativeWorkspace')};
      else if(spec==='lucide-vue-next')value=icons;
      else if(spec==='../api.js')value={api,API_BASE:'https://preview.invalid'};
      else if(spec==='@ziwei/ui')value=new Proxy({},{get:(_target,key)=>placeholder(key)});
      else if(spec.endsWith('.vue')){
        const child=spec.split('/').at(-1).replace('.vue','');
        value={default:['ZiSelect','BotInstancePanel'].includes(child)?await loadComponent(child,api,cache):placeholder(child)};
      }else value=await import(new URL(spec,filename));
      if(specifier.startsWith('{'))for(const token of specifier.slice(1,-1).split(',')){
        const [key,alias]=token.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];
      }else bindings[specifier]=value.default;
      code=code.replace(statement,'');
    }
    code=code.replaceAll('import.meta.env','({VITE_ZIWEI_PREVIEW:"true"})').replace(...exportReplacement);
    return new Function(...Object.keys(bindings),'setTimeout','clearTimeout',code)(...Object.values(bindings),()=>0,()=>{});
  }
  const component=await evaluate(script.content,['export default','return']);
  component.render=await evaluate(template.code,['export function render','return function render']);
  if(descriptor.styles.some(style=>style.scoped))component.__scopeId='data-v-'+id;
  cache.set(name,component);return component;
}

export async function createManagerHarness({fixture=managerFixture(),initial={},shell=false}={}){
  const previous={document:globalThis.document,window:globalThis.window,localStorage:globalThis.localStorage};
  const listeners=new Map(),body=node('body');
  globalThis.document={hidden:false,body,addEventListener(){},removeEventListener(){},getElementById(){return null;}};
  globalThis.window={innerWidth:1600,innerHeight:1000,addEventListener(){},removeEventListener(){},confirm:()=>true};
  globalThis.localStorage={getItem(){return null;},setItem(){}};
  const calls=[],events=[];
  const api={bots:async workspace=>{calls.push(['bots',workspace]);return{bots:fixture.roster};},botWorkbench:async(id,workspace)=>{calls.push(['bot',id,workspace]);return fixture.bot;},botRuns:async(id,workspace)=>{calls.push(['runs',id,workspace]);return{runs:fixture.runs};},botRoutines:async(id,workspace)=>{calls.push(['routines',id,workspace]);return{routines:fixture.routines};},managementMcpDiscovery:async workspace=>{calls.push(['discovery',workspace]);if(fixture.discoveryError)throw fixture.discoveryError;return fixture.discovery;},botForceAbandonStatus:async()=>({eligible:false,state:'none'}),updateBot:async(id,body,workspace)=>{calls.push(['save',id,body,workspace]);fixture.bot={...fixture.bot,revision:fixture.bot.revision+1,employee:{...fixture.bot.employee,...body.employee,model_id:body.employee.model},config:body.config};fixture.roster[0]=fixture.bot;return fixture.bot;}};
  const cache=new Map(),component=await loadComponent('BotWorkbench',api,cache);
  let setupState;const setup=component.setup;component.setup=(props,context)=>{setupState=setup(props,context);return setupState;};
  const props=vue.reactive({workspace:'preview',actorId:'fixture-owner',botId:fixture.bot.id,models:[],skills:[],initialTab:'chat',...initial});
  const renderer=vue.createRenderer({
    createElement:node,createText:text=>({...node('#text'),text}),createComment:text=>({...node('#comment'),text}),
    setText:(target,text)=>target.text=text,setElementText:(target,text)=>{target.text=text;target.children=[];},
    patchProp:(target,key,_previous,value)=>{target.props[key]=value;if(key==='value')target.value=value;},
    insert(child,parent,anchor){remove(child);child.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,child);},
    remove,parentNode:target=>target.parent,nextSibling:target=>target.parent?.children[target.parent.children.indexOf(target)+1]||null,
    querySelector:()=>body,setScopeId:(target,id)=>target.props[id]='',
  });
  const on=Object.fromEntries(['select','section','chat','employee','creator','phone','changed','employee-chat','employee-settings'].map(key=>['on'+key.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join(''),value=>events.push([key,value])]));
  const child=()=>vue.h(component,{...props,...on});
  const root=node('root');
  const shellComponent=shell?await loadComponent('WorkspaceShell',api,cache):null;
  const app=renderer.createApp({render:()=>shellComponent?vue.h(shellComponent,{page:'bots',language:'zh-CN',workspace:{name:'示例工作区',slug:'preview'},account:{name:'示例账号',role:'owner'}},{default:()=>vue.h('div',{class:'content'},child())}):child()});
  app.mount(root);await settle();
  function node(type){return{type,props:{},children:[],parent:null,text:'',style:{},value:'',addEventListener(key,handler){listeners.set(this, {...listeners.get(this),[key]:handler});},removeEventListener(){},getBoundingClientRect:()=>({left:600,top:110,bottom:145,width:180}),focus(){},contains:()=>false};}
  function remove(child){if(child.parent){const siblings=child.parent.children;siblings.splice(siblings.indexOf(child),1);child.parent=null;}}
  function findAll(predicate,target=root){return[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>findAll(predicate,child))];}
  function text(target=root){return target.type==='#comment'?'':[target.text,...target.children.map(child=>text(child))].join('');}
  const byClass=name=>findAll(target=>String(target.props.class||'').split(/\s+/).includes(name));
  const button=label=>findAll(target=>target.type==='button'&&text(target).trim()===label)[0];
  function html(target=root){
    if(target.type==='#comment')return'';if(target.type==='#text')return escaped(target.text);if(target.type==='root')return target.children.map(html).join('');
    const attributes={...target.props,...(Object.keys(target.style).length?{style:{...target.props.style,...target.style}}:{}),...(target.type==='input'&&target.value?{value:target.value}:{}),...(target.checked?{checked:true}:{})};
    const attrs=Object.entries(attributes).filter(([key,value])=>!key.startsWith('on')&&!['innerHTML','textContent','ref'].includes(key)&&value!==null&&value!==undefined&&(value!==false||key.startsWith('aria-'))).map(([key,value])=>` ${key}="${escaped(key==='style'?Object.entries(value).map(([k,v])=>k.replace(/[A-Z]/g,s=>'-'+s.toLowerCase())+':'+v).join(';'):value)}"`).join('');
    return`<${target.type}${attrs}>${escaped(target.type==='textarea'?target.value:target.text)}${target.children.map(html).join('')}</${target.type}>`;
  }
  return{props,fixture,calls,events,root,body,text,findAll,byClass,button,html,get state(){return setupState;},async settle(){await settle();},dispose(){app.unmount();Object.assign(globalThis,previous);}};
}

async function settle(){for(let i=0;i<4;i++){await vue.nextTick();await new Promise(setImmediate);}}
