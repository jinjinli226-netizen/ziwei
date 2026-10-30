import test from 'node:test';
import assert from 'node:assert/strict';
import {createDshSettingsDraft,dshSettingsFields} from './dsh-settings.js';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';

function namespace(patch={}){return{ns:'native-plugin',revision:7,applies:'live',value:{enabled:true,nested:{count:2,title:'旧标题'},mode:'fast',options:['one'],headers:{authorization:'must-not-render'}},secrets:[{path:['headers','authorization'],set:true}],schema:{uid:1,refs:{
  1:{type:'intersect',list:[2,3]},2:{type:'object',dict:{enabled:4,nested:5,mode:8,options:11,headers:12}},3:{type:'object',dict:{enabled:4,optional:6,locked:13,hidden:14}},
  4:{type:'boolean',meta:{description:'启用功能'}},5:{type:'object',dict:{count:7,title:6}},6:{type:'string'},7:{type:'number',meta:{required:true,min:1,max:8,step:1}},
  8:{type:'union',list:[9,10,15,16,17]},9:{type:'const',value:'fast',meta:{description:'快速'}},10:{type:'const',value:false},15:{type:'const',value:null},16:{type:'const',value:3},17:{type:'const'},
  11:{type:'array',inner:6},12:{type:'object',dict:{authorization:6}},13:{type:'string',meta:{disabled:true,comment:'由原生管理'}},14:{type:'string',meta:{hidden:true}},
}},...patch};}
function editor(value=namespace(),options={}){const ui=createDshSettingsDraft();ui.select(value,{scopeKey:'team:actor:employee:pc:alpha',writable:true,...options});return ui;}

test('native DSH settings has an independent schema editor',async()=>{
  const module=await import('./dsh-settings.js').catch(()=>({}));
  assert.equal(typeof module.createDshSettingsDraft,'function');
});

test('native refs flatten nested objects and intersections without duplicate or hidden fields',()=>{
  const fields=dshSettingsFields(namespace());
  assert.deepEqual(fields.map(field=>field.path.join('.')),['enabled','nested.count','nested.title','mode','options','headers','optional','locked']);
  assert.equal(fields.find(field=>field.key==='["mode"]').control,'select');assert.equal(fields.find(field=>field.key==='["options"]').control,'json');
  const secret=fields.find(field=>field.sensitive);assert.deepEqual(secret.path,['headers']);assert.equal(secret.value,undefined);assert.equal(secret.configured,true);
});

test('only changed editable fields become exact typed set or unset operations',()=>{
  const ui=editor();ui.set(['enabled'],false);ui.set(['nested','count'],'5');ui.set(['nested','title'],'新标题');ui.set(['options'],'["one", "two"]');ui.unset(['optional']);
  assert.equal(ui.unset(['nested','count']),false);assert.equal(ui.set(['locked'],'not allowed'),false);
  assert.deepEqual(ui.build(),{ns:'native-plugin',expectedRevision:7,ops:[{op:'set',path:['enabled'],value:false},{op:'set',path:['nested','count'],value:5},{op:'set',path:['nested','title'],value:'新标题'},{op:'set',path:['options'],value:['one','two']}],secureOps:[]});
  ui.set(['nested','title'],'旧标题');assert.equal(ui.build().ops.some(op=>op.path.join('.')==='nested.title'),false);
  ui.unset(['options']);assert.deepEqual(ui.build().ops.at(-1),{op:'unset',path:['options']});
});

test('select values preserve native false, null and number values and undefined means unset',()=>{
  const ui=editor();ui.set(['mode'],false);assert.equal(ui.build().ops[0].value,false);ui.set(['mode'],null);assert.equal(ui.build().ops[0].value,null);ui.set(['mode'],3);assert.equal(ui.build().ops[0].value,3);ui.unset(['mode']);assert.deepEqual(ui.build().ops[0],{op:'unset',path:['mode']});
  const initialNull=editor(namespace({value:{...namespace().value,mode:null}}));assert.equal(initialNull.state.values['["mode"]'],null);
});

async function mountEditor(t,overrides={}){
  const file=new URL('./components/DshSettingsEditor.vue',import.meta.url),{descriptor,errors}=parse(await readFile(file,'utf8'));
  assert.deepEqual(errors,[]);const script=compileScript(descriptor,{id:'native-settings'}),template=compileTemplate({id:'native-settings',filename:file.pathname,source:descriptor.template.content,compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  async function evaluate(source){const bindings={};let code=source;for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){const value=match[2]==='vue'?vue:await import(new URL(match[2],file));for(const part of match[1].slice(1,-1).split(',')){const[key,alias]=part.trim().split(/\s+as\s+/);bindings[alias||key]=value[key];}code=code.replace(match[0],'');}return new Function(...Object.keys(bindings),code.replace('export default','return').replace('export function render','return function render'))(...Object.values(bindings));}
  const component=await evaluate(script.content);component.render=await evaluate(template.code);const setup=component.setup;let state;component.setup=(props,context)=>state=setup(props,context);
  const node=type=>({type,props:{},children:[],parent:null,text:''}),remove=el=>{if(el.parent)el.parent.children.splice(el.parent.children.indexOf(el),1);};
  const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:()=>node('#comment'),setText:(el,text)=>el.text=text,setElementText:(el,text)=>{el.text=text;el.children=[];},patchProp:(el,key,_old,value)=>el.props[key]=value,insert(el,parent,anchor){remove(el);el.parent=parent;const at=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(at<0?parent.children.length:at,0,el);},remove,parentNode:el=>el.parent,nextSibling:el=>el.parent?.children[el.parent.children.indexOf(el)+1]||null});
  const props=vue.reactive({namespace:namespace(),writable:true,busy:false,scopeKey:'team:actor:employee:pc:alpha',conflict:false,...overrides}),events=[],root=node('root'),app=renderer.createApp({render:()=>vue.h(component,{...props,onMutate:value=>events.push(['mutate',value]),onSecure:value=>events.push(['secure',value]),onRefresh:()=>events.push(['refresh'])})});app.mount(root);t.after(()=>app.unmount());
  const all=(predicate,target=root)=>[...(predicate(target)?[target]:[]),...target.children.flatMap(child=>all(predicate,child))],text=(target=root)=>[target.text,...target.children.map(text)].join(' '),settle=async()=>{await vue.nextTick();};await settle();
  return{props,state,events,all,text,settle,input:label=>all(el=>el.props['aria-label']===label&&['input','select','textarea'].includes(el.type))[0],button:label=>all(el=>el.type==='button'&&(el.props['aria-label']===label||text(el).trim()===label))[0],submit:()=>all(el=>el.type==='form')[0].props.onSubmit({preventDefault(){}})};
}

test('real Vue edits produce exact native operations and preserve typed select values',async t=>{
  const h=await mountEditor(t);assert.equal(h.input('enabled').props.type,'checkbox');assert.equal(h.input('nested.count').props.type,'number');assert.equal(h.input('mode').type,'select');assert.equal(h.input('options').type,'textarea');assert.equal(h.input('headers').props.type,'password');assert.doesNotMatch(h.text(),/must-not-render/);
  h.input('nested.count').props.onInput({target:{value:'6'}});h.input('enabled').props.onChange({target:{checked:false}});h.input('mode').props.onChange({target:{value:'1'}});h.button('恢复继承值：options').props.onClick();await h.settle();h.submit();
  assert.deepEqual(h.events,[['mutate',{ns:'native-plugin',expectedRevision:7,ops:[{op:'set',path:['enabled'],value:false},{op:'set',path:['nested','count'],value:6},{op:'set',path:['mode'],value:false},{op:'unset',path:['options']}]}]]);assert.doesNotMatch(h.text(),/已保存/);
});

test('real Vue routes mixed secret changes through one secure event and clears secret input',async t=>{
  const h=await mountEditor(t);h.input('headers').props.onInput({target:{value:''}});h.submit();assert.equal(h.events.length,0);
  h.input('nested.title').props.onInput({target:{value:'新标题'}});h.input('headers').props.onInput({target:{value:'{"authorization":"fixture-value"}'}});h.submit();await h.settle();
  assert.deepEqual(h.events,[['secure',{ns:'native-plugin',expectedRevision:7,ops:[{op:'set',path:['nested','title'],value:'新标题'},{op:'set',path:['headers'],value:{authorization:'fixture-value'}}]}]]);assert.equal(h.input('headers').props.value,'');assert.match(h.text(),/安全通道/);
});

test('real Vue preserves conflict drafts and requires explicit adoption of a fresh revision',async t=>{
  const h=await mountEditor(t);h.input('nested.title').props.onInput({target:{value:'冲突草稿'}});h.props.conflict=true;h.props.namespace=namespace({revision:8});await h.settle();assert.equal(h.input('nested.title').props.value,'冲突草稿');h.submit();assert.equal(h.events.length,0);
  h.button('重新读取配置').props.onClick();assert.deepEqual(h.events,[['refresh']]);h.button('按新版本继续编辑').props.onClick();await h.settle();h.submit();assert.equal(h.events.at(-1)[1].expectedRevision,8);assert.equal(h.events.at(-1)[1].ops[0].value,'冲突草稿');
});

test('real Vue explains readonly and applies mode and blocks all input submissions',async t=>{
  const h=await mountEditor(t,{writable:false,readOnlyReason:'当前账号只有查看权限',namespace:namespace({applies:'restart-required'})});assert.equal(h.input('nested.title').props.disabled,true);h.submit();assert.equal(h.events.length,0);assert.match(h.text(),/当前账号只有查看权限/);assert.match(h.text(),/重启/);
});

test('real Vue respects the external in-flight lock even for form submission events',async t=>{
  const h=await mountEditor(t);h.input('nested.title').props.onInput({target:{value:'等待中的草稿'}});h.props.busy=true;await h.settle();h.submit();assert.equal(h.events.length,0);assert.equal(h.input('nested.title').props.disabled,true);h.props.busy=false;await h.settle();h.submit();assert.equal(h.events[0][1].ops[0].value,'等待中的草稿');
});

test('real Vue disables secret editing while its external secure broker is unavailable',async t=>{
  const h=await mountEditor(t,{secureWritable:false});assert.equal(h.input('headers').props.disabled,true);assert.equal(h.input('nested.title').props.disabled,false);h.input('headers').props.onInput({target:{value:'{"authorization":"blocked-value"}'}});h.submit();assert.equal(h.events.length,0);assert.match(h.text(),/安全通道尚未接入/);
});

test('secret blank keeps its current value and secret object replacements use only secure ops',()=>{
  const ui=editor();ui.set(['headers'],'');assert.deepEqual(ui.build().secureOps,[]);ui.set(['headers'],'{"authorization":"new-fixture-secret"}');ui.set(['nested','title'],'新标题');
  const submission=ui.build();assert.deepEqual(submission.ops,[{op:'set',path:['nested','title'],value:'新标题'}]);assert.deepEqual(submission.secureOps,[{op:'set',path:['headers'],value:{authorization:'new-fixture-secret'}}]);
  ui.clearSecrets();assert.equal(ui.state.values['["headers"]'],'');assert.deepEqual(ui.build().secureOps,[]);
});

test('invalid numeric or JSON drafts stay editable and never produce a partial submission',()=>{
  const ui=editor();ui.set(['nested','title'],'草稿保留');ui.set(['nested','count'],'');assert.throws(()=>ui.build(),/数值/);assert.equal(ui.state.values['["nested","title"]'],'草稿保留');
  ui.keep(['nested','count']);ui.set(['options'],'{bad');assert.throws(()=>ui.build(),/JSON/);
});

test('a settings conflict or newer native revision retains drafts until an explicit resolution',()=>{
  const ui=editor();ui.set(['nested','title'],'未保存草稿');ui.markConflict('settings/conflict');ui.select(namespace({revision:8,value:{...namespace().value,nested:{count:3,title:'外部新值'}}}),{scopeKey:'team:actor:employee:pc:alpha',writable:true});
  assert.equal(ui.state.values['["nested","title"]'],'未保存草稿');assert.equal(ui.state.base.revision,7);assert.equal(ui.state.conflict,true);assert.throws(()=>ui.build(),/版本/);
  assert.equal(ui.rebase(),true);assert.equal(ui.build().expectedRevision,8);assert.equal(ui.build().ops[0].value,'未保存草稿');
});

test('readonly and scope changes block edits and discard prior actor secret drafts',()=>{
  const ui=editor(namespace(),{writable:false});assert.equal(ui.set(['enabled'],false),false);assert.equal(ui.unset(['options']),false);
  ui.select(namespace(),{scopeKey:'a',writable:true});ui.set(['headers'],'{"authorization":"secret"}');ui.select(namespace({ns:'other'}),{scopeKey:'b',writable:true});assert.equal(ui.state.values['["headers"]'],'');assert.equal(ui.dirty(),false);
});

test('an empty JSON container with secret schema descendants never emits ordinary values',()=>{
  const value={ns:'connections',revision:0,value:{rows:[]},secrets:[],schema:{uid:1,refs:{1:{type:'object',dict:{rows:2}},2:{type:'array',inner:3},3:{type:'object',dict:{label:4,apiKey:5}},4:{type:'string'},5:{type:'string',meta:{role:'secret'}}}}};
  const ui=editor(value);assert.equal(ui.state.fields[0].sensitive,true);ui.set(['rows'],'[{"label":"first","apiKey":"fixture-key"}]');assert.deepEqual(ui.build().ops,[]);assert.equal(ui.build().secureOps.length,1);
});

test('intersect constraints merge readonly and required flags for the same path',()=>{
  const value={ns:'native',revision:1,value:{name:'base'},schema:{uid:1,refs:{1:{type:'intersect',list:[2,3]},2:{type:'object',dict:{name:4}},3:{type:'object',dict:{name:5}},4:{type:'string'},5:{type:'string',meta:{disabled:true,required:true}}}}};
  const ui=editor(value);assert.equal(ui.state.fields.length,1);assert.equal(ui.state.fields[0].readOnly,true);assert.equal(ui.state.fields[0].required,true);assert.equal(ui.set(['name'],'changed'),false);
});

test('rebasing incompatible schema changes never silently drops an existing unset draft',()=>{
  const ui=editor();ui.unset(['options']);const next=namespace({revision:8});next.schema.refs[11].meta={required:true};ui.select(next,{scopeKey:'team:actor:employee:pc:alpha',writable:true});assert.equal(ui.rebase(),false);assert.equal(ui.state.changes['["options"]'],'unset');assert.equal(ui.state.base.revision,7);assert.equal(ui.state.conflict,true);
});

test('rebasing after permission revocation preserves the original draft and version',()=>{
  const ui=editor();ui.set(['nested','title'],'保留草稿');ui.select(namespace({revision:8}),{scopeKey:'team:actor:employee:pc:alpha',writable:false});assert.equal(ui.rebase(),false);assert.equal(ui.state.values['["nested","title"]'],'保留草稿');assert.equal(ui.state.base.revision,7);assert.equal(ui.dirty(),true);
});

test('JSON containers respect readonly descendants and disabled constant options are not writable',()=>{
  const value={ns:'native',revision:1,value:{rows:[{locked:'base'}],mode:'safe'},schema:{uid:1,refs:{1:{type:'object',dict:{rows:2,mode:5}},2:{type:'array',inner:3},3:{type:'object',dict:{locked:4}},4:{type:'string',meta:{disabled:true}},5:{type:'union',list:[6,7]},6:{type:'const',value:'safe'},7:{type:'const',value:'locked',meta:{disabled:true}}}}};
  const ui=editor(value);assert.equal(ui.state.fields[0].readOnly,true);assert.match(ui.state.fields[0].readOnlyReason,/只读/);assert.equal(ui.set(['rows'],'[{"locked":"changed"}]'),false);ui.set(['mode'],'locked');assert.throws(()=>ui.build(),/选项/);
});

test('a secret intersect parent takes precedence over a public descendant from another branch',()=>{
  const value={ns:'native',revision:1,value:{auth:{name:'never-copy'}},schema:{uid:1,refs:{1:{type:'intersect',list:[2,3]},2:{type:'object',dict:{auth:4}},3:{type:'object',dict:{auth:6}},4:{type:'object',dict:{name:5}},5:{type:'string'},6:{type:'object',dict:{name:5},meta:{role:'secret'}}}}};
  const ui=editor(value);assert.deepEqual(ui.state.fields.map(field=>field.path),[['auth']]);assert.equal(ui.state.fields[0].sensitive,true);assert.equal(ui.set(['auth','name'],'changed'),false);ui.set(['auth'],'{"name":"new"}');assert.equal(ui.build().ops.length,0);assert.equal(ui.build().secureOps.length,1);
});
