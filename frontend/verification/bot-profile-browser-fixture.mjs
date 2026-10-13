// UI reproduction and scoped flow only. All responses below are marked fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const root=path.resolve(import.meta.dirname,'../..'),dist=path.join(root,'frontend/dist'),evidence=path.join(root,'.local/e03-profile-ui');await fs.mkdir(evidence,{recursive:true});
const {chromium}=await import(pathToFileURL(process.env.ZIWEI_PLAYWRIGHT_PATH).href),browser=await chromium.launch({headless:true,channel:'msedge'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const device={id:'profile-device',name:'Profile UI fixture',status:'online',runtimes:[{name:'Hermes',available:true,cli_status:'available',profiles:[]}]},calls=[],errors=[];let action=null,bots=[];
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname;if(url.host!=='ziwei-fixture.invalid')return route.abort();const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(p.startsWith('/assets/'))return route.fulfill({body:await fs.readFile(path.join(dist,p)),contentType:p.endsWith('.css')?'text/css':'application/javascript'});
  if(p==='/ziwei-logo.png')return route.fulfill({body:await fs.readFile(path.join(dist,'ziwei-logo.png')),contentType:'image/png'});
  if(p==='/api/auth/status')return json({setup_required:false,authenticated:true,user:{id:'profile-ui-owner',role:'owner'},memberships:[{slug:'qa',name:'Profile UI',role:'owner'}]});
  if(p.endsWith('/mcp/discovery'))return json({workspace:'qa',devices:[device]});
  if(p.endsWith('/hermes/profiles'))return json({source:'ziwei_user',profiles:device.runtimes[0].profiles});
  if(p.endsWith('/hermes/profiles/requests')&&req.method()==='POST'){const body=req.postDataJSON();calls.push({path:p,body});action={id:'profile-fixture-action',type:'hermes.profile.create',status:'pending',payload:{workspace:'qa',deviceId:device.id,profile:body.profile},result:null};return json(action,202);}
  if(p.endsWith('/hermes/profiles/requests/profile-fixture-action')){calls.push({path:p,method:'GET'});action.status='succeeded';action.result={profile:action.payload.profile,duplicate:false};device.runtimes[0].profiles=[{name:action.payload.profile,provider_configured:true,authentication_configured:true,readiness:{ready:true}}];return json(action);}
  if(p==='/api/workspaces/qa/bots'&&req.method()==='POST'){const body=req.postDataJSON();calls.push({path:p,body});const bot={id:'profile-ui-bot',workspace:'qa',configuration_state:'initialized',employee:{id:'profile-ui-bot',name:body.name,runtime:'Hermes',runtime_profile:body.runtimeProfile,target_device_id:body.targetDeviceId},config:body.config,revision:1,control_state:'draft',control_epoch:1,main_conversation_id:'profile-ui-main',capabilities:[],validation:{status:'not_checked'}};bots.push(bot);return json(bot,201);}
  if(p==='/api/workspaces/qa/bots')return json({bots});
  if(p.startsWith('/api/workspaces/qa/bots/'))return json(p.endsWith('/runs')?{runs:[]}:p.endsWith('/routines')?{routines:[]}:bots[0]);
  if(p.includes('/notifications/stream'))return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(p.startsWith('/api/')||p.startsWith('/a2a/'))return json({workspace:{slug:'qa',name:'Profile UI',preferences:{}},devices:[device],employees:bots.map(row=>row.employee),models:[],skills:[],tasks:[],documents:[],automations:[],members:[],calendars:[],agents:[],conversations:[],notifications:[],stats:{unread:0}});
  return route.fulfill({body:await fs.readFile(path.join(dist,'index.html')),contentType:'text/html'});
});
try{
  await page.goto('https://ziwei-fixture.invalid/qa/bots');await page.getByRole('button',{name:'创建 Bot',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByLabel('新 Bot 运行电脑').click();await page.getByRole('option').filter({hasText:device.name}).click();await page.screenshot({path:path.join(evidence,process.argv.includes('--red')?'before.png':'after-open.png')});
  assert.equal(await dialog.getByLabel('新 Profile 名称',{exact:true}).count(),1,'Bot dialog must allow a direct new profile name without an existing profile');
  await dialog.getByLabel('名称',{exact:true}).fill('Profile UI Bot');await dialog.getByLabel('新 Profile 名称',{exact:true}).fill('ui-direct-profile');await dialog.getByRole('button',{name:'在此电脑创建 Profile',exact:true}).click();await dialog.getByLabel('新 Bot Hermes profile').waitFor();await dialog.getByLabel('新 Bot Hermes profile').filter({hasText:'ui-direct-profile'}).waitFor();
  assert.equal(calls.filter(row=>row.path.endsWith('/hermes/profiles/requests')&&row.body).length,1);await dialog.getByRole('button',{name:'创建并配置',exact:true}).click();await dialog.waitFor({state:'detached'});assert.equal(bots.length,1);assert.equal(bots[0].employee.runtime_profile,'ui-direct-profile');assert.equal(bots[0].main_conversation_id,'profile-ui-main');assert.deepEqual(errors,[]);await page.screenshot({path:path.join(evidence,'after-created.png')});await fs.writeFile(path.join(evidence,'result.json'),JSON.stringify({fixture:true,passed:true,calls,errors},null,2));console.log(JSON.stringify({fixture:true,passed:true,evidence}));
}catch(error){await fs.writeFile(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,calls,errors},null,2));throw error;}finally{await browser.close();}
