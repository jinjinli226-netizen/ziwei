import {createApi} from './api.js';
import {createController} from './controller.js';
import {createReporting} from './reporting.js';
import {initialState,scopeKey} from './model.js';
import {render,captureDraft,restoreFocus} from './view.js';

const state=initialState(),root=document.getElementById('app');
let lastView='',lastMarkup='',renderScheduled=false;
function draw(){
  const view=`${state.phase}:${scopeKey(state)}:${state.page}:${state.tab}:${state.selectedEmployee?.id||''}:${state.report?.index||0}`;
  const sameView=view===lastView,markup=render(state);
  // A revalidated poll often changes no visible content. Keep decoded images,
  // long history nodes, selection and scroll intact instead of rebuilding them.
  if(sameView&&markup===lastMarkup)return;
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
}
const api=createApi();
const reporting=createReporting({api,storage:localStorage,onChange:()=>draw()});
const controller=createController({state,api,reporting,render:draw,storage:localStorage});
root.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||target.disabled)return;
  const action=controller.actions[target.dataset.action];if(!action)return;
  event.preventDefault();void action({...target.dataset});
});
root.addEventListener('submit',event=>{const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();const data=new FormData(form);void controller.submit(form,data);});
root.addEventListener('input',event=>{if(event.target.type!=='file'&&event.target.tagName!=='SELECT')void controller.change(event);});
root.addEventListener('change',event=>{if(event.target.type==='file'||event.target.tagName==='SELECT')void controller.change(event);});
window.addEventListener('ziwei:back',event=>{if(state.imagePreview||state.phase==='ready'&&state.page!=='home'){event.preventDefault();void controller.actions.back();}else if(state.phase==='ready'&&state.tab!=='employees'){event.preventDefault();void controller.actions.navigate({tab:'employees'});}});
function resize(){if(renderScheduled)return;renderScheduled=true;requestAnimationFrame(()=>{document.documentElement.style.setProperty('--app-height',`${Math.round(window.visualViewport?.height||window.innerHeight)}px`);renderScheduled=false;});}
window.visualViewport?.addEventListener('resize',resize);window.addEventListener('resize',resize);resize();
window.addEventListener('pagehide',()=>{if(state.page==='chat')root.querySelector('[name=draft]')?.dispatchEvent(new Event('input',{bubbles:true}));});
void controller.boot();
