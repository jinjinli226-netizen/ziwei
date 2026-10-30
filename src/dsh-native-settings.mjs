import {redactSecrets} from './redaction.mjs';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const nodeKeys=new Set(['type','dict','list','inner','sKey','bits','value','preserve','constructor','meta']);
const metaKeys=['role','extra','required','disabled','hidden','collapse','experimental','deprecated','description','comment','link','min','max','step'];
const privateMetadataKey=key=>/^(?:api[_-]?key|token|password|secrets?|credentials?|authorization|headers|private[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|rawDiagnostic|rawConfig|rawError|environment|envelope|ciphertext|wrappedKey|callback)$/i.test(key);
const secret=node=>node?.meta?.role==='secret';
const resolve=(schema,reference)=>object(reference)?reference:Object.hasOwn(schema.refs||{},reference)?schema.refs[reference]:undefined;
const childPaths=(paths,key)=>paths.filter(path=>path[0]===key).map(path=>path.slice(1));
const credentialName=key=>/^(?:api[_-]?key|token|password|passwd|secrets?|credentials?|client[_-]?secret|auth|authorization|cookie|headers|private[_-]?key|access[_-]?token|refresh[_-]?token)$/i.test(key);

export function publicDshSettings(description){
 validateDescription(description);
 const detached=structuredClone(description),result=pick(detached,['writable','hasDocument','schemaFormat']);
 result.namespaces=detached.namespaces.map(namespace=>{
  markCredentialFields(namespace);
  const out=pick(namespace,['ns','revision','applies','autoGenerate']),schema=namespace.schema,root=schema.refs?schema.uid:schema,paths=(namespace.secrets||[]).map(item=>item.path);
  for(const key of ['value','base','user'])if(Object.hasOwn(namespace,key)){
   const value=stripValue(schema,root,namespace[key],paths);
   if(value!==undefined)out[key]=value;
  }
  cleanSchema(schema,root,paths);
  out.schema=schema;out.secrets=(namespace.secrets||[]).map(item=>({path:[...item.path],set:item.set===true}));
  return out;
 });
 return result;
}

function credentialURL(value){
 if(typeof value!=='string'||!/^https?:\/\//i.test(value))return false;
 try{const url=new URL(value);return Boolean(url.username||url.password||[...url.searchParams.keys()].some(key=>credentialName(key)||key==='key'));}catch{return false;}
}

function markCredentialFields(namespace){
 const schema=namespace.schema,root=schema.refs?schema.uid:schema,entries=new Map((namespace.secrets||[]).map(item=>[JSON.stringify(item.path),{path:[...item.path],set:item.set===true}])),marked=new Set(),urlPaths=new Set();
 const actual=[namespace.value,namespace.base,namespace.user];
 const at=(value,path)=>path.reduce((parent,key)=>parent!==null&&typeof parent==='object'&&Object.hasOwn(parent,key)?parent[key]:undefined,value);
 const add=path=>{const key=JSON.stringify(path),previous=entries.get(key);entries.set(key,{path:[...path],set:previous?.set===true||actual.some(value=>at(value,path)!==undefined)});marked.add(key);};
 function scanValue(value,path=[]){
  if(credentialURL(value)){add(path);urlPaths.add(JSON.stringify(path));return;}
  if(value===null||typeof value!=='object')return;
  for(const[key,item]of Object.entries(value)){if(credentialName(key))add([...path,key]);else scanValue(item,[...path,key]);}
 }
 for(const value of actual)scanValue(value);
 function scanSchema(reference,path,values,ancestors=new Set()){
  const node=resolve(schema,reference);if(!object(node)||ancestors.has(node))return;
  const next=new Set(ancestors),samples=[...values,...(Object.hasOwn(node.meta||{},'default')?[node.meta.default]:[]),...(Array.isArray(node.meta?.examples)?node.meta.examples:[])];next.add(node);
  for(const value of samples)scanValue(value,path);
  if(secret(node)){add(path);return;}
  if(node.type==='object')for(const[key,child]of Object.entries(node.dict||{})){if(credentialName(key))add([...path,key]);else scanSchema(child,[...path,key],samples.map(value=>at(value,[key])),next);}
  if(['dict','array'].includes(node.type))for(const key of new Set(samples.flatMap(value=>value!==null&&typeof value==='object'?Object.keys(value):[])))scanSchema(node.inner,[...path,key],samples.map(value=>at(value,[key])),next);
  if(node.type==='tuple')(node.list||[]).forEach((child,index)=>scanSchema(child,[...path,String(index)],samples.map(value=>at(value,[String(index)])),next));
  if(['union','intersect'].includes(node.type))for(const child of node.list||[])scanSchema(child,path,samples,next);
  if(node.type==='transform')scanSchema(node.inner,path,samples,next);
 }
 scanSchema(root,[],actual);
 let uid=Math.max(0,...Object.keys(schema.refs||{}).filter(key=>/^\d+$/.test(key)).map(Number));const replaced=new Set();
 function copy(reference,deep=false,memo=new Map()){
  const node=resolve(schema,reference);if(!object(node))return reference;
  if(!object(reference)&&memo.has(reference))return memo.get(reference);
  const cloned=structuredClone(node);let result=cloned;
  if(!object(reference)&&schema.refs){result=++uid;memo.set(reference,result);schema.refs[result]=cloned;replaced.add(String(reference));}
  if(deep){if(cloned.dict)cloned.dict=Object.fromEntries(Object.entries(cloned.dict).map(([key,child])=>[key,copy(child,true,memo)]));if(cloned.list)cloned.list=cloned.list.map(child=>copy(child,true,memo));if(cloned.inner!==undefined)cloned.inner=copy(cloned.inner,true,memo);if(cloned.sKey!==undefined)cloned.sKey=copy(cloned.sKey,true,memo);}
  return result;
 }
 function mark(reference,path,isRoot=false,seen=new Set()){
  const original=resolve(schema,reference);if(!object(original)||seen.has(original)||secret(original))return reference;
  const next=new Set(seen);next.add(original);
  if(!path.length){const result=isRoot?reference:copy(reference,true),node=resolve(schema,result);node.meta={...node.meta,role:'secret'};return result;}
  const edits={};
  if(original.type==='object'&&Object.hasOwn(original.dict||{},path[0])){const child=mark(original.dict[path[0]],path.slice(1),false,next);if(child!==original.dict[path[0]])edits.dict={...original.dict,[path[0]]:child};}
  if(['dict','array'].includes(original.type)){const child=mark(original.inner,path.slice(1),false,next);if(child!==original.inner)edits.inner=child;}
  if(original.type==='tuple'&&original.list?.[Number(path[0])]!==undefined){const index=Number(path[0]),child=mark(original.list[index],path.slice(1),false,next);if(child!==original.list[index]){edits.list=[...original.list];edits.list[index]=child;}}
  if(['union','intersect'].includes(original.type)){const children=(original.list||[]).map(child=>mark(child,path,false,next));if(children.some((child,index)=>child!==original.list[index]))edits.list=children;}
  if(original.type==='transform'){const child=mark(original.inner,path,false,next);if(child!==original.inner)edits.inner=child;}
  if(!Object.keys(edits).length)return reference;
  const result=isRoot?reference:copy(reference);Object.assign(resolve(schema,result),edits);
  return result;
 }
 function hasPublicPeer(reference,path,values,seen=new Set()){
  if(!path.length)return values.some(value=>value!==undefined&&!credentialURL(value));
  const node=resolve(schema,reference);if(!object(node)||seen.has(node))return false;
  const next=new Set(seen);next.add(node);
  if(node.type==='object')return hasPublicPeer(node.dict?.[path[0]],path.slice(1),values.map(value=>at(value,[path[0]])),next);
  if(['dict','array'].includes(node.type))return hasPublicPeer(node.inner,path.slice(1),values.flatMap(value=>value!==null&&typeof value==='object'?Object.values(value):[]),next);
  if(node.type==='tuple')return hasPublicPeer(node.list?.[Number(path[0])],path.slice(1),values.map(value=>at(value,[path[0]])),next);
  if(['union','intersect'].includes(node.type))return(node.list||[]).some(child=>hasPublicPeer(child,path,values,next));
  return node.type==='transform'&&hasPublicPeer(node.inner,path,values,next);
 }
 for(const key of marked){const path=JSON.parse(key);if(urlPaths.has(key)&&!credentialName(path.at(-1)||'')&&hasPublicPeer(root,path,actual))continue;mark(root,path,true);}
 const reachable=new Set(),seen=new Set();
 function visit(reference){const node=resolve(schema,reference);if(!object(reference))reachable.add(String(reference));if(!object(node)||seen.has(node))return;seen.add(node);for(const child of [...Object.values(node.dict||{}),...(node.list||[]),node.inner,node.sKey].filter(value=>value!==undefined))visit(child);}
 visit(root);for(const key of replaced)if(!reachable.has(key))delete schema.refs[key];
 namespace.secrets=[...entries.values()];
}

function validateDescription(description){
 if(!object(description)||!Array.isArray(description.namespaces)||description.namespaces.some(namespace=>!object(namespace)||!object(namespace.schema)||namespace.secrets!==undefined&&(!Array.isArray(namespace.secrets)||namespace.secrets.some(item=>!object(item)||!Array.isArray(item.path)||item.path.some(part=>typeof part!=='string')))))throw Object.assign(new Error('DSH_NATIVE_SETTINGS_DESCRIPTOR_INVALID'),{code:'DSH_NATIVE_SETTINGS_DESCRIPTOR_INVALID'});
}

function stripValue(schema,reference,value,paths=[]){
 let stripped=stripSchemaValue(schema,reference,value);
 for(const path of paths)stripped=removePath(stripped,path);
 return stripped;
}

function stripSchemaValue(schema,reference,value,ancestors=new Set()){
 const node=resolve(schema,reference);
 if(secret(node))return undefined;
 if(value===undefined||!node||ancestors.has(node))return value;
 const next=new Set(ancestors);next.add(node);
 if(node.type==='transform')return stripSchemaValue(schema,node.inner,value,next);
 if(['union','intersect'].includes(node.type))return(node.list||[]).reduce((current,child)=>stripSchemaValue(schema,child,current,next),value);
 if(node.type==='object'&&object(value))return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{
  const child=Object.hasOwn(node.dict||{},key)?node.dict[key]:undefined,cleaned=stripSchemaValue(schema,child,item);
  return cleaned===undefined?[]:[[key,cleaned]];
 }));
 if(node.type==='dict'&&object(value))return Object.fromEntries(Object.entries(value).flatMap(([key,item])=>{const cleaned=stripSchemaValue(schema,node.inner,item);return cleaned===undefined?[]:[[key,cleaned]];}));
 if(['array','tuple'].includes(node.type)&&Array.isArray(value))return value.map((item,index)=>stripSchemaValue(schema,node.type==='array'?node.inner:node.list?.[index],item)??null);
 return value;
}

function removePath(value,path){
 if(!path.length)return undefined;
 let current=value;
 for(const part of path.slice(0,-1)){
  if(current===null||typeof current!=='object'||!Object.hasOwn(current,part))return value;
  current=current[part];
 }
 if(current!==null&&typeof current==='object'&&Object.hasOwn(current,path.at(-1))){if(Array.isArray(current))current[path.at(-1)]=null;else delete current[path.at(-1)];}
 return value;
}

function cleanSchema(schema,root,paths){
 const visited=new Map();
 function clean(reference,localPaths){
  const node=resolve(schema,reference);if(!object(node))return;
  const context=JSON.stringify(localPaths),seen=visited.get(node)||new Set();if(seen.has(context))return;seen.add(context);visited.set(node,seen);
  const hidden=secret(node)||localPaths.some(path=>!path.length),meta=node.meta;
  if(object(meta)){
   const projected=hidden?pick(meta,['role']):Object.fromEntries(metaKeys.filter(key=>Object.hasOwn(meta,key)).map(key=>[key,metadataValue(meta[key])]));
   if(!hidden)for(const key of ['default','examples'])if(Object.hasOwn(meta,key)){
    const cleaned=key==='examples'&&Array.isArray(meta[key])?meta[key].map(value=>stripValue(schema,node,value,localPaths)).filter(value=>value!==undefined):stripValue(schema,node,meta[key],localPaths);
    if(cleaned!==undefined)projected[key]=cleaned;
   }
   node.meta=projected;
  }
  if(hidden)delete node.value;
  // A serialized transform callback is executable when schemastery rehydrates it.
  for(const key of Object.keys(node))if(!nodeKeys.has(key))delete node[key];
  if(node.type==='object')for(const[key,child]of Object.entries(node.dict||{}))clean(child,hidden?[[]]:childPaths(localPaths,key));
  if(['dict','array'].includes(node.type))clean(node.inner,hidden?[[]]:localPaths.filter(path=>path.length).map(path=>path.slice(1)));
  if(node.type==='tuple')(node.list||[]).forEach((child,index)=>clean(child,hidden?[[]]:childPaths(localPaths,String(index))));
  if(['union','intersect'].includes(node.type))for(const child of node.list||[])clean(child,hidden?[[]]:localPaths);
  if(node.type==='transform')clean(node.inner,hidden?[[]]:localPaths);
  if(node.sKey!==undefined)clean(node.sKey,[]);
 }
 clean(root,paths);
 // Unreachable reference nodes still cross the same wire boundary.
 for(const node of Object.values(schema.refs||{}))clean(node,[]);
 if(schema.refs)for(const key of Object.keys(schema))if(!['uid','refs'].includes(key))delete schema[key];
}

function metadataValue(value){
 if(typeof value==='string')return redactSecrets(value).replace(/(https?:\/\/)[^\s/@]+@/gi,'$1[REDACTED]@');
 if(Array.isArray(value))return value.map(metadataValue);
 if(object(value))return Object.fromEntries(Object.entries(value).filter(([key])=>!privateMetadataKey(key)).map(([key,item])=>[key,metadataValue(item)]));
 return value;
}
