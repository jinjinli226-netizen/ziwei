import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {clientBuildIdentity} from '../src/management-bootstrap.mjs';
test('client identity covers the packaged native evidence and preservation code',t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'ziwei-preservation-build-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'backend'));fs.writeFileSync(path.join(root,'package.json'),'{}');const file=path.join(root,'backend/preservation-native-evidence.mjs');fs.writeFileSync(file,'version-one');const before=clientBuildIdentity(root);fs.writeFileSync(file,'version-two');assert.notEqual(clientBuildIdentity(root),before);});
