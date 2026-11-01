import {createApi} from './api.js';
import {createController} from './controller.js';
import {createReporting} from './reporting.js';
import {initialState,scopeKey} from './model.js';
import {render,captureDraft,restoreFocus} from './view.js';
import {installMessageGestures,lastVisibleMessage} from './message-gestures.js';
import {createDomRenderer} from './dom-renderer.js';
import {captureChatScroll,restoreChatScroll,distanceFromEnd} from './chat-scroll.js';

const state=initialState(),root=document.getElementById('app');
const domRenderer=createDomRenderer(root);
let lastView='',lastMarkup='',lastJump='',renderScheduled=false,readScheduled=false,nativePaused=false;
let followingLatest=true;
function updateLatestButton(){
  const timeline=root.querySelector('.chat-timeline'),main=root.querySelector('.chat-main');
  if(!timeline||!main)return;
  let button=main.querySelector('[data-action="chat-latest"]');
  if(!button){button=document.createElement('button');button.type='button';button.className='chat-latest';button.dataset.action='chat-latest';button.textContent='跳至最新 ↓';main.append(button);}
  button.hidden=distanceFromEnd(timeline)<=120;
}
function sizeComposer(){
  const editor=root.querySelector('.composer textarea');
  if(!editor)return;
  editor.style.height='auto';editor.style.height=`${Math.min(130,Math.max(44,editor.scrollHeight))}px`;
}
function applyChatJump(){
  const jump=state.chatJump;
  if(!jump||jump.serial===lastJump||state.page!=='chat'||state.conversation?.id!==jump.conversationId)return;
  const parent=[...root.querySelectorAll('[data-message-id]')].find(item=>item.dataset.messageId===jump.messageId);
  const quote=Number.isSafeInteger(jump.quoteIndex)?[...root.querySelectorAll('[data-search-quote-index]')].find(item=>Number(item.dataset.searchQuoteIndex)===jump.quoteIndex):null;
  const target=quote||parent;
  if(target){
    for(const selected of root.querySelectorAll('.message.search-match,.forward-snapshot-message.search-match'))selected.classList.remove('search-match');
    parent?.classList.add('search-match');if(quote)quote.classList.add('search-match');
    target.scrollIntoView({block:'center',behavior:'auto'});lastJump=jump.serial;
  }
}
function scheduleRead(){
  if(readScheduled)return;readScheduled=true;
  requestAnimationFrame(()=>{
    readScheduled=false;
    if(nativePaused||document.hidden||state.phase!=='ready'||state.page!=='chat'||state.forward||state.forwardDetail||state.imagePreview||state.chatFind)return;
    const messageId=lastVisibleMessage(root.querySelector('.chat-timeline'),window.visualViewport?.height||window.innerHeight);
    if(messageId&&state.conversation?.id)void controller.actions['mark-thread-read']({conversationId:state.conversation.id,messageId});
  });
}
function draw(){
  const view=`${state.phase}:${scopeKey(state)}:${state.page}:${state.tab}:${state.selectedEmployee?.id||''}:${state.chatVisit||0}:${state.workspaceGroups?.selectedId||''}:${state.report?.index||0}`;
  const sameView=view===lastView,markup=render(state);
  // A revalidated poll often changes no visible content. Keep decoded images,
  // long history nodes, selection and scroll intact instead of rebuilding them.
  if(sameView&&markup===lastMarkup){applyChatJump();updateLatestButton();scheduleRead();return;}
  const scroll=document.scrollingElement?.scrollTop||0,timeline=root.querySelector('.chat-timeline');
  const savedTimeline=captureChatScroll(timeline);
  const template=document.createElement('template');
  template.innerHTML=markup;
  const patchChat=sameView&&timeline&&template.content.querySelector('.chat-timeline');
  const fields=sameView&&!patchChat?[...root.querySelectorAll('input[name]:not([type=file]),select[name],textarea[name]:not([name=draft])')].filter(f=>!['search','chatSearch','chatFind'].includes(f.name)&&!f.form?.hasAttribute('data-state-fields')).map(f=>({name:f.name,form:f.form?.dataset.form||'',record:f.form?.dataset.recordKey||'',value:f.value,checked:f.checked})):[];
  const active=document.activeElement;
  const focus=sameView&&!patchChat&&active?.name&&root.contains(active)?{name:active.name,form:active.form?.dataset.form||'',record:active.form?.dataset.recordKey||'',start:active.selectionStart,end:active.selectionEnd}:null;
  // Controller inputs are canonical. Keep the view's focus helper from restoring a cleared draft.
  if(sameView&&!patchChat)captureDraft(root,{...state});
  domRenderer.update(template.content,{sameView:Boolean(patchChat)});
  if(sameView)for(const saved of fields){const target=[...root.querySelectorAll('[name]')].find(f=>f.name===saved.name&&(f.form?.dataset.form||'')===saved.form&&(f.form?.dataset.recordKey||'')===saved.record);if(target){target.value=saved.value;if(target.type==='checkbox')target.checked=saved.checked;}}
  if(sameView&&!patchChat)restoreFocus();
  if(focus){const target=[...root.querySelectorAll('[name]')].find(f=>f.name===focus.name&&(f.form?.dataset.form||'')===focus.form&&(f.form?.dataset.recordKey||'')===focus.record);if(target){target.focus({preventScroll:true});try{target.setSelectionRange(focus.start,focus.end);}catch{}}}
  const currentTimeline=root.querySelector('.chat-timeline');
  sizeComposer();restoreChatScroll(currentTimeline,savedTimeline,sameView);
  followingLatest=currentTimeline?distanceFromEnd(currentTimeline)<=40:true;
  if(!sameView)window.scrollTo(0,0);else if((document.scrollingElement?.scrollTop||0)!==scroll)window.scrollTo(0,scroll);
  lastView=view;lastMarkup=markup;
  applyChatJump();
  updateLatestButton();
  scheduleRead();
}
const api=createApi();
const reporting=createReporting({api,storage:localStorage,onChange:()=>draw()});
const controller=createController({state,api,reporting,render:draw,storage:localStorage});
const syncDraft=()=>{const target=root.querySelector('[name=draft]');if(target?.isConnected)void controller.change({target});};
installMessageGestures(root,{enabled:()=>state.phase==='ready'&&state.page==='chat'&&!state.forward&&!state.forwardDetail&&!state.imagePreview&&!state.chatFind&&!nativePaused,openMenu:id=>void controller.actions['message-menu']({id})});
root.addEventListener('scroll',event=>{if(event.target.matches?.('.chat-timeline')){followingLatest=distanceFromEnd(event.target)<=40;updateLatestButton();}scheduleRead();},true);
root.addEventListener('load',event=>{const timeline=root.querySelector('.chat-timeline');if(timeline?.contains(event.target)){if(followingLatest)timeline.scrollTop=timeline.scrollHeight;updateLatestButton();scheduleRead();}},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden)syncDraft();scheduleRead();});
window.addEventListener('ziwei:pause',()=>{syncDraft();nativePaused=true;});
window.addEventListener('ziwei:resume',()=>{nativePaused=false;scheduleRead();});
root.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  if(target.dataset.action==='chat-latest'){event.preventDefault();const timeline=root.querySelector('.chat-timeline');if(timeline){timeline.scrollTop=timeline.scrollHeight;followingLatest=true;updateLatestButton();scheduleRead();}return;}
  const action=controller.actions[target.dataset.action];if(!action)return;
  event.preventDefault();syncDraft();void action({...target.dataset});
});
root.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form,event.submitter);void controller.submit(form,data);});
root.addEventListener('input',event=>{if(event.target.name==='draft'){const timeline=root.querySelector('.chat-timeline'),saved=captureChatScroll(timeline);sizeComposer();restoreChatScroll(timeline,saved,true);updateLatestButton();}if(event.target.type!=='file'&&event.target.tagName!=='SELECT')void controller.change(event);});
root.addEventListener('compositionstart',event=>{domRenderer.compositionStart(event.target);void controller.change(event);});
root.addEventListener('compositionend',event=>{domRenderer.compositionEnd(event.target);void controller.change(event);});
root.addEventListener('change',event=>{if(event.target.type==='file'||event.target.tagName==='SELECT')void controller.change(event);});
window.addEventListener('ziwei:back',event=>{syncDraft();if(state.imagePreview||state.forwardDetail||state.forward||state.phase==='ready'&&state.page!=='home'){event.preventDefault();void controller.actions.back();}else if(state.phase==='ready'&&state.tab!=='employees'){event.preventDefault();void controller.actions.navigate({tab:state.tab==='devices'?'me':'employees'});}});
function resize(){if(renderScheduled)return;renderScheduled=true;const saved=captureChatScroll(root.querySelector('.chat-timeline'));requestAnimationFrame(()=>{document.documentElement.style.setProperty('--app-height',`${Math.round(window.visualViewport?.height||window.innerHeight)}px`);restoreChatScroll(root.querySelector('.chat-timeline'),saved,true);updateLatestButton();renderScheduled=false;scheduleRead();});}
window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
window.addEventListener('pagehide',()=>{if(state.page==='chat')root.querySelector('[name=draft]')?.dispatchEvent(new Event('input',{bubbles:true}));});
void controller.boot();
