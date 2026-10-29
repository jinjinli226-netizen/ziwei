import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {consumeRuntimePrelaunchEvidence,markManagementPrelaunchFailure} from '../src/runtime-launch-evidence.mjs';
import * as runtime from '../src/runtime-adapters.mjs';

test('an absent Codex phone server never becomes an invalid enabled-only transport', () => {
  const invocation = { args: ['exec', '--json', '-'], stdin: 'only the current user request' };
  for (const codexMcpServers of [[], ['another-server']]) {
    const launch = runtime.prepareTerminalMcpLaunch({ runtime: 'Codex', invocation, codexMcpServers, env: {
      ZIWEI_TERMINAL_TOKEN_FILE: '/host/another-execution.json', ZIWEI_CONTROL_AUTH: 'host-admin-secret',
    } });
    assert.deepEqual(launch.invocation.args, invocation.args, 'no native transport means there is nothing to disable');
    assert.equal(launch.invocation.stdin, invocation.stdin);
    assert.equal(launch.env.ZIWEI_CONTROL_AUTH, undefined);
    assert.equal(launch.env.ZIWEI_TERMINAL_TOKEN_FILE, undefined);
    assert.equal(launch.receipt, null);
  }
  assert.deepEqual(invocation.args, ['exec', '--json', '-']);
});

test('native Codex MCP inventory uses the exact CLI HOME profile and cwd, returning only existing transport names', t => {
  const binary = path.resolve('fixture-codex.exe'), cwd = path.resolve('fixture-workdir');
  const env = { CODEX_HOME: path.resolve('fixture-codex-home'), PATH: 'fixture-only' };
  const rows = [
    {name:'ziwei-terminal',enabled:true,transport:{type:'stdio',command:'native-command',env:{PRIVATE:'must-stay-local'}}},
    {name:'key.with.dot',enabled:false,transport:{type:'streamable_http',url:'https://example.test/mcp',http_headers:{Authorization:'private-native-header'}}},
  ];
  let observed;
  t.mock.method(childProcess, 'execFileSync', (command, args, options) => { observed = {command,args,options};return JSON.stringify(rows); });
  syncBuiltinESMExports();t.after(() => {t.mock.restoreAll();syncBuiltinESMExports();});
  const names = runtime.discoverCodexMcpServers({binary,profile:'office',cwd,env});
  assert.deepEqual(names,['ziwei-terminal','key.with.dot']);assert.equal(Object.isFrozen(names),true);
  assert.deepEqual(observed,{command:binary,args:['--profile','office','mcp','list','--json'],options:{cwd,env,encoding:'utf8',timeout:5000,maxBuffer:1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']}});
  assert.doesNotMatch(JSON.stringify(names), /PRIVATE|must-stay-local|private-native-header|http_headers/);
});

test('failed or malformed native MCP inventory carries owned no-model-launch proof without leaking native configuration', t => {
  const raw = Object.assign(new Error('private-native-header'), {stdout:'private-env-value',stderr:'private-native-header'});
  let output = raw;
  t.mock.method(childProcess, 'execFileSync', () => {if(output instanceof Error)throw output;return JSON.stringify(output);});
  syncBuiltinESMExports();t.after(() => {t.mock.restoreAll();syncBuiltinESMExports();});
  for (const fixture of [raw, {}, [{name:'missing-transport'}], [{name:'dup',transport:{type:'stdio',command:'node'}},{name:'dup',transport:{type:'stdio',command:'node'}}]]) {
    output = fixture;let error;
    try {runtime.discoverCodexMcpServers({binary:path.resolve('fixture-codex.exe'),cwd:path.resolve('.'),env:{}});} catch(caught) {error=caught;}
    assert.equal(error?.code,'CODEX_MCP_CONFIG_DISCOVERY_FAILED');
    assert.doesNotMatch(error.message+JSON.stringify(error),/private-native-header|private-env-value|stdout|stderr/);
    const proof=consumeRuntimePrelaunchEvidence(error);assert.equal(proof.prelaunch.source,'codex-mcp-config-discovery');
    assert.equal(proof.processExit.launched,false);assert.equal(proof.processExit.treeConfirmed,true);
    assert.equal(consumeRuntimePrelaunchEvidence(error),null);
  }
  assert.equal(consumeRuntimePrelaunchEvidence(Object.assign(new Error('wire error'),{code:'CODEX_MCP_CONFIG_DISCOVERY_FAILED',processExit:{launched:false},prelaunch:{source:'codex-mcp-config-discovery'}})),null);
});

test('management MCP preflight failure carries trusted no-model-launch proof', () => {
  const error=markManagementPrelaunchFailure(new Error('management bootstrap failed'), {
    actionId:'action_management_preflight',workspace:'bigtron',deviceId:'device_current',employeeId:'employee_probe',conversationId:'conv_probe',
  });
  const proof=consumeRuntimePrelaunchEvidence(error);
  assert.equal(proof.prelaunch.source,'management-mcp-preflight');
  assert.equal(proof.prelaunch.spawnAttempted,false);
  assert.equal(proof.processExit.launched,false);
  assert.equal(proof.processExit.rootPid,null);
  assert.equal(proof.processExit.treeConfirmed,true);
  assert.equal(proof.processExit.activeProcesses,0);
  assert.equal(consumeRuntimePrelaunchEvidence(error),null);
});

test('existing native stdio and HTTP phone transports are disabled without replacing their transport', t => {
  let rows;
  t.mock.method(childProcess, 'execFileSync', () => JSON.stringify(rows));
  syncBuiltinESMExports();t.after(() => {t.mock.restoreAll();syncBuiltinESMExports();});
  for (const transport of [{type:'stdio',command:'native-stdio'},{type:'streamable_http',url:'https://example.test/mcp'}]) {
    rows=[{name:'ziwei-terminal',enabled:true,transport}];
    const codexMcpServers=runtime.discoverCodexMcpServers({binary:path.resolve('fixture-codex.exe'),cwd:path.resolve('.'),env:{}});
    const launch=runtime.prepareTerminalMcpLaunch({runtime:'Codex',codexMcpServers,invocation:{args:['exec','-']},env:{ZIWEI_CONTROL_AUTH:'host-admin-secret'}});
    assert.deepEqual(launch.invocation.args,['exec','--config','mcp_servers.ziwei-terminal.enabled=false','-']);
    assert.equal(launch.env.ZIWEI_CONTROL_AUTH,undefined);assert.equal(launch.receipt,null);
  }
});

test('trusted native disable policy filters absent servers while retaining literal dotted names', () => {
  assert.deepEqual(runtime.codexMcpDisabledServerOverrides(['missing-server'],[]),[]);
  assert.deepEqual(runtime.codexMcpDisabledServerOverrides([],['native-server']),[]);
  assert.deepEqual(runtime.codexMcpDisabledServerOverrides(['key.with.dot','missing-server','key.with.dot','native-server'],['key.with.dot','native-server','unrelated']),
    ['--config','mcp_servers={"key.with.dot"={enabled=false},"native-server"={enabled=false}}']);
  for (const invalid of [null,'native-server',['bad\nname'],[''],[123]]) assert.throws(()=>runtime.codexMcpDisabledServerOverrides(invalid,['native-server']),/安全的服务名/);
});
