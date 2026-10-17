import {createApi} from './api.js';
import {createController} from './controller.js';
import {createReporting} from './reporting.js';
import {initialState,scopeKey} from './model.js';
import {render,captureDraft,restoreFocus} from './view.js';
import {installMessageGestures,lastVisibleMessage} from './message-gestures.js';

const state=initialState(),root=document.getElementById('app');
let lastView='',lastMarkup='',renderScheduled=false,readScheduled=false,nativePaused=false;
function scheduleRead(){
  if(readScheduled)return;readScheduled=true;
  requestAnimationFrame(()=>{
    readScheduled=false;
    if(nativePaused||document.hidden||state.phase!=='ready'||state.page!=='chat'||state.forward||state.forwardDetail||state.imagePreview)return;
    const messageId=lastVisibleMessage(root.querySelector('.chat-timeline'),window.visualViewport?.height||window.innerHeight);
    if(messageId&&state.conversation?.id)void controller.actions['mark-thread-read']({conversationId:state.conversation.id,messageId});
  });
}
function draw(){
  const view=`${state.phase}:${scopeKey(state)}:${state.page}:${state.tab}:${state.selectedEmployee?.id||''}:${state.report?.index||0}`;
  const sameView=view===lastView,markup=render(state);
  // A revalidated poll often changes no visible content. Keep decoded images,
  // long history nodes, selection and scroll intact instead of rebuilding them.
  if(sameView&&markup===lastMarkup){scheduleRead();return;}
  const scroll=document.scrollingElement?.scrollTop||0,timeline=root.querySelector('.chat-timeline');
  const timelineScroll=timeline?.scrollTop,atEnd=timeline?timeline.scrollHeight-timeline.clientHeight-timeline.scrollTop<100:true;
  const fields=sameView?[...root.querySelectorAll('input[name]:not([type=file]),select[name],textarea[name]:not([name=draft])')].filter(f=>!['search'].includes(f.name)&&!f.form?.hasAttribute('data-state-fields')).map(f=>({name:f.name,form:f.form?.dataset.form||'',record:f.form?.dataset.recordKey||'',value:f.value,checked:f.checked})):[];
  const active=document.activeElement;
  const focus=sameView&&active?.name&&root.contains(active)?{name:active.name,form:active.form?.dataset.form||'',record:active.form?.dataset.recordKey||'',start:active.selectionStart,end:active.selectionEnd}:null;
  // Controller inputs are canonical. Keep the view's focus helper from restoring a cleared draft.
  captureDraft(root,{...state});
  const template=document.createElement('template');
  template.innerHTML=markup;
  const nextTimeline=template.content.querySelector('.chat-timeline');
  // Status/composer changes must not discard an unchanged long conversation.
  // A template is inert, so replacement images are never loaded or decoded.
  if(sameView&&timeline&&nextTimeline&&timeline.innerHTML===nextTimeline.innerHTML)nextTimeline.replaceWith(timeline);
  root.replaceChildren(template.content);
  if(sameView)for(const saved of fields){const target=[...root.querySelectorAll('[name]')].find(f=>f.name===saved.name&&(f.form?.dataset.form||'')===saved.form&&(f.form?.dataset.recordKey||'')===saved.record);if(target){target.value=saved.value;if(target.type==='checkbox')target.checked=saved.checked;}}
  restoreFocus();
  if(focus){const target=[...root.querySelectorAll('[name]')].find(f=>f.name===focus.name&&(f.form?.dataset.form||'')===focus.form&&(f.form?.dataset.recordKey||'')===focus.record);if(target){target.focus({preventScroll:true});try{target.setSelectionRange(focus.start,focus.end);}catch{}}}
  const currentTimeline=root.querySelector('.chat-timeline');
  if(currentTimeline){currentTimeline.scrollTop=atEnd||!sameView?currentTimeline.scrollHeight:timelineScroll||0;}
  if(!sameView)window.scrollTo(0,0);else window.scrollTo(0,scroll);
  lastView=view;lastMarkup=markup;
  scheduleRead();
}
const api=createApi();
const reporting=createReporting({api,storage:localStorage,onChange:()=>draw()});
const controller=createController({state,api,reporting,render:draw,storage:localStorage});
installMessageGestures(root,{enabled:()=>state.phase==='ready'&&state.page==='chat'&&!state.forward&&!state.forwardDetail&&!state.imagePreview&&!nativePaused,openMenu:id=>void controller.actions['message-menu']({id})});
root.addEventListener('scroll',scheduleRead,true);
document.addEventListener('visibilitychange',scheduleRead);
window.addEventListener('ziwei:pause',()=>{nativePaused=true;});
window.addEventListener('ziwei:resume',()=>{nativePaused=false;scheduleRead();});
root.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=controller.actions[target.dataset.action];if(!action)return;
  event.preventDefault();void action({...target.dataset});
});
root.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form);void controller.submit(form,data);});
root.addEventListener('input',event=>{if(event.target.type!=='file'&&event.target.tagName!=='SELECT')void controller.change(event);});
root.addEventListener('change',event=>{if(event.target.type==='file'||event.target.tagName==='SELECT')void controller.change(event);});
window.addEventListener('ziwei:back',event=>{if(state.imagePreview||state.forwardDetail||state.forward||state.phase==='ready'&&state.page!=='home'){event.preventDefault();void controller.actions.back();}else if(state.phase==='ready'&&state.tab!=='chat'){event.preventDefault();void controller.actions.navigate({tab:state.tab==='devices'?'me':'chat'});}});
function resize(){if(renderScheduled)return;renderScheduled=true;requestAnimationFrame(()=>{document.documentElement.style.setProperty('--app-height',`${Math.round(window.visualViewport?.height||window.innerHeight)}px`);renderScheduled=false;scheduleRead();});}
window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
window.addEventListener('pagehide',()=>{if(state.page==='chat')root.querySelector('[name=draft]')?.dispatchEvent(new Event('input',{bubbles:true}));});
void controller.boot();
