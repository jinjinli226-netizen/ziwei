import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {planServerCodeRollout} from '../backend/server-code-rollout.mjs';
const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
if(args[0]!=='plan'||!option('--output'))throw new Error('Usage: node scripts/server-code-rollout.mjs plan --database CANONICAL_DB --packages CANONICAL_PACKAGE_DIR --objects CANONICAL_OBJECT_DIR --environment-key CANONICAL_KEY --output PRIVATE_CONFIG');
const config=planServerCodeRollout({databasePath:option('--database'),packagesDirectory:option('--packages'),objectStoreDir:option('--objects'),environmentKeyFile:option('--environment-key'),rolloutId:option('--rollout-id')}),output=path.resolve(option('--output')),bytes=JSON.stringify(config,null,2)+'\n';
fs.writeFileSync(output,bytes,{mode:0o600,flag:'wx'});
console.log(JSON.stringify({configPath:output,configSha256:crypto.createHash('sha256').update(bytes).digest('hex'),rolloutId:config.rolloutId,candidateCommit:config.candidateCommit,scheduler:'disabled',deviceExecution:'blocked',databaseModified:false}));
