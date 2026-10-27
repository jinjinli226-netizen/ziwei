import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc';
import * as vue from 'vue';
import {renderToString} from '@vue/server-renderer';
import * as installer from '../frontend/src/android-install.js';

const origin='https://ziwei.qzelynth.top';
const filename=new URL('../frontend/src/components/AndroidInstallPage.vue',import.meta.url);
async function page({fetchImpl,workspace='bigtron'}={}){
  const source=await fs.readFile(filename,'utf8');const {descriptor,errors}=parse(source);assert.deepEqual(errors,[]);
  const script=compileScript(descriptor,{id:'android-install-origin-test'});
  const template=compileTemplate({id:'android-install-origin-test',filename:filename.pathname,source:descriptor.template.content,
    compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[]);
  const mounted=[],unmounted=[],clipboard=[];
  const bindings={window:{setTimeout,clearTimeout},document:{title:'Previous title'},
    location:{search:`?workspace=${encodeURIComponent(workspace)}`},
    navigator:{userAgent:'Mozilla/5.0 (Linux; Android 10; K) Chrome/143.0 Mobile',clipboard:{writeText:async value=>clipboard.push(value)}}};
  function imports(code,resolve){return code.replace(/^import (.*?) from ['"]([^'"]+)['"];?\r?$/gm,(_line,names,specifier)=>{
    const exports=resolve(specifier);
    for(const token of names.slice(1,-1).split(',')){const [name,alias]=token.trim().split(/\s+as\s+/);bindings[alias||name]=exports[name];}
    return '';
  });}
  const scriptCode=imports(script.content,specifier=>{
    if(specifier==='vue')return{...vue,onMounted:callback=>mounted.push(callback),onUnmounted:callback=>unmounted.push(callback)};
    if(specifier==='lucide-vue-next')return new Proxy({},{get:()=>({render:()=>null})});
    assert.equal(specifier,'../android-install.js');return{...installer,
      loadLatestAndroidRelease:options=>installer.loadLatestAndroidRelease({...options,fetchImpl})};
  });
  const component=new Function(...Object.keys(bindings),scriptCode.replace('export default','return'))(...Object.values(bindings));
  const ui=component.setup({}, {expose(){}});
  const templateCode=imports(template.code,specifier=>{assert.equal(specifier,'vue');return vue;});
  const render=new Function(...Object.keys(bindings),templateCode.replace('export function render','function render')+'\nreturn render;')(...Object.values(bindings));
  return{ui,clipboard,mounted,async html(){return renderToString(vue.h({render(){return render(this,[],{},vue.proxyRefs(ui),{},{});}}));},
    dispose(){for(const fn of unmounted)fn();}};
}
function data(){
  const dir='/downloads/android/vfixture-22-code22';const hashes={sha256:'a'.repeat(64),signerSha256:'b'.repeat(64)};
  const release={versionName:'fixture-22',versionCode:22,buildType:'debug',manifest:`https://qzelynth.top${dir}/manifest.json`,
    packages:Object.fromEntries(['agent','updater'].map(role=>[role,{file:`ziwei-${role}-debug.apk`,packageName:`com.ziwei.device.${role}`,path:`https://qzelynth.top${dir}/ziwei-${role}-debug.apk`,...hashes}]))};
  const manifest={schemaVersion:1,buildType:'debug',packages:['agent','updater'].map((role,i)=>({role,...release.packages[role],versionCode:22,versionName:'fixture-22',bytes:815470+i*4}))};
  return{release,manifest,dir};
}

test('the actual install page loads index and legacy manifest into both download links and the bigtron return path',async()=>{
  const {release,manifest,dir}=data(),calls=[];
  const h=await page({fetchImpl:async(url,options)=>{
    calls.push({url,options});assert.equal(new URL(url).origin,origin);
    if(url===`${origin}/downloads/android/index.json`)return Response.json({schemaVersion:1,releases:[release]});
    assert.equal(url,`${origin}${dir}/manifest.json`);return Response.json(manifest);
  }});
  try{
    assert.equal(h.ui.state.value,'loading');await h.ui.loadRelease();assert.equal(h.ui.state.value,'ready',h.ui.error.value);
    assert.equal(h.ui.release.value.versionCode,22);assert.equal(calls.length,2);
    const html=await h.html();
    for(const role of ['agent','updater'])assert.ok(html.includes(`href="${origin}${dir}/ziwei-${role}-debug.apk"`));
    assert.ok(html.includes(`href="${origin}/bigtron/ziwei-connect"`));
    assert.ok(html.includes(`href="${origin}/android-install"`));
    assert.ok(html.includes(`内容为 ${origin}/android-install`),'QR accessible text identifies the actual formal target');
    assert.match(html.match(/class="install-page-url"[^>]*>([^<]+)/)?.[1]||'',/ziwei\.qzelynth\.top\/android-install/);
    assert.ok(html.includes('fixture-22'));assert.ok(html.includes('796.4 KB'));
    await h.ui.copyAddress();assert.deepEqual(h.clipboard,[installer.CONTROL_URL]);
  }finally{h.dispose();}
});

test('page failure shows retry without stale package links and retry uses the same trusted release chain',async()=>{
  const {release,manifest}=data();let failed=true;
  const h=await page({fetchImpl:async(url)=>{
    assert.equal(new URL(url).origin,origin);
    if(failed)return new Response(null,{status:503});
    return Response.json(url.endsWith('/index.json')?{schemaVersion:1,releases:[release]}:manifest);
  }});
  try{
    await h.ui.loadRelease();assert.equal(h.ui.state.value,'error');assert.equal(h.ui.release.value,null);
    assert.ok((await h.html()).includes('重试'));assert.equal((await h.html()).includes('data-testid="download-agent"'),false);
    failed=false;await h.ui.loadRelease();assert.equal(h.ui.state.value,'ready',h.ui.error.value);
    assert.ok((await h.html()).includes('data-testid="download-agent"'));
  }finally{h.dispose();}
});
