import path from 'node:path';

export function assertPreviewNativeAction(action,home,apiBase){
  const snapshot=action.payload?.hermesBot;
  if(!snapshot)throw Object.assign(new Error('原生预览只执行明确绑定的 Bot；Creator 保留原路径'),{definitelyNotStarted:true});
  if(snapshot.sourceProfile!=='default')throw Object.assign(new Error('请选择“本机原生隔离预览”电脑与 default profile'),{definitelyNotStarted:true});
  for(const value of [action.payload.workdir,action.payload.cwd,action.payload.workingDirectory])if(value){const relative=path.relative(path.resolve(home),path.resolve(home,value));if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw Object.assign(new Error('原生预览工作目录须在隔离 HOME 内'),{definitelyNotStarted:true});}
  const localUrl=value=>{if(!value)return;const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||(apiBase&&url.origin!==new URL(apiBase).origin))throw Object.assign(new Error('原生预览仅连接预览自身的协议服务；正式 provider 请在正式电脑配置'),{definitelyNotStarted:true});};
  for(const server of Object.values(snapshot.config?.mcpServers||{})){if(server.enabled===false)continue;if(server.command)throw Object.assign(new Error('本地预览不启动任意 stdio 命令；stdio 配置与原生执行由产品接口支持'),{definitelyNotStarted:true});localUrl(server.url);}
  for(const voice of Object.values(snapshot.config?.voice||{}))if(voice&&voice.enabled!==false){if(!voice.baseUrl)throw Object.assign(new Error('原生预览音频须明确填写预览自身的服务地址'),{definitelyNotStarted:true});localUrl(voice.baseUrl);}
  const inspect=value=>{if(!value||typeof value!=='object')return;for(const [key,item] of Object.entries(value)){if(item&&typeof item==='object')inspect(item);else if(/url|endpoint/i.test(key)&&typeof item==='string'&&/^https?:/.test(item))localUrl(item);}};
  inspect(snapshot.config?.gateway);inspect(action.payload.nativeOperation?.input);
  if(action.payload.nativeOperation?.resource==='gateway'&&action.payload.nativeOperation.operation==='connect')throw Object.assign(new Error('此隔离预览不启动外部渠道监听器；渠道配置与原生接口已接入，真实连接需授权电脑的 SDK、凭据和已登记端口'),{definitelyNotStarted:true});
  return true;
}
