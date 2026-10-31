import fs from 'node:fs';
import path from 'node:path';
import {defaultUserDir,resolveConfigPath,resolveWorkspaceConnections} from '../daemon/config.mjs';
import {createActionDelivery} from './daemon-action-delivery.mjs';

const noop=async()=>{};

/**
 * Migrate terminal local delivery blocks before an old daemon is stopped.
 * This only archives journals whose own authenticated delivery record proves a
 * permanent server rejection; it never writes a server result or marks an
 * execution successful. The candidate daemon owns the format so an older
 * installed client cannot keep the updater permanently blocked.
 */
export function archiveBlockedDeliveriesForUpdate({root=process.cwd(),env=process.env}={}){
 const configPath=resolveConfigPath({root,env});
 let config;
 try{config=JSON.parse(fs.readFileSync(configPath,'utf8'));}catch(error){if(error.code==='ENOENT')return {archived:0,remaining:0,connections:0};throw error;}
 if(config.connectionState==='disconnected')return {archived:0,remaining:0,connections:0};
 const runtimeRoot=env.ZIWEI_USER_HOME?path.join(defaultUserDir({env}),'runtime'):path.join(path.resolve(root),'.local','runtime');
 const resolved=resolveWorkspaceConnections(config,{configPath,root});
 let archived=0,remaining=0,connections=0;
 for(const connection of resolved.connections.filter(item=>item.deviceToken)){
  const runtimeDir=connection.primary?runtimeRoot:path.join(runtimeRoot,'shared-workspaces',connection.workspace,connection.deviceId);
  const delivery=createActionDelivery({
   directory:path.join(runtimeDir,'action-delivery'),
   identity:{apiBase:connection.apiBase,workspace:connection.workspace,deviceId:connection.deviceId},
   post:noop,dispatch:noop,onConfirmed:noop,autoArchiveUnconfirmed:true,
  });
  const result=delivery.archiveBlockedDeliveries();
  archived+=result.archived;remaining+=result.remaining;connections++;
 }
 return {archived,remaining,connections,errors:resolved.errors};
}
