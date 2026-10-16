const stages = {
  native_imports: '加载 Hermes 组件', read_request: '读取创建请求', identity: '核对 Bot 身份', reasoning: '检查推理配置',
  source: '读取初始化来源', target: '准备 Profile 目录', create_staging: '创建临时目录',
  native_bootstrap: '初始化原生 Profile', native_layout: '生成原生目录结构',
  write_config: '写入配置', write_soul: '写入身份说明', write_profile: '写入 Profile 信息',
  write_metadata: '写入归属记录', create_parent: '创建 Profile 父目录', publish: '保存 Profile 目录', verify: '检查创建结果',
  receipt: '生成创建回执', cleanup: '清理临时目录'
};
const exceptions = new Set(['PermissionError','FileNotFoundError','FileExistsError','NotADirectoryError','IsADirectoryError','OSError','ImportError','ModuleNotFoundError','AttributeError','TypeError','ValueError','KeyError','RuntimeError','UnicodeDecodeError','UnicodeEncodeError','JSONDecodeError','AssertionError','RecursionError','MemoryError','RepresenterError','ParserError','ScannerError','ReaderError','OtherError']);
const sourceFunctions = new Set(['provision','_provision','verify','_bootstrap_profile_dir','_finish_profile_layout','_seed_model_config','_seed_file_if_missing','_migrate_profile_config_if_outdated','_get_profiles_root','_get_default_hermes_home','get_profile_dir','profile_exists','run','read_request']);

// Native diagnostic metadata is projected again at the JS boundary. Never use
// the exception message, request, environment or full path as a public error.
export function safeProfileProvisionDiagnostic(value) {
  if (!value || value.schemaVersion !== 1 || !Object.hasOwn(stages,value.stage) || !exceptions.has(value.exception)) return null;
  const result={schemaVersion:1,stage:value.stage,exception:value.exception};
  for(const [key,max] of [['errno',255],['winerror',65535]]) if(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=max)result[key]=value[key];
  if(value.cleanupFailed===true)result.cleanupFailed=true;
  const source=value.source;
  if(source&&['hermes-owned-profile.py','hermes-mcp-bootstrap.py','profiles.py'].includes(source.file)&&sourceFunctions.has(source.function)&&Number.isSafeInteger(source.line)&&source.line>0&&source.line<=100000)result.source={file:source.file,function:source.function,line:source.line};
  return result;
}

export function profileProvisionFailure(receipt) {
  const code=typeof receipt?.code==='string'&&/^BOT_PROFILE_[A-Z0-9_]{1,64}$/.test(receipt.code)?receipt.code:'BOT_PROFILE_PROVISION_FAILED';
  const diagnostic=safeProfileProvisionDiagnostic(receipt?.diagnostic);
  if(!diagnostic)return {code,error:code};
  const detail=diagnostic.winerror===32||diagnostic.winerror===33?'文件或目录正在被占用；关闭占用该目录的程序后重试'
    :diagnostic.winerror===5||diagnostic.errno===13||diagnostic.exception==='PermissionError'?'目录访问被拒绝；检查当前 Windows 用户对 Hermes 目录的读写权限'
    :diagnostic.winerror===112||diagnostic.errno===28?'磁盘空间不足；释放空间后重试'
    :diagnostic.winerror===206||diagnostic.errno===36?'目录路径过长；需要缩短 Hermes 的安装或工作目录'
    :diagnostic.exception==='FileNotFoundError'?'所需文件或目录不存在；检查 Hermes 安装及所选初始化来源'
    :['ImportError','ModuleNotFoundError'].includes(diagnostic.exception)?'Hermes 组件加载失败；需要检查其安装依赖'
    :diagnostic.exception==='FileExistsError'?'目标目录已存在；需要核对其归属，不能覆盖'
    :'已保留具体失败阶段和异常类型，可据此继续排查';
  const system=diagnostic.winerror!==undefined?`，Windows ${diagnostic.winerror}`:diagnostic.errno!==undefined?`，errno ${diagnostic.errno}`:'';
  return {code,diagnostic,error:`创建独立 Profile 失败：${stages[diagnostic.stage]}（${diagnostic.exception}${system}）。${detail}。${code}`};
}
