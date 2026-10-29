// A refreshed latest page updates messages without discarding older pages or
// messages just sent by this browser. The server owns message IDs and cursors.
const rows=value=>Array.isArray(value)?value:[];
const validId=value=>typeof value==='string'&&value.length>0;
function mergedMessages(first,second) {
  const messages=[],indices=new Map();
  for(const message of [...rows(first),...rows(second)]){
    if(!message||typeof message!=='object')continue;
    const id=message.id;
    if(validId(id)&&indices.has(id)){
      const index=indices.get(id);messages[index]={...messages[index],...message};
    }else{if(validId(id))indices.set(id,messages.length);messages.push(message);}
  }
  // Server timestamps are chronological. Stable ordering handles equal times
  // while retaining a locally received message absent from a stale latest page.
  return messages.sort((a,b)=>{
    const left=Date.parse(a.created_at),right=Date.parse(b.created_at);
    return Number.isFinite(left)&&Number.isFinite(right)?left-right:0;
  });
}
function sameConversation(current,incoming) {return Boolean(current&&incoming&&current.id===incoming.id);}
function pageTotal(page,fallback){return Number.isSafeInteger(page?.total)&&page.total>=0?page.total:fallback;}

export function mergeConversationLatest(current,incoming) {
  if(!incoming)return current;
  // Unpaged callers retain the existing authoritative full-detail contract.
  if(!incoming.messagePage||!sameConversation(current,incoming))return incoming;
  const messages=mergedMessages(current.messages,incoming.messages),previous=rows(current.messages);
  const keepsEarlier=previous.length>0&&messages[0]?.id===previous[0]?.id;
  const source=keepsEarlier&&current.messagePage?current.messagePage:incoming.messagePage;
  const messagePage=source?{...source,total:pageTotal(incoming.messagePage,source.total),beforeCursor:messages[0]?.id||source.beforeCursor||null}:undefined;
  return {...current,...incoming,messages,...(messagePage?{messagePage}:{})};
}

export function prependConversationHistory(current,older) {
  if(!sameConversation(current,older))return current;
  const messages=mergedMessages(older.messages,current.messages);
  // Older page metadata must never replace current employee, model, execution
  // or working-directory bindings. Only its earlier pagination boundary wins.
  const page=older.messagePage;
  const messagePage=page?{...page,total:pageTotal(current.messagePage,page.total),beforeCursor:messages[0]?.id||page.beforeCursor||null}:current.messagePage;
  return {...current,messages,...(messagePage?{messagePage}:{})};
}

export function isConversationNearBottom({scrollHeight=0,scrollTop=0,clientHeight=0}={},distance=40) {
  return scrollHeight-scrollTop-clientHeight<=distance;
}
export function shouldShowConversationLatest({scrollHeight=0,scrollTop=0,clientHeight=0}={}) {
  return scrollHeight-scrollTop-clientHeight>120;
}
export function createConversationScrollTracker({wrap=value=>value}={}) {
  const state=wrap({followLatest:true,showLatest:false});
  let previousTop=0,upwards=false,touchY=null;
  function pause(){state.followLatest=false;}
  function intent(up){upwards=up;if(up)pause();}
  function refresh(node){
    if(!node)return;
    if(state.followLatest)node.scrollTop=node.scrollHeight;
    previousTop=node.scrollTop;state.showLatest=shouldShowConversationLatest(node);
  }
  return {
    state,pause,refresh,
    reset(){state.followLatest=true;state.showLatest=false;previousTop=0;upwards=false;touchY=null;},
    jump(node){state.followLatest=true;upwards=false;refresh(node);},
    scroll({currentTarget:node}){state.followLatest=!(upwards&&node.scrollTop<previousTop)&&isConversationNearBottom(node);previousTop=node.scrollTop;state.showLatest=shouldShowConversationLatest(node);},
    wheel(event){if(event.deltaY)intent(event.deltaY<0);},
    touchStart(event){touchY=event.touches?.[0]?.clientY??null;upwards=false;},
    touchMove(event){const next=event.touches?.[0]?.clientY;if(touchY!==null&&next!==undefined&&next!==touchY)intent(next>touchY);touchY=next??null;},
    key(event){if(['ArrowUp','PageUp','Home'].includes(event.key))intent(true);else if(['ArrowDown','PageDown','End'].includes(event.key))intent(false);},
    pointer(){upwards=true;}
  };
}
export function shouldLoadEarlierHistory({hasMore=false,loading=false,error='',scrollTop=0,previousScrollTop=0,userInitiated=false}={}) {
  return Boolean(hasMore&&!loading&&!error&&userInitiated&&scrollTop<previousScrollTop&&scrollTop<=160);
}
export function restoreConversationPrependScroll({scrollTop=0,scrollHeight=0,nextScrollHeight=scrollHeight,anchorOffset,nextAnchorOffset}={}) {
  const delta=Number.isFinite(anchorOffset)&&Number.isFinite(nextAnchorOffset)?nextAnchorOffset-anchorOffset:nextScrollHeight-scrollHeight;
  return Math.max(0,scrollTop+delta);
}
