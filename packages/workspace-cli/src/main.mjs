import crypto from 'node:crypto';
import {CliError,EXIT_CODES,fail,redact} from './errors.mjs';
import {readBusinessInput} from './input.mjs';
import {assertCredential,configurationRoot,CredentialStore,selector,validateOrigin,validateWorkspace} from './config.mjs';
import {authCommand} from './auth.mjs';
import {identityConfig,requireLegacy} from './unified.mjs';
import {requestJson,nativeOperationView} from './transport.mjs';
import {phoneSetupSummary} from '../vendor/native-schemas.mjs';
import {normalizeNativeOperation} from '../vendor/hermes-native-contract.mjs';
import {normalizeBotConfig,createDefaultBotConfig} from '../vendor/hermes-bot-config.mjs';
import {CLI_VERSION,STANDARD_VERSION,DOCS_URL,DEFAULT_API,getCapabilities,getOperation,operations,unsupportedOperations,createOperationRequest} from './registry.mjs';
export {CLI_VERSION,STANDARD_VERSION,DOCS_URL,getCapabilities,operations};
const booleanFlags=new Set(['help','version','json','non-interactive','input-stdin','password-stdin','managed-stdin','local','dry-run']);
const publicFlags=new Set(['help','version','json','non-interactive','contract','timeout','profile','api','account','purpose','workspace']);
const inputFlags=new Set(['input','input-file','input-stdin']);
const authFlags=new Set(['mode','email','password-stdin','managed-file','managed-stdin','local']);
const allFlags=new Set([...publicFlags,...inputFlags,...authFlags,'dry-run',...operations.flatMap(o=>Object.keys(o.inputSchema.properties||{}))]);
function parse(argv){
  const options={},words=[];
  for(let i=0;i<argv.length;i++){
    let token=argv[i];if(token==='-h')token='--help';if(token==='-v')token='--version';
    if(!token.startsWith('-')){words.push(token);continue;}
    if(!token.startsWith('--')||token==='--')fail('USAGE','Unknown option syntax');
    const eq=token.indexOf('=');const key=token.slice(2,eq<0?undefined:eq);
    if(!allFlags.has(key))fail('USAGE','Unknown option; use --help for exact command options');
    if(Object.hasOwn(options,key))fail('USAGE','Duplicate option');
    if(booleanFlags.has(key)){if(eq>=0)fail('USAGE',`--${key} does not accept a value`);options[key]=true;continue;}
    const value=eq<0?argv[++i]:token.slice(eq+1);if(value===undefined||value===''||value.startsWith('--'))fail('USAGE',`--${key} requires a value`);options[key]=value;
  }
  if(options.contract&&options.contract!=='v1')fail('USAGE','This major version supports --contract v1 only');
  const timeout=options.timeout===undefined?30000:Number(options.timeout);
  if((options.timeout!==undefined&&!/^\d+$/.test(options.timeout))||!Number.isInteger(timeout)||timeout<100||timeout>300000)fail('USAGE','--timeout must be an integer from 100 through 300000 milliseconds');
  options.timeout=timeout;return{options,words};
}
function validateOptions(options,allowed){for(const key of Object.keys(options))if(!allowed.has(key)&&!publicFlags.has(key))fail('USAGE','Option is not valid for this command; use its --help');}
export function helpText(operation){
  const lines=[`ziwei-workspace ${CLI_VERSION} (contract v1; standard ${STANDARD_VERSION})`,'Independent digital employee workspace management CLI.','Usage: ziwei-workspace <resource> <action> [options]','  ziwei-workspace capabilities','  ziwei-workspace auth login|complete|wait|refresh|status|logout','  ziwei-workspace config show','Public options, before or after commands:','  --help --version --json --non-interactive --contract v1','  --timeout <100..300000 milliseconds> (default 30000) --profile <name>','  --api <HTTPS origin> --account <slot> --purpose person|employee --workspace <slug>','Business input: --input <JSON> | --input-file <path> | --input-stdin (mutually exclusive).','Native field shortcuts use the exact field name, e.g. --id <string> or --data <JSON>.','Reserved public flags select CLI settings only. For profiles create, supply native profile in JSON; --profile selects the credential slot.','Secrets must use the existing authorized Profile/environment reference, never ordinary business input.','Auth default: auth login --mode unified --workspace <slug> starts a public device grant and returns only public verification URI/user code.','auth complete polls once when due; auth wait polls within --timeout; both require an explicit prior login. No browser or input prompt is opened.','auth refresh explicitly rotates the online refresh grant, then verifies the API identity and native binding. No offline_access or automatic mutation retry.','auth status verifies the selected server by default; --local reports stored metadata only and never grants permissions.','auth logout atomically clears this slot and requests current-site latest AT/RT revocation. RFC 7009 HTTP 200 is accepted, not confirmed inactive; --local skips remote revocation.','Legacy requires explicit --mode native --email <email> --workspace <slug> --password-stdin or --mode managed --purpose employee --managed-file <path> (or --managed-stdin), plus server legacy declaration.','Machine client credentials are NOT_SUPPORTED; shared administrator credentials are never substituted.','Unified identity requires public ready /api/identity/config and trusted issuer discovery. Production deployment remains pending.','All ordinary calls emit one v1 JSON envelope. Help/version are text. No write retries or fabricated dry-run.','actions wait --id <original-action-id> polls only the existing action; actions cancel is unsupported.'];
  if(operation)lines.push(`Command: ${operation.name.replace('.',' ')}`,operation.description,'Input schema:',JSON.stringify(operation.inputSchema,null,2),'Behavior:',JSON.stringify({readOnly:operation.readOnly,sideEffects:operation.sideEffects,idempotency:operation.idempotency,transports:operation.transports,resultQuery:operation.resultQuery},null,2));
  else lines.push('Commands:',...operations.map(o=>`  ${o.name.replace('.',' ')}${o.readOnly?'':' [see side effects in capabilities]'}`));
  lines.push(`Documentation: ${DOCS_URL}`);return lines.join('\n')+'\n';
}
async function delay(ms,signal){
  if(signal?.aborted)fail('CANCELLED','Cancelled while waiting',{outcomeUnknown:false});
  await new Promise((resolve,reject)=>{let timer;const abort=()=>{clearTimeout(timer);reject(new CliError('CANCELLED','Cancelled while waiting',{outcomeUnknown:false}));};timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);signal?.addEventListener('abort',abort,{once:true});});
}
function defaultReadStdin({signal}={}){
  if(process.stdin.isTTY)fail('USAGE','Explicit stdin requires piped input; an interactive prompt is not opened');
  return new Promise((resolve,reject)=>{
    let text='',bytes=0;
    const cleanup=()=>{process.stdin.removeListener('data',data);process.stdin.removeListener('end',end);process.stdin.removeListener('error',error);signal?.removeEventListener('abort',abort);process.stdin.pause();};
    const data=chunk=>{bytes+=Buffer.byteLength(chunk);if(bytes>16*1024*1024){cleanup();reject(new CliError('USAGE','Input exceeds 16 MiB'));}else text+=chunk;};
    const end=()=>{cleanup();resolve(text);},error=()=>{cleanup();reject(new CliError('USAGE','Cannot read stdin'));};
    const abort=()=>{cleanup();process.stdin.destroy();reject(new CliError('CANCELLED','Input read stopped',{outcomeUnknown:false}));};
    process.stdin.setEncoding('utf8');process.stdin.on('data',data);process.stdin.once('end',end);process.stdin.once('error',error);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else process.stdin.resume();
  });
}
async function boundedStdin(readStdin,{timeout,signal}){
  if(signal?.aborted)fail('CANCELLED','Cancelled before reading input',{outcomeUnknown:false});
  const controller=new AbortController();let timer,onAbort;
  const stop=new Promise((_,reject)=>{
    timer=setTimeout(()=>{reject(new CliError('USAGE','Explicit stdin timed out before a request was submitted',{outcomeUnknown:false}));controller.abort();},timeout);
    onAbort=()=>{reject(new CliError('CANCELLED','Cancelled before a request was submitted',{outcomeUnknown:false}));controller.abort();};signal?.addEventListener('abort',onAbort,{once:true});
  });
  try{return await Promise.race([Promise.resolve().then(()=>readStdin({signal:controller.signal})),stop]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);}
}
export async function runCli(argv,{env=process.env,fetchImpl=globalThis.fetch,stdout=s=>process.stdout.write(s),stderr=s=>process.stderr.write(s),readStdin=defaultReadStdin,signal,requestId=crypto.randomUUID()}={}){
  const secrets=[];let envelope;
  try{
    const{options,words}=parse(argv);
    if(signal?.aborted)fail('CANCELLED','Cancelled before dispatch',{outcomeUnknown:false});
    const readSelectedStdin=()=>boundedStdin(readStdin,{timeout:options.timeout,signal});
    const name=words.join('.');const wait=name==='actions.wait';const op=getOperation(name);
    if(options.version){if(words.length>2)fail('USAGE','Unexpected positional arguments');stdout(`${CLI_VERSION}\n`);return{exitCode:0};}
    if(options.help||words.length===0||name==='help'){if(words.length>2)fail('USAGE','Unexpected positional arguments');stdout(helpText(op));return{exitCode:0};}
    if(words.length>2)fail('USAGE','Unexpected positional arguments');
    if(unsupportedOperations[name])fail('NOT_SUPPORTED',unsupportedOperations[name],{status:name==='auth.unified'?'pending':'unsupported'});
    const origin=validateOrigin(options.api||DEFAULT_API,{allowLoopbackHttp:env.ZIWEI_WORKSPACE_ALLOW_LOOPBACK_HTTP==='1'}),selection=selector(options,origin);
    const store=new CredentialStore(configurationRoot(env),{signal});
    const request=init=>requestJson({origin,timeout:options.timeout,signal,fetchImpl,...init});
    const authContext={store,selection,request,readStdin:readSelectedStdin,secrets,env,signal};
    let data;
    if(name==='capabilities'){
      validateOptions(options,new Set());data=getCapabilities();
    }else if(words[0]==='auth'){
      validateOptions(options,words[1]==='login'?authFlags:['status','logout'].includes(words[1])?new Set(['local']):new Set());data=await authCommand(words[1],options,authContext);
    }else if(name==='config.show'){
      validateOptions(options,new Set());const credential=await store.load(selection);data={service:'workspace',...selection,configured:Boolean(credential),workspace:credential?.workspace||null,docs:DOCS_URL};
    }else{
      if(!op)fail('USAGE','Unknown command; use --help for the supported resource/action catalog');
      const allowed=new Set([...inputFlags,...Object.keys(op.inputSchema.properties||{}),'dry-run']);
      validateOptions(options,allowed);
      // Public selectors never become business field shortcuts. Workspace is the
      // documented exception: it explicitly selects the authorized API scope and
      // remains subject to duplicate-source rejection against JSON workspace.
      const businessOptions=Object.fromEntries(Object.entries(options).filter(([key])=>!publicFlags.has(key)||key==='workspace'));
      const input=await readBusinessInput(businessOptions,op.inputSchema,readSelectedStdin,{allowReferences:Boolean(op.nativeOperation)});
      if(op.nativeOperation){try{
        if(op.nativeOperation==='update'){
          if(input.data.deferUntilIdle===true&&(input.data.expectedControlEpoch===undefined||!input.data.idempotencyKey))fail('USAGE','Deferred Bot update requires expectedControlEpoch and the original idempotencyKey');
          if(input.data.connectMcpServers!==undefined&&input.data.deferUntilIdle!==true)fail('USAGE','connectMcpServers requires deferUntilIdle:true');
        }
        if(op.nativeOperation==='native')normalizeNativeOperation(input.data);
        if(input.data?.config)(op.nativeOperation==='create'?createDefaultBotConfig:normalizeBotConfig)(input.data.config);
      }catch(error){if(error instanceof CliError)throw error;fail('USAGE','Input violates the original Bot/native schema',{nativeCode:error.code||'BOT_INPUT_INVALID'});}}
      if(options['dry-run'])fail('NOT_SUPPORTED','This original endpoint has no non-submitting dry-run mode',{operation:op.name});
      const credential=await store.load(selection);assertCredential(credential);secrets.push(...[credential.session,credential.token,credential.accessToken,credential.refreshToken].filter(Boolean));
      const workspace=validateWorkspace(input.workspace||credential.workspace);
      if(credential.mode==='managed'&&(workspace!==credential.workspace||credential.apiBase!==origin||credential.audience!=='ziwei-management'))fail('FORBIDDEN','Managed credentials are limited to their original workspace and API audience');
      let transportMode=credential.mode;
      if(credential.mode==='unified'){
        const config=await identityConfig(authContext,credential);
        transportMode=config.cliTransports.includes('native')&&op.routes.native?'native':config.cliTransports.includes('mcp')&&op.routes.managed?'managed':null;
        if(!transportMode)fail('NOT_SUPPORTED','The selected server does not advertise a unified transport for this operation',{operation:op.name});
      }else await requireLegacy(authContext,credential);
      const init=createOperationRequest(op,input,{mode:transportMode,workspace});
      let resultQuery=op.resultQuery;
      if(resultQuery?.command&&input.id)resultQuery={...resultQuery,command:resultQuery.command.replace('<actionId>',JSON.stringify(input.id)).replace('<employeeId>',JSON.stringify(input.id)).replace('<taskId>',JSON.stringify(input.id))};
      const idempotencyKey=init.body?.idempotencyKey;
      const once=timeout=>request({...init,credential,resultQuery,idempotencyKey,...(timeout?{timeout}:{})});
      if(wait){
        const deadline=Date.now()+options.timeout;let latest;
        while(Date.now()<deadline){
          const result=await once(Math.max(1,deadline-Date.now()));latest=nativeOperationView(result.payload,op,result.status,input);
          if(latest.operation?.completed){data=latest;break;}
          if(Date.now()<deadline)await delay(Math.min(1000,deadline-Date.now()),signal);
        }
        if(!data)fail('SERVICE_UNAVAILABLE','Waiting for the original action timed out; this is a readonly wait timeout',{outcomeUnknown:false,resultQuery,lastKnown:latest});
      }else{const result=await once();const native=op.name==='phone-mcp.setup'&&input.view==='summary'?phoneSetupSummary(result.payload,workspace):result.payload;data=nativeOperationView(native,op,result.status,input);}
    }
    if(signal?.aborted)fail('CANCELLED','Cancelled after the last known result',{outcomeUnknown:false,lastKnown:data});
    envelope={schemaVersion:1,service:'workspace',ok:true,data,requestId};
    const safe=redact(envelope,secrets);
    // capabilities is immutable public source metadata and has loaded no
    // credential. Preserve its documented authorization/schema field names;
    // generic server payloads still redact every sensitive subtree entirely.
    envelope={...safe,...(name==='capabilities'?{data}:{}),schemaVersion:1,service:'workspace',ok:true,requestId};stdout(JSON.stringify(envelope)+'\n');return{exitCode:0,envelope};
  }catch(error){
    const known=error instanceof CliError;
    const code=known?error.code:'INTERNAL_ERROR',details=known?{...error.details}:{};
    const nativeCode=details.nativeCode,httpStatus=details.httpStatus;delete details.nativeCode;delete details.httpStatus;
    envelope=redact({schemaVersion:1,service:'workspace',ok:false,error:{code,message:known?error.message:'Internal CLI error',...(nativeCode?{nativeCode}:{}),...(httpStatus?{httpStatus}:{}),...(Object.keys(details).length?{details}:{})},requestId},secrets);
    envelope={...envelope,schemaVersion:1,service:'workspace',ok:false,requestId,error:{...envelope.error,code}};
    stdout(JSON.stringify(envelope)+'\n');return{exitCode:EXIT_CODES[code]||1,envelope};
  }
}
