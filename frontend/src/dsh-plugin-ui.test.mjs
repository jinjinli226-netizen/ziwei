import test from 'node:test';
import assert from 'node:assert/strict';
import {dshPluginUiBotName,dshPluginUiMessage,dshPluginUiRelayUrl} from './dsh-plugin-ui.js';

test('plugin UI bridge accepts only the bound DSH source, origin and view key',()=>{
 const source={},base={channel:'dshbot-plugin-ui',version:1,botName:'alpha',viewKey:'v'.repeat(16),type:'ready'};
 assert.equal(dshPluginUiMessage(base,{botName:'alpha',viewKey:base.viewKey,source,expectedSource:source,origin:'https://ziwei.test',expectedOrigin:'https://ziwei.test'}),true);
 assert.equal(dshPluginUiMessage({...base,viewKey:'other'},{botName:'alpha',viewKey:base.viewKey,source,expectedSource:source,origin:'https://ziwei.test',expectedOrigin:'https://ziwei.test'}),false);
 assert.equal(dshPluginUiMessage(base,{botName:'alpha',viewKey:base.viewKey,source:{},expectedSource:source,origin:'https://ziwei.test',expectedOrigin:'https://ziwei.test'}),false);
 assert.equal(dshPluginUiMessage({...base,type:'unmounted'},{botName:'alpha',viewKey:base.viewKey,source,expectedSource:source,origin:'https://ziwei.test',expectedOrigin:'https://ziwei.test'}),false);
});

test('plugin UI iframe URL stays on the validated runtime profile path',()=>{
 const url=dshPluginUiRelayUrl({originPath:'/runtime/alpha/ui/',relayId:'relay-1',viewKey:'v'.repeat(16)});
 assert.equal(url,'/runtime/alpha/ui/?dshPluginUiRelay=relay-1&viewKey='+ 'v'.repeat(16));
 assert.throws(()=>dshPluginUiRelayUrl({originPath:'/runtime/../ui/'}));
 assert.equal(dshPluginUiBotName({runtime_profile:'alpha',name:'Other'}),'alpha');
});
