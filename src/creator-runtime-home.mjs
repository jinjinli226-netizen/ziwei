import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseDocument } from 'yaml';
import { stringify as stringifyYaml } from 'yaml';
import { redactSecrets } from './redaction.mjs';

const TEMPLATE_ID = 'ziwei-employee-creator';
export const CREATOR_RUNTIME_ENV_KEYS = ['ZIWEI_CREATOR_HOME', 'ZIWEI_CREATOR_SOURCE_HOME', 'ZIWEI_CREATOR_KEY', 'ZIWEI_CREATOR_WORKSPACE', 'ZIWEI_CREATOR_EMPLOYEE_ID', 'ZIWEI_CREATOR_PROFILE'];

function failure(code, message) { const error = new Error(message); error.code = code; return error; }
function apiOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)
      || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
    return url.origin;
  } catch { throw failure('creator_instance_invalid', 'Creator 实例 API 地址无效；不会读取其他工作区状态'); }
}
function readConfig(file) {
  try {
    const document = parseDocument(fs.readFileSync(file, 'utf8'));
    const config = document.toJSON();
    if (document.errors.length || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error();
    return { text: document.toString(), config };
  } catch { throw failure('creator_config_invalid', 'Creator 所选 profile 或实例配置无效；未修改原配置'); }
}
function validateProvider(config) {
  if (String(config.model?.provider || config.provider || '') !== 'openai-codex') throw failure('creator_provider_unsupported', 'Creator Hermes 实例隔离目前仅支持已核实的 openai-codex 原生认证路径；请保留所选 profile 并更新适配器');
  if (String(config.memory?.provider || '').trim()) throw failure('creator_memory_provider_unsupported', 'Creator Hermes 外部 memory provider 尚未验证实例 namespace 隔离；请配置本地记忆或提供受支持的独立 namespace');
}
function effectiveModel(source, explicitModel) {
  const value = explicitModel ?? source.model?.default;
  if (typeof value !== 'string' || !value.trim() || value.length > 200 || /\$\{|[\r\n]/.test(value)) throw failure('creator_model_config_unsupported', 'Creator 缺少可核实的默认或显式 model；请设置明确 model，未复制配置');
  return value;
}
function initialConfig(model) {
  // Explicit data whitelist: auth/other providers/MCP env/headers/.env never
  // enter the persistent state home. Managed policy remains a native overlay.
  return stringifyYaml({ model: { provider: 'openai-codex', default: model }, memory: { provider: '', memory_enabled: true, user_profile_enabled: true } });
}
function refuseSymlink(target) {
  let stats; try { stats = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stats.isSymbolicLink()) throw failure('creator_home_invalid', 'Creator 实例目录或文件指向外部路径；已拒绝覆盖');
}
function atomicPrivateWrite(file, text) {
  refuseSymlink(file);
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); if (process.platform !== 'win32') fs.chmodSync(file, 0o600); }
  finally { try { fs.unlinkSync(temporary); } catch {} }
}

/** Persistent employee state only. Authentication is never copied or linked into this home. */
export function prepareCreatorRuntimeHome({ context, sourceHome, profile = 'default', privateDirectory, workspace, apiBase, model = null } = {}) {
  if (context?.templateId !== TEMPLATE_ID) return null;
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(context.workspace || '') || context.workspace !== workspace) throw failure('creator_instance_invalid', 'Creator 实例工作区与当前连接不一致');
  if (!/^employee_[A-Za-z0-9_-]{1,100}$/.test(context.employeeId || '')) throw failure('creator_instance_invalid', 'Creator 实例需要有效员工 ID');
  const origin = apiOrigin(context.apiBase);
  if (origin !== apiOrigin(apiBase)) throw failure('creator_instance_invalid', 'Creator 实例 API 地址与当前连接不一致');
  if (!sourceHome || !privateDirectory || !path.isAbsolute(sourceHome) || !path.isAbsolute(privateDirectory)) throw failure('creator_home_invalid', 'Creator 实例缺少绝对本机私有目录或所选 profile');
  const source = fs.realpathSync.native(sourceHome);
  const sourceConfig = readConfig(path.join(source, 'config.yaml')); validateProvider(sourceConfig.config);
  const resolvedModel = effectiveModel(sourceConfig.config, model);
  const seedConfig = initialConfig(resolvedModel);
  const key = createHash('sha256').update(JSON.stringify([origin, workspace, context.employeeId])).digest('hex');
  const parent = path.resolve(privateDirectory); refuseSymlink(parent);
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  const home = path.join(parent, key); refuseSymlink(home);
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  if (fs.realpathSync.native(home) === source || !fs.realpathSync.native(home).startsWith(`${fs.realpathSync.native(parent)}${path.sep}`)) throw failure('creator_home_invalid', 'Creator 实例必须位于独立私有目录');
  const metadataFile = path.join(home, 'ziwei-instance.json'); refuseSymlink(metadataFile);
  const binding = { version: 1, templateId: TEMPLATE_ID, key, origin, workspace, employeeId: context.employeeId, sourceHome: source, sourceProfile: profile || 'default', provider: 'openai-codex' };
  if (fs.existsSync(metadataFile)) {
    let previous; try { previous = JSON.parse(fs.readFileSync(metadataFile, 'utf8')); } catch {}
    if (JSON.stringify(previous) !== JSON.stringify(binding)) throw failure('creator_home_binding_conflict', 'Creator 实例已绑定另一个 source profile；需要明确迁移，未替换认证或记忆');
  } else {
    if (fs.readdirSync(home).length) throw failure('creator_home_binding_conflict', 'Creator 实例目录缺少可信绑定；未覆盖既有状态');
    atomicPrivateWrite(path.join(home, 'config.yaml'), seedConfig);
    atomicPrivateWrite(metadataFile, `${JSON.stringify(binding)}\n`);
  }
  refuseSymlink(path.join(home, 'config.yaml'));
  for (const relative of ['memories', 'memories/MEMORY.md', 'memories/USER.md', 'state.db', 'state.db-wal', 'state.db-shm', 'sessions', 'logs', 'SOUL.md']) refuseSymlink(path.join(home, relative));
  validateProvider(readConfig(path.join(home, 'config.yaml')).config);
  if (fs.existsSync(path.join(home, 'auth.json')) || fs.existsSync(path.join(home, '.env'))) throw failure('creator_home_invalid', 'Creator 实例中出现复制的认证或环境文件；已拒绝使用');
  const soul = redactSecrets([context.description, context.persona, context.instructions].map(value => String(value || '').trim()).filter(Boolean).join('\n\n'));
  if (!soul) throw failure('creator_role_missing', 'Creator 实例缺少已保存的职责、人格和工作指令');
  if (Buffer.byteLength(soul) > 256 * 1024) throw failure('creator_role_invalid', 'Creator 实例角色内容过大；未改写 SOUL');
  refuseSymlink(path.join(home, 'SOUL.md'));
  if (!fs.existsSync(path.join(home, 'SOUL.md')) || fs.readFileSync(path.join(home, 'SOUL.md'), 'utf8') !== `${soul}\n`) atomicPrivateWrite(path.join(home, 'SOUL.md'), `${soul}\n`);
  return { home, sourceHome: source, key, effectiveModel: resolvedModel, env: { ZIWEI_CREATOR_HOME: home, ZIWEI_CREATOR_SOURCE_HOME: source, ZIWEI_CREATOR_KEY: key, ZIWEI_CREATOR_WORKSPACE: workspace, ZIWEI_CREATOR_EMPLOYEE_ID: context.employeeId, ZIWEI_CREATOR_PROFILE: profile || 'default' }, receipt: { enabled: true, key, workspace, employeeId: context.employeeId, sourceProfile: profile || 'default', authMode: 'source-native-store' } };
}
