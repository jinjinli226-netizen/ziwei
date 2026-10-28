import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url));
const source=path.resolve(root,'../../scripts/ziwei-mcp.mjs');
const output=path.join(root,'vendor/native-schemas.mjs');
try {
  const code=(await fs.readFile(source,'utf8')).replace(/\r\n/g,'\n');
  const begin=code.indexOf('export const toolDefinitions = [');
  const end=code.indexOf('\nexport function createMcpClient',begin);
  if(begin<0 || end<0) throw Error('Native schema extraction boundary missing');
  const definitions=code.slice(begin,end).trim().replace('\nfunction phoneSetupSummary','\nexport function phoneSetupSummary');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,`// Generated from scripts/ziwei-mcp.mjs; only native schemas, no environment or credential access.\n// Source SHA256: ${crypto.createHash('sha256').update(code).digest('hex')}\n${definitions}\n`);
} catch(error) {
  if(error.code!=='ENOENT') throw error;
  // A packed install is already self-contained. Rebuilding never discovers credentials.
  await fs.access(output);
}
for(const name of ['hermes-bot-config.mjs','hermes-mcp-config.mjs','hermes-native-contract.mjs','redaction.mjs']){
  const target=path.join(root,'vendor',name);
  try{const code=(await fs.readFile(path.resolve(root,'../../src',name),'utf8')).replace(/\r\n/g,'\n');await fs.writeFile(target,`// Vendored original pure validation module; no credential/environment reads.\n${code}`);}
  catch(error){if(error.code!=='ENOENT')throw error;await fs.access(target);}
}
async function extractedModule(sourceFile,targetFile,extract){
  const target=path.join(root,'vendor',targetFile);
  try{const code=(await fs.readFile(path.resolve(root,'../..',sourceFile),'utf8')).replace(/\r\n/g,'\n');const result=extract(code);if(!result)throw Error(`Native extraction boundary missing: ${sourceFile}`);await fs.writeFile(target,`// Generated from ${sourceFile}; pure original completion semantics only.\n${result.trimEnd()}\n`);}
  catch(error){if(error.code!=='ENOENT')throw error;await fs.access(target);}
}
await extractedModule('src/runtime-adapters.mjs','phone-completion.mjs',code=>{
  const start=code.indexOf('const phoneExecutionStates = '),helpersEnd=code.indexOf('export function terminalMcpReceipt',start),failureStart=code.indexOf('export function terminalMcpExecutionFailure('),end=code.indexOf('\nfunction localManagementConfiguration',failureStart);
  return start>=0&&helpersEnd>start&&failureStart>=0&&end>failureStart?`import {redactSecrets} from './redaction.mjs';\n${code.slice(start,helpersEnd)}\n${code.slice(failureStart,end)}`:null;
});
await extractedModule('backend/repository.mjs','native-completion.mjs',code=>{
  const start=code.indexOf('const uncertainCompletion = '),end=code.indexOf('\nconst recoverableBotCompletion',start);
  return start>=0&&end>start?`import {terminalMcpExecutionFailure} from './phone-completion.mjs';\nexport ${code.slice(start,end)}`:null;
});
process.stdout.write('workspace-cli 2.0.0: independent native schemas ready\n');
