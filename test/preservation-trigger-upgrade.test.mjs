import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRepository} from '../backend/repository.mjs';
import {createManagementService} from '../backend/management.mjs';
import {createPreservation,FROZEN_VERSIONS} from '../backend/version-preservation.mjs';
import {completeOwnedProfile} from '../test-support/owned-profile.mjs';
test('trigger replacement holds the write lock and failed DDL restores the previous guard',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-trigger-upgrade-')),filename=path.join(root,'db.sqlite'),repo=createRepository({filename}),second=new DatabaseSync(filename);t.after(()=>{second.close();repo.db.close();fs.rmSync(root,{recursive:true,force:true});});
 repo.heartbeatDevice('test-111',{deviceId:'upgrade-pc',runtimes:{Hermes:{status:'available',profiles:[{name:'default'}],models:[{id:'fixture'}]}}});const bot=createManagementService(repo).bots.create('test-111',{name:'Upgrade Bot',targetDeviceId:'upgrade-pc',runtimeProfile:'default',model:'fixture',idempotencyKey:'upgrade'},{deviceCredentialDeviceId:'upgrade-pc',deviceScope:'upgrade-pc',authenticatedMcp:true});completeOwnedProfile(repo,bot);repo.preservation.begin({operationId:'upgrade',versions:FROZEN_VERSIONS});createPreservation(second);second.exec('PRAGMA busy_timeout=0');
 const original=repo.db.exec.bind(repo.db);let observed=false,injectFailure=false;repo.db.exec=sql=>{if(sql.includes('CREATE TRIGGER preservation_a2a_actions_update')){original('DROP TRIGGER IF EXISTS preservation_a2a_actions_update');assert.throws(()=>second.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run('must not write',bot.instance.provisioning.actionId),/locked/);observed=true;if(injectFailure)return original('CREATE TRIGGER invalid syntax');}return original(sql);};
 createPreservation(repo.db);assert.equal(observed,true);injectFailure=true;assert.throws(()=>createPreservation(repo.db),/syntax/);assert.ok(repo.db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='preservation_a2a_actions_update'").get());assert.throws(()=>second.prepare('UPDATE a2a_actions SET error=? WHERE id=?').run('must not write',bot.instance.provisioning.actionId),/V2_OBJECT_SEALED/);assert.equal(second.prepare('SELECT error FROM a2a_actions WHERE id=?').get(bot.instance.provisioning.actionId).error,null);
});
