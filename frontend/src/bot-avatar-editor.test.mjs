import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import * as icons from 'lucide-vue-next';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import {AVATAR_SHAPES,AVATAR_COLORS} from '../../src/employee-avatar.mjs';

async function compile(name='BotAvatarEditor'){
  const file=new URL('./components/'+name+'.vue',import.meta.url),{descriptor,errors}=parse(await readFile(file,'utf8'));
  assert.deepEqual(errors,[]);const script=compileScript(descriptor,{id:'avatar-editor-'+name});
  const template=compileTemplate({id:'avatar-editor-'+name,filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  async function evaluate(source){
    const bindings={};let code=source;
    for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
      const [statement,names,spec]=match;let value;
      if(spec==='vue')value=vue;
      else if(spec==='lucide-vue-next')value=icons;
      else if(spec.endsWith('.vue'))value={default:await compile(spec.split('/').at(-1).replace('.vue',''))};
      else value=await import(new URL(spec,file));
      if(names.startsWith('{'))for(const token of names.slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];}
      else bindings[names]=value.default;
      code=code.replace(statement,'');
    }
    return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));
  }
  const component=await evaluate(script.content);component.render=await evaluate(template.code);return component;
}

async function harness(t,initial={}){
  const previousReader=globalThis.FileReader,readers=[];
  globalThis.FileReader=class{
    constructor(){readers.push(this);}
    readAsDataURL(file){this.file=file;}
    complete(value){this.result=value;this.onload?.();}
    fail(){this.onerror?.();}
    abort(){this.aborted=true;this.onabort?.();}
  };
  const props=vue.reactive({modelValue:null,savedValue:null,name:'资料伙伴',identity:'employee-preview',...initial}),events=[];
  const component=await compile(),setup=component.setup;let state;
  component.setup=(p,context)=>{state=setup(p,context);return state;};
  const node=type=>({type,props:{},children:[],parent:null,text:'',click(){this.clicked=true;}});
  const remove=child=>{if(child.parent){const children=child.parent.children;children.splice(children.indexOf(child),1);child.parent=null;}};
  const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:text=>({...node('#comment'),text}),setText:(el,text)=>el.text=text,setElementText:(el,text)=>{el.text=text;el.children=[];},patchProp:(el,key,_previous,value)=>el.props[key]=value,insert(child,parent,anchor){remove(child);child.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,child);},remove,parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null});
  const root=node('root'),app=renderer.createApp({render:()=>vue.h(component,{...props,'onUpdate:modelValue':value=>{events.push(['avatar',value]);props.modelValue=value;},onReading:value=>events.push(['reading',value])})});
  app.mount(root);let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;app.unmount();globalThis.FileReader=previousReader;};t.after(dispose);
  const settle=async()=>{await vue.nextTick();await new Promise(setImmediate);};await settle();
  function all(predicate,target=root){return[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>all(predicate,child))];}
  function text(target=root){return target.type==='#comment'?'':[target.text,...target.children.map(text)].join('');}
  const button=label=>all(el=>el.type==='button'&&(el.props['aria-label']===label||text(el).trim()===label))[0];
  const changes=()=>events.filter(event=>event[0]==='avatar');
  const choose=file=>all(el=>el.type==='input'&&el.props.type==='file')[0].props.onChange({target:{files:[file],value:'chosen'}});
  return{props,events,readers,state,root,text,all,button,changes,choose,settle,dispose};
}

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const file=(type='image/png',size=10)=>({name:'avatar.png',type,size});

test('a confirmed character save discards an expired server image URL instead of offering it again',async t=>{
  const url='/api/workspaces/team/employees/e/avatar?v=old-picture';
  const h=await harness(t,{modelValue:url,savedValue:url});
  h.button('角色头像').props.onClick();await h.settle();h.button('使用此角色头像').props.onClick();await h.settle();
  h.props.savedValue=h.props.modelValue;await h.settle();
  h.button('上传图片').props.onClick();await h.settle();
  assert.equal(h.state.imageValue.value,null);assert.equal(h.button('使用这张图片'),undefined);
});

test('a real local image draft can still be selected after saving a character',async t=>{
  const h=await harness(t,{modelValue:image,savedValue:image});
  h.button('角色头像').props.onClick();await h.settle();h.button('使用此角色头像').props.onClick();await h.settle();
  h.props.savedValue=h.props.modelValue;await h.settle();
  h.button('上传图片').props.onClick();await h.settle();h.button('使用这张图片').props.onClick();await h.settle();
  assert.equal(h.props.modelValue,image);
});

test('mode changes only preview and do not replace the current avatar',async t=>{
  const h=await harness(t,{modelValue:'/api/avatars/photo.png',savedValue:'/api/avatars/photo.png'});
  assert.equal(h.state.mode.value,'image');h.button('角色头像').props.onClick();await h.settle();
  assert.equal(h.state.mode.value,'character');assert.deepEqual(h.changes(),[]);assert.match(h.text(),/仅预览/);
  h.button('上传图片').props.onClick();await h.settle();assert.deepEqual(h.changes(),[]);assert.equal(h.readers.length,0);
  assert.ok(h.all(el=>el.type==='img'&&el.props.src==='/api/avatars/photo.png').length);
});

test('actual shape and color controls persist the original DSH token as the unsaved avatar',async t=>{
  const h=await harness(t);h.button('选择形状与颜色').props.onClick();await h.settle();
  assert.equal(h.all(el=>el.type==='button'&&String(el.props['aria-label']||'').startsWith('角色形状：')).length,AVATAR_SHAPES.length);
  assert.equal(h.all(el=>el.type==='button'&&String(el.props['aria-label']||'').startsWith('角色颜色：')).length,AVATAR_COLORS.length);
  h.button('角色形状：云朵').props.onClick();await h.settle();h.button('角色颜色：蓝色').props.onClick();await h.settle();
  assert.equal(h.props.modelValue,'grok:cloud:blue');assert.deepEqual(h.changes().at(-1),['avatar','grok:cloud:blue']);
  assert.equal(h.button('角色形状：云朵').props['aria-pressed'],true);assert.equal(h.button('角色颜色：蓝色').props['aria-pressed'],true);
  assert.match(h.text(),/待保存/);assert.match(h.text(),/保存员工配置后生效/);
  const preview=h.all(el=>el.type==='img'&&el.props.alt==='员工头像预览')[0];assert.match(preview.props.src,/^data:image\/svg\+xml/);
  assert.match(decodeURIComponent(preview.props.src),/avatar-eyes/);
});

test('switching back to an uploaded picture preserves it and requires an explicit choice',async t=>{
  const photo='/api/avatars/my-photo.webp',h=await harness(t,{modelValue:photo,savedValue:photo});
  h.button('角色头像').props.onClick();await h.settle();h.button('选择形状与颜色').props.onClick();await h.settle();h.button('角色颜色：绿色').props.onClick();await h.settle();
  const character=h.props.modelValue,before=h.changes().length;
  h.button('上传图片').props.onClick();await h.settle();assert.equal(h.props.modelValue,character);assert.equal(h.changes().length,before);
  h.button('使用这张图片').props.onClick();await h.settle();assert.equal(h.props.modelValue,photo);assert.equal(h.state.dirty.value,false);
  h.button('角色头像').props.onClick();await h.settle();assert.equal(h.props.modelValue,photo);
  h.button('使用此角色头像').props.onClick();await h.settle();assert.equal(h.props.modelValue,character);
});

for(const type of ['image/png','image/jpeg','image/webp'])test(type+' upload preserves the original FileReader result and reading lifecycle',async t=>{
  const h=await harness(t);h.button('上传图片').props.onClick();await h.settle();const selected=file(type),pending=h.choose(selected);await h.settle();
  assert.equal(h.state.reading.value,true);assert.equal(h.readers[0].file,selected);assert.equal(h.button('角色头像').props.disabled,true);
  h.readers[0].complete(image);await pending;await h.settle();assert.equal(h.props.modelValue,image);assert.equal(h.state.mode.value,'image');
  assert.deepEqual(h.events.filter(event=>event[0]==='reading'),[['reading',true],['reading',false]]);
});

test('unsupported and oversized images fail before a reader is created',async t=>{
  const h=await harness(t);await h.choose(file('image/svg+xml'));await h.settle();assert.match(h.text(),/请选择 2 MB 以内/);
  await h.choose(file('image/png',2*1024*1024+1));await h.settle();assert.equal(h.readers.length,0);assert.deepEqual(h.changes(),[]);
});

test('a failed image read retains the current avatar and releases the reading lock',async t=>{
  const h=await harness(t,{modelValue:'grok:bean:green'}),pending=h.choose(file());h.readers[0].fail();await pending;await h.settle();
  assert.equal(h.props.modelValue,'grok:bean:green');assert.equal(h.state.reading.value,false);assert.match(h.text(),/图片读取失败/);assert.deepEqual(h.changes(),[]);
});

for(const lock of ['disabled','saving','uncertain'])test('late FileReader output cannot replace an avatar when '+lock,async t=>{
  const h=await harness(t),pending=h.choose(file());h.props[lock]=true;await h.settle();h.readers[0].complete(image);await pending;await h.settle();
  assert.deepEqual(h.changes(),[]);assert.equal(h.state.reading.value,false);
});

test('unmount aborts a pending read and never publishes its late result',async t=>{
  const h=await harness(t),pending=h.choose(file());h.dispose();assert.equal(h.readers[0].aborted,true);
  h.readers[0].complete(image);await pending;assert.deepEqual(h.changes(),[]);assert.equal(h.events.at(-1)[0],'reading');assert.equal(h.events.at(-1)[1],false);
});

test('busy controls cannot alter a selected character and restore-default emits null only explicitly',async t=>{
  const h=await harness(t,{modelValue:'grok:bean:green',savedValue:'grok:bean:green'});h.button('选择形状与颜色').props.onClick();await h.settle();h.props.uncertain=true;await h.settle();
  h.button('角色形状：星星').props.onClick();h.button('恢复默认').props.onClick();assert.deepEqual(h.changes(),[]);assert.match(h.text(),/保存待确认/);
  h.props.uncertain=false;await h.settle();h.button('恢复默认').props.onClick();await h.settle();assert.deepEqual(h.changes(),[['avatar',null]]);assert.equal(h.state.mode.value,'character');
});
