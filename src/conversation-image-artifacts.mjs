import fs from 'node:fs';
import path from 'node:path';

export const MAX_CONVERSATION_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_ACTION_RESULT_JSON_BYTES = 15 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_OUTPUT_IMAGES = 20;
const failure = message => Object.assign(new Error(message), {code:'image_artifact_invalid'});
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const sameFile = (a,b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

export function imageMimeType(bytes) {
  // Match the server raster boundary: header, dimensions where available and
  // trailer/container size, rather than accepting a signature-only file.
  if (bytes.length >= 45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0 && bytes.toString('ascii',bytes.length-8,bytes.length-4) === 'IEND') return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length-2] === 255 && bytes[bytes.length-1] === 217) return 'image/jpeg';
  if (bytes.length >= 14 && ['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)) && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0 && bytes[bytes.length-1] === 59) return 'image/gif';
  if (bytes.length >= 20 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.readUInt32LE(4)+8 === bytes.length && bytes.toString('ascii',8,12) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16))) return 'image/webp';
  return null;
}

export function validateImageBytes(bytes, declaredMime = null) {
  if (!bytes.length || bytes.length > MAX_CONVERSATION_IMAGE_BYTES) throw failure('图片大小必须大于 0，且不能超过 10 MiB');
  const mimeType = imageMimeType(bytes);
  if (!mimeType) throw failure('图片格式或魔数无效；仅支持 PNG、JPEG、GIF、WebP');
  if (declaredMime && String(declaredMime).toLowerCase() !== mimeType) throw failure('图片 MIME 类型与实际格式不匹配');
  return mimeType;
}

export function createImageArtifactSession({runtimeDir, actionId, conversationId = null} = {}) {
  if (!runtimeDir || !String(actionId || '').trim()) throw failure('图片输出缺少本机目录或当前执行 ID');
  fs.mkdirSync(runtimeDir,{recursive:true});
  const canonicalRuntime = fs.realpathSync.native(runtimeDir);
  const base = path.join(canonicalRuntime,'image-output');
  try { fs.mkdirSync(base,{recursive:true}); } catch { throw failure('当前执行图片输出目录不可创建'); }
  const baseStat = fs.lstatSync(base);
  if (!baseStat.isDirectory() || baseStat.isSymbolicLink() || !inside(canonicalRuntime,fs.realpathSync.native(base))) throw failure('图片输出目录不能是符号链接或跨目录链接');
  const prefix = String(actionId).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64) || 'action';
  const directory = fs.mkdtempSync(path.join(base,`${prefix}-`));
  const manifestPath = path.join(directory,'manifest.json');
  const rootStat = fs.statSync(directory);
  return Object.freeze({directory,manifestPath,actionId:String(actionId),conversationId:conversationId ? String(conversationId) : null,rootDev:rootStat.dev,rootIno:rootStat.ino});
}

export function imageArtifactInstructions(session) {
  const example = {version:1,actionId:session.actionId,conversationId:session.conversationId,artifacts:[{path:'result.png',name:'result.png'}]};
  return `\n\n[本次执行的图片输出通道]\n若生成需要回传的图片，请将实际 PNG/JPEG/GIF/WebP 文件写入此独立目录：${session.directory}\n然后写 UTF-8 JSON 清单到：${session.manifestPath}\n清单格式：${JSON.stringify(example)}\npath 只能是此目录内文件的相对路径；version、actionId、conversationId 必须与示例一致。每张和所有图片合计最多 10 MiB。只回传清单声明的图片，不扫描其他目录。输入附件不是输出图片，不要把输入附件路径列入清单；需要修改图片时将结果另存本次输出目录。先完成图片文件，最后写清单。没有图片输出时无需创建清单。`;
}

function readDeclaredFile(session, relativePath, limit) {
  if (typeof relativePath !== 'string' || !relativePath.trim() || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || /[:\0]/.test(relativePath)) throw failure('图片输出路径必须是当前执行目录内的相对路径');
  const segments = relativePath.replace(/\\/g,'/').split('/');
  if (segments.some(part => !part || part === '.' || part === '..')) throw failure('图片输出路径不能包含目录外跳转');
  const root = fs.lstatSync(session.directory);
  if (!root.isDirectory() || root.isSymbolicLink() || root.dev !== session.rootDev || root.ino !== session.rootIno || fs.realpathSync.native(session.directory) !== session.directory) throw failure('当前执行图片目录已变化或是链接');
  let filename = session.directory;
  let initial;
  for (const [index,segment] of segments.entries()) {
    filename = path.join(filename,segment);
    try { initial = fs.lstatSync(filename); } catch { throw failure('清单声明的图片文件或目录不存在、不可读取'); }
    if (initial.isSymbolicLink()) throw failure('图片输出文件或目录不能是符号链接/跨目录链接');
    if (index < segments.length-1 && !initial.isDirectory()) throw failure('图片输出路径的中间节点不是目录');
  }
  if (!initial.isFile() || initial.nlink !== 1) throw failure('图片输出必须是独立普通文件，不能是硬链接');
  if (initial.size > limit) throw failure(limit === MAX_MANIFEST_BYTES ? '图片清单 manifest 不能超过 64 KiB' : '图片大小不能超过 10 MiB');
  if (!inside(session.directory,fs.realpathSync.native(filename))) throw failure('图片输出解析到当前执行目录之外');
  let fd;
  try {
    fd = fs.openSync(filename,fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW));
    if (!sameFile(initial,fs.fstatSync(fd))) throw failure('读取前图片文件已变化');
    const bytes = fs.readFileSync(fd);
    if (bytes.length > limit || !sameFile(initial,fs.fstatSync(fd)) || !sameFile(initial,fs.lstatSync(filename))) throw failure('读取过程中图片文件已变化或超过大小限制');
    return bytes;
  } catch (error) {
    if (error.code === 'image_artifact_invalid') throw error;
    throw failure('清单声明的图片文件不可安全读取');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export function readImageArtifacts(session) {
  try { fs.lstatSync(session.manifestPath); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw failure('图片清单 manifest 不可读取');
  }
  let manifest;
  try { manifest = JSON.parse(readDeclaredFile(session,'manifest.json',MAX_MANIFEST_BYTES).toString('utf8')); } catch (error) {
    if (error.code === 'image_artifact_invalid') throw error;
    throw failure('图片清单 manifest 必须是有效 UTF-8 JSON');
  }
  if (manifest?.version !== 1 || manifest.actionId !== session.actionId || (manifest.conversationId ?? null) !== session.conversationId) throw failure('图片清单 version、执行 ID 或会话 ID 与本次执行不匹配');
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length > MAX_OUTPUT_IMAGES) throw failure('图片清单 artifacts 必须是最多 20 个条目的数组');
  const output = [];const declared = new Set();let total = 0;
  for (const entry of manifest.artifacts) {
    if (!entry || typeof entry !== 'object' || typeof entry.path !== 'string') throw failure('图片清单条目缺少相对文件路径');
    const key = process.platform === 'win32' ? entry.path.replace(/\\/g,'/').toLowerCase() : entry.path;
    if (declared.has(key)) throw failure('图片清单不能重复声明同一个文件');
    declared.add(key);
    const bytes = readDeclaredFile(session,entry.path,MAX_CONVERSATION_IMAGE_BYTES);
    const mimeType = validateImageBytes(bytes,entry.mimeType);
    total += bytes.length;if (total > MAX_CONVERSATION_IMAGE_BYTES) throw failure('图片输出总大小不能超过 10 MiB');
    const name = path.win32.basename(String(entry.name || entry.path)).replace(/[\u0000-\u001f\u007f]/g,'_').slice(0,180) || `image-${output.length+1}`;
    output.push({name,mimeType,size:bytes.length,contentEncoding:'base64',content:bytes.toString('base64')});
  }
  return output;
}

export function imageArtifactEventResult(result) {
  if (!result || typeof result !== 'object') return result;
  const metadata = Array.isArray(result.outputArtifacts)
    ? {...result,outputArtifactCount:result.outputArtifacts.length,outputArtifacts:result.outputArtifacts.map(({name,mimeType,size})=>({name,mimeType,size}))}
    : result;
  return imageArtifactDeliveryBody({result:metadata},{maxBytes:128*1024}).result;
}

const jsonBytes = value => Buffer.byteLength(JSON.stringify(value),'utf8');
const truncationNotice = '\n[本次回传已截断：文本超过 JSON 大小预算；图片内容完整保留。]';
function safePrefix(text, length) {
  if (length > 0 && length < text.length && /[\uD800-\uDBFF]/.test(text[length-1]) && /[\uDC00-\uDFFF]/.test(text[length])) length--;
  return text.slice(0,length);
}

// Budget the exact upload envelope. Base64 bytes are never truncated. The
// runtime also calls this with reserve space; the daemon repeats it immediately
// before POST so JSON escaping, Unicode and envelope overhead are accounted for.
export function imageArtifactDeliveryBody(body, {maxBytes=MAX_ACTION_RESULT_JSON_BYTES} = {}) {
  if (jsonBytes(body) <= maxBytes) return body;
  if (!body?.result || typeof body.result !== 'object') throw failure('执行结果超过 JSON 回传大小预算');
  const result = {...body.result,truncated:true,truncationReason:'action_result_json_budget',truncationDetails:[]};
  const bounded = {...body,result};
  if (result.diagnostics !== undefined && result.diagnostics !== null) {
    result.diagnostics = null;result.truncationDetails.push('diagnostics_removed');
  }
  if (jsonBytes(bounded) <= maxBytes) return bounded;
  if (typeof result.output === 'string') {
    const original=result.output;result.truncationDetails.push('output_truncated');
    let low=0,high=original.length;
    result.output=truncationNotice;
    if (jsonBytes(bounded) <= maxBytes) {
      while (low < high) {
        const middle=Math.ceil((low+high)/2);
        result.output=safePrefix(original,middle)+truncationNotice;
        if (jsonBytes(bounded) <= maxBytes) low=middle;else high=middle-1;
      }
      result.output=safePrefix(original,low)+truncationNotice;
      return bounded;
    }
  }
  // Unexpected large metadata must produce a visible failure rather than an
  // endlessly retried HTTP 413. Preserve valid images in the minimal envelope.
  const minimal={status:'failed',error:'执行结果元数据超过 JSON 回传大小预算；仅保留图片及错误摘要',result:{runtime:result.runtime || null,output:truncationNotice,truncated:true,truncationReason:'action_result_json_budget',truncationDetails:['metadata_removed'],...(Array.isArray(result.outputArtifacts)?{outputArtifacts:result.outputArtifacts}:{})}};
  if (jsonBytes(minimal) <= maxBytes) return minimal;
  throw failure('图片回传本身超过 JSON 大小预算，不能截断图片内容');
}
