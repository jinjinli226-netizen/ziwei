import crypto from 'node:crypto';

const endpoints={guangzhou:'https://api.tpns.tencent.com',shanghai:'https://api.tpns.sh.tencent.com',hongkong:'https://api.tpns.hk.tencent.com',singapore:'https://api.tpns.sgp.tencent.com'};
const failure=(code,retryable=false)=>Object.assign(new Error(code),{code,retryable});
const unknown=code=>Object.assign(failure(code),{unknownOutcome:true});
// TPNS's official Python/Java examples encode the lowercase HEX HMAC, then
// Base64 that ASCII text (not the raw digest). Sign these exact transmitted bytes.
// https://cloud.tencent.com/document/product/548/41046
export const tpnsSignature=(secret,timestamp,accessId,body)=>Buffer.from(crypto.createHmac('sha256',secret).update(`${timestamp}${accessId}${body}`).digest('hex')).toString('base64');
export function createTpnsSender(options={}){
  const env=options.env||process.env,accessId=String(env.ZIWEI_TPNS_ACCESS_ID||''),accessKey=String(env.ZIWEI_TPNS_ACCESS_KEY||''),secret=String(env.ZIWEI_TPNS_SECRET_KEY||''),region=env.ZIWEI_TPNS_REGION||'guangzhou';
  const configured=env.ZIWEI_TPNS_ENABLED==='1'&&/^\d{5,20}$/.test(accessId)&&accessKey.length>0&&secret.length>0&&Boolean(endpoints[region]);
  const status=()=>({provider:'tpns',configured,status:configured?'ready':'notConfigured',accessId:configured?accessId:null,accessKey:configured?accessKey:null,packageName:'com.ziwei.manager'});
  async function send({token,deliveryId}){
    if(!configured)throw failure('PUSH_NOT_CONFIGURED');
    // Current TPNS Android SDK documents a 40-character registration token;
    // older HTTP docs' 36-character limit must not reject that real SDK input.
    if(typeof token!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(token)||!/^[A-Za-z0-9_-]{32}$/.test(deliveryId))throw failure('PUSH_PROVIDER_INPUT_INVALID');
    // Both forms carry only the opaque identifier. Huawei's V5 notification
    // channel needs the Intent form because it can omit custom_content.
    const notificationId=(crypto.createHash('sha256').update(deliveryId).digest().readUInt32BE(0)&0x7fffffff)||1;
    const body=JSON.stringify({audience_type:'token',token_list:[token],message_type:'notify',ignore_invalid_token:1,expire_time:800,
      // n_id is only a best-effort self-channel replacement identifier; TPNS
      // deprecates it and provides no arbitrary idempotency key across OEMs.
      message:{title:'紫薇',content:'有新的工作动态，打开查看',android:{n_id:notificationId,custom_content:JSON.stringify({deliveryId}),action:{action_type:3,intent:`ziwei-manager://push?deliveryId=${deliveryId}`}}}});
    const timestamp=String(Math.floor((options.now?.()??Date.now())/1000)),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),options.timeoutMs||10000);
    try{
      const response=await (options.fetch||globalThis.fetch)(`${endpoints[region]}/v3/push/app`,{method:'POST',redirect:'error',signal:controller.signal,headers:{'Content-Type':'application/json',AccessId:accessId,TimeStamp:timestamp,Sign:tpnsSignature(secret,timestamp,accessId,body)},body});
      if(response.status>=500)throw unknown('PUSH_PROVIDER_HTTP_UNKNOWN');
      if(Number(response.headers?.get('content-length')||0)>16384)throw unknown('PUSH_PROVIDER_RESPONSE_INVALID');
      let bytes=0,text='';
      if(response.body){for await(const part of response.body){bytes+=part.length;if(bytes>16384)throw unknown('PUSH_PROVIDER_RESPONSE_INVALID');text+=Buffer.from(part).toString('utf8');}}
      else{text=await response.text();if(Buffer.byteLength(text)>16384)throw unknown('PUSH_PROVIDER_RESPONSE_INVALID');}
      let receipt;try{receipt=JSON.parse(text);}catch{throw unknown('PUSH_PROVIDER_RESPONSE_INVALID');}
      if(Array.isArray(receipt?.invalid_targe_list)&&receipt.invalid_targe_list.includes(token))throw Object.assign(failure('PUSH_TOKEN_INVALID'),{invalidToken:true});
      if(Number.isSafeInteger(receipt?.ret_code)&&receipt.ret_code!==0)throw Object.assign(failure('PUSH_PROVIDER_REJECTED',receipt.ret_code===1008028),{retryAfterMs:60000});
      if(!response.ok||receipt?.ret_code!==0||typeof receipt.push_id!=='string'||!receipt.push_id||receipt.push_id.length>160)throw unknown('PUSH_PROVIDER_RESPONSE_INVALID');
      return {accepted:true,providerId:receipt.push_id};
    }catch(error){if(error?.code?.startsWith('PUSH_'))throw error;throw unknown('PUSH_PROVIDER_UNAVAILABLE');}finally{clearTimeout(timer);}
  }
  return {status,send};
}
