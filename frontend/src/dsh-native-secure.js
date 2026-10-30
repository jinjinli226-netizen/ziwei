import {watch} from 'vue';
import {sealBrowserAnswer} from './bot-interaction.js';
import {dshNativeApplicationLabel} from './dsh-native.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const terminal=new Set(['succeeded','failed','expired','cancelled']);
function erase(value){if(Array.isArray(value)){value.forEach(erase);value.length=0;}else if(value&&typeof value==='object')for(const name of Object.keys(value)){erase(value[name]);value[name]=null;}}
function takePayload(payload){
  let resource=payload.resource,operation=payload.operation,input=payload.input,secret,mutation=null;
  if(payload.kind==='provider'){resource='credentials';operation='set';input={ref:payload.ref};secret={value:payload.secret};mutation=payload.mutation;}
  else if(payload.kind==='credential'){resource='credentials';operation='set';input={ref:payload.ref};secret={value:payload.secret};}
  else if(payload.kind==='discover-models'){resource='providers';operation='discoverModelsSecure';secret={apiKey:payload.secret};}
  else secret=payload.secret;
  payload.secret=null;
  const shape=({'credentials.set':{allowed:['ref'],required:['ref']},'settings.mutateSecure':{allowed:['ns','expectedRevision'],required:['ns','expectedRevision']},'providers.discoverModelsSecure':{allowed:['provider','api','baseURL'],required:[]}})[`${resource}.${operation}`];
  const invalidSecret=resource==='settings'?!Array.isArray(secret?.ops):typeof secret?.[resource==='credentials'?'value':'apiKey']!=='string'||!secret[resource==='credentials'?'value':'apiKey'];
  if(!shape||!input||Object.keys(input).some(name=>!shape.allowed.includes(name))||shape.required.some(name=>!Object.hasOwn(input,name))||Object.entries(input).some(([name,value])=>name==='expectedRevision'?!Number.isSafeInteger(value)||value<0:typeof value!=='string'||!value)||!secret||invalidSecret){
    erase(secret);throw Error('DSH_SECRET_INPUT_INVALID');
  }
  if(mutation&&(mutation.resource!=='providers'||mutation.operation!=='upsert'||mutation.input?.credentialRef!==input.ref)){erase(secret);throw Error('DSH_SECRET_INPUT_INVALID');}
  return{resource,operation,input:copy(input),secret,mutation};
}

export function createDshNativeSecure({api,controller,wrap=value=>value,keyFactory=()=>crypto.randomUUID(),seal=sealBrowserAnswer,pollInterval=1500,pollLimit=20,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),now=Date.now}={}){
  const state=wrap({scope:null,busy:false,status:'idle',stage:'idle',request:null,action:null,unknown:false,steps:{provider:'not-requested',credential:'not-requested'},error:'',notice:''});
  const known=new Map();let generation=0,disposed=false,activeErase=null;
  function scope(){const local=controller.state.subject,value=controller.state.value;if(!local||!value)return null;return{actorId:local.actorId,workspace:local.workspace,employeeId:local.employeeId,conversationId:local.conversationId||null,subjectHash:value.subjectHash,subject:copy(value.subject),kind:value.scope.kind};}
  const identity=value=>value?JSON.stringify([value.actorId,value.workspace,value.employeeId,value.conversationId,value.subjectHash]):'';
  function save(){if(state.scope)known.set(identity(state.scope),copy({status:state.status,stage:state.stage,request:state.request,action:state.action,unknown:state.unknown,steps:state.steps,error:state.error,notice:state.notice}));}
  function synchronize(force=false){
    const next=scope();if(!force&&identity(next)===identity(state.scope))return;
    if(state.busy){state.unknown=true;state.status=state.steps.provider==='applied'?'partial':'unknown';state.notice='操作已中断；原请求引用保留，秘密输入已清除。';}
    save();generation++;activeErase?.();activeErase=null;
    Object.assign(state,{scope:next,busy:false,status:'idle',stage:'idle',request:null,action:null,unknown:false,steps:{provider:'not-requested',credential:'not-requested'},error:'',notice:''},known.get(identity(next))||{});
  }
  const stopWatch=watch(()=>identity(scope()),()=>synchronize(),{flush:'sync'});synchronize();
  const current=(visit,selected)=>!disposed&&visit===generation&&identity(scope())===identity(selected);
  function check(visit,selected){if(!current(visit,selected))throw Error('DSH_SECRET_SCOPE_CHANGED');}
  function available(){const selected=scope();return Boolean(!disposed&&selected?.kind==='bot'&&!selected.conversationId&&selected.actorId&&selected.subject.ownerUserId===selected.actorId&&globalThis.crypto?.subtle&&api.prepareDshNativeSecret&&api.answerDshNativeSecret);}
  function preparedRequest(value,request,selected){
    const binding=value?.binding,action=value?.action,op=action?.payload?.dshOperation;
    if(!value?.requestId||!binding||binding.schemaVersion!==1||binding.purpose!=='dsh-native-secret'||binding.requestId!==value.requestId||binding.actionId!==action?.id||binding.workspace!==selected.workspace||binding.workspaceId!==selected.subject.workspaceId||binding.employeeId!==selected.employeeId||binding.ownerUserId!==selected.actorId||binding.deviceId!==selected.subject.deviceId||binding.profile!==selected.subject.profile||binding.subjectHash!==selected.subjectHash||binding.resource!==request.resource||binding.operation!==request.operation||!same(binding.input,request.input)||Date.parse(binding.expiresAt)<=now()||!Number.isFinite(Date.parse(binding.expiresAt))||typeof value.devicePublicKey!=='string'||!same(op?.subject,selected.subject)||op.scope?.kind!=='bot'||op.resource!==request.resource||op.operation!==request.operation)throw Error('DSH_SECRET_BINDING_INVALID');
    request.requestId=value.requestId;request.actionId=action.id;request.binding=copy(binding);return value;
  }
  function acceptAction(value,request,selected){
    const action=value?.action||value,op=action?.payload?.dshOperation;
    if(action?.id!==request.actionId||!same(op?.subject,selected.subject)||op.scope?.kind!=='bot'||op.resource!==request.resource||op.operation!==request.operation)throw Error('DSH_SECRET_BINDING_INVALID');
    state.action=action;
    if(!terminal.has(action.status))return false;
    const receipt=action.result?.dshNative;
    if(receipt?.schemaVersion!==1||receipt.source!=='dsh-native'||!same(receipt.subject,selected.subject)||receipt.scope?.kind!=='bot'||receipt.resource!==request.resource||receipt.operation!==request.operation)throw Error('DSH_SECRET_RECEIPT_INVALID');
    const success=request.operation==='discoverModelsSecure'?receipt.status==='observed':['applied','restart-required'].includes(receipt.status);
    state.status=success?receipt.status:state.steps.provider==='applied'?'partial':['failed','cancelled','unavailable'].includes(receipt.status)?'failed':receipt.status==='overridden'?'overridden':'unknown';
    state.unknown=!success&&!['failed','cancelled','unavailable','overridden'].includes(receipt.status);state.stage='receipt';state.notice=dshNativeApplicationLabel(receipt.status);
    if(!success&&receipt.status==='observed')state.notice='仅有原生观察，尚未证明秘密写入已应用；原请求保留。';
    if(request.resource==='credentials')state.steps.credential=success?'applied':state.unknown?'unknown':receipt.status;
    if(state.steps.provider==='applied'&&!success)state.notice='Provider 配置已应用；凭据步骤尚未确认，两个步骤并非原子操作。';
    save();return true;
  }
  async function query(visit,selected){
    const request=state.request;if(!request?.actionId)return false;
    const action=await api.dshNativeAction(request.actionId,selected.workspace);check(visit,selected);return acceptAction(action,request,selected);
  }
  async function poll(visit,selected){
    for(let count=0;count<pollLimit;count++){
      if(await query(visit,selected))return;check(visit,selected);if(count+1<pollLimit)await pause(pollInterval);
    }
    state.status=state.steps.provider==='applied'?'partial':'unknown';state.unknown=true;state.notice='已到本次读取等待上限；保留原请求，只能继续回读。';save();
  }
  async function providerStep(mutation,visit,selected){
    state.stage='provider';state.steps.provider='pending';
    const queued=await controller.submit('providers','upsert',mutation.input,{observedResource:'providers'});check(visit,selected);
    const actionId=queued?.action?.id||controller.state.request?.actionId;
    state.request.providerActionId=actionId||null;save();
    if(!actionId)throw Error('DSH_SECRET_PROVIDER_UNKNOWN');
    for(let count=0;count<pollLimit;count++){
      const action=controller.state.action;
      if(action?.id===actionId&&terminal.has(action.status)){
        if(action.result?.dshNative?.status==='applied'){state.steps.provider='applied';save();return;}
        state.steps.provider=action.result?.dshNative?.status==='failed'?'failed':'unknown';throw Error('DSH_SECRET_PROVIDER_UNKNOWN');
      }
      await controller.readAction();check(visit,selected);if(count+1<pollLimit)await pause(pollInterval);
    }
    if(controller.state.action?.id===actionId&&controller.state.action.result?.dshNative?.status==='applied'){state.steps.provider='applied';save();return;}
    state.steps.provider='unknown';throw Error('DSH_SECRET_PROVIDER_UNKNOWN');
  }
  async function submit(payload){
    let secret=null,envelope=null,selected=null,visit=null,owns=false,eraseThis=null;
    try{
      const request=takePayload(payload);secret=request.secret;synchronize();
      const finishCredential=state.status==='partial'&&!state.unknown&&state.steps.provider==='applied'&&!request.mutation&&request.resource==='credentials'&&request.input.ref===state.request?.input.ref;
      if(disposed||state.busy||state.request&&!finishCredential&&!['applied','observed','restart-required','overridden','failed'].includes(state.status))return;
      if(!available())throw Error('DSH_SECRET_OWNER_REQUIRED');
      if(controller.state.request)throw Error('DSH_SECRET_NATIVE_REQUEST_PENDING');
      selected=scope();visit=generation;owns=true;state.busy=true;state.error='';state.notice='';state.unknown=false;state.action=null;state.steps={provider:finishCredential?'applied':'not-requested',credential:'not-requested'};
      const reference={resource:request.resource,operation:request.operation,input:request.input,idempotencyKey:keyFactory(),expectedSubjectHash:selected.subjectHash,requestId:null,actionId:null};state.request=reference;state.status='pending';save();
      eraseThis=()=>{erase(secret);secret=null;};activeErase=eraseThis;
      if(request.mutation)await providerStep(request.mutation,visit,selected);
      check(visit,selected);if(!secret)throw Error('DSH_SECRET_SCOPE_CHANGED');
      state.stage='prepare';const response=await api.prepareDshNativeSecret(selected.employeeId,{resource:reference.resource,operation:reference.operation,input:reference.input,expectedSubjectHash:reference.expectedSubjectHash,idempotencyKey:reference.idempotencyKey},selected.workspace);
      const prepared=preparedRequest(response,reference,selected);if(!current(visit,selected)){known.set(identity(selected),{...known.get(identity(selected)),request:copy(reference)});return;}
      state.request=reference;save();state.stage='encrypt';envelope=await seal(prepared.devicePublicKey,prepared.binding,secret);erase(secret);secret=null;check(visit,selected);
      state.stage='answer';await api.answerDshNativeSecret(selected.employeeId,prepared.requestId,{envelope},selected.workspace);check(visit,selected);envelope=null;state.stage='pending';state.notice='密文已投递，等待原生操作回执；尚未确认保存。';save();await poll(visit,selected);
      if(current(visit,selected))await controller.load();
    }catch(error){
      if(owns&&current(visit,selected)){
        const providerUnknown=error.message==='DSH_SECRET_PROVIDER_UNKNOWN',definitive=error.status>=400&&error.status<500&&![408,409,429].includes(error.status)&&state.stage==='prepare';
        state.unknown=!definitive&&state.steps.provider!=='failed';state.status=state.steps.provider==='applied'?'partial':definitive||state.steps.provider==='failed'?'failed':'unknown';
        state.error=error.message==='DSH_SECRET_OWNER_REQUIRED'?'仅当前员工本人可使用已就绪的安全通道。':error.message==='DSH_SECRET_NATIVE_REQUEST_PENDING'?'请先查询当前原生请求。':providerUnknown?'Provider 配置尚未核实，凭据步骤没有执行。':'安全投递结果尚不能核实；原请求引用已保留，请回读。';
        state.notice=state.steps.provider==='applied'?'Provider 配置已应用；凭据步骤尚未确认，不能视为全部完成。':'';save();
      }else if(!owns&&!disposed&&!state.busy&&!state.request)state.error='安全输入不符合当前操作要求，请检查权限、连接与字段。';
    }finally{
      erase(secret);secret=null;envelope=null;erase(payload.secret);payload.secret='';if(activeErase===eraseThis)activeErase=null;
      if(owns&&current(visit,selected)){state.busy=false;save();}
    }
    return state.action;
  }
  async function readAction(){
    synchronize();if(disposed||state.busy||!state.request)return;const selected=scope(),visit=generation;if(!available())return;
    if(!state.request.actionId){
      if(state.request.providerActionId){
        state.busy=true;
        try{await controller.readAction();check(visit,selected);const action=controller.state.action;if(action?.id===state.request.providerActionId&&terminal.has(action.status)){state.action=action;if(action.result?.dshNative?.status==='applied'){state.steps.provider='applied';state.status='partial';state.unknown=false;state.notice='Provider 配置已核实；凭据尚未提交，请单独重新输入凭据，不要重做配置。';}else{state.steps.provider='failed';state.status='failed';state.unknown=false;state.notice='Provider 配置未应用；凭据步骤没有执行。';}}}
        catch{if(current(visit,selected))state.error='原 Provider 请求尚不能核实。';}finally{if(current(visit,selected)){state.busy=false;save();}}return;
      }
      state.notice='原准备请求的回执引用尚未确认；不会重新准备或重发秘密。';return;
    }
    state.busy=true;try{await query(visit,selected);if(current(visit,selected))await controller.load();}catch{if(current(visit,selected)){state.unknown=true;state.error='原请求回执尚不能读取，请保留原引用。';save();}}finally{if(current(visit,selected)){state.busy=false;save();}}
  }
  function clear(){synchronize(true);}
  function dispose(){if(disposed)return;clear();disposed=true;generation++;activeErase?.();activeErase=null;stopWatch();known.clear();}
  return{state,available,submit,readAction,clear,dispose};
}
