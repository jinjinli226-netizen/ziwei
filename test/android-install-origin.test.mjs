import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import jsqr from 'jsqr';
import {PUBLIC_ORIGIN,INSTALL_URL,installPageHref,managementHref,loadLatestAndroidRelease} from '../frontend/src/android-install.js';

const canonical='https://ziwei.qzelynth.top';
const legacy='https://qzelynth.top';
const digest='a'.repeat(64),signer='b'.repeat(64);
function release(code=22,version='fixture-22'){
  const directory=`/downloads/android/v${version}-code${code}`;
  return{versionCode:code,versionName:version,buildType:'debug',manifest:`${directory}/manifest.json`,
    packages:Object.fromEntries(['agent','updater'].map(role=>[role,{packageName:`com.ziwei.device.${role}`,
      file:`ziwei-${role}-debug.apk`,path:`${directory}/ziwei-${role}-debug.apk`,sha256:digest,signerSha256:signer}]))};
}
function manifest(item){return{schemaVersion:1,buildType:item.buildType,packages:['agent','updater'].map((role,i)=>({role,...item.packages[role],versionCode:item.versionCode,versionName:item.versionName,bytes:815470+i*4}))};}
function fixture({releases=[release()],mutateManifest=()=>{},override=()=>null}={}){
  const calls=[];
  return{calls,fetchImpl:async(url,options={})=>{
    calls.push({url,options});
    assert.equal(new URL(url).origin,canonical,'every browser release fetch stays on the formal page origin');
    const response=await override(url,options);if(response)return response;
    if(url===`${canonical}/downloads/android/index.json`)return Response.json({schemaVersion:1,releases});
    const item=releases.find(r=>new URL(r.manifest,canonical).pathname===new URL(url).pathname);
    assert.ok(item,`unexpected fixture request ${url}`);
    const data=manifest(item);mutateManifest(data,item);return Response.json(data);
  }};
}
function absolute(item,origin){item.manifest=origin+item.manifest;for(const pkg of Object.values(item.packages))pkg.path=origin+pkg.path;return item;}

test('default release fetch and latest of eighteen entries use the formal installation origin',async()=>{
  // Shape fixture: 18 historical entries, numeric latest code22. No claimed APK bytes.
  const releases=Array.from({length:18},(_,i)=>release(i+5,`fixture-${i+5}`)).reverse();
  const f=fixture({releases});const result=await loadLatestAndroidRelease({fetchImpl:f.fetchImpl});
  assert.equal(PUBLIC_ORIGIN,canonical);assert.equal(result.versionCode,22);assert.equal(result.versionName,'fixture-22');
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].url,`${canonical}/downloads/android/index.json`);
  for(const role of ['agent','updater'])assert.equal(new URL(result.packages[role].href).origin,canonical);
  for(const {options} of f.calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');}
});

for(const indexedOrigin of [canonical,legacy])test(`exact ${new URL(indexedOrigin).host} artifact URLs normalize to the installation origin`,async()=>{
  const item=absolute(release(),indexedOrigin);const f=fixture({releases:[item]});
  const result=await loadLatestAndroidRelease({fetchImpl:f.fetchImpl});
  assert.equal(f.calls[1].url,`${canonical}/downloads/android/vfixture-22-code22/manifest.json`);
  assert.equal(result.packages.agent.href,`${canonical}/downloads/android/vfixture-22-code22/ziwei-agent-debug.apk`);
  assert.equal(result.packages.updater.href,`${canonical}/downloads/android/vfixture-22-code22/ziwei-updater-debug.apk`);
  assert.equal(f.calls.length,2);
});

test('a legacy absolute package path inside the manifest is compared after exact canonicalization',async()=>{
  const f=fixture({mutateManifest(data){for(const pkg of data.packages)pkg.path=legacy+pkg.path;}});
  const result=await loadLatestAndroidRelease({fetchImpl:f.fetchImpl});
  assert.equal(result.packages.agent.bytes,815470);assert.equal(new URL(result.packages.agent.href).origin,canonical);
});

test('missing size HEAD stays same-origin after legacy URL normalization and never GETs APK bodies',async()=>{
  const signal=new AbortController().signal;
  const f=fixture({releases:[absolute(release(),legacy)],mutateManifest(data){delete data.packages[0].bytes;},
    override(_url,options){return options.method==='HEAD'?new Response(null,{headers:{'content-length':'815470'}}):null;}});
  const result=await loadLatestAndroidRelease({fetchImpl:f.fetchImpl,signal});
  assert.equal(result.packages.agent.bytes,815470);assert.equal(f.calls.length,3);
  const head=f.calls.find(c=>c.options.method==='HEAD');assert.equal(head.url,result.packages.agent.href);
  assert.equal(head.options.redirect,'error');assert.equal(head.options.signal,signal);assert.equal(head.options.credentials,'omit');
  assert.equal(f.calls.some(c=>c.url.endsWith('.apk')&&c.options.method!=='HEAD'),false);
});

test('legacy compatibility does not admit another origin, URL credentials, alternate port, query or traversal',async()=>{
  const bad=[
    'http://qzelynth.top/downloads/android/v22/manifest.json',
    'https://other.example/downloads/android/v22/manifest.json',
    'https://qzelynth.top.evil.example/downloads/android/v22/manifest.json',
    'https://ziwei.qzelynth.top.evil.example/downloads/android/v22/manifest.json',
    'https://qzelynth.top@evil.example/downloads/android/v22/manifest.json',
    'https://user:password@ziwei.qzelynth.top/downloads/android/v22/manifest.json',
    'https://qzelynth.top:444/downloads/android/v22/manifest.json',
    '//qzelynth.top/downloads/android/v22/manifest.json',
    ...[legacy,canonical].flatMap(origin=>[
      `${origin}/api/manifest.json`,`${origin}/downloads/android/../private/manifest.json`,
      `${origin}/downloads/android/%2e%2e/private/manifest.json`,`${origin}/downloads/android/v22%2fprivate/manifest.json`,
      `${origin}/downloads/android/v22/manifest.json?token=x`,`${origin}/downloads/android/v22/manifest.json#x`,
      `${origin}/downloads/android/v22\\manifest.json`]),
  ];
  for(const path of bad){const item=release();item.manifest=path;const f=fixture({releases:[item]});
    await assert.rejects(loadLatestAndroidRelease({fetchImpl:f.fetchImpl}),/下载地址.*安全/);assert.equal(f.calls.length,1,path);}
});

test('package path compatibility does not permit another host or a different package file',async()=>{
  for(const path of [`https://evil.example/downloads/android/vfixture-22-code22/ziwei-agent-debug.apk`,
    `${legacy}/downloads/android/vfixture-22-code22/different.apk`,
    `${legacy}/downloads/android/vfixture-22-code22/ziwei-agent-debug.apk?x=y`]){
    const item=release();item.packages.agent.path=path;const f=fixture({releases:[item]});
    await assert.rejects(loadLatestAndroidRelease({fetchImpl:f.fetchImpl}),/安全|不一致/);
    assert.equal(f.calls.some(c=>c.url.endsWith('.apk')),false);
  }
});

test('redirect responses from the index, manifest or size HEAD cannot turn into an alternate-origin fetch',async()=>{
  for(const phase of ['index','manifest','head']){
    const f=fixture({mutateManifest(data){if(phase==='head')delete data.packages[0].bytes;},override(url,options){
      if((phase==='index'&&url.endsWith('/index.json'))||(phase==='manifest'&&url.endsWith('/manifest.json'))||(phase==='head'&&options.method==='HEAD'))
        return new Response(null,{status:302,headers:{location:'https://evil.example/package'}});
    }});
    await assert.rejects(loadLatestAndroidRelease({fetchImpl:f.fetchImpl}),/302/);
    assert.ok(f.calls.every(c=>new URL(c.url).origin===canonical&&c.options.redirect==='error'));
  }
});

test('install entry and workspace return route preserve bigtron on the formal website',()=>{
  assert.equal(INSTALL_URL,`${canonical}/android-install`);
  assert.equal(installPageHref('bigtron'),`${canonical}/android-install?workspace=bigtron`);
  assert.equal(managementHref('bigtron'),`${canonical}/bigtron/ziwei-connect`);
});

test('the checked-in QR pixels decode to the same formal installation URL',()=>{
  const svg=fs.readFileSync(new URL('../frontend/public/android-install-qr.svg',import.meta.url),'utf8');
  const view=svg.match(/viewBox="0 0 (\d+) (\d+)"/);assert.ok(view);
  const width=Number(view[1]),height=Number(view[2]);const pixels=new Uint8ClampedArray(width*height*4);pixels.fill(255);
  const cells=[...svg.matchAll(/M(\d+),(\d+)l(\d+),0 0,\d+ -\d+,0 0,-\d+z/g)];assert.ok(cells.length>100,'locally-generated QR vector contains real pixel cells');
  for(const cell of cells){const x=Number(cell[1]),y=Number(cell[2]),size=Number(cell[3]);
    for(let dy=0;dy<size;dy++)for(let dx=0;dx<size;dx++){const i=((y+dy)*width+x+dx)*4;pixels[i]=pixels[i+1]=pixels[i+2]=0;}}
  assert.equal(jsqr(pixels,width,height)?.data,`${canonical}/android-install`);
});
