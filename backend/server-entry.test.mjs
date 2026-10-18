import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isBackendServerEntry} from './app.mjs';

test('only the actual sibling backend/server.mjs entry may auto-start the server',()=>{
  const appUrl=new URL('./app.mjs',import.meta.url),server=fileURLToPath(new URL('./server.mjs',appUrl));
  assert.equal(isBackendServerEntry(server),true);
  assert.equal(isBackendServerEntry(path.relative(process.cwd(),server)),true);
  for(const entry of [undefined,null,'',fileURLToPath(appUrl),path.join(path.dirname(server),'fixture-server.mjs'),path.join(path.dirname(server),'not-server.mjs'),path.join(path.dirname(server),'other','server.mjs'),path.join(path.dirname(server),'server.mjs.backup')])assert.equal(isBackendServerEntry(entry),false,String(entry));
});

test('the real app auto-entry uses the exact guard and the official entry retains its export',()=>{
  const app=fs.readFileSync(new URL('./app.mjs',import.meta.url),'utf8'),entry=fs.readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
  assert.match(app,/if \(isBackendServerEntry\(process\.argv\[1\]\)\) startServer\(\);/);
  assert(!app.includes("endsWith('server.mjs')"));
  assert.match(entry,/export\s*\{\s*startServer\s*\}\s*from\s*['"]\.\/app\.mjs['"]/);
});
