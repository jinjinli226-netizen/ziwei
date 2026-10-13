import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const walk=directory=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
const patterns=['test/*.test.mjs','frontend/src/*.test.mjs','frontend/preview/*.test.mjs','frontend/tests/*.test.mjs'];
// Node expands these globs. Keep the native command below the historical
// identity reader's 64-argument safety bound during its unrelated-node scan.
const result=spawnSync(process.execPath,['--test','--test-concurrency=4',...patterns],{cwd:root,stdio:'inherit',windowsHide:true});process.exitCode=result.status??1;
