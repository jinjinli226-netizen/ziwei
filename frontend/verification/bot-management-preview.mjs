import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {parse,compileStyleAsync} from '@vue/compiler-sfc';
import {createManagerHarness,managerFixture} from './bot-management-harness.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(import.meta.url);
const avatarPreview=process.argv.includes('--avatars');
const unified=process.argv.includes('--chat')||avatarPreview;
const output=path.resolve(root,process.argv[2]?.startsWith('--')?(unified?'.local/employee-workbench-preview':'.local/bot-management-preview'):process.argv[2]||(unified?'.local/employee-workbench-preview':'.local/bot-management-preview'));
await fs.mkdir(output,{recursive:true});
const css=[];
for(const file of [require.resolve('@ziwei/ui/style.css'),path.join(root,'frontend/src/styles.css'),path.join(root,'frontend/src/workspace-shell.css')])css.push(await fs.readFile(file,'utf8'));
for(const name of ['BotWorkbench','BotInstancePanel','ZiSelect','EmployeeAvatar','BotAvatarEditor',...(unified?['BotMainChat','ConversationQueuePanel']:[])]){
  const filename=path.join(root,'frontend/src/components',name+'.vue'),{descriptor}=parse(await fs.readFile(filename,'utf8'),{filename});
  for(const style of descriptor.styles){
    const source=style.src?await fs.readFile(path.resolve(path.dirname(filename),style.src),'utf8'):style.content;
    const compiled=await compileStyleAsync({source,filename:style.src||filename,id:'data-v-management-'+name,scoped:Boolean(style.scoped)});
    if(compiled.errors.length)throw new Error(JSON.stringify(compiled.errors));css.push(compiled.code);
  }
}
const logo='data:image/png;base64,'+(await fs.readFile(path.join(root,'frontend/public/ziwei-logo.png'))).toString('base64');
const fixture=managerFixture();
fixture.bot.employee.avatar='grok:gem:violet';
fixture.roster[1].employee.avatar='grok:clover:green';
fixture.roster[2].employee.avatar='grok:bean:cyan';
for(const [index,name] of ['绮映','拆解哥','libtv 爆款学习','小红书 TRO 运营','品牌内容伙伴','资料研究员','产品交付伙伴','设计审校伙伴','客户服务伙伴','活动策划伙伴','数据分析伙伴','自动化伙伴'].entries()){
  const example=structuredClone(fixture.roster[1]);example.id=example.employee.id='example-'+index;example.employee.name=name;example.employee.description='示例岗位 · 归属于同一工作区';fixture.roster.push(example);
}
function inspectLayout(){
  const region=selector=>{const el=document.querySelector(selector);if(!el)return null;const rect=el.getBoundingClientRect();return{width:el.clientWidth,height:el.clientHeight,scrollWidth:el.scrollWidth,scrollHeight:el.scrollHeight,overflowY:getComputedStyle(el).overflowY,visible:el.getClientRects().length>0,left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom};};
  const result={width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,horizontalOverflow:document.documentElement.scrollWidth>innerWidth,roster:region('.bot-roster-list'),rosterContainer:region('.bot-roster'),main:region('.bot-main'),stage:region('.employee-chat-stage'),chat:region('.bot-chat-timeline'),composer:region('.bot-chat-compose'),drawer:region('.bot-management-drawer')};
  const main=document.querySelector('.bot-chat-timeline')||document.querySelector('.bot-main'),roster=document.querySelector('.bot-roster-list'),aside=document.querySelector('.bot-roster');
  if(main&&roster){const before=main.scrollTop;roster.scrollTop=roster.scrollHeight;result.rosterScrollIndependent=main.scrollTop===before;result.rosterScrollDistance=roster.scrollTop;roster.scrollTop=0;const rosterBefore=roster.scrollTop;main.scrollTop=main.scrollHeight;result.mainScrollIndependent=roster.scrollTop===rosterBefore;result.mainScrollDistance=main.scrollTop;main.scrollTop=0;}
  if(roster&&aside&&result.roster.visible){const before=aside.scrollTop;aside.scrollTop=aside.scrollHeight;result.rosterContainerScrollDistance=aside.scrollTop;const r=roster.getBoundingClientRect(),a=aside.getBoundingClientRect();result.rosterReachable=r.bottom>a.top&&r.top<a.bottom;roster.scrollTop=roster.scrollHeight;const last=roster.querySelector('.bot-roster-row:last-of-type')?.getBoundingClientRect();result.lastEmployeeReachable=Boolean(last&&last.bottom<=Math.min(a.bottom,r.bottom)+1&&last.bottom>Math.max(a.top,r.top));roster.scrollTop=0;aside.scrollTop=before;}
  const composer=document.querySelector('.bot-chat-compose');
  if(composer){const rect=composer.getBoundingClientRect(),stage=document.querySelector('.employee-chat-stage')?.getBoundingClientRect();result.composerReachable=rect.top>=0&&rect.bottom<=innerHeight+1&&(!stage||rect.top>=stage.top&&rect.bottom<=stage.bottom+1);}
  const exits=[...document.querySelectorAll('.employee-workspace-return,.bot-roster-footer .bot-link')].filter(button=>button.getClientRects().length);
  if(exits.length)result.workspaceReturnReachable=exits.some(button=>{const rect=button.getBoundingClientRect();return rect.top>=0&&rect.bottom<=innerHeight+1&&rect.left>=0&&rect.right<=innerWidth+1&&button.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2));});
  const report=document.createElement('script');report.id='layout-report';report.type='application/json';report.textContent=JSON.stringify(result);document.body.append(report);
}
const layoutScript=`addEventListener('load',${inspectLayout.toString()});`;
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const browserProfile=path.join(output,'edge-profile');
const results=[];
const child=spawn(edge,['--headless=new','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--disable-sync','--no-first-run','--no-default-browser-check','--disable-features=msImplicitSignin','--no-proxy-server',`--user-data-dir=${browserProfile}`,'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe','pipe','pipe']});
let sequence=0,buffer='',stderr='';const pending=new Map(),events=[];
child.stderr.on('data',chunk=>stderr+=chunk);
child.stdio[4].on('data',chunk=>{
  buffer+=chunk;let boundary;
  while((boundary=buffer.indexOf('\0'))>=0){
    const value=JSON.parse(buffer.slice(0,boundary));buffer=buffer.slice(boundary+1);
    if(value.id){const callback=pending.get(value.id);if(callback){pending.delete(value.id);clearTimeout(callback.timer);value.error?callback.reject(Error(value.error.message)):callback.resolve(value.result);}}
    else for(let index=events.length-1;index>=0;index--)if(events[index].method===value.method&&events[index].sessionId===value.sessionId){const item=events.splice(index,1)[0];clearTimeout(item.timer);item.resolve(value.params);}
  }
});
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(Error('DevTools pipe timeout: '+method));},15000);
  pending.set(id,{resolve,reject,timer});child.stdio[3].write(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})})+'\0');
});
const event=(method,sessionId)=>new Promise((resolve,reject)=>{const item={method,sessionId,resolve};item.timer=setTimeout(()=>{events.splice(events.indexOf(item),1);reject(Error('DevTools event timeout: '+method));},15000);events.push(item);});
const {targetId}=await call('Target.createTarget',{url:'about:blank'});
const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
try{
const scenarios=avatarPreview?['character','image'].map(avatarMode=>({runtime:'Hermes',section:'settings',expanded:false,avatarMode})):unified?['Hermes','DSH','Codex'].flatMap(runtime=>[{runtime,section:'chat',expanded:false},{runtime,section:'settings',expanded:false},{runtime,section:'chat',expanded:true}]):[['chat',false],['settings',false],['chat',true]].map(([section,expanded])=>({section,expanded}));
for(const {runtime,section,expanded,avatarMode} of scenarios){
  const view=(runtime?runtime.toLowerCase()+'-':'')+section+(expanded?'-employees':'')+(avatarMode?'-'+avatarMode:'');
  const sample=structuredClone(fixture);
  if(avatarMode==='image')sample.bot.employee.avatar=logo;
  const harness=await createManagerHarness({fixture:sample,shell:true,initial:{initialTab:section},chat:unified?{runtime}:false});
  if(avatarMode==='character'){harness.button('选择形状与颜色').props.onClick();await harness.settle();}
  if(expanded){harness.byClass('bot-mobile-roster-heading')[0].props.onClick();await harness.settle();}
  const markup=harness.html().replace('src="/ziwei-logo.png"','src="'+logo+'"');harness.dispose();
  const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>紫薇员工工作台 · 示例预览</title><style>${css.join('\n')}\nbody{margin:0}.preview-note{height:28px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;background:#fff8e9;color:#846333;font:11px/1.3 sans-serif}.preview-frame .workspace-shell{height:calc(100dvh - 28px)}</style></head><body><div class="preview-note">示例预览 · 真实组件与样例数据 · 未连接线上设备或模型</div><div class="preview-frame">${markup}</div><script>${layoutScript}${avatarPreview?`addEventListener('load',()=>{const editor=document.querySelector('.bot-avatar-editor'),drawer=document.querySelector('.bot-management-drawer');if(editor&&drawer)drawer.scrollTop=editor.offsetTop-drawer.offsetTop-65;});`:''}</script></body></html>`;
  const file=path.join(output,view+'.html');await fs.writeFile(file,html);
  for(const [width,height] of (unified?[[1440,1000],[390,844],[844,360]]:[[1440,1000],[390,844],[390,640],[844,390],[844,360]])){
    const screenshot=path.join(output,view+'-'+width+'x'+height+'.png');
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},sessionId);
    const loaded=event('Page.loadEventFired',sessionId);await call('Page.navigate',{url:pathToFileURL(file).href},sessionId);await loaded;
    await call('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true},sessionId);
    const report=await call('Runtime.evaluate',{expression:'JSON.parse(document.getElementById("layout-report").textContent)',returnByValue:true},sessionId);
    if(report.exceptionDetails)throw Error(report.exceptionDetails.text);
    const layout=report.result.value;
    if(expanded){
      const access=await call('Runtime.evaluate',{expression:`(()=>{const aside=document.querySelector('.bot-roster');const original=aside.scrollTop;aside.scrollTop=0;const frame=aside.getBoundingClientRect();const controls=[...aside.querySelectorAll('.bot-roster-actions button')];const reachable=controls.every(button=>{let rect=button.getBoundingClientRect();aside.scrollTop+=Math.max(0,rect.bottom-frame.bottom);rect=button.getBoundingClientRect();return rect.top>=frame.top&&rect.bottom<=frame.bottom+1;});aside.scrollTop=original;return reachable;})()`,returnByValue:true},sessionId);
      layout.creationReachable=access.result.value;
      if(!layout.creationReachable)throw Error(`${section}/${width}: creation controls are inaccessible`);
    }
    results.push({runtime,section,expanded,screenshot,...layout});
    const capture=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);await fs.writeFile(screenshot,Buffer.from(capture.data,'base64'));
    if(layout.width!==width||layout.height!==height)throw new Error('Browser viewport does not match requested dimensions');
    if(layout.horizontalOverflow)throw new Error(`${section}/${width}: page overflows horizontally`);
    if(unified&&(!layout.stage?.visible||!layout.chat?.visible||layout.chat.height<40||!layout.composerReachable))throw new Error(`${runtime}/${section}/${width}: actual employee chat or composer is inaccessible`);
    if(unified&&section!=='chat'&&(!layout.drawer?.visible||layout.drawer.width<Math.min(300,width-32)))throw new Error(`${runtime}/${section}/${width}: employee management drawer is clipped`);
    if(unified&&layout.drawer?.visible&&layout.drawer.scrollWidth>layout.drawer.width+1)throw new Error(`${runtime}/${section}/${width}: employee management drawer overflows horizontally`);
    if(unified&&!layout.workspaceReturnReachable)throw new Error(`${runtime}/${section}/${width}: return to workspace is inaccessible`);
    if(layout.roster.visible&&(!layout.rosterReachable||!layout.lastEmployeeReachable||!layout.rosterScrollIndependent||!layout.mainScrollIndependent))throw new Error(`${section}/${width}: roster or independent scrolling is inaccessible`);
    if(expanded&&layout.roster.height<72)throw new Error(`${section}/${width}: expanded roster cannot show one employee row`);
  }
}
}finally{
  await fs.writeFile(path.join(output,'layout-results.json'),JSON.stringify(results,null,2));
  await call('Browser.close').catch(error=>{child.kill();throw error;});
}
console.log(JSON.stringify({output,frames:results.length,results:results.map(({runtime,section,expanded,width,height,horizontalOverflow,composerReachable,roster,creationReachable})=>({runtime,section,expanded,width,height,horizontalOverflow,composerReachable,rosterHeight:roster.height,creationReachable}))},null,2));
