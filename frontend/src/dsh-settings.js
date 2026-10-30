const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
const at=(value,path)=>path.reduce((parent,key)=>parent?.[key],value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const localized=value=>typeof value==='string'?value:value?.['zh-CN']||value?.zh||value?.en||'';
const secretName=name=>/(?:api[_-]?key|token|password|secret|authorization|credential|headers)$/i.test(name);
const prefix=(a,b)=>a.length<=b.length&&a.every((part,index)=>part===b[index]);

export function dshSettingsFields(namespace){
  const envelope=namespace?.schema,fields=[];
  const node=value=>typeof value==='string'||typeof value==='number'?envelope?.refs?.[value]:value;
  function schemaHas(reference,predicate,visited=new Set(),key=''){
    const schema=node(reference);if(!schema)return false;if(predicate(schema,key))return true;if(visited.has(schema))return false;visited.add(schema);
    return Object.entries(schema.dict||{}).some(([name,child])=>schemaHas(child,predicate,visited,name))||(schema.list||[]).some(child=>schemaHas(child,predicate,visited))||schema.inner!==undefined&&schemaHas(schema.inner,predicate,visited);
  }
  function visit(reference,path,disabled=false){
    const schema=node(reference);if(!schema||schema.meta?.hidden)return;
    let readOnly=disabled||schema.meta?.disabled===true||schema.readOnly===true;
    const relatedSecrets=path.length?(namespace.secrets||[]).filter(secret=>prefix(path,secret.path)||prefix(secret.path,path)):[];
    const directSecret=schema.meta?.role==='secret'||secretName(path.at(-1)||'')||relatedSecrets.some(secret=>prefix(secret.path,path));
    if(schema.type==='intersect'&&!directSecret){for(const child of schema.list||[])visit(child,path,readOnly);return;}
    if(schema.type==='object'&&schema.dict&&!directSecret){for(const[key,child]of Object.entries(schema.dict))visit(child,[...path,key],readOnly);return;}
    const sensitive=directSecret||relatedSecrets.length>0||schemaHas(schema,(value,key)=>value.meta?.role==='secret'||secretName(key));
    const key=JSON.stringify(path);if(!path.length)return;
    if(fields.some(field=>field.sensitive&&field.path.length<path.length&&prefix(field.path,path)))return;
    if(sensitive)for(let index=fields.length-1;index>=0;index--)if(fields[index].path.length>path.length&&prefix(path,fields[index].path)){readOnly||=fields[index].readOnly;fields.splice(index,1);}
    const previous=fields.find(field=>field.key===key);
    if(previous){previous.readOnly||=readOnly;previous.required||=schema.meta?.required===true;if(sensitive){previous.sensitive=true;previous.value=undefined;previous.present=false;}previous.configured||=relatedSecrets.some(secret=>secret.set===true);return;}
    const branches=schema.type==='union'?(schema.list||[]).map(node):schema.type==='const'?[schema]:[];
    const options=branches.length&&branches.every(branch=>branch?.type==='const')?branches.map(branch=>({value:branch.value,unset:!Object.hasOwn(branch,'value'),disabled:branch.meta?.disabled===true||branch.readOnly===true,label:localized(branch.meta?.description)||(!Object.hasOwn(branch,'value')?'未设置（恢复继承）':String(branch.value))})):[];
    const control=options.length&&!sensitive?'select':['boolean','number','string'].includes(schema.type)?schema.type:'json';
    const readOnlyChild=control==='json'&&schemaHas(schema,value=>value.meta?.disabled===true||value.readOnly===true);readOnly||=readOnlyChild;
    const value=sensitive?undefined:at(namespace.value,path);
    fields.push({key,path,schema,control,options,sensitive,readOnly,readOnlyReason:readOnlyChild?'此 JSON 结构包含原生只读字段，请在原生 DSH 端管理。':'',required:schema.meta?.required===true,configured:relatedSecrets.some(secret=>secret.set===true),value:copy(value),present:value!==undefined,description:localized(schema.meta?.description),comment:localized(schema.meta?.comment)});
  }
  visit(envelope?.refs?envelope.uid:envelope,[]);return fields;
}

export function createDshSettingsDraft({wrap=value=>value}={}){
  const state=wrap({base:null,latest:null,fields:[],values:{},changes:{},writable:false,conflict:false,error:''});let identity='';
  function select(namespace,{scopeKey='',writable=false}={}){
    const nextIdentity=JSON.stringify([scopeKey,namespace?.ns]);state.writable=writable;state.latest=copy(namespace);
    if(nextIdentity!==identity){identity=nextIdentity;reset();return;}
    if(!dirty()){reset();return;}
    if(namespace.revision!==state.base.revision)markConflict();
  }
  function reset(){
    state.base=copy(state.latest);state.fields=dshSettingsFields(state.base);state.values=Object.fromEntries(state.fields.map(field=>[field.key,initialValue(field)]));state.changes={};state.conflict=false;state.error='';
  }
  function editable(field){return state.writable&&!field.readOnly;}
  function set(path,value){
    const field=state.fields.find(item=>same(item.path,path));if(!field||!editable(field))return false;
    state.values[field.key]=value;state.error='';
    if(field.sensitive&&value===''||same(value,initialValue(field)))delete state.changes[field.key];else state.changes[field.key]='set';return true;
  }
  function unset(path){
    const field=state.fields.find(item=>same(item.path,path));if(!field||!editable(field)||field.required)return false;
    state.error='';if(!field.present&&!field.sensitive){keep(path);return true;}state.changes[field.key]='unset';return true;
  }
  function keep(path){const field=state.fields.find(item=>same(item.path,path));if(!field)return;state.values[field.key]=initialValue(field);delete state.changes[field.key];state.error='';}
  function dirty(){return Object.keys(state.changes).length>0;}
  function markConflict(){state.conflict=true;state.error='原生配置版本已变化，草稿已保留。请重新读取后明确采用新版本。';}
  function rebase(){
    if(!state.latest||state.latest.revision===state.base.revision)return false;
    const fields=dshSettingsFields(state.latest),changes=Object.entries(state.changes).map(([key,operation])=>({field:state.fields.find(field=>field.key===key),operation,value:copy(state.values[key])}));
    if(!state.writable||changes.some(change=>{const next=fields.find(field=>field.key===change.field.key);return!next||next.readOnly||next.sensitive!==change.field.sensitive||next.control!==change.field.control||change.operation==='unset'&&next.required;})){state.error='原生字段结构或编辑权限已变化，原草稿仍保留；请核对后放弃草稿并重新编辑。';return false;}
    reset();for(const change of changes)if(change.operation==='unset')unset(change.field.path);else set(change.field.path,change.value);return true;
  }
  function build(){
    if(!state.writable)throw Error('当前配置只读，不能提交修改。');if(state.conflict)throw Error(state.error||'原生配置版本已变化，请先核对。');
    const ops=[],secureOps=[];
    for(const field of state.fields){
      const operation=state.changes[field.key];if(!operation||!editable(field))continue;
      let op;if(operation==='unset')op={op:'unset',path:[...field.path]};else{
        const raw=state.values[field.key];if(field.sensitive&&raw==='')continue;
        const value=fieldValue(field,raw);if(!field.sensitive&&same(value,field.value))continue;
        op={op:'set',path:[...field.path],value};
      }
      (field.sensitive?secureOps:ops).push(op);
    }
    return{ns:state.base.ns,expectedRevision:state.base.revision,ops,secureOps};
  }
  function clearSecrets(){for(const field of state.fields)if(field.sensitive){state.values[field.key]='';delete state.changes[field.key];}}
  return{state,select,set,unset,keep,dirty,editable,build,markConflict,rebase,reset,clearSecrets};
}

function initialValue(field){if(field.sensitive)return '';if(field.control==='json')return field.value===undefined?'':JSON.stringify(field.value,null,2);if(field.control==='select')return copy(field.value);return field.value??(field.control==='boolean'?false:'');}
function fieldValue(field,raw){
  if(field.control==='json'){try{return JSON.parse(raw);}catch{throw Error(field.path.join('.')+' 需要有效 JSON。');}}
  if(field.control==='number'){const value=Number(raw);if(String(raw).trim()===''||!Number.isFinite(value))throw Error(field.path.join('.')+' 需要有效数值。');return value;}
  if(field.control==='select'){if(!field.options.some(option=>!option.unset&&!option.disabled&&same(option.value,raw)))throw Error(field.path.join('.')+' 需要选择可编辑的原生选项。');return copy(raw);}
  if(field.control==='boolean'&&field.sensitive){if(raw!=='true'&&raw!=='false')throw Error(field.path.join('.')+' 需要 true 或 false。');return raw==='true';}
  return raw;
}
