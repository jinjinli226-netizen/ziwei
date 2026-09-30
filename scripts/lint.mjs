import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const files=['backend','frontend/src','daemon','src'].flatMap(dir=>{const base=path.join(root,dir);return fs.existsSync(base)?walk(base):[]});
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]).filter(file=>/\.(mjs|js|vue)$/.test(file));}
const banned=[]; for(const file of files){const content=fs.readFileSync(file,'utf8'); if(/aura_ffde|Bearer\s+[A-Za-z0-9_-]{12,}/i.test(content)) banned.push(file);}
if(banned.length){console.error('Potential credential material in source:',banned);process.exit(1);} console.log(`lint ok: ${files.length} source files checked`);
