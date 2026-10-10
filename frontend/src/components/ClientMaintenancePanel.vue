<script setup>
import {ref} from 'vue';
const copied=ref('');
const instructions=[
  {id:'update',title:'更新已安装的客户端',command:'ziwei_user update',description:'从官方固定地址下载并校验版本，保留原安装位置与工作区连接。更新在包目录之外继续执行，最后结果请用下一条命令查询。'},
  {id:'update-status',title:'查看更新结果',command:'ziwei_user update-status --json',description:'读取真实更新结果；命令已接受不等于更新已完成。'},
  {id:'legacy-update',title:'旧版没有 update 或 stop 命令',command:'irm https://qzelynth.top/downloads/cli/update-windows.ps1 | iex',description:'在目标 Windows 电脑的 PowerShell 中运行官方升级入口。它校验官方包并更新原安装，不生成配对码，不需要重新 connect。'},
  {id:'stop',title:'停止这台电脑的客户端',command:'ziwei_user stop',description:'停止当前安装对应的 ziwei_user。停止后电脑显示离线，已有工作区连接和用户数据保留；恢复时运行 ziwei_user start。'},
  {id:'uninstall',title:'卸载客户端',command:'ziwei_user uninstall',description:'卸载当前客户端，默认保留用户数据、连接配置和记忆；不删除网页上的工作区、员工或业务记录。remove 是同一命令的别名。'}
];
async function copy(item){await navigator.clipboard.writeText(item.command);copied.value=item.id;}
</script>

<template>
  <section class="client-maintenance-panel" data-testid="client-maintenance-panel">
    <p class="modal-copy">本轮维护命令先支持 Windows。请在需要维护的那台 Windows 电脑上运行；这里展示命令，不会从网页执行设备动作。已有 macOS 连接保持不变。</p>
    <section v-for="item in instructions" :key="item.id" class="device-install-command" :data-testid="`client-maintenance-${item.id}`">
      <div class="device-install-command-head"><strong>{{item.title}}</strong><button type="button" class="pill" @click="copy(item)">{{copied===item.id?'已复制':'复制命令'}}</button></div>
      <pre>{{item.command}}</pre><p class="modal-copy">{{item.description}}</p>
    </section>
    <p class="modal-copy">第一次安装仍使用官方包：<code>npm install --global "https://qzelynth.top/downloads/cli/ziwei-latest.tgz"</code>。只有首次连接或主动连接其他工作区时，才使用“添加设备”中的 connect 配对流程。</p>
  </section>
</template>

<style scoped>
.client-maintenance-panel {display:grid;gap:16px;min-width:0;}
.client-maintenance-panel pre,.client-maintenance-panel code {white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;}
.client-maintenance-panel .modal-copy {margin:0;font-size:12px;line-height:1.7;}
</style>
