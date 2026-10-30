import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import * as icons from 'lucide-vue-next';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';

const filename=new URL('./components/BotMainChat.vue',import.meta.url);
async function compile(name='BotMainChat',now=()=>Date.now()){
  const file=new URL('./components/'+name+'.vue',import.meta.url),{descriptor,errors}=parse(await readFile(file,'utf8'));
  assert.deepEqual(errors,[]);const script=compileScript(descriptor,{id:'employee-chat-'+name});
  const template=compileTemplate({id:'employee-chat-'+name,filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  async function evaluate(source){
    let code=source;const bindings={};
    for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
      const [statement,names,spec]=match;let value;
      if(spec==='vue')value=vue;
      else if(spec==='lucide-vue-next')value=icons;
      else if(spec.endsWith('.vue'))value={default:spec.endsWith('ConversationQueuePanel.vue')?await compile('ConversationQueuePanel',now):{render:()=>null}};
      else{value=await import(new URL(spec,file));if(spec.endsWith('/conversation-compose.js')){const guard=value.createConversationEnterGuard;value={...value,createConversationEnterGuard:()=>guard({now})};}}
      if(names.startsWith('{'))for(const part of names.slice(1,-1).split(',')){const [key,alias]=part.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];}else bindings[names]=value.default;
      code=code.replace(statement,'');
    }
    return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));
  }
  const component=await evaluate(script.content);component.render=await evaluate(template.code);return component;
}
async function harness(t,overrides={},options={}){
  const previous={document:globalThis.document,window:globalThis.window};
  globalThis.document={addEventListener(){},removeEventListener(){},querySelector(){return null;}};
  globalThis.window={innerWidth:1200,innerHeight:900,addEventListener(){},removeEventListener(){}};
  const events=[],employee={id:'codex-employee',name:'代码伙伴',runtime:'Codex',status:'active',runtime_profile:null};
  const props=vue.reactive({managed:false,employee,bot:null,conversation:{id:'codex-chat-one',employee_id:employee.id,title:'独立开发会话',messages:[],queue:{count:0,paused:false,items:[]}},events:[],draft:'继续当前工作',...overrides});
  const component=await compile('BotMainChat',options.now),original=component.setup;let state;
  component.setup=(p,context)=>{state=original(p,context);return state;};
  const node=type=>({type,props:{},children:[],text:'',parent:null,scrollTop:0,scrollHeight:1200,clientHeight:300,getBoundingClientRect:()=>({left:0,top:0,right:900,bottom:300}),querySelectorAll:()=>[]});
  const remove=child=>{if(child.parent){const siblings=child.parent.children;siblings.splice(siblings.indexOf(child),1);child.parent=null;}};
  const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:text=>({...node('#comment'),text}),setText:(el,text)=>el.text=text,setElementText:(el,text)=>{el.text=text;el.children=[];},patchProp:(el,key,_previous,value)=>el.props[key]=value,insert(child,parent,anchor){remove(child);child.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,child);},remove,parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null});
  const callbacks=Object.fromEntries(component.emits.map(name=>['on'+name.split('-').map(p=>p[0].toUpperCase()+p.slice(1)).join(''),(...args)=>events.push([name,...args])]));
  const root=node('root'),app=renderer.createApp({render:()=>vue.h(component,{...props,...callbacks},options.slots||{})});app.mount(root);
  const settle=async()=>{await vue.nextTick();await vue.nextTick();};await settle();
  t.after(()=>{app.unmount();Object.assign(globalThis,previous);});
  function all(predicate,target=root){return[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>all(predicate,child))];}
  function text(target=root){return target.type==='#comment'?'':[target.text,...target.children.map(text)].join('');}
  const button=label=>all(el=>el.type==='button'&&(el.props['aria-label']===label||text(el).trim()===label))[0];
  return{props,events,state,root,all,text,button,settle};
}

for(const runtime of ['Codex','DSH','Hermes','Claude'])test(`${runtime} employee uses the shared real conversation view without a synthetic Bot`,async t=>{
  const h=await harness(t,{employee:{id:'e-'+runtime,name:runtime+'伙伴',runtime,status:'active'}});
  assert.equal(h.all(el=>el.props['aria-label']==='员工聊天').length,1);assert.equal(h.state.presence.value.tone,'muted');
  assert.match(h.text(),/员工已启用/);assert.doesNotMatch(h.text(),/主聊天|Bot 能力|例行工作|手机互联|已就绪/);
  assert.equal(h.state.blockedReason.value,'');assert.equal(h.state.canFinalize.value,false);assert.equal(h.all(el=>el.props['data-bot-id']).length,0);
  assert.equal(h.all(el=>el.props['data-employee-id']==='e-'+runtime).length,1);assert.equal(h.all(el=>el.props['data-conversation-id']==='codex-chat-one').length,1);
});

test('ordinary employees retain history, create, archive and checked current-directory actions',async t=>{
  const h=await harness(t);h.button('会话历史').props.onClick();h.button('新建会话').props.onClick();
  assert.deepEqual(h.events,[['history'],['new-conversation']]);
  h.button('更多能力').props.onClick({currentTarget:{getBoundingClientRect:()=>({left:0,top:0,bottom:30})}});await h.settle();
  assert.equal(h.button('手机互联'),undefined);assert.equal(h.button('例行工作'),undefined);
  h.button('使用电脑当前目录').props.onClick();assert.deepEqual(h.events.at(-1),['directory',{useDeviceDefault:true}]);
  h.button('更多能力').props.onClick({currentTarget:{}});await h.settle();h.button('归档当前会话').props.onClick();assert.deepEqual(h.events.at(-1),['archive-conversation']);
});

test('compact message actions keep forwarding and selection bound to each original message',async t=>{
  const messages=[{id:'message-user',role:'user',content:'用户消息'},{id:'message-assistant',role:'assistant',content:'助手回复'}];
  const h=await harness(t,{conversation:{id:'chat-actions',messages},forwardSelected:[]});
  const forwards=h.all(el=>el.type==='button'&&el.props['aria-label']==='转发此消息');
  const selections=h.all(el=>el.type==='button'&&el.props['aria-label']==='多选消息');
  for(const [index,message]of h.props.conversation.messages.entries()){
    forwards[index].props.onClick();assert.deepEqual(h.events.at(-1),['forward',message]);
    selections[index].props.onClick();assert.deepEqual(h.events.at(-1),['forward-select',message]);
  }
  h.props.forwardSelecting=true;h.props.forwardSelected=['message-assistant'];await h.settle();
  assert.equal(h.button('转发此消息'),undefined);assert.equal(h.button('多选消息'),undefined);
  const selected=h.all(el=>el.type==='input'&&el.props.type==='checkbox'&&el.props.checked)[0];
  selected.props.onChange();assert.deepEqual(h.events.at(-1),['forward-toggle','message-assistant']);
  h.button('转发').props.onClick();assert.deepEqual(h.events.at(-1),['forward-open']);
  h.button('取消').props.onClick();assert.deepEqual(h.events.at(-1),['forward-cancel']);
});

test('the shared model and device popovers render the parent conversation controls with their original scope',async t=>{
  const changes=[],h=await harness(t,{}, {slots:{'conversation-settings':({kind})=>vue.h('button',{onClick:()=>changes.push(kind)},'保存当前会话'+kind)}});
  for(const [label,kind]of [['会话模型','model'],['绑定电脑','device']]){h.button(label).props.onClick({currentTarget:{}});await h.settle();h.button('保存当前会话'+kind).props.onClick();}
  assert.deepEqual(changes,['model','device']);assert.equal(h.events.length,0);
});

test('real event summaries remain available beside tool progress without creating activity',async t=>{
  const h=await harness(t,{execution:{id:'action',status:'acked'},events:[{id:'stage',label:'读取文件',detail:'CLI 工具活动'},{id:'reasoning',label:'公开推理摘要',summary:'这是运行时公开的摘要。',created_at:'2026-10-29T00:00:00Z'}]});
  assert.match(h.text(),/这是运行时公开的摘要/);assert.equal(h.state.reasoningSummaries.value.length,1);assert.equal(h.button('查看原执行与停止回执'),undefined);assert.equal(h.button('核实并恢复回执'),undefined);
  h.props.events=[];await h.settle();assert.equal(h.state.reasoningSummaries.value.length,0);assert.doesNotMatch(h.text(),/公开的摘要/);
});

test('a working ordinary employee queues the next message without exposing a managed stop action',async t=>{
  const h=await harness(t,{execution:{id:'action',status:'acked'},canStop:false});
  assert.ok(h.button('加入队列'));assert.equal(h.button('请求停止当前执行'),undefined);
  assert.match(h.text(),/Enter 加入队列/);
  assert.equal(h.all(el=>String(el.props.class||'').split(' ').includes('bot-chat-progress'))[0].props.open,true);
  h.button('加入队列').props.onClick();assert.deepEqual(h.events.at(-1),['send']);
});

test('managed main chats retain the owned Profile admission gate by default',async t=>{
  const h=await harness(t,{managed:undefined,employee:undefined,bot:{id:'owned-bot',workspace:'preview',employee:{id:'owned-bot',name:'专属伙伴',runtime:'Hermes',runtime_profile:'bot-private'},instance:{mode:'owned_profile',profile:'bot-private',provisioning:{status:'pending'}}}});
  assert.ok(h.state.blockedReason.value);assert.equal(h.button('发送').props.disabled,true);assert.equal(h.button('会话历史'),undefined);assert.match(h.text(),/主聊天/);
});

test('ordinary chat keeps the same IME guard and stream-following policy',async t=>{
  let now=1000;const h=await harness(t,{}, {now:()=>now}),input=h.all(el=>el.type==='textarea')[0];
  const enter=patch=>input.props.onKeydown({key:'Enter',preventDefault(){},...patch});
  input.props.onCompositionstart();enter();input.props.onCompositionend();now+=499;enter();assert.deepEqual(h.events,[]);now++;enter();assert.deepEqual(h.events,[['send']]);
  const timeline=h.state.timeline.value;timeline.scrollTop=100;h.state.followLatest.value=false;h.props.events.push({id:'stream-1',label:'读取中'});await h.settle();assert.equal(timeline.scrollTop,100);
  h.state.followLatest.value=true;h.props.events.push({id:'stream-2',label:'已读取'});await h.settle();assert.equal(timeline.scrollTop,timeline.scrollHeight);
});
