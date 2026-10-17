import {workspaceId,scopeKey,list,escapeHtml,formatTime} from './model.js';

const phoneId=value=>String(value?.deviceId||value?.device_id||value?.id||'');
const employeeId=value=>String(value?.employeeId||value?.employee_id||'');
const roleOf=state=>state.workspace?.role||state.workspaces?.find(item=>item.slug===workspaceId(state))?.role||'';
export const canManagePhoneSettings=state=>['owner','admin'].includes(roleOf(state));
export const canPairComputer=state=>['owner','admin','member'].includes(roleOf(state));
const initial=state=>({scope:scopeKey(state),loading:false,pending:'',loaded:{},errors:{},catalogEpochs:{},computers:[],phones:[],employees:[],bindings:[],requests:[],pairing:null,pairDraft:{name:'',os:'windows'},binding:{employeeId:'',deviceId:'',accountId:'',accountLabel:''},bindingDirty:false,bindingChanged:{},controlDeviceId:'',controlRole:'',controlDirty:false,notice:'',needsReview:false});
const activeRequest=(request,clock)=>request.status==='pending'&&(!request.expiresAt||Date.parse(request.expiresAt)>clock());

/** Existing workspace session only. Loading never creates a code or performs a device action. */
export function createDeviceSettings({state,api,current=()=>({}),valid=()=>true,fail=()=>{},draw=()=>{},clock=Date.now,clipboard=globalThis.navigator?.clipboard}={}){
  let readGeneration=0;
  const ensure=()=>{
    if(!state.deviceSettings||state.deviceSettings.scope!==scopeKey(state))state.deviceSettings=initial(state);
    return state.deviceSettings;
  };
  const alive=(token,data)=>state.deviceSettings===data&&data.scope===scopeKey(state)&&state.page==='device-settings'&&valid(token,true);
  const denied=message=>Object.assign(new Error(message),{status:403});
  const invalid=(message,status=400)=>Object.assign(new Error(message),{status});
  function requireManager(){if(!canManagePhoneSettings(state))throw denied('手机审批、绑定和控制端设置需要工作区 Owner 或管理员权限');}
  function report(error,token,data){
    if(!alive(token,data))return;
    data.errors.operation=error?.message||'操作未完成，请刷新核对';
    fail(error,token,true);draw();
  }
  function selectBinding(data,id){
    const existing=data.bindings.find(binding=>employeeId(binding)===id);
    data.binding={employeeId:id,deviceId:existing?phoneId(existing):'',accountId:existing?.accountId??existing?.account_id??'',accountLabel:existing?.accountLabel??existing?.account_label??''};
    data.bindingDirty=false;data.bindingChanged={};
  }
  function synchronize(data){
    if(!data.bindingDirty){
      const selected=data.binding.employeeId||data.employees[0]?.id||'';
      selectBinding(data,selected);
    }else if(data.loaded.bindings){
      // A late first binding read must still fill untouched account fields,
      // even when the user already selected a different phone.
      const saved=data.bindings.find(binding=>employeeId(binding)===data.binding.employeeId);
      if(saved){
        if(!data.bindingChanged.deviceId)data.binding.deviceId=phoneId(saved);
        if(!data.bindingChanged.accountId)data.binding.accountId=saved.accountId??saved.account_id??'';
        if(!data.bindingChanged.accountLabel)data.binding.accountLabel=saved.accountLabel??saved.account_label??'';
      }
    }
    if(!data.controlDeviceId||!data.phones.some(phone=>phone.id===data.controlDeviceId)){
      data.controlDeviceId=data.phones[0]?.id||'';data.controlDirty=false;
    }
    if(!data.controlDirty)data.controlRole=data.phones.find(phone=>phone.id===data.controlDeviceId)?.control?.role||'';
  }
  async function load(){
    const data=ensure(),token=current(),generation=++readGeneration;
    if(!alive(token,data))return;
    // A response from a previous visit cannot own the new page's loading lock.
    if(data.operationToken&&!valid(data.operationToken,true)){data.pending='';data.operationToken=null;data.needsReview=true;}
    data.loading=true;data.notice='';delete data.errors.operation;draw();
    const jobs=[
      ['computers',()=>api.devices(workspaceId(state)),value=>{data.computers=list(value,'devices');}],
      ['employees',()=>api.employees(workspaceId(state)),value=>{data.employees=list(value,'employees');}],
      ['phones',()=>api.connectDevices(workspaceId(state)),value=>{data.phones=list(value,'devices');}],
      ['bindings',()=>api.phoneBindings(workspaceId(state)),value=>{data.bindings=list(value,'bindings').map(binding=>({...data.bindings.find(old=>old.id===binding.id),...binding}));}],
      ...(canManagePhoneSettings(state)?[['requests',()=>api.phoneEnrollmentRequests(workspaceId(state)),value=>{data.requests=list(value,'requests');}]]:[]),
    ];
    let remaining=jobs.length;
    await Promise.all(jobs.map(async([name,read,accept])=>{
      try{
        let catalogEpoch=data.catalogEpochs[name]||0,result=await read();
        if(!alive(token,data)||generation!==readGeneration)return;
        // A mutation can complete while an unrelated catalog is still loading.
        // Re-read only a catalog changed since this GET started; no write repeats.
        if(catalogEpoch!==(data.catalogEpochs[name]||0)){
          catalogEpoch=data.catalogEpochs[name]||0;result=await read();
          if(!alive(token,data)||generation!==readGeneration)return;
          if(catalogEpoch!==(data.catalogEpochs[name]||0))throw new Error('设备目录仍在更新，请刷新核对');
        }
        accept(result);data.loaded[name]=true;delete data.errors[name];synchronize(data);draw();
      }catch(error){
        if(!alive(token,data)||generation!==readGeneration)return;
        data.errors[name]=error?.message||'读取失败，请刷新';
        if(error?.status===401)fail(error,token,true);
        draw();
      }finally{
        remaining--;
        if(!remaining&&alive(token,data)&&generation===readGeneration){data.loading=false;if(!Object.keys(data.errors).length)data.needsReview=false;draw();}
      }
    }));
  }
  async function mutate(key,write,accept,{manager=true,requires=[],catalogs=[]}={}){
    const data=ensure(),token=current();
    if(!alive(token,data)||data.pending)return false;
    try{
      if(manager)requireManager();
      if(requires.some(name=>!data.loaded[name]))throw invalid('相关设备与原绑定资料尚未读取完成，请稍候或刷新');
      if(data.needsReview&&key!=='pair')throw new Error('上一项操作回执尚未确认，请先刷新设备与绑定后核对');
      data.pending=key;data.operationToken=token;delete data.errors.operation;data.notice='';draw();
      const response=await write(data);
      if(!alive(token,data))return false;
      for(const name of catalogs)data.catalogEpochs[name]=(data.catalogEpochs[name]||0)+1;
      await accept(response,data);
      if(!alive(token,data))return false;
      return true;
    }catch(error){
      if(alive(token,data)){
        if(!error?.status||error.status>=500||error.uncertain)data.needsReview=true;
        report(error,token,data);
      }
      return false;
    }finally{
      if(data.operationToken===token){data.pending='';data.operationToken=null;if(alive(token,data))draw();}
    }
  }
  async function pairing(form){
    return mutate('pair',async()=>{
      if(!canPairComputer(state))throw denied('当前工作区角色不能生成电脑配对码');
      const name=String(form.get('name')||'我的运行电脑').trim();
      const os=String(form.get('os')||'').trim();
      if(!name||name.length>120)throw invalid('请填写 120 字以内的电脑名称');
      if(!['windows','darwin','linux'].includes(os))throw invalid('请选择目标电脑的系统');
      return api.createDevicePairing(workspaceId(state),{name,os,ttlMs:10*60*1000});
    },(response,data)=>{
      if(response?.workspace!==workspaceId(state)||!/^zwi-[0-9a-f]{8}-[0-9a-f]{8}$/i.test(response.code||'')||!Number.isFinite(Date.parse(response.expires_at)))throw new Error('配对码返回异常，请重新核对工作区');
      data.pairing={code:response.code,workspace:response.workspace,expires_at:response.expires_at};data.notice='配对码已生成，请在要运行员工的电脑上使用。';
    },{manager:false});
  }
  async function binding(form){
    return mutate('binding',async data=>{
      const previous=data.binding;
      const id=String(form.get('employeeId')??previous.employeeId??'');
      const deviceId=String(form.get('deviceId')??previous.deviceId??'');
      if(!data.loaded.employees||!data.employees.some(employee=>employee.id===id))throw invalid('请从当前工作区选择员工');
      if(!data.loaded.phones||!data.phones.some(phone=>phone.id===deviceId))throw invalid('请从手机目录选择已入网手机');
      const accountId=String(form.has('accountId')?form.get('accountId'):previous.accountId||'').trim();
      const accountLabel=String(form.has('accountLabel')?form.get('accountLabel'):previous.accountLabel||'').trim();
      if(accountId.length>200||accountLabel.length>200)throw invalid('账号标识和备注不能超过 200 字');
      return api.savePhoneBinding(workspaceId(state),{employeeId:id,deviceId,accountId:accountId||null,accountLabel:accountLabel||null});
    },(saved,data)=>{
      if(!saved?.id||!employeeId(saved)||!phoneId(saved))throw new Error('绑定回执不完整，请刷新核对');
      const previous=data.bindings.find(row=>row.id===saved.id||employeeId(row)===employeeId(saved));
      data.bindings=[{...previous,...saved},...data.bindings.filter(row=>row.id!==saved.id&&employeeId(row)!==employeeId(saved))];
      selectBinding(data,employeeId(saved));data.notice='员工手机绑定已保存';
    },{requires:['employees','phones','bindings'],catalogs:['bindings']});
  }
  async function control(form){
    return mutate('control',async data=>{
      const id=String(form.get('deviceId')||data.controlDeviceId||'');
      const role=String(form.get('role')??data.controlRole??'');
      if(!data.loaded.phones||!data.phones.some(phone=>phone.id===id))throw invalid('请先选择已入网手机');
      if(!['','agent','updater'].includes(role))throw invalid('控制端只能选择紫薇互联、更新伙伴或暂停');
      return api.phoneControl(workspaceId(state),id,{role:role||null});
    },async(response,data)=>{
      if(!response?.device?.id)throw new Error('控制端回执不完整，请刷新手机状态核对');
      const saved=response.device;data.phones=data.phones.map(phone=>phone.id===saved.id?{...phone,...saved}:phone);data.controlDeviceId=saved.id;data.controlDirty=false;data.controlRole=saved.control?.role||'';
      data.notice=saved.control?.draining?'控制端正在切换，等待原授权结束后刷新核对':'控制端设置已保存，以手机实际状态为准';
      // This is a receipt read, never a second control request.
      const token=current(),detail=await api.phone(workspaceId(state),saved.id);
      if(alive(token,data)&&detail?.device?.id===saved.id){data.phones=data.phones.map(phone=>phone.id===saved.id?{...phone,...detail.device}:phone);if(!data.controlDirty)data.controlRole=detail.device.control?.role||'';}
    },{requires:['phones'],catalogs:['phones']});
  }
  const guard=handler=>async values=>{const data=ensure(),token=current();try{return await handler(values||{});}catch(error){report(error,token,data);return false;}};
  async function resolveEnrollment(id,operation){
    return mutate(`${operation}:${id}`,async data=>{
      const request=data.requests.find(row=>row.id===id);
      if(!request||!activeRequest(request,clock))throw invalid('入网申请已处理或过期，请刷新核对',409);
      return operation==='approve'?api.approvePhoneEnrollment(workspaceId(state),id):api.rejectPhoneEnrollment(workspaceId(state),id);
    },(response,data)=>{
      const expected=operation==='approve'?'approved':'rejected';
      if(response?.request?.id!==id||response.request.status!==expected)throw new Error('入网申请状态已变化，请刷新核对');
      data.requests=data.requests.map(request=>request.id===id?{...request,...response.request}:request);
      if(operation==='approve'){
        if(!response.device?.id)throw new Error('批准已返回，但手机信息尚未同步，请刷新核对');
        data.phones=[response.device,...data.phones.filter(phone=>phone.id!==response.device.id)];synchronize(data);
      }
      data.notice=operation==='approve'?'已批准手机入网；在线和可控制状态仍以手机回传为准':'已拒绝这次手机入网申请';
    },{requires:['requests'],catalogs:operation==='approve'?['requests','phones']:['requests']});
  }
  const actions={
    'device-settings-refresh':guard(()=>load()),
    'device-pairing-hide':guard(()=>{ensure().pairing=null;draw();}),
    'device-pairing-copy':guard(async()=>{
      const data=ensure(),token=current(),code=data.pairing?.code;
      if(!code||Date.parse(data.pairing.expires_at)<=clock())throw new Error('配对码已过期，请重新生成');
      if(!clipboard?.writeText)throw new Error('请长按配对码复制');
      await clipboard.writeText(code);if(alive(token,data)){data.notice='配对码已复制';draw();}
    }),
    'device-enrollment-approve':guard(({id})=>resolveEnrollment(id,'approve')),
    'device-enrollment-reject':guard(({id})=>resolveEnrollment(id,'reject')),
    'device-binding-edit':guard(({id})=>{const data=ensure(),row=data.bindings.find(binding=>binding.id===id);if(!row)throw new Error('绑定已变化，请刷新');selectBinding(data,employeeId(row));draw();}),
    'device-binding-unbind':guard(({id})=>mutate(`unbind:${id}`,data=>{if(!data.bindings.some(row=>row.id===id))throw invalid('绑定已变化，请刷新',409);return api.deletePhoneBinding(workspaceId(state),id);},(response,data)=>{if(response?.deleted!==true||response.id!==id)throw new Error('解绑回执不完整，请刷新核对');const removed=data.bindings.find(row=>row.id===id);data.bindings=data.bindings.filter(row=>row.id!==id);if(employeeId(removed)===data.binding.employeeId)selectBinding(data,data.binding.employeeId);data.notice='已解除员工与手机的关联；员工和手机仍然保留';},{requires:['bindings'],catalogs:['bindings']})),
    'device-control-select':guard(({id})=>{const data=ensure(),phone=data.phones.find(row=>row.id===id);if(!phone)throw new Error('手机已变化，请刷新');data.controlDeviceId=id;data.controlRole=phone.control?.role||'';data.controlDirty=false;draw();}),
  };
  function change(event){
    const target=event?.target||event;if(!target)return false;
    const data=ensure(),form=target.form?.dataset?.form||target.dataset?.form||'';
    if(form==='device-pairing'&&['name','os'].includes(target.name)){data.pairDraft[target.name]=target.value;return true;}
    if(form==='device-binding'){
      if(target.name==='employeeId'){selectBinding(data,String(target.value));draw();}
      else if(['deviceId','accountId','accountLabel'].includes(target.name)){data.binding[target.name]=target.value;data.bindingDirty=true;data.bindingChanged[target.name]=true;}
      return true;
    }
    if(form==='device-phone-control'&&target.name==='role'){data.controlRole=target.value;data.controlDirty=true;return true;}
    return false;
  }
  async function submit(name,form){
    if(name==='device-pairing'){await pairing(form);return true;}
    if(name==='device-binding'){await binding(form);return true;}
    if(name==='device-phone-control'){await control(form);return true;}
    return false;
  }
  return {load,submit,change,actions};
}

export function renderDeviceSettings(state,ui={}){
  const e=ui.e||escapeHtml,icon=ui.icon||(()=>''),header=ui.pageHeader||((_state,title)=>`<header><h1>${e(title)}</h1></header>`),section=ui.sectionTitle||((title)=>`<h2>${e(title)}</h2>`);
  const data=state.deviceSettings?.scope===scopeKey(state)?state.deviceSettings:initial(state);
  const manager=canManagePhoneSettings(state),busy=Boolean(data.pending),disabled=busy?' disabled':'';
  const bindingDisabled=busy||!['employees','phones','bindings'].every(name=>data.loaded[name])?' disabled':'';
  const controlDisabled=busy||!data.loaded.phones?' disabled':'';
  const refreshDisabled=busy||data.loading?' disabled':'';
  const time=value=>e(value?formatTime(value):'时间未知');
  const error=name=>data.errors[name]?`<p class="banner error" role="alert">${e(data.errors[name])}</p>`:'';
  const name=id=>data.employees.find(employee=>employee.id===id)?.name||id||'员工';
  const phoneName=id=>data.phones.find(phone=>phone.id===id)?.alias||id||'手机';
  const pairing=data.pairing,expired=pairing&&Date.parse(pairing.expires_at)<=Date.now();
  const controlPhone=data.phones.find(phone=>phone.id===data.controlDeviceId);
  const button=(action,text,id='')=>`<button type="button" class="button secondary" data-action="${e(action)}"${id?` data-id="${e(id)}"`:''}${disabled}>${e(text)}</button>`;
  const phoneOptions=data.phones.map(phone=>`<option value="${e(phone.id)}"${phone.id===data.binding.deviceId?' selected':''}>${e(phone.alias||phone.id)}${phone.online?' · 在线':' · 离线'}</option>`).join('');
  return `${header(state,'设备绑定','同一工作区 · 原有设备',`<button class="icon-button" data-action="device-settings-refresh" aria-label="刷新设备绑定"${refreshDisabled}>${icon('refresh')}</button>`)}<main class="page-content device-settings">${ui.alerts?.(state)||''}${error('operation')}${data.notice?`<p class="banner notice" role="status">${e(data.notice)}</p>`:''}${data.needsReview?'<p class="banner error" role="alert">操作回执尚未确认，请先刷新核对；不会自动重发。</p>':''}
  ${section('运行电脑')}<div class="panel form-panel">${error('computers')}${data.computers.length?data.computers.map(device=>`<div class="command-row"><span><strong>${e(device.name||device.hostname||device.id)}</strong><small>${e(device.os||device.platform||'')} · ${e(device.status==='online'?'在线':device.status==='offline'?'离线':'状态待确认')}</small><small>${e(device.id)}</small></span></div>`).join(''):`<p>${data.loaded.computers?'还没有运行电脑':'正在读取运行电脑…'}</p>`}</div>
  ${canPairComputer(state)?`<details class="panel new-routine"><summary>${icon('plus')}连接一台电脑</summary><form class="form-panel" data-form="device-pairing" data-state-fields><label class="field-label">电脑名称<input name="name" maxlength="120" value="${e(data.pairDraft.name)}" placeholder="例如：我的运行电脑" required></label><label class="field-label">电脑系统<select name="os">${[['windows','Windows'],['darwin','macOS'],['linux','Linux']].map(([value,label])=>`<option value="${value}"${value===data.pairDraft.os?' selected':''}>${label}</option>`).join('')}</select></label><button class="button primary full" type="submit"${disabled}>${pairing?'生成另一配对码':'生成配对码'}</button><p class="page-footnote">只在点击后生成一次性配对码，不会替手机或电脑自动入网。</p></form>${pairing?`<div class="form-panel"><strong>${expired?'配对码已过期':'一次性配对码'}</strong><code class="prose" tabindex="0">${e(pairing.code)}</code><small>有效期至 ${time(pairing.expires_at)}</small><small>工作区 ${e(pairing.workspace)}</small>${!expired?`<pre class="prose">${e(`ziwei_user connect --api https://qzelynth.top --code ${pairing.code}\nziwei_user start`)}</pre><small>在要运行员工的电脑上执行；运行与手机控制仍由原服务负责。</small>${button('device-pairing-copy','复制配对码')}`:''}${button('device-pairing-hide','隐藏配对码')}</div>`:''}</details>`:'<p class="page-footnote">当前角色不能生成电脑配对码。</p>'}
  ${section('已入网手机')}<div class="panel form-panel">${error('phones')}${data.phones.length?data.phones.map(phone=>`<div class="command-row"><span><strong>${e(phone.alias||phone.id)}</strong><small>${e(phone.online?'在线':'离线')} · ${e(phone.id)}</small><small>控制端：${e(phone.control?.role==='agent'?'紫薇互联':phone.control?.role==='updater'?'更新伙伴':'已暂停')}${phone.control?.draining?' · 等待原授权结束':''}</small></span>${manager?button('device-control-select','控制端',phone.id):''}</div>`).join(''):`<p>${data.loaded.phones?'还没有已入网手机':'正在读取手机目录…'}</p>`}</div>
  ${manager&&controlPhone?`<details class="panel edit-panel" open><summary>${icon('settings')}手机控制端</summary><form class="form-panel" data-form="device-phone-control" data-state-fields data-record-key="${e(controlPhone.id)}"><input type="hidden" name="deviceId" value="${e(controlPhone.id)}"><strong>${e(controlPhone.alias||controlPhone.id)}</strong><label class="field-label">使用哪个控制端<select name="role">${[['agent','紫薇互联 Agent'],['updater','更新伙伴 Updater'],['','暂停新指令']].map(([value,label])=>`<option value="${value}"${value===data.controlRole?' selected':''}>${e(label)}</option>`).join('')}</select></label><p class="page-footnote">暂停只阻止新指令；在途动作仍等待原回执。可操作状态以手机健康回传为准。</p><button type="submit" class="button primary full"${controlDisabled}>保存控制端</button></form></details>`:''}
  ${manager?`${section('手机入网申请')}<div class="panel form-panel">${error('requests')}${data.requests.length?data.requests.map(request=>{const pending=activeRequest(request,Date.now),status=pending?'待审批':request.status==='pending'?'已过期':({approved:'已批准',rejected:'已拒绝',expired:'已过期'}[request.status]||'状态待确认');return `<article class="routine-card"><strong>${e(request.alias||'新手机')}</strong><p>${e(request.role==='updater'?'更新伙伴':'紫薇互联')} · ${e(request.versionName||'版本未知')} · ${e(status)}</p><small>有效期至 ${time(request.expiresAt)}</small>${pending?`<div class="routine-actions">${button('device-enrollment-reject','拒绝',request.id)}${button('device-enrollment-approve','批准入网',request.id)}</div>`:''}</article>`;}).join(''):`<p>${data.loaded.requests?'暂无手机入网申请':'正在读取入网申请…'}</p>`}</div>`:'<p class="page-footnote">手机入网审批、绑定修改和控制端设置需要工作区 Owner 或管理员权限。</p>'}
  ${section('员工与手机绑定')}<div class="panel form-panel">${error('bindings')}${error('employees')}${data.bindings.length?data.bindings.map(binding=>`<article class="routine-card"><strong>${e(name(employeeId(binding)))}</strong><p>${e(phoneName(phoneId(binding)))}</p><small>${e(binding.accountLabel||binding.account_label||binding.accountId||binding.account_id||'未映射外部账号')}</small>${manager?`<div class="routine-actions">${button('device-binding-edit','编辑绑定',binding.id)}${button('device-binding-unbind','解除绑定',binding.id)}${button('bot-settings','员工手机能力',employeeId(binding))}</div>`:''}</article>`).join(''):`<p>${data.loaded.bindings?'暂无员工手机绑定':'正在读取绑定…'}</p>`}</div>
  ${manager?`<details class="panel edit-panel" open><summary>${icon('link')}保存员工手机绑定</summary><form class="form-panel" data-form="device-binding" data-state-fields data-record-key="${e(data.binding.employeeId)}"><label class="field-label">数字员工<select name="employeeId" required><option value="">选择当前工作区员工</option>${data.employees.map(employee=>`<option value="${e(employee.id)}"${employee.id===data.binding.employeeId?' selected':''}>${e(employee.name||employee.id)}</option>`).join('')}</select></label><label class="field-label">已入网手机<select name="deviceId" required><option value="">选择手机</option>${phoneOptions}${data.binding.deviceId&&!data.phones.some(phone=>phone.id===data.binding.deviceId)?`<option value="${e(data.binding.deviceId)}" selected>原手机 ${e(data.binding.deviceId)} · 待核对</option>`:''}</select></label><label class="field-label">账号标识（可选）<input name="accountId" maxlength="200" value="${e(data.binding.accountId)}" placeholder="例如：店铺账号"></label><label class="field-label">账号备注（可选）<input name="accountLabel" maxlength="200" value="${e(data.binding.accountLabel)}"></label><button type="submit" class="button primary full"${bindingDisabled}>保存手机绑定</button><p class="page-footnote">仅保存手机关联；员工手机控制需在“员工手机能力”中单独开启。</p></form></details>`:''}</main>`;
}
