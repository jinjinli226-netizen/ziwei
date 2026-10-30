import {readFile} from 'node:fs/promises';
import {parse,compileScript} from '@vue/compiler-sfc';
import * as vue from 'vue';

globalThis.Document??=class Document{};
globalThis.ShadowRoot??=class ShadowRoot{};

export async function mountPanel(file,props,events={}){
 const url=new URL(file,import.meta.url),source=await readFile(url,'utf8'),{descriptor}=parse(source);
 let code=compileScript(descriptor,{id:'panel-verification',inlineTemplate:true}).content;
 const imports=[...code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g)],modules=[];
 for(const match of imports){
  const index=modules.length;modules.push(await import(match[2].startsWith('.')?new URL(match[2],url).href:match[2]));
  const names=match[1].split(',').map(name=>name.trim().replace(/\s+as\s+/,':')).join(',');
  code=code.replace(match[0],`const {${names}}=modules[${index}];`);
 }
 const component=new Function('modules',code.replace('export default','return'))(modules);
 const node=type=>{
  const listeners=new Map();
  const element={type,props:{},children:[],parent:null,text:'',value:'',getRootNode(){return root;},addEventListener(event,listener){const list=listeners.get(event)||[];list.push(listener);listeners.set(event,list);},removeEventListener(event,listener){listeners.set(event,(listeners.get(event)||[]).filter(value=>value!==listener));},dispatch(event,input={}){for(const listener of listeners.get(event)||[])listener({target:element,...input});}};
  Object.defineProperty(element,'options',{get(){return element.children.filter(child=>child.type==='option');}});
  return element;
 };
 const remove=element=>{if(element.parent)element.parent.children.splice(element.parent.children.indexOf(element),1);};
 const renderer=vue.createRenderer({createElement:node,createText:text=>({...node('#text'),text}),createComment:()=>node('#comment'),setText:(element,text)=>element.text=text,setElementText:(element,text)=>{element.text=text;element.children=[];},patchProp(element,key,_old,value){element.props[key]=value;if(['value','checked','multiple'].includes(key))element[key]=value;},insert(element,parent,anchor){remove(element);element.parent=parent;const index=anchor?parent.children.indexOf(anchor):-1;parent.children.splice(index<0?parent.children.length:index,0,element);},remove,parentNode:element=>element.parent,nextSibling:element=>element.parent?.children[element.parent.children.indexOf(element)+1]||null});
 const values=vue.reactive(props),root=node('root'),emitted=[];
 const app=renderer.createApp({render:()=>vue.h(component,{...values,...Object.fromEntries(Object.entries(events).map(([event,handler])=>[event,(...args)=>{emitted.push(args);handler(...args);}]))})});app.mount(root);
 const text=element=>(element.text||'')+element.children.map(text).join('');
 const find=predicate=>{const output=[];function walk(element){if(predicate(element))output.push(element);element.children.forEach(walk);}walk(root);return output;};
 return{props:values,root,emitted,text:()=>text(root),find,button:label=>find(element=>element.type==='button'&&text(element)===label)[0],async settle(){for(let index=0;index<4;index++){await vue.nextTick();await new Promise(setImmediate);}},dispose(){app.unmount();}};
}
