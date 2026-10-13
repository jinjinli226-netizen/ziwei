import path from 'node:path';
import fs from 'node:fs';

export function assertPreviewNativeAction(action,home,apiBase,{sourceHome,deviceId,workspace}={}){
  const reject=message=>{throw Object.assign(new Error(message),{definitelyNotStarted:true});};
  const inside=(root,value)=>{const relative=path.relative(root,value);return relative!== '..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);};
  if(sourceHome&&(!inside(fs.realpathSync(home),fs.realpathSync(sourceHome))))reject('来源 Profile 必须保留在本预览隔离 HOME 内');
  if(action.type==='hermes.profile.create'){
    const payload=action.payload||{};
    if(!sourceHome||!deviceId||payload.deviceId!==deviceId||payload.workspace!==workspace)reject('Profile 创建必须绑定当前隔离原生电脑和工作区');
    if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(payload.profile||'')||payload.profile.toLowerCase()==='default')reject('请选择独立 Profile 名称，不能改写 default');
    return true;
  }
  const snapshot=action.payload?.hermesBot;
  if(!snapshot)throw Object.assign(new Error('原生预览只执行明确绑定的 Bot；Creator 保留原路径'),{definitelyNotStarted:true});
  if(action.type==='directory.inspect'){
    const directory=path.resolve(String(action.payload.path||''));let parent=directory;while(!fs.existsSync(parent)&&parent!==path.dirname(parent))parent=path.dirname(parent);
    if(!action.payload.path||!inside(path.resolve(home),directory)||!inside(fs.realpathSync(home),fs.realpathSync(parent)))reject('隔离预览只检查自己的 HOME 内目录；其他项目目录不开放');
  }
  if(snapshot.sourceProfile!=='default'){
    if(!sourceHome||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(snapshot.sourceProfile||''))reject('请选择隔离电脑实际发现的独立 Profile');
    const profile=path.join(sourceHome,'profiles',snapshot.sourceProfile);
    if(!fs.existsSync(profile)||!fs.statSync(profile).isDirectory()||!inside(fs.realpathSync(sourceHome),fs.realpathSync(profile)))reject('来源 Profile 不属于本预览隔离 HOME');
  }
  for(const value of [action.payload.workdir,action.payload.cwd,action.payload.workingDirectory])if(value){const relative=path.relative(path.resolve(home),path.resolve(home,value));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Object.assign(new Error('原生预览工作目录须在隔离 HOME 内'),{definitelyNotStarted:true});}
  const localUrl=value=>{if(!value)return;const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||(apiBase&&url.origin!==new URL(apiBase).origin))throw Object.assign(new Error('原生预览仅连接预览自身的协议服务；正式 provider 请在正式电脑配置'),{definitelyNotStarted:true});};
  for(const server of Object.values(snapshot.config?.mcpServers||{})){if(server.enabled===false)continue;if(server.command)throw Object.assign(new Error('本地预览不启动任意 stdio 命令；stdio 配置与原生执行由产品接口支持'),{definitelyNotStarted:true});localUrl(server.url);}
  for(const voice of Object.values(snapshot.config?.voice||{}))if(voice&&voice.enabled!==false){if(!voice.baseUrl)throw Object.assign(new Error('原生预览音频须明确填写预览自身的服务地址'),{definitelyNotStarted:true});localUrl(voice.baseUrl);}
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(item&&typeof item==='object')inspect(item);else if(/url|endpoint/i.test(key)&&typeof item==='string'&&/^https?:/.test(item))localUrl(item);}};
  inspect(snapshot.config?.gateway);inspect(action.payload.nativeOperation?.input);
  if(action.payload.nativeOperation?.resource==='gateway'&&action.payload.nativeOperation.operation==='connect')throw Object.assign(new Error('此隔离预览不启动外部渠道监听器；渠道配置与原生接口已接入，真实连接需授权电脑的 SDK、凭据和已登记端口'),{definitelyNotStarted:true});
  return true;
}
