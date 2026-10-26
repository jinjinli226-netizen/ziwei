<script setup>
import {computed,inject,onBeforeUnmount,reactive,ref,unref,watch} from 'vue';
import {api,API_BASE} from '../api.js';
import NativeOperationStatus from './NativeOperationStatus.vue';
import {nativeReceipt} from '../bot-native-transport.js';
import {buildMcpServer,mcpServerForm,viralMcpPreset,nativeValue,nativeMcpTools} from '../bot-native-data.js';
import {createMcpConnections,mcpAuthorizationUrl,mcpConnectionActive,mcpConnectionLabel,sameMcpServer} from '../bot-mcp-connections.js';
const props=defineProps({ui:{type:Object,required:true},bot:{type:Object,required:true},draft:{type:Object,required:true},enabled:Boolean,configBusy:Boolean});
const emit=defineEmits(['save-config']);
const actorId=inject('bot-native-actor-id',ref(''));
const connections=createMcpConnections({api,wrap:reactive,namespace:API_BASE});
const connectionState=connections.state;
const editor=ref(false),editingName=ref(''),form=ref({}),error=ref(''),serverName=ref(''),toolName=ref(''),argumentsText=ref('{}');
const state=computed(()=>props.ui.resource('mcp')),servers=computed(()=>props.draft.config.mcpServers||{}),evidence=computed(()=>nativeValue(state.value.data));
const tools=computed(()=>{
  const connected=connectionFor(serverName.value);
  if(connectionCurrent(connected)&&connected.status==='connected'&&Array.isArray(connected.tools))return nativeMcpTools(connected);
  return evidence.value?.server===serverName.value?nativeMcpTools(state.value.data):[];
});
const callResult=computed(()=>{const receipt=nativeReceipt({result:state.value.result});return receipt?.operation==='call'?receipt.data:null;});
const remote=server=>Boolean(server?.url)&&server.transport!=='stdio';
const saved=name=>sameMcpServer(servers.value[name],props.bot.config?.mcpServers?.[name]);
const connectionFor=name=>connectionState.connections[name];
const connectionCurrent=row=>Boolean(row)&&row.revision===props.bot.revision&&row.controlEpoch===props.bot.control_epoch&&(!props.bot.employee?.target_device_id||row.deviceId===props.bot.employee.target_device_id)&&(!props.bot.instance?.profile||row.profile===props.bot.instance.profile);
const authorizationLink=name=>{const row=connectionFor(name);return saved(name)&&connectionCurrent(row)&&row.status==='authorization_required'?mcpAuthorizationUrl(row.authorizationUrl):'';};
function label(name){const row=connectionFor(name);if(connectionState.pending[name])return '正在确认原连接';if(!saved(name))return '待保存';if(row&&!connectionCurrent(row))return '配置已更新，需重新检查';return mcpConnectionLabel(row);}
function edit(name=''){
  editingName.value=name;form.value=mcpServerForm(name,servers.value[name]||{transport:'http',auth:'oauth'});error.value='';editor.value=true;
}
function preset(){if(servers.value.viral_library){edit('viral_library');return;}editingName.value='';form.value=viralMcpPreset();error.value='';editor.value=true;}
function apply(){try{const name=form.value.name.trim();if(!/^[a-z][a-z0-9_-]{0,63}$/.test(name)||name.startsWith('ziwei'))throw new Error('请使用小写 MCP 名称，紫薇保留名称不可编辑');if(!editingName.value&&Object.hasOwn(servers.value,name))throw new Error('已有同名 MCP，请使用编辑入口');props.draft.config.mcpServers[name]=buildMcpServer(form.value,servers.value[editingName.value]||{});serverName.value=name;editor.value=false;error.value='';}catch(value){error.value=value.message;}}
function remove(name){if(window.confirm('从此 Bot 的配置草稿移除 MCP '+name+'？'))delete props.draft.config.mcpServers[name];}
async function connect(name){if(!props.enabled||props.configBusy||!saved(name)||servers.value[name]?.enabled===false||!remote(servers.value[name]))return;serverName.value=name;await connections.connect(name,{revision:props.bot.revision,controlEpoch:props.bot.control_epoch});}
async function call(){try{const args=JSON.parse(argumentsText.value);if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('工具参数须为 JSON 对象');error.value='';await props.ui.submit('mcp','call',{server:serverName.value,tool:toolName.value,arguments:args});}catch(value){error.value=value.message;}}
watch([()=>props.ui.state.workspace,()=>props.bot.id,()=>unref(actorId),()=>props.enabled],([workspace,botId,actor,enabled])=>{
  editor.value=false;error.value='';serverName.value='';toolName.value='';argumentsText.value='{}';
  connections.select(enabled?{workspace,botId,actorId:actor}:null);
},{immediate:true});
watch(serverName,()=>{toolName.value='';argumentsText.value='{}';});
onBeforeUnmount(()=>connections.dispose());
</script>
<template>
  <section id="employee-mcp-management" tabindex="-1" class="native-section mcp-section" aria-label="MCP 与工具">
    <p class="native-help">能力明细中的“已配置”不等于已授权或本轮已加载；连接和实际工具检查仍使用下方原入口。</p>
    <div class="native-toolbar"><div><h3>MCP 与工具</h3><p class="native-help">连接外部服务，让这位员工使用它的工具。</p></div><div class="native-actions mcp-toolbar-actions"><button class="bot-button" :disabled="!enabled||configBusy" @click="preset">添加爆款库</button><button class="bot-button primary" :disabled="!enabled||configBusy" @click="edit()">添加 MCP</button></div></div>
    <div v-if="!Object.keys(servers).length" class="native-empty">还没有添加 MCP 服务。</div>
    <div class="native-list">
      <article v-for="(server,name) in servers" :key="name" class="mcp-server">
        <div class="mcp-server-heading"><div><strong>{{name}}</strong><small>{{server.transport||(server.url?'http':'stdio')}} · {{server.auth==='oauth'?'OAuth 授权':remote(server)?'环境引用':'本机进程'}}<span v-if="server.enabled===false"> · 已停用</span></small><small class="mcp-address">{{server.url||server.command}}</small></div><div class="native-actions mcp-toolbar-actions"><button class="bot-button" :disabled="configBusy" @click="edit(name)">编辑</button><button class="bot-button danger" :disabled="configBusy" @click="remove(name)">移除</button></div></div>
        <div v-if="remote(server)" class="mcp-connection-row">
          <div class="mcp-connection-copy" aria-live="polite"><span class="mcp-status" :class="{'connected':saved(name)&&connectionCurrent(connectionFor(name))&&connectionFor(name)?.status==='connected','waiting':mcpConnectionActive(connectionFor(name))}">{{label(name)}}</span><span v-if="saved(name)&&connectionCurrent(connectionFor(name))&&connectionFor(name)?.status==='connected'" class="native-help">{{connectionFor(name).toolsCount??connectionFor(name).tools?.length??0}} 个工具 · 下次员工执行时加载</span><span v-if="!saved(name)" class="native-help">先保存配置，再连接。</span></div>
          <div class="native-actions mcp-toolbar-actions"><a v-if="authorizationLink(name)" class="bot-button primary" :href="authorizationLink(name)" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">前往授权</a><button class="bot-button" :disabled="!enabled||configBusy||!saved(name)||server.enabled===false||connectionState.busy[name]" @click="connect(name)">{{connectionState.busy[name]?'正在检查…':connectionState.pending[name]?'检查原连接':mcpConnectionActive(connectionFor(name))?'检查连接':connectionFor(name)?.status==='connected'?'检查连接':'连接'}}</button><button v-if="mcpConnectionActive(connectionFor(name))&&!connectionState.pending[name]" class="bot-button" :disabled="connectionState.busy[name]" @click="connections.cancel(name)">取消连接</button></div>
        </div>
        <p v-if="connectionState.errors[name]||connectionFor(name)?.error" class="native-error" role="alert">{{connectionState.errors[name]||connectionFor(name)?.error}}</p>
      </article>
    </div>
    <p v-if="connectionState.error" class="native-error" role="alert">{{connectionState.error}} <button class="bot-link" :disabled="connectionState.loading" @click="connections.refresh()">重试读取</button></p>
    <form v-if="editor" class="mcp-editor native-fields native-grid" @submit.prevent="apply">
      <label>MCP 名称<input v-model="form.name" :disabled="Boolean(editingName)" maxlength="64" required/></label>
      <label>连接方式<select v-model="form.transport"><option value="http">HTTP</option><option value="sse">SSE</option><option value="stdio">标准输入输出</option></select></label>
      <template v-if="form.transport==='stdio'"><label class="wide">命令<input v-model="form.command" placeholder="例如 node" required/></label><label class="wide">参数（每行一个）<textarea v-model="form.argsText" rows="3"/></label></template>
      <template v-else><label class="wide">MCP 地址<input v-model="form.url" type="url" placeholder="https://..." required/></label><label>认证方式<select v-model="form.auth"><option value="oauth">OAuth · 浏览器授权</option><option value="header">环境变量引用 / 无认证</option></select></label><label v-if="form.auth==='oauth'">授权范围（scope）<input v-model="form.oauthScope" maxlength="4000" placeholder="由服务提供，例如 library:read"/></label><label v-else class="wide">HTTP header 引用<textarea v-model="form.headersText" rows="2" placeholder="Authorization=MY_AUTH_HEADER（无认证可留空）"/></label></template>
      <details class="native-advanced wide"><summary>高级设置</summary><div class="native-fields native-grid">
        <template v-if="form.transport!=='stdio'&&form.auth==='oauth'"><label>客户端元数据发现（CIMD）<select v-model="form.oauthCimd"><option v-if="form.oauthCimd===undefined" :value="undefined">默认</option><option :value="true">启用</option><option :value="false">关闭</option></select></label><label class="wide">额外 HTTP header 引用<textarea v-model="form.headersText" rows="2" placeholder="X-Team=MY_TEAM（OAuth 不使用 Authorization 引用）"/></label></template>
        <label class="wide">环境变量引用<textarea v-model="form.envText" rows="2" placeholder="API_KEY=MY_LOCAL_API_KEY"/></label>
        <label>允许工具（每行一个）<textarea v-model="form.includeText" rows="2"/></label><label>排除工具（每行一个）<textarea v-model="form.excludeText" rows="2"/></label>
        <label>并行工具调用<select v-model="form.supportsParallelToolCalls"><option v-if="form.supportsParallelToolCalls===undefined" :value="undefined">默认</option><option :value="true">启用</option><option :value="false">关闭</option></select></label><label>读取资源（resources）<select v-model="form.resources"><option v-if="form.resources===undefined" :value="undefined">默认</option><option :value="true">启用</option><option :value="false">关闭</option></select></label><label>提示模板（prompts）<select v-model="form.prompts"><option v-if="form.prompts===undefined" :value="undefined">默认</option><option :value="true">启用</option><option :value="false">关闭</option></select></label>
        <label>调用超时（秒）<input v-model="form.timeout" type="number" min="1" max="120"/></label><label>连接超时（秒）<input v-model="form.connectTimeout" type="number" min="1" max="60"/></label>
      </div></details>
      <label class="inline-check wide"><input v-model="form.enabled" type="checkbox"/>启用此 MCP</label><div class="native-actions wide"><button type="submit" class="bot-button primary" :disabled="configBusy">加入配置草稿</button><button type="button" class="bot-button" @click="editor=false">取消</button></div>
    </form>
    <p v-if="error" role="alert" class="native-error">{{error}}</p>
    <div class="native-actions"><button class="bot-button primary" :disabled="!enabled||configBusy" @click="emit('save-config')">保存配置</button><button class="bot-button" :disabled="!enabled||connectionState.loading" @click="connections.refresh()">{{connectionState.loading?'正在读取连接…':'刷新连接状态'}}</button></div>
    <details class="native-advanced mcp-tool-check"><summary>查看与测试工具</summary><div class="native-fields native-grid"><label>服务名称<select v-model="serverName"><option value="">选择此 Bot 的 MCP</option><option v-for="(_,name) in servers" :key="name" :value="name">{{name}}</option></select></label><label>工具名称<input v-model="toolName" list="native-mcp-tools"/><datalist id="native-mcp-tools"><option v-for="tool in tools" :key="tool.name" :value="tool.name"/></datalist></label><label class="wide">工具参数 JSON<textarea v-model="argumentsText" rows="4"/></label></div><div class="native-actions"><button class="bot-button" :disabled="!enabled||state.loading||!serverName||!saved(serverName)" @click="ui.read('mcp',{server:serverName})">检查实际 MCP 加载</button><button class="bot-button" :disabled="!enabled||ui.blocked()||bot.control_state!=='active'||bot.config.permissions.mode!=='execute'||!serverName||!saved(serverName)||!toolName" @click="call">调用所选工具</button></div>
      <div v-if="tools.length" class="native-list"><article v-for="tool in tools" :key="tool.name" class="native-list-row"><div><strong>{{tool.name}}</strong><p>{{tool.description}}</p><details><summary>工具参数定义</summary><pre class="native-record">{{JSON.stringify(tool.parameters,null,2)}}</pre></details></div></article></div><div v-if="callResult" class="native-record" aria-label="MCP 工具返回"><strong>工具返回</strong><pre>{{JSON.stringify(callResult.result??callResult,null,2)}}</pre></div><p v-if="evidence?.reason" class="native-help">{{evidence.reason}}</p><NativeOperationStatus :state="state" @poll="ui.poll('mcp')" @recover="ui.recover('mcp')"/>
    </details>
  </section>
</template>
<style scoped>
.mcp-toolbar-actions{margin-top:0;align-items:center}.mcp-server{border:1px solid var(--bot-line);border-radius:12px;padding:16px;min-width:0}.mcp-server-heading,.mcp-connection-row{display:flex;gap:16px;justify-content:space-between;align-items:center;flex-wrap:wrap}.mcp-server-heading>div:first-child{min-width:0;flex:1}.mcp-server strong{font-size:13px;overflow-wrap:anywhere}.mcp-server small{display:block;font-size:11px;line-height:1.8;color:var(--bot-muted)}.mcp-address{overflow-wrap:anywhere}.mcp-connection-row{margin-top:14px;padding-top:12px;border-top:1px solid var(--bot-line)}.mcp-connection-copy{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.mcp-status{font-size:11px;border-radius:6px;background:#f1edf7;color:#746384;padding:4px 8px}.mcp-status.connected{background:#e8f6ef;color:#29764d}.mcp-status.waiting:not(.connected){background:#fdf3de;color:#886822}.mcp-server .bot-button{text-decoration:none}.mcp-editor{padding:18px;margin-top:16px;border:1px solid var(--bot-line);background:#fcfaff;border-radius:12px}.mcp-editor details{margin-top:0}.mcp-tool-check{border-top:1px solid var(--bot-line);padding-top:14px}.mcp-section summary{cursor:pointer}.mcp-server .native-error{margin-bottom:0;overflow-wrap:anywhere}@media(max-width:600px){.mcp-server-heading{align-items:flex-start}.mcp-server-heading>div:first-child{flex-basis:100%}.mcp-editor{padding:12px}}
</style>
