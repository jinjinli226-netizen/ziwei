export const nativeText=value=>typeof value==='string'?value:value?.['zh-CN']||value?.zh||value?.en||'';
export const nativeApplication=status=>({observed:'原生观察已返回',applied:'原生已应用', 'restart-required':'已保存，等待重启后生效',overridden:'已保存，但被其他配置覆盖',failed:'原生操作失败',cancelled:'原生已取消',partial:'仅部分完成，请查看分步回执',unknown:'原生结果未确认',unavailable:'原生能力暂不可用'})[status]||'等待原生回执';
export function nativePluginMatches(row,query){const needle=query.trim().toLocaleLowerCase();return!needle||[row.name,row.entryId,row.moduleName,row.patchId,nativeText(row.meta?.title),nativeText(row.meta?.description)].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);}
export function nativeMarketQuery(url,text,page=null){const value=text.trim();return{url,query:{...(value?{text:value}:{}),sort:{kind:value?'relevance':'index'},offset:page?page.nextOffset:0,limit:20,...(page?{fetchedAt:page.fetchedAt}:{})}};}
export function nativeMarketSource(entry,version){const selected=entry.versions.find(item=>item.version===version);if(!selected||!selected.compatibility.compatible&&!selected.compatibility.exempted)return null;return{spec:selected.install.spec,...(selected.install.registry?{registry:selected.install.registry}:{}),...(['installed','update-available','different-version'].includes(entry.installation.status)?{replaceName:entry.name}:{})};}
export function nativeInstallAttempt(action,previous,input={}){
  const operation=action.payload.dshOperation.operation,receipt=action.result?.dshNative,data=receipt?.data||{};
  if(operation==='installBundle')return{actionId:action.id,status:receipt?.status||action.status,enabled:input.enabled??previous?.enabled??data.receipt?.enabled,data};
  const actionId=data.installActionId||previous?.actionId||input.sourceActionId;if(!actionId)return previous;
  const result={actionId,status:operation==='cancelInstall'||!receipt?previous?.status||'unknown':receipt.status,enabled:previous?.enabled,data:{...previous?.data,...data}};
  if(operation==='waitForInstall'&&['applied','restart-required','overridden','failed','cancelled'].includes(result.status))delete result.data.nativeCancellation;
  return result;
}
