import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import * as vue from 'vue';
import {renderToString} from '@vue/server-renderer';

async function harness(){
 const file=new URL('./components/MixedGroupPanel.vue',import.meta.url),{descriptor}=parse(await readFile(file,'utf8'));
 const compiled=compileScript(descriptor,{id:'mixed-attachments'}),template=compileTemplate({id:'mixed-attachments',filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:compiled.bindings}});
 assert.deepEqual(template.errors,[]);
 let code=compiled.content;const cleanups=[],calls=[],bindings={};
 const group={id:'mix_fixture',workspace:'test',title:'Group',members:[{employeeId:'a',name:'A',runtime:'DSH',profile:'a',conversationId:'conv-a'},{employeeId:'b',name:'B',runtime:'Codex',profile:'b',conversationId:'conv-b'}],messages:[],runs:[]};
 let failSend=true;
 const api={mixedGroups:async()=>({groups:[group]}),mixedGroup:async()=>group,
 uploadConversationAttachment:async(id,file,{onProgress})=>{calls.push({type:'upload',id,file});onProgress({loaded:file.size,total:file.size});return{attachmentId:'ref-a',size:file.size,name:file.name,mimeType:'text/plain',sha256:'a'.repeat(64)};},
 sendMixedGroupMessage:async(id,body)=>{calls.push({type:'send',id,body});if(failSend)throw new Error('receipt lost');},
 conversationAttachmentUrl:(id,ref,{download=false}={})=>'/api/conversations/'+id+'/attachments/'+ref+(download?'?download=1':'')};
 for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
  const names=match[1],specifier=match[2],value=specifier==='vue'?{...vue,onBeforeUnmount:fn=>cleanups.push(fn)}:specifier==='../api.js'?{api}:await import(new URL(specifier,file).href);
  for(const token of names.slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];}
  code=code.replace(match[0],'');
 }
 const component=new Function(...Object.keys(bindings),code.replace('export default','return'))(...Object.values(bindings));
 const props=vue.reactive({workspace:'test',groupId:'mix_fixture',employee:null,employees:[],embedded:false});
 const ui=component.setup(props,{expose(){},emit(){}});await vue.nextTick();await vue.nextTick();
 const renderBindings={};
 let renderCode=template.code.replace(/^import \{([^}]+)\} from ["']vue["']/gm,(_,list)=>{for(const token of list.split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);renderBindings[alias||name]=vue[name];}return '';}).replace('export function render','function render');
 const render=new Function(...Object.keys(renderBindings),renderCode+';return render')(...Object.values(renderBindings));
 return {ui,props,calls,group,allowSend(){failSend=false;},render:async()=>renderToString(vue.createSSRApp({setup:()=>ui,render(){return render.call(this,this,[],props,vue.proxyRefs(ui),{},{});}})),dispose(){cleanups.forEach(fn=>fn());}};
}
test('real mixed composer retains original File and message key after lost send receipt; file-only dispatch uses member scope',async()=>{
 const h=await harness();try{
  const file=new File(['hello'],'report.txt',{type:'text/plain'}),event={target:{files:[file],value:'selected'}};
  h.ui.chooseFiles(event);assert.equal(event.target.value,'');assert.equal(h.ui.files.value[0].file,file);
  await h.ui.send();assert.match(h.ui.error.value,/未确认/);assert.equal(h.ui.files.value[0].file,file);
  const first=h.calls.find(call=>call.type==='send');assert.equal(first.body.content,'');assert.equal(first.body.attachmentSourceConversationId,'conv-a');
  h.allowSend();await h.ui.send();const sends=h.calls.filter(call=>call.type==='send');assert.equal(sends[0].body.messageId,sends[1].body.messageId);assert.equal(h.ui.files.value.length,0);
 }finally{h.dispose();}
});
test('actual mixed Vue renderer previews only small raster images and links large files without loading content',async()=>{
 const h=await harness();try{
  const base={attachmentId:'ref-image',conversationId:'conv-b',name:'picture.png',mimeType:'image/png',size:8,url:'/api/safe'};
  h.ui.selected.value={...h.group,messages:[{id:'reply',role:'assistant',text:'Done',attachments:[base,{...base,attachmentId:'ref-large',name:'large.png',size:500*1024*1024}]}]};
  const html=await h.render();
  assert.match(html,/src="\/api\/conversations\/conv-b\/attachments\/ref-image"/);
  assert.doesNotMatch(html,/src="[^"]*ref-large/);assert.match(html,/href="\/api\/conversations\/conv-b\/attachments\/ref-large\?download=1"/);assert.doesNotMatch(html,/base64/);
 }finally{h.dispose();}
});
