import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as vue from 'vue';
import {renderToString} from '@vue/server-renderer';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';

const filename=new URL('./components/EmployeeAvatar.vue',import.meta.url);
const {descriptor}=parse(await readFile(filename,'utf8'));
const script=compileScript(descriptor,{id:'employee-avatar'});
const template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'employee-avatar',compilerOptions:{bindingMetadata:script.bindings}});
assert.deepEqual(template.errors,[]);
async function evaluate(source,from,to){
  let code=source;const bindings={};
  for(const match of [...code.matchAll(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm)]){
    const module=match[2]==='vue'?vue:await import(new URL(match[2],filename));
    for(const token of match[1].slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=module[name];}
    code=code.replace(match[0],'');
  }
  return new Function(...Object.keys(bindings),code.replace(from,to))(...Object.values(bindings));
}
const component=await evaluate(script.content,'export default','return');
component.render=await evaluate(template.code,'export function render','return function render');
const render=props=>renderToString(vue.createSSRApp(component,props));

test('the actual employee avatar renders stored character descriptors as trusted images',async()=>{
  const html=await render({avatar:'grok:clover:cyan',identity:'employee',name:'员工'});
  assert.match(html,/data-avatar-kind="character"/);assert.match(html,/src="data:image\/svg\+xml/);assert.doesNotMatch(html,/src="grok:/);
});

test('the actual employee avatar preserves uploaded image sources and accessible labels',async()=>{
  const html=await render({avatar:'/api/workspaces/team/employees/e/avatar',name:'员工',alt:'员工头像'});
  assert.match(html,/src="\/api\/workspaces\/team\/employees\/e\/avatar"/);assert.match(html,/data-avatar-kind="image"/);assert.match(html,/alt="员工头像"/);
});

test('default character identity remains stable when the employee display name changes',async()=>{
  const first=await render({identity:'employee',name:'原名称'}),second=await render({identity:'employee',name:'新名称'});
  assert.equal(first,second);assert.match(first,/employee-avatar--character/);
});
