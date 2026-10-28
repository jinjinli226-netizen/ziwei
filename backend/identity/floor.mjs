import fs from 'node:fs';
import path from 'node:path';
import {fail} from './common.mjs';
const deny=()=>fail('IDENTITY_CONFIGURATION','Unified identity floor requires its original issuer, origin and independent security store.',503);
export function assertUnifiedFloor(db,env){
  const table=!!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='unified_identity_security_floor'").get(),saved=table?db.prepare('SELECT * FROM unified_identity_security_floor WHERE singleton=1').get():null;
  const databases=db.prepare('PRAGMA database_list').all(),business=databases.find(x=>x.name==='main')?.file;
  const directory=env.ZIWEI_IDENTITY_SECURITY_DIR;
  if(!directory){if(saved||business&&env.ZIWEI_IDENTITY_MODE==='unified')deny();return;}
  if(!path.isAbsolute(directory)||path.resolve(directory)===path.parse(directory).root)deny();
  if(business){const dataDir=path.dirname(path.resolve(business)),relative=path.relative(dataDir,path.resolve(directory));if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))deny();}
  fs.mkdirSync(directory,{recursive:true,mode:0o700});if(fs.lstatSync(directory).isSymbolicLink())deny();
  const marker=path.join(directory,'unified-required.json');let original=null;
  if(fs.existsSync(marker)){const st=fs.lstatSync(marker);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1||process.platform!=='win32'&&(st.mode&0o077))deny();try{original=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{deny();}}
  const expected={version:1,issuer:env.ZIWEI_IDENTITY_ISSUER,origin:env.ZIWEI_IDENTITY_ORIGIN};
  if(saved||original){if(env.ZIWEI_IDENTITY_MODE!=='unified'||!saved||!original||saved.issuer!==expected.issuer||saved.origin!==expected.origin||JSON.stringify(original)!==JSON.stringify(expected))deny();return;}
  if(env.ZIWEI_IDENTITY_MODE!=='unified')return;
  if(typeof expected.issuer!=='string'||!expected.issuer.startsWith('https://')||typeof expected.origin!=='string'||!expected.origin.startsWith('https://'))deny();
  fs.writeFileSync(marker,JSON.stringify(expected),{mode:0o600,flag:'wx',flush:true});
  db.exec('CREATE TABLE IF NOT EXISTS unified_identity_security_floor(singleton INTEGER PRIMARY KEY CHECK(singleton=1),issuer TEXT NOT NULL,origin TEXT NOT NULL)');
  db.prepare('INSERT INTO unified_identity_security_floor VALUES(1,?,?)').run(expected.issuer,expected.origin);
}
