export const FORWARD_MESSAGE_LIMIT=20;
const empty=()=>({selecting:false,dialog:false,messageIds:[],targetEmployeeId:'',mode:'reference',note:'',status:'idle',error:'',result:null,clientRequestId:''});
const scopeKey=scope=>scope?.workspace&&scope?.actor&&scope?.conversationId?JSON.stringify([scope.workspace,scope.actor,scope.employeeId||'',scope.conversationId]):'';
const locked=state=>['pending','unknown'].includes(state.status);

/** A network-unknown POST retains its exact request across editor/navigation resets. */
export function createConversationForwarder({send,makeId=()=>crypto.randomUUID(),wrap=value=>value,storage=null}={}) {
  const state=wrap(empty()),requests=new Map();let scope=null,key='';
  const storageKey=value=>`ziwei.forward.pending:${value}`;
  const save=(record,remove=false)=>{try{if(remove)storage?.removeItem(storageKey(record.key));else storage?.setItem(storageKey(record.key),JSON.stringify({body:record.body,conversationId:record.conversationId}));}catch{}};
  function remembered(){
    if(!key)return null;
    if(!requests.has(key))try{const record=JSON.parse(storage?.getItem(storageKey(key))||'null');if(record?.conversationId===scope.conversationId&&typeof record.body?.clientRequestId==='string'&&Array.isArray(record.body.messageIds)&&record.body.messageIds.length>0&&record.body.messageIds.length<=FORWARD_MESSAGE_LIMIT&&typeof record.body.targetEmployeeId==='string'&&['reference','execute'].includes(record.body.mode))requests.set(key,{...record,key,status:'unknown',everUnknown:true});}catch{}
    return requests.get(key);
  }
  function restore(record){Object.assign(state,empty(),{dialog:true,messageIds:[...record.body.messageIds],targetEmployeeId:record.body.targetEmployeeId,mode:record.body.mode,note:record.body.note||'',clientRequestId:record.body.clientRequestId,status:record.status,error:record.status==='unknown'?'上次结果未确认，请重试同一次转发。':''});}
  function edit(patch){if(locked(state))return false;Object.assign(state,patch,{error:'',status:'idle'});return true;}
  return {
    state,
    setScope(next){const nextKey=scopeKey(next);if(nextKey===key)return;key=nextKey;scope=next;Object.assign(state,empty());},
    dispose(){key='';scope=null;Object.assign(state,empty());},
    begin(messageIds=[],{selecting=false}={}){if(!key)return false;const pending=remembered();if(pending){restore(pending);return true;}const ids=[...new Set(messageIds)].filter(Boolean);if(ids.length>FORWARD_MESSAGE_LIMIT)return false;Object.assign(state,empty(),{messageIds:ids,selecting,dialog:!selecting});return true;},
    toggle(id){if(!key||locked(state)||!id)return false;const ids=state.messageIds.includes(id)?state.messageIds.filter(value=>value!==id):[...state.messageIds,id];if(ids.length>FORWARD_MESSAGE_LIMIT){state.error='一次最多选择 20 条消息';return false;}return edit({selecting:true,messageIds:ids});},
    open(){if(!state.messageIds.length)return false;state.dialog=true;state.error='';return true;},
    update(patch){return edit(Object.fromEntries(Object.entries(patch).filter(([name])=>['targetEmployeeId','mode','note'].includes(name))));},
    cancel(){Object.assign(state,empty());},
    async submit(visibleEmployeeIds=[]){
      if(!key||state.status==='pending')return null;
      let record=remembered();
      if(!record){
        if(!state.messageIds.length||state.messageIds.length>FORWARD_MESSAGE_LIMIT){state.error='请选择 1–20 条消息';return null;}
        if(!visibleEmployeeIds.includes(state.targetEmployeeId)){state.error='请选择当前可见的数字员工';return null;}
        if(!['reference','execute'].includes(state.mode)||state.note.length>4000){state.error='附言最多 4000 字';return null;}
        const body={messageIds:[...state.messageIds],targetEmployeeId:state.targetEmployeeId,note:state.note.trim(),mode:state.mode,clientRequestId:makeId()};
        record={key,conversationId:scope.conversationId,body,status:'pending'};requests.set(key,record);
      }
      if(record.status==='pending'&&record.promise)return null;
      const current=()=>key===record.key&&state.clientRequestId===record.body.clientRequestId&&state.dialog;
      record.status='pending';state.status='pending';state.clientRequestId=record.body.clientRequestId;state.error='';save(record);
      record.promise=(async()=>{
        try{
          const result=await send(record.conversationId,structuredClone(record.body));
          if(!result?.forward?.id||result.forward.sourceConversationId!==record.conversationId||result.forward.targetEmployeeId!==record.body.targetEmployeeId||result.forward.mode!==record.body.mode||!result.forward.targetConversationId)throw new Error('转发结果未确认');
          requests.delete(record.key);save(record,true);
          const visible=current();if(visible)Object.assign(state,empty(),{result});
          return {result,current:visible};
        }catch(error){
          // Only a first, explicit 4xx rejection permits edits/new identity.
          // After an unknown outcome, even a later permission or route error
          // cannot prove the original request did not commit.
          const rejected=!record.everUnknown&&Number.isInteger(error.status)&&error.status>=400&&error.status<500&&error.status!==408&&!['IDEMPOTENCY_CONFLICT','FORWARD_IDEMPOTENCY_CONFLICT','FORWARD_REQUEST_CONFLICT','FORWARD_RECEIPT_INVALID'].includes(error.code);
          record.status=rejected?'error':'unknown';if(!rejected)record.everUnknown=true;
          if(rejected){requests.delete(record.key);save(record,true);}
          if(current()){state.status=record.status;state.error=rejected?error.message:'结果未确认，请重试同一次转发。';}
          return null;
        }finally{record.promise=null;}
      })();
      return record.promise;
    },
  };
}
