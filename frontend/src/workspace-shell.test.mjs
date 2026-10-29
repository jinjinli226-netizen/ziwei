import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import {parse,compileScript} from '@vue/compiler-sfc';

const file=new URL('./components/WorkspaceShell.vue',import.meta.url);
const {descriptor,errors}=parse(await readFile(file,'utf8'),{filename:file.pathname});
assert.deepEqual(errors,[]);
const compiled=compileScript(descriptor,{id:'workspace-shell-test',inlineTemplate:true});
const bindings={};let code=compiled.content;
const stub={render(){return vue.h('div',this.$slots.default?.());}};
for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
  const value=match[2]==='vue'?vue:new Proxy({},{get:()=>stub});
  if(match[1].startsWith('{'))for(const token of match[1].slice(1,-1).split(',')){
    const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=value[name];
  }else bindings[match[1]]=stub;
  code=code.replace(match[0],'');
}
const component=new Function(...Object.keys(bindings),code.replace('export default','return'))(...Object.values(bindings));
function harness(t,initial={}){
  const previousDocument=globalThis.document;
  globalThis.document={addEventListener(){},removeEventListener(){}};
  const node=type=>({type,props:{},children:[],parent:null,text:''});
  const remove=child=>{if(child.parent){const siblings=child.parent.children;siblings.splice(siblings.indexOf(child),1);child.parent=null;}};
  const renderer=vue.createRenderer({
    createElement:node,createText:text=>({...node('#text'),text}),createComment:text=>({...node('#comment'),text}),
    setText:(target,text)=>target.text=text,setElementText:(target,text)=>{target.text=text;target.children=[];},
    patchProp:(target,key,_previous,value)=>target.props[key]=value,
    insert(child,parent,anchor){remove(child);child.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,child);},
    remove,parentNode:target=>target.parent,nextSibling:target=>target.parent?.children[target.parent.children.indexOf(target)+1]||null,
  });
  const props=vue.reactive({page:'bots',focused:false,language:'zh-CN',account:{name:'测试账号',email:'test@fixture.invalid',role:'owner'},workspace:{name:'测试工作区',slug:'one'},...initial});
  const events=[],root=node('root'),app=renderer.createApp({render:()=>vue.h(component,{...props,onNavigate:value=>events.push(['navigate',value]),onLogout:()=>events.push(['logout']),onLanguage:value=>events.push(['language',value])})});
  app.mount(root);t.after(()=>{app.unmount();globalThis.document=previousDocument;});
  function find(predicate,target=root){if(predicate(target))return target;for(const child of target.children){const found=find(predicate,child);if(found)return found;}return null;}
  const byClass=name=>find(target=>String(target.props.class||'').split(/\s+/).includes(name));
  return{props,events,find,byClass};
}

test('Bot management starts with reversible compact navigation and restores other pages',async t=>{
  const h=harness(t);
  assert.ok(h.byClass('bot-navigation-collapsed'));
  assert.ok(h.byClass('bots-panel'));
  const toggle=h.find(target=>target.props['aria-label']==='展开工作区导航');
  assert.ok(toggle);assert.equal(toggle.props['aria-expanded'],false);
  assert.equal(toggle.props['aria-controls'],h.byClass('workspace-sidebar').props.id);
  toggle.props.onClick();await vue.nextTick();
  assert.equal(h.byClass('bot-navigation-collapsed'),null);
  assert.equal(h.find(target=>target.props['aria-label']==='收起工作区导航').props['aria-expanded'],true);
  h.find(target=>target.props['aria-label']==='收起工作区导航').props.onClick();await vue.nextTick();
  assert.ok(h.byClass('bot-navigation-collapsed'));
  h.find(target=>target.props['aria-label']==='展开工作区导航').props.onClick();await vue.nextTick();
  h.props.page='members';await vue.nextTick();
  assert.equal(h.byClass('bot-navigation-collapsed'),null);assert.equal(h.byClass('bots-panel'),null);
  assert.equal(h.find(target=>target.props['aria-controls']==='workspace-navigation'),null);
  h.props.page='bots';await vue.nextTick();assert.ok(h.byClass('bot-navigation-collapsed'));
});

test('focused real chat retains its own shell contract without a compact navigation',async t=>{
  const h=harness(t,{page:'inbox',focused:true});
  assert.ok(h.byClass('focused-workspace'));assert.equal(h.byClass('bot-navigation-collapsed'),null);
  assert.equal(h.byClass('workspace-topbar'),null);assert.equal(h.byClass('workspace-sidebar'),null);
  h.props.page='bots';await vue.nextTick();assert.equal(h.byClass('bot-navigation-collapsed'),null);
  h.props.focused=false;await vue.nextTick();assert.ok(h.byClass('bot-navigation-collapsed'));
});

test('compact navigation retains route labels and account language help actions',async t=>{
  const h=harness(t);
  for(const [label,key]of [['Bot 伙伴','bots'],['任务','issues'],['工作流','workflow'],['日历','calendar'],['文档','docs'],['团队管理','members'],['技能管理','skills'],['邀请','invite'],['紫薇·互联','ziwei-connect'],['设置','settings'],['开放平台','open']]){
    const button=h.find(target=>target.type==='button'&&target.props['aria-label']===label);
    assert.ok(button,label);assert.equal(button.props.title,label);button.props.onClick();
    assert.deepEqual(h.events.at(-1),['navigate',key]);
  }
  const account=h.byClass('sidebar-account');assert.match(account.props['aria-label'],/测试账号/);assert.ok(account.props.title);
  account.props.onClick();await vue.nextTick();assert.ok(h.byClass('account-popup'));
  h.find(target=>target.type==='button'&&target.children.some(child=>child.text.trim()==='退出登录')).props.onClick();assert.deepEqual(h.events.at(-1),['logout']);
  h.find(target=>target.props['aria-label']==='语言').props.onClick();await vue.nextTick();
  assert.ok(h.byClass('language-popup'));
  h.find(target=>target.type==='button'&&target.children.some(child=>child.text.trim()==='English')).props.onClick();assert.deepEqual(h.events.at(-1),['language','en-US']);
  h.find(target=>target.props['aria-label']==='帮助').props.onClick();await vue.nextTick();assert.ok(h.byClass('shell-help'));
});
