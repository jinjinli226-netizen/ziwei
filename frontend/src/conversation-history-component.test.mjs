import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import * as vue from 'vue';

const filename=new URL('./components/BotMainChat.vue',import.meta.url);
async function harness(){
  const source=await readFile(filename,'utf8'),{descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  const compiled=compileScript(descriptor,{id:'history-test'});
  const template=compileTemplate({id:'history-test',filename:filename.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:compiled.bindings}});assert.deepEqual(template.errors,[]);
  const bindings={window:{removeEventListener(){}},document:{removeEventListener(){}}},unmount=[];let code=compiled.content;
  for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
    const names=match[1],specifier=match[2];let value;
    if(specifier==='vue')value={...vue,onMounted:()=>{},onBeforeUnmount:callback=>unmount.push(callback)};
    else if(specifier==='lucide-vue-next')value=new Proxy({},{get:()=>({})});
    else if(specifier.endsWith('.vue'))value={default:{}};
    else value=await import(new URL(specifier,filename).href);
    if(names.startsWith('{'))for(const token of names.slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];}
    else bindings[names]=value.default;
    code=code.replace(match[0],'');
  }
  const component=new Function(...Object.keys(bindings),code.replace('export default','return'))(...Object.values(bindings)),events=[];
  const props=vue.reactive({bot:{id:'bot-a',employee:{name:'Fixture'}},conversation:{id:'chat-a',messages:[{id:'current',content:'current'}],messagePage:{hasMore:true}},execution:null,events:[],attachments:[],historyLoading:false,historyError:''});
  const ui=component.setup(props,{expose(){},emit:(...args)=>events.push(args)});
  await vue.nextTick();await vue.nextTick();
  return {ui,props,events,dispose:()=>unmount.forEach(callback=>callback())};
}
function viewport(){
  let top=100,phase=0;const node={clientHeight:300,get scrollHeight(){return phase===0?1000:phase===1?1600:1800;},get scrollTop(){return top;},set scrollTop(value){top=Math.min(Math.max(value,0),this.scrollHeight-this.clientHeight);},getBoundingClientRect:()=>({top:0}),querySelectorAll:()=>[{dataset:{messageId:'current'},getBoundingClientRect:()=>({top:(phase===0?80:phase===1?680:880)-top,bottom:(phase===0?200:phase===1?800:1000)-top})}]};
  return {node,setPhase:value=>phase=value};
}

test('the work panel waits for an explicit open before requesting heavy work records',async()=>{
  const h=await harness();try{assert.equal(h.ui.panel.value,false);assert.deepEqual(h.events,[]);h.ui.toggleWorkPanel();assert.deepEqual(h.events,[['refresh-work']]);h.ui.toggleWorkPanel();assert.equal(h.events.length,1);}finally{h.dispose();}
});

test('initial/programmatic scroll cannot drain history; an intentional up-scroll issues one request and exposes retry',async()=>{
  const h=await harness();try{
    const {node}=viewport();node.scrollTop=20;h.ui.timeline.value=node;
    h.ui.timelineScrolled({currentTarget:node});assert.deepEqual(h.events,[]);
    h.ui.timelineWheel({deltaY:-1});h.ui.timelineWheel({deltaY:-1});assert.deepEqual(h.events,[['load-history']]);
    h.props.historyLoading=true;await vue.nextTick();h.ui.timelineWheel({deltaY:-1});assert.equal(h.events.length,1);
    h.props.historyError='Read failed';h.props.historyLoading=false;await vue.nextTick();h.ui.timelineWheel({deltaY:-1});assert.equal(h.events.length,1);
    h.ui.requestEarlierHistory();assert.deepEqual(h.events[1],['load-history']);
  }finally{h.dispose();}
});

test('prepend and a late image preserve the reader anchor instead of jumping to the latest message',async()=>{
  const h=await harness();try{
    const {node,setPhase}=viewport();h.ui.timeline.value=node;h.ui.followLatest.value=false;
    h.props.conversation={...h.props.conversation,messages:[{id:'older',content:'older'},{id:'current',content:'current'}]};
    await vue.nextTick();setPhase(1);await vue.nextTick();
    assert.equal(node.scrollTop,700);assert.equal(h.ui.followLatest.value,false);
    setPhase(2);h.ui.timelineMediaLoaded();await vue.nextTick();assert.equal(node.scrollTop,900);
    h.props.conversation={...h.props.conversation,messages:[...h.props.conversation.messages,{id:'new',content:'new'}]};
    await vue.nextTick();await vue.nextTick();assert.equal(node.scrollTop,900);
  }finally{h.dispose();}
});
