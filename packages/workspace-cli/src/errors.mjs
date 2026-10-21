export const EXIT_CODES=Object.freeze({INTERNAL_ERROR:1,USAGE:2,UNAUTHENTICATED:3,FORBIDDEN:4,NOT_FOUND:5,CONFLICT:6,SERVICE_UNAVAILABLE:7,OUTCOME_UNKNOWN:8,NOT_SUPPORTED:9,CANCELLED:130});
export class CliError extends Error {
  constructor(code,message,details={}) {super(message);this.name='CliError';this.code=code;this.details=details;}
}
export const fail=(code,message,details)=>{throw new CliError(code,message,details);};
const sensitiveKey=/(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|credential|bearer|^session$)/i;
const protocolKeys=new Set(['schemaVersion','service','ok','data','error','requestId','code','message','details','httpStatus','nativeCode','native','operation','state','completed','nativeState','serverReceiptId','receiptKind','resultQuery']);
function publicAuthorizationUrl(key,value){
  if(key!=='authorizationUrl'||typeof value!=='string')return false;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&![...url.searchParams.keys()].some(name=>/^(?:access_token|refresh_token|id_token|client_secret|token|secret|password|api[_-]?key|code)$/i.test(name));}catch{return false;}
}
export function redact(value,secrets=[]) {
  const known=secrets.filter(v=>typeof v==='string'&&v.length>0).sort((a,b)=>b.length-a.length);
  const cleanString=input=>{
    let output=input;
    for(const secret of known) output=output.split(secret).join('[REDACTED]');
    return output.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]')
      .replace(/((?:password|passwd|[\w-]*secret|[\w-]*token|api[_-]?key|authorization|cookie)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,'$1[REDACTED]');
  };
  const walk=(node,depth)=>{
    if(depth>50)return '[TRUNCATED]';
    if(typeof node==='string')return cleanString(node);
    if(Array.isArray(node))return node.map(v=>walk(v,depth+1));
    if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([k,v])=>[protocolKeys.has(k)?k:cleanString(k),sensitiveKey.test(k)&&!publicAuthorizationUrl(k,v)?'[REDACTED]':walk(v,depth+1)]));
    return node;
  };
  return walk(value,0);
}
export function httpFailure(status,payload) {
  const codes={400:'USAGE',401:'UNAUTHENTICATED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',422:'USAGE',429:'SERVICE_UNAVAILABLE',501:'NOT_SUPPORTED'};
  const code=codes[status] || (status>=500?'SERVICE_UNAVAILABLE':'INTERNAL_ERROR');
  const native=payload?.code || payload?.error?.code;
  const message=typeof payload?.error==='string'?payload.error:payload?.error?.message || payload?.message || `Workspace API returned HTTP ${status}`;
  return new CliError(code,String(message),{httpStatus:status,...(native?{nativeCode:native}:{}),native:payload});
}
