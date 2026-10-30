import test from 'node:test';
import assert from 'node:assert/strict';
import {publicDshSettings} from '../src/dsh-native-settings.mjs';

const SECRET='synthetic-settings-private-value',MODEL='public-model-reference-012345678901234567890123456789012345678901234567890123456789';
const description=(schema,value,extra={})=>({writable:true,hasDocument:true,schemaFormat:'schemastery',namespaces:[{ns:'native-config',revision:7,applies:'live',autoGenerate:false,schema,value,base:structuredClone(value),user:structuredClone(value),secrets:[],...extra}]});
const clean=(schema,value,extra)=>publicDshSettings(description(schema,value,extra)).namespaces[0];
const absentSecret=value=>assert.equal(JSON.stringify(value).includes(SECRET),false);

test('nested inline secrets and every parent default/example are stripped without changing public types or values',()=>{
 const schema={type:'object',dict:{nested:{type:'object',dict:{private:{type:'string',meta:{role:'secret',default:SECRET,required:SECRET,description:SECRET,extra:{raw:SECRET}}},model:{type:'const',value:MODEL,meta:{default:MODEL}}},meta:{default:{private:SECRET,model:MODEL},examples:[{private:SECRET,model:MODEL}]}},enabled:{type:'boolean',meta:{default:true}}},meta:{default:{nested:{private:SECRET,model:MODEL},enabled:true},examples:[{nested:{private:SECRET,model:MODEL}}]}};
 const value={nested:{private:SECRET,model:MODEL},enabled:true},input=description(schema,value),saved=structuredClone(input),result=publicDshSettings(input),ns=result.namespaces[0];
 absentSecret(result);assert.deepEqual(input,saved);assert.deepEqual(ns.value,{nested:{model:MODEL},enabled:true});assert.deepEqual(ns.base,ns.value);assert.deepEqual(ns.user,ns.value);
 assert.deepEqual(ns.schema.dict.nested.meta.default,{model:MODEL});assert.deepEqual(ns.schema.meta.default,{nested:{model:MODEL},enabled:true});assert.deepEqual(ns.schema.dict.nested.meta.examples,[{model:MODEL}]);
 assert.equal(ns.schema.dict.nested.dict.private.type,'string');assert.equal(ns.schema.dict.nested.dict.private.meta.role,'secret');assert.equal(ns.schema.dict.nested.dict.model.type,'const');assert.equal(ns.schema.dict.nested.dict.model.value,MODEL);assert.equal(ns.schema.dict.enabled.meta.default,true);
});

test('reference graphs redact transform, array, dict and all union/intersection branches including defaults',()=>{
 const schema={uid:1,refs:{
  1:{type:'transform',inner:2,callback:'() => "'+SECRET+'"',preserve:true,meta:{default:[{alpha:{private:SECRET,model:MODEL}}]}},
  2:{type:'array',inner:3,meta:{default:[{alpha:{private:SECRET,model:MODEL}}]}},
  3:{type:'dict',inner:4,sKey:9,meta:{default:{alpha:{private:SECRET,model:MODEL}}}},
  4:{type:'union',list:[5,6],meta:{default:{private:SECRET,model:MODEL}}},
  5:{type:'object',dict:{private:7,model:8},meta:{default:{private:SECRET,model:MODEL}}},
  6:{type:'intersect',list:[5,10]},
  7:{type:'string',meta:{role:'secret',default:SECRET,examples:[SECRET],extra:{raw:SECRET}}},
  8:{type:'const',value:MODEL,meta:{default:MODEL}},9:{type:'string'},10:{type:'object',dict:{other:7}},
 }};
 const ns=clean(schema,[{alpha:{private:SECRET,model:MODEL,other:SECRET}}]);absentSecret(ns);assert.deepEqual(ns.value,[{alpha:{model:MODEL}}]);
 assert.deepEqual(ns.schema.refs[1].meta.default,[{alpha:{model:MODEL}}]);assert.deepEqual(ns.schema.refs[3].meta.default,{alpha:{model:MODEL}});assert.deepEqual(ns.schema.refs[4].meta.default,{model:MODEL});
 assert.equal(ns.schema.uid,1);assert.equal(ns.schema.refs[1].type,'transform');assert.equal(ns.schema.refs[1].inner,2);assert.equal(ns.schema.refs[1].preserve,true);assert.equal(ns.schema.refs[1].callback,undefined);assert.equal(ns.schema.refs[3].sKey,9);assert.deepEqual(ns.schema.refs[4].list,[5,6]);assert.equal(ns.schema.refs[8].value,MODEL);
});

test('root secret nodes and explicit empty secret paths remove entire value/base/user and value-bearing metadata',()=>{
 for(const [schema,secrets]of [[{type:'const',value:SECRET,meta:{role:'secret',default:SECRET,examples:[SECRET],extra:{value:SECRET},description:SECRET}},[]],[{type:'string',meta:{default:SECRET}},[{path:[],set:true,raw:SECRET}]]]){
  const ns=clean(schema,SECRET,{secrets});absentSecret(ns);for(const key of ['value','base','user'])assert.equal(Object.hasOwn(ns,key),false);assert.equal(ns.schema.type,schema.type);assert.equal(ns.schema.value,undefined);assert.equal(ns.schema.meta.default,undefined);
 }
 const nested=clean({type:'object',dict:{private:{type:'const',value:SECRET,meta:{default:SECRET}}},meta:{role:'secret'}},{private:SECRET});absentSecret(nested);assert.equal(nested.schema.dict.private.type,'const');assert.equal(nested.schema.dict.private.value,undefined);
});

test('explicit native sidecar paths clean local schema defaults and project only path/set metadata',()=>{
 const schema={uid:1,refs:{1:{type:'object',dict:{nested:2}},2:{type:'object',dict:{private:3,model:4},meta:{default:{private:SECRET,model:MODEL}}},3:{type:'string',meta:{default:SECRET}},4:{type:'string',meta:{default:MODEL}}}},ns=clean(schema,{nested:{private:SECRET,model:MODEL}},{secrets:[{path:['nested','private'],set:true,value:SECRET,raw:SECRET,metadata:{value:SECRET}}]});
 absentSecret(ns);assert.deepEqual(ns.value,{nested:{model:MODEL}});assert.deepEqual(ns.secrets,[{path:['nested','private'],set:true}]);assert.deepEqual(ns.schema.refs[2].meta.default,{model:MODEL});assert.equal(ns.schema.refs[3].meta.default,undefined);assert.equal(ns.schema.refs[4].meta.default,MODEL);
});

test('array secrets preserve indexes and tuple structure while dict secret items disappear',()=>{
 const schema={type:'object',dict:{list:{type:'array',inner:{type:'string',meta:{role:'secret'}}},dictionary:{type:'dict',inner:{type:'string',meta:{role:'secret'}}},tuple:{type:'tuple',list:[{type:'string',meta:{role:'secret'}},{type:'const',value:MODEL}]}}},ns=clean(schema,{list:[SECRET,SECRET],dictionary:{alpha:SECRET},tuple:[SECRET,MODEL]});
 absentSecret(ns);assert.deepEqual(ns.value,{list:[null,null],dictionary:{},tuple:[null,MODEL]});assert.equal(ns.schema.dict.tuple.type,'tuple');assert.equal(ns.schema.dict.tuple.list[1].value,MODEL);
});

test('raw schema and namespace diagnostics cannot carry private metadata through the descriptor',()=>{
 const schema={uid:1,refs:{1:{type:'object',dict:{model:2},meta:{description:'Public editor',extra:{credential:SECRET},raw:SECRET,volatile:SECRET,default:{model:MODEL}}},2:{type:'string',meta:{description:'Model',min:1,max:200,step:1,default:MODEL},callback:'() => '+JSON.stringify(SECRET),raw:SECRET}}},input=description(schema,{model:MODEL},{error:SECRET,raw:SECRET,metadata:{credential:SECRET}});input.diagnostic=SECRET;
 const result=publicDshSettings(input);absentSecret(result);assert.equal(result.namespaces[0].schema.refs[2].meta.default,MODEL);assert.equal(result.namespaces[0].schema.refs[2].meta.max,200);assert.equal(result.namespaces[0].schema.refs[1].meta.description,'Public editor');assert.equal(result.namespaces[0].schema.refs[1].meta.volatile,undefined);
});

test('secret paths never traverse inherited properties or mutate Object.prototype',()=>{
 const original=Object.getOwnPropertyDescriptor(Object.prototype,'toString');
 try{
  const ns=clean({type:'object',dict:{}},{model:MODEL},{secrets:[{path:['__proto__','toString'],set:true},{path:['constructor','prototype','toString'],set:true}]});
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype,'toString'),original);assert.equal(ns.value.model,MODEL);
 }finally{Object.defineProperty(Object.prototype,'toString',original);}
 const own=JSON.parse('{"__proto__":{"private":"'+SECRET+'","model":"'+MODEL+'"}}'),ns=clean({type:'object',dict:{}},own,{secrets:[{path:['__proto__','private'],set:true}]});absentSecret(ns);assert.equal(Object.hasOwn(ns.value,'__proto__'),true);assert.equal(ns.value.__proto__.model,MODEL);
});

test('cyclic references remain declarative and repeated uses retain ordinary public data',()=>{
 const schema={uid:1,refs:{1:{type:'union',list:[1,2]},2:{type:'object',dict:{model:3,private:4,child:2}},3:{type:'string',meta:{default:MODEL}},4:{type:'string',meta:{role:'secret',default:SECRET}},5:{type:'string',meta:{role:'secret',default:SECRET,extra:{raw:SECRET}}}}},ns=clean(schema,{model:MODEL,private:SECRET,child:{model:MODEL,private:SECRET}});
 absentSecret(ns);assert.deepEqual(ns.value,{model:MODEL,child:{model:MODEL}});assert.deepEqual(ns.schema.refs[1].list,[1,2]);assert.equal(ns.schema.refs[3].meta.default,MODEL);
});

test('public constructor names, bit constraints, booleans and localized labels keep their native types',()=>{
 const schema={type:'object',dict:{date:{type:'is',constructor:'Date'},regexp:{type:'string',meta:{role:'regexp',extra:{flag:'i',value:MODEL,credential:SECRET}}},flags:{type:'bitset',bits:{read:1,write:2},meta:{default:0}},model:{type:'const',value:MODEL,meta:{required:true,hidden:false,description:{en:'Public model','zh-CN':'公开模型'},link:'https://models.fixture/'+MODEL}}}},ns=clean(schema,{model:MODEL,flags:0});
 assert.equal(ns.schema.dict.date.constructor,'Date');assert.deepEqual(ns.schema.dict.flags.bits,{read:1,write:2});assert.equal(ns.schema.dict.model.meta.required,true);assert.equal(ns.schema.dict.model.meta.hidden,false);assert.equal(ns.schema.dict.model.meta.description['zh-CN'],'公开模型');assert.equal(ns.schema.dict.model.meta.link,'https://models.fixture/'+MODEL);
 assert.deepEqual(ns.schema.dict.regexp.meta.extra,{flag:'i',value:MODEL});absentSecret(ns);
});

test('malformed descriptor envelopes and sidecar paths fail at the entry without echoing their values',()=>{
 for(const value of [null,{namespaces:{}},{namespaces:[{schema:null}]},description({type:'string'},'public',{secrets:[{path:SECRET,set:true}]}),description({type:'string'},'public',{secrets:[{path:[{}],set:true}]})]){
  assert.throws(()=>publicDshSettings(value),error=>error.code==='DSH_NATIVE_SETTINGS_DESCRIPTOR_INVALID'&&!error.message.includes(SECRET));
 }
});

test('native unmarked Provider headers and credential URLs become secret fields while shared public references survive',()=>{
 const privateURL='https://user:'+SECRET+'@provider.fixture/v1',schema={uid:1,refs:{1:{type:'object',dict:{api:4,baseURL:4,apiKeyEnv:4,headers:5,model:4},meta:{default:{api:'openai-completions',baseURL:privateURL,apiKeyEnv:'PROVIDER_API_KEY',headers:{Authorization:SECRET,'x-api-key':SECRET},model:MODEL},examples:[{baseURL:privateURL,headers:{Authorization:SECRET},model:MODEL}]}},4:{type:'string',meta:{default:MODEL}},5:{type:'dict',inner:4,meta:{default:{Authorization:SECRET},examples:[{'x-api-key':SECRET}]}}}},value={api:'openai-completions',baseURL:privateURL,apiKeyEnv:'PROVIDER_API_KEY',headers:{Authorization:SECRET,'x-api-key':SECRET},model:MODEL},ns=clean(schema,value);
 absentSecret(ns);assert.deepEqual(ns.value,{api:'openai-completions',apiKeyEnv:'PROVIDER_API_KEY',model:MODEL});assert.deepEqual(ns.base,ns.value);assert.deepEqual(ns.user,ns.value);assert.equal(ns.schema.uid,1);assert.equal(ns.schema.refs[1].dict.api,4);assert.equal(ns.schema.refs[1].dict.apiKeyEnv,4);assert.equal(ns.schema.refs[1].dict.model,4);assert.equal(ns.schema.refs[4].type,'string');assert.equal(ns.schema.refs[4].meta.default,MODEL);
 for(const key of ['baseURL','headers']){const ref=ns.schema.refs[1].dict[key];assert.notEqual(ref,4);assert.equal(ns.schema.refs[ref].meta.role,'secret');assert.equal(ns.schema.refs[ref].type,key==='headers'?'dict':'string');}
 assert.deepEqual(new Set(ns.secrets.filter(item=>item.set).map(item=>JSON.stringify(item.path))),new Set(['["baseURL"]','["headers"]']));assert.deepEqual(publicDshSettings({namespaces:[ns]}).namespaces[0],ns);
});

test('known unmarked credential names and credential query URLs are hidden, ordinary URLs and apiKeyEnv stay exact',()=>{
 const sensitive={apiKey:SECRET,api_key:SECRET,token:SECRET,password:SECRET,clientSecret:SECRET,accessToken:SECRET,authorization:SECRET,queryURL:'https://provider.fixture/v1?api_key='+SECRET},value={...sensitive,baseURL:'https://provider.fixture/v1?model='+MODEL,apiKeyEnv:'NATIVE_API_KEY',model:MODEL},schema={type:'object',dict:Object.fromEntries(Object.keys(value).map(key=>[key,{type:'string'}]))},ns=clean(schema,value);
 absentSecret(ns);assert.deepEqual(ns.value,{baseURL:value.baseURL,apiKeyEnv:'NATIVE_API_KEY',model:MODEL});for(const key of Object.keys(sensitive)){assert.equal(ns.schema.dict[key].meta.role,'secret');assert.ok(ns.secrets.some(item=>item.path.join('.')===key&&item.set));}assert.equal(ns.schema.dict.apiKeyEnv.meta?.role,undefined);
});

test('one private URL in a provider dictionary does not erase another provider public URL',()=>{
 const schema={uid:1,refs:{1:{type:'dict',inner:2},2:{type:'object',dict:{baseURL:3,apiKeyEnv:3}},3:{type:'string'}}},value={privateProvider:{baseURL:'https://provider.fixture/?access_token='+SECRET,apiKeyEnv:'PRIVATE_API_KEY'},publicProvider:{baseURL:'https://public.fixture/v1',apiKeyEnv:'PUBLIC_API_KEY'}},ns=clean(schema,value);
 absentSecret(ns);assert.equal(ns.value.privateProvider.baseURL,undefined);assert.equal(ns.value.publicProvider.baseURL,'https://public.fixture/v1');assert.equal(ns.value.publicProvider.apiKeyEnv,'PUBLIC_API_KEY');assert.ok(ns.secrets.some(item=>item.path.join('.')==='privateProvider.baseURL'&&item.set));assert.deepEqual(publicDshSettings({namespaces:[ns]}).namespaces[0],ns);
});
