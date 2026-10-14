import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {PRODUCT_ROLE,FROZEN_VERSIONS} from './version-preservation.mjs';
import {readDatabaseSnapshot} from './preservation-native-databases.mjs';
import {readApiDatabaseConnectionIdentity} from './preservation-source-namespace.mjs';

const ROOT=path.resolve(import.meta.dirname,'..');
const states=new WeakMap(),repositories=new WeakMap();
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,(_key,row)=>row&&typeof row==='object'&&!Array.isArray(row)?Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b))):row);
const equal=(a,b)=>json(a)===json(b);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const fail=(code,message='服务器代码升级模式不允许未验证客户端执行')=>{throw Object.assign(new Error(message),{code,status:409});};
const fields=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))fail('SERVER_CODE_ROLLOUT_INVALID');};
const identity=file=>{const row=fs.lstatSync(file,{bigint:true});return {dev:String(row.dev),ino:String(row.ino)};};
const table=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function plain(file,{directory=false,privateMode=false}={}){
 if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file)fail('SERVER_CODE_ROLLOUT_PATH');
 for(let current=file;;current=path.dirname(current)){if(fs.lstatSync(current).isSymbolicLink())fail('SERVER_CODE_ROLLOUT_PATH');if(path.dirname(current)===current)break;}
 const stat=fs.lstatSync(file);if(fs.realpathSync.native(file)!==file||(directory?!stat.isDirectory():!stat.isFile()||stat.nlink!==1)||privateMode&&process.platform!=='win32'&&(stat.mode&0o077)!==0)fail('SERVER_CODE_ROLLOUT_PATH');return stat;
}
const read=file=>{plain(file);return fs.readFileSync(file);};
const keyConfigured=options=>String(options.envEncryptionKey||process.env.ZIWEI_ENV_ENCRYPTION_KEY||process.env.ZIWEI_SECRET_KEY||'').trim();
function sourceFiles(root,prefix){return fs.readdirSync(path.join(root,prefix),{withFileTypes:true}).flatMap(entry=>{const relative=path.posix.join(prefix,entry.name),file=path.join(root,relative);if(entry.isSymbolicLink())fail('SERVER_CODE_ROLLOUT_SOURCE');return entry.isDirectory()?sourceFiles(root,relative):[relative];});}
function verifyRelease(config){
 const descriptor=JSON.parse(read(path.join(ROOT,'preservation-package.json')));
 if(descriptor.schemaVersion!==1||descriptor.productRole!==PRODUCT_ROLE||!equal(descriptor.versions,FROZEN_VERSIONS)||!['v2','v1-compat'].includes(descriptor.productRole)||descriptor.candidateCommit!==config.candidateCommit)fail('SERVER_CODE_ROLLOUT_SOURCE');
 const manifests=config.releases.map(pin=>{
  fields(pin,['productRole','manifestPath','manifestSha256','apiArtifactPath','apiArtifactSha256']);
  const bytes=read(pin.manifestPath);if(!hex(pin.manifestSha256)||sha(bytes)!==pin.manifestSha256)fail('SERVER_CODE_ROLLOUT_PACKAGE');
  const manifest=JSON.parse(bytes),artifact=manifest.artifacts?.find(row=>path.basename(row.path)===pin.productRole+'-api.zip');
  if(manifest.schemaVersion!==1||manifest.productRole!==pin.productRole||manifest.candidateCommit!==config.candidateCommit||!Array.isArray(manifest.contents)||manifest.buildDigest!==sha(JSON.stringify(manifest.contents))||!equal(manifest.versions,descriptor.versions)||!artifact||!hex(pin.apiArtifactSha256)||artifact.sha256!==pin.apiArtifactSha256)fail('SERVER_CODE_ROLLOUT_PACKAGE');
  const stat=plain(pin.apiArtifactPath);if(stat.size!==artifact.bytes||sha(fs.readFileSync(pin.apiArtifactPath))!==pin.apiArtifactSha256)fail('SERVER_CODE_ROLLOUT_PACKAGE');return manifest;
 });
 const manifest=manifests.find(row=>row.productRole===descriptor.productRole),seen=new Set();
 const included=file=>/^(backend|src|scripts|skills|daemon)\//.test(file)||['package.json','package-lock.json','preservation-package.json'].includes(file);
 const files=manifest.contents.filter(row=>included(row.path));
 for(const row of files){fields(row,['path','sha256']);if(!hex(row.sha256)||path.posix.normalize(row.path)!==row.path||row.path.startsWith('../')||path.posix.isAbsolute(row.path)||row.path.includes('\\')||seen.has(row.path))fail('SERVER_CODE_ROLLOUT_SOURCE');seen.add(row.path);if(sha(read(path.join(ROOT,row.path)))!==row.sha256)fail('SERVER_CODE_ROLLOUT_SOURCE');}
 const actual=[...['backend','src','scripts','skills','daemon'].flatMap(prefix=>sourceFiles(ROOT,prefix)),...['package.json','package-lock.json','preservation-package.json']];
 if(!equal(actual.sort(),[...seen].sort())||!['backend/app.mjs','backend/db.mjs','backend/repository.mjs','backend/server-code-rollout.mjs','backend/version-preservation.mjs','src/execution-admission.mjs'].every(file=>seen.has(file)))fail('SERVER_CODE_ROLLOUT_SOURCE');
 return Object.freeze({productRole:descriptor.productRole,candidateCommit:config.candidateCommit,buildDigest:manifest.buildDigest,manifestSha256:config.releases.find(row=>row.productRole===descriptor.productRole).manifestSha256});
}
function configuration(options){
 const file=options.serverCodeRolloutConfigPath||process.env.ZIWEI_SERVER_CODE_ROLLOUT_CONFIG;
 const pin=options.serverCodeRolloutConfigSha256||process.env.ZIWEI_SERVER_CODE_ROLLOUT_CONFIG_SHA256;
 if(!file&&!pin)return null;if(!file||!hex(pin))fail('SERVER_CODE_ROLLOUT_AUTHORIZATION');plain(file,{privateMode:true});const bytes=fs.readFileSync(file);if(bytes.length>256*1024||sha(bytes)!==pin)fail('SERVER_CODE_ROLLOUT_AUTHORIZATION');
 const config=JSON.parse(bytes);fields(config,['schemaVersion','kind','rolloutId','candidateCommit','database','storage','releases','scheduler','deviceExecution']);fields(config.database,['databaseId','canonicalPath','identity']);fields(config.database.identity,['dev','ino']);fields(config.storage,['objectStoreDir','environmentKey']);
 if(config.schemaVersion!==1||config.kind!=='server-code-rollout-v1'||!uuid(config.rolloutId)||!uuid(config.database.databaseId)||!/^[a-f0-9]{40}$/.test(config.candidateCommit)||config.scheduler!=='disabled'||config.deviceExecution!=='blocked'||!Array.isArray(config.releases)||config.releases.length!==2||!equal(config.releases.map(row=>row.productRole).sort(),['v1-compat','v2']))fail('SERVER_CODE_ROLLOUT_INVALID');
 return {config,pin};
}
function validateStorage(config,options){
 plain(config.storage.objectStoreDir,{directory:true});if(options.objectStore||options.objectStoreDir&&options.objectStoreDir!==config.storage.objectStoreDir||process.env.ZIWEI_OBJECT_STORE_DIR&&process.env.ZIWEI_OBJECT_STORE_DIR!==config.storage.objectStoreDir)fail('SERVER_CODE_ROLLOUT_STORAGE');
 const key=config.storage.environmentKey;
 if(key.kind==='configured'){fields(key,['kind','sha256']);const value=keyConfigured(options);if(!value||!hex(key.sha256)||sha(value)!==key.sha256)fail('SERVER_CODE_ROLLOUT_KEY');return ()=>crypto.createHash('sha256').update(value).digest();}
 fields(key,['kind','canonicalPath','sha256']);if(key.kind!=='file'||keyConfigured(options))fail('SERVER_CODE_ROLLOUT_KEY');plain(key.canonicalPath,{privateMode:true});const bytes=fs.readFileSync(key.canonicalPath);if(bytes.length<32||!hex(key.sha256)||sha(bytes)!==key.sha256)fail('SERVER_CODE_ROLLOUT_KEY');return ()=>{const current=read(key.canonicalPath);if(sha(current)!==key.sha256)fail('SERVER_CODE_ROLLOUT_KEY');return current.subarray(0,32);};
}
/** Reads copies of SQLite files only; it never opens the original writable. */
export function preflightServerCodeRollout(options={}){
 const approved=configuration(options),filename=options.filename||process.env.ZIWEI_DB_FILE||path.join(ROOT,'data','ziwei.sqlite');
 if(approved){const {config}=approved;if(options.memory||filename!==config.database.canonicalPath)fail('SERVER_CODE_ROLLOUT_DATABASE');plain(filename);if(!equal(identity(filename),config.database.identity))fail('SERVER_CODE_ROLLOUT_DATABASE');verifyRelease(config);validateStorage(config,options);}
 if(options.memory||!fs.existsSync(filename)||fs.statSync(filename).size===0)return approved;
 const present=readDatabaseSnapshot(filename,db=>table(db,'server_code_rollout'));
 if(present&&!approved)fail('SERVER_CODE_ROLLOUT_REQUIRED','该数据库已绑定服务器代码升级模式；必须保留原批准配置和同批兼容代码');return approved;
}
export function assertServerCodeRolloutRepository(repo,options={}){const state=states.get(repo.db),approved=configuration(options);if((approved||table(repo.db,'server_code_rollout'))&&(!state||repositories.get(repo)!==state))fail('SERVER_CODE_ROLLOUT_REPOSITORY','必须先用同一批准模式构造 repository，不能后装门禁或替换存储');if(state&&(!approved||approved.pin!==state.configSha256))fail('SERVER_CODE_ROLLOUT_REQUIRED');return repo;}
/** Must run before preservation registration or any startup migration writes. */
export function initializeServerCodeRollout(db,options={}, {readConnectionIdentity=readApiDatabaseConnectionIdentity}={}){
 const saved=table(db,'server_code_rollout')?db.prepare('SELECT * FROM server_code_rollout WHERE singleton=1').get():null,approved=configuration(options);
 if(!approved){if(saved||table(db,'server_code_rollout'))fail('SERVER_CODE_ROLLOUT_REQUIRED','该数据库已绑定服务器代码升级模式；必须保留原批准配置和同批兼容代码');return null;}
 const {config,pin}=approved,filename=db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')?.file;
 if(!filename||filename!==config.database.canonicalPath)fail('SERVER_CODE_ROLLOUT_DATABASE');plain(filename);if(!equal(identity(filename),config.database.identity))fail('SERVER_CODE_ROLLOUT_DATABASE');
 if(table(db,'production_preservation_identity')){const original=db.prepare('SELECT database_id FROM production_preservation_identity WHERE singleton=1').get();if(original&&original.database_id!==config.database.databaseId)fail('SERVER_CODE_ROLLOUT_DATABASE');}
 const release=verifyRelease(config),environmentKey=validateStorage(config,options),connection=readConnectionIdentity(filename);if(!equal(connection,{canonicalPath:filename,identity:config.database.identity}))fail('SERVER_CODE_ROLLOUT_DATABASE_HANDLE');
 if(saved&&(saved.rollout_id!==config.rolloutId||saved.config_sha256!==pin||saved.database_id!==config.database.databaseId||saved.database_path!==filename||saved.batch_commit!==config.candidateCommit||!equal(JSON.parse(saved.file_identity_json),config.database.identity)||saved.mode_json!==json(config)))fail('SERVER_CODE_ROLLOUT_CONFLICT');
 let write=false;db.function('ziwei_server_code_rollout_write_admitted',()=>write?1:0);
 db.exec("CREATE TABLE IF NOT EXISTS server_code_rollout(singleton INTEGER PRIMARY KEY CHECK(singleton=1),rollout_id TEXT NOT NULL,database_id TEXT NOT NULL,database_path TEXT NOT NULL,file_identity_json TEXT NOT NULL,config_sha256 TEXT NOT NULL,batch_commit TEXT NOT NULL,mode_json TEXT NOT NULL,created_at TEXT NOT NULL)");
 for(const event of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER IF NOT EXISTS server_code_rollout_${event.toLowerCase()} BEFORE ${event} ON server_code_rollout WHEN ziwei_server_code_rollout_write_admitted()=0 BEGIN SELECT RAISE(ABORT,'SERVER_CODE_ROLLOUT_CONTROL_PRIVATE'); END`);
 if(!saved){write=true;try{db.prepare('INSERT INTO server_code_rollout VALUES(1,?,?,?,?,?,?,?,?)').run(config.rolloutId,config.database.databaseId,filename,json(config.database.identity),pin,config.candidateCommit,json(config),new Date().toISOString());}finally{write=false;}}
 const status=()=>({mode:'server-only-code-rollout',rolloutId:config.rolloutId,databaseId:config.database.databaseId,...release,scheduler:'disabled',deviceExecution:'blocked',clientQualification:'not_available',code:'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED',message:'等待客户端验证或更新；当前仅开放服务器配置和历史读取'});
 const state=Object.freeze({active:true,configSha256:pin,status,assertExecution:()=>fail('SERVER_CODE_ROLLOUT_CLIENT_REQUIRED','等待客户端验证或更新；服务器代码升级期间设备执行已关闭'),environmentKey,objectStoreDir:config.storage.objectStoreDir});states.set(db,state);return state;
}
export const serverCodeRolloutFor=db=>states.get(db)||null;
export function installServerCodeRolloutActionGuards(db){
 if(!states.has(db))return;
 db.exec("CREATE TRIGGER IF NOT EXISTS server_code_rollout_action_insert BEFORE INSERT ON a2a_actions BEGIN SELECT RAISE(ABORT,'SERVER_CODE_ROLLOUT_CLIENT_REQUIRED'); END; CREATE TRIGGER IF NOT EXISTS server_code_rollout_action_delete BEFORE DELETE ON a2a_actions BEGIN SELECT RAISE(ABORT,'SERVER_CODE_ROLLOUT_ACTION_PRESERVED'); END");
 const immutable=['id','workspace_id','agent_id','task_id','type','payload_json','dedupe_key','expires_at','created_at','acked_at'];
 const same=immutable.map(key=>`NEW.${key} IS OLD.${key}`).join(' AND '),noop=[...immutable,'status','completed_at','result_json','error'].map(key=>`NEW.${key} IS OLD.${key}`).join(' AND ');
 db.exec(`CREATE TRIGGER IF NOT EXISTS server_code_rollout_action_update BEFORE UPDATE ON a2a_actions WHEN NOT ((${same} AND OLD.status='acked' AND NEW.status IN ('succeeded','failed')) OR (${noop})) BEGIN SELECT RAISE(ABORT,'SERVER_CODE_ROLLOUT_ACTION_PRESERVED'); END`);
}
export function guardServerCodeRolloutRepository(repo){
 const state=states.get(repo.db);if(!state)return repo;if(repositories.get(repo)===state)return repo;if(Object.hasOwn(repo,'serverCodeRollout'))fail('SERVER_CODE_ROLLOUT_REPOSITORY');Object.defineProperty(repo,'serverCodeRollout',{value:state});repositories.set(repo,state);
 const wrap=(name,check)=>{if(typeof repo[name]!=='function')return;const original=repo[name];repo[name]=function(...args){check(...args);return original.apply(repo,args);};};
 for(const name of ['createA2AAction','authorizeActionExecution','authorizeBotStart','authorizeBotGateway','receiveBotGateway','botGatewayDelivery','deviceAction','dispatchBotCollaboration','runAutomation','queueAutomationRetry','createDeviceDirectoryAction','createConversationDirectoryAction','requestManagementMcpRetry','createA2ATask'])wrap(name,()=>state.assertExecution());
 wrap('createTask',(_slug,input={})=>{if(input.execute===true||input.runtime||input.model)state.assertExecution();});
 wrap('addConversationMessage',(_id,input={})=>{if(input.dispatch!==false && (!input.role||input.role==='user'))state.assertExecution();});
 if(repo.listA2AActions){repo.listA2AActions=function(slug,input={}){if(input.executionDelivery===true||input.deviceId||input.device_id||String(input.status||'pending')!=='all')return [];return repo.db.prepare('SELECT id FROM a2a_actions WHERE workspace_id=(SELECT id FROM workspaces WHERE slug=?) ORDER BY created_at').all(slug).map(row=>repo.getA2AAction(row.id));};}
 if(repo.ackA2AAction)repo.ackA2AAction=function(actionId,input={}){const row=repo.db.prepare('SELECT * FROM a2a_actions WHERE id=?').get(actionId),payload=row?JSON.parse(row.payload_json):{},target=payload.deviceId||payload.device_id;if(input.receiptOnly!==true||input.renewLease===true||!row||!['acked','succeeded','failed','expired'].includes(row.status)||!input.deviceId||target!==input.deviceId||input.agentId&&input.agentId!==row.agent_id)state.assertExecution();return {id:row.id,status:row.status,deviceId:input.deviceId,acked_at:row.acked_at,expires_at:row.expires_at,duplicate:true,receiptOnly:true,deliveryOnly:true,leaseRenewed:false};};
 if(repo.tickAutomations)repo.tickAutomations=()=>[];if(repo.dispatchWebhookDeliveries)repo.dispatchWebhookDeliveries=async()=>0;if(repo.queueWebhookDelivery)repo.queueWebhookDelivery=()=>null;
 if(repo.authorizeBotSettlement){const original=repo.authorizeBotSettlement;repo.authorizeBotSettlement=function(...args){return {...original.apply(repo,args),allowEvaluation:false};};}
 wrap('resultA2AAction',(actionId)=>{const row=repo.db.prepare('SELECT status FROM a2a_actions WHERE id=?').get(actionId);if(row&&!['acked','succeeded','failed','expired'].includes(row.status))state.assertExecution();});
 for(const name of ['getSummary','listDevices'])if(repo[name]){const original=repo[name];repo[name]=function(...args){const value=original.apply(repo,args);return Array.isArray(value)?value.map(row=>({...row,executionAdmission:state.status(),management_mcp_retry_at:null})):{...value,serverCodeRollout:state.status()};};}
 return repo;
}
/** Generates private operator input only; never activates or modifies the DB. */
export function planServerCodeRollout({databasePath,packagesDirectory,objectStoreDir,environmentKeyFile,rolloutId=crypto.randomUUID(),envEncryptionKey}={}){
 plain(databasePath);plain(objectStoreDir,{directory:true});const databaseId=readDatabaseSnapshot(databasePath,db=>{let value=table(db,'production_preservation_identity')?db.prepare('SELECT database_id FROM production_preservation_identity WHERE singleton=1').get()?.database_id:null;value ||= table(db,'server_code_rollout')?db.prepare('SELECT database_id FROM server_code_rollout WHERE singleton=1').get()?.database_id:null;return value;});
 const configured=keyConfigured({envEncryptionKey});let environmentKey;
 if(configured)environmentKey={kind:'configured',sha256:sha(configured)};else{plain(environmentKeyFile,{privateMode:true});environmentKey={kind:'file',canonicalPath:environmentKeyFile,sha256:sha(fs.readFileSync(environmentKeyFile))};}
 const descriptor=JSON.parse(read(path.join(ROOT,'preservation-package.json'))),config={schemaVersion:1,kind:'server-code-rollout-v1',rolloutId,candidateCommit:descriptor.candidateCommit,database:{databaseId:databaseId||crypto.randomUUID(),canonicalPath:databasePath,identity:identity(databasePath)},storage:{objectStoreDir,environmentKey},releases:['v2','v1-compat'].map(productRole=>{const manifestPath=path.join(packagesDirectory,productRole+'-manifest.json'),apiArtifactPath=path.join(packagesDirectory,productRole+'-api.zip');return {productRole,manifestPath,manifestSha256:sha(read(manifestPath)),apiArtifactPath,apiArtifactSha256:sha(read(apiArtifactPath))};}),scheduler:'disabled',deviceExecution:'blocked'};verifyRelease(config);validateStorage(config,{envEncryptionKey});return config;
}
