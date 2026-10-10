import fs from 'node:fs';
import path from 'node:path';

export function isNativeRuntimeAction(action) {
  const type = String(action?.type || '').toLowerCase();
  return ['agent.execute', 'conversation.execute', 'runtime.execute', 'automation.execute'].includes(type)
    || (type === 'task.execute' && (action?.payload?.runtime || action?.payload?.agent || action?.payload?.modelId || action?.payload?.prompt));
}

function localDrivePath(value, { fromFilesystem = false } = {}) {
  let candidate = String(value);
  // realpath can return a long-path prefix for an ordinary local drive. Only
  // accept that OS-generated form; callers cannot request device namespaces.
  if (fromFilesystem && /^\\\\\?\\[a-z]:\\/i.test(candidate)) candidate = candidate.slice(4);
  if (!/^[a-z]:[\\/]/i.test(candidate) || candidate.startsWith('\\\\')) {
    throw new Error('工作目录只支持这台 Windows 电脑的本地盘符路径；不支持 UNC 或设备命名空间');
  }
  return path.win32.normalize(candidate);
}

function filesystemError(error, candidate) {
  if (['EACCES', 'EPERM'].includes(error?.code)) return new Error(`工作目录访问权限不足: ${candidate}`, { cause: error });
  if (error?.code === 'ENOTDIR') return new Error(`工作目录不是目录: ${candidate}`, { cause: error });
  return error;
}

function directoryStats(candidate) {
  try {
    const stats = fs.statSync(candidate);
    if (!stats.isDirectory()) throw new Error(`工作目录不是目录: ${candidate}`);
    return stats;
  } catch (error) { throw filesystemError(error, candidate); }
}

/**
 * A paired Windows user's default directory is a starting location, not a
 * filesystem sandbox. Resolve local drives through Windows and retain their
 * real junction/symlink target, while ordinary runtime file actions keep their
 * separate private-directory boundary.
 */
export function resolveWindowsWorkdirPath(basePath, requested = '.') {
  let raw = String(requested || '.').trim() || '.';
  if (raw.includes('\0') || /^[\\/]{2}/.test(raw)) throw new Error('工作目录只支持本地盘符路径；不支持 UNC 或设备命名空间');
  if (/^[a-z]:$/i.test(raw)) raw += '\\';
  else if (/^[a-z]:[^\\/]/i.test(raw)) throw new Error('工作目录需要明确的盘根或绝对路径，例如 C:\\ 或 D:\\projects');
  const absolute = /^[a-z]:[\\/]/i.test(raw);
  // Preserve drive syntax before path.resolve can reinterpret C: or C:child
  // using a process-specific current directory for that drive.
  let baseRaw = String(basePath || process.cwd()).trim();
  if (!absolute) {
    if (baseRaw.includes('\0') || /^[\\/]{2}/.test(baseRaw)) throw new Error('工作目录只支持本地盘符路径；不支持 UNC 或设备命名空间');
    if (/^[a-z]:$/i.test(baseRaw)) baseRaw += '\\';
    else if (/^[a-z]:[^\\/]/i.test(baseRaw)) throw new Error('工作目录需要明确的盘根或绝对路径，例如 C:\\ 或 D:\\projects');
  }
  const base = absolute ? undefined : localDrivePath(path.win32.resolve(baseRaw));
  return localDrivePath(absolute ? path.win32.resolve(raw) : path.win32.resolve(base, raw));
}

export function resolveWindowsWorkdir(basePath, requested = '.', { allowMissing = false } = {}) {
  const candidate = resolveWindowsWorkdirPath(basePath, requested);
  const driveRoot = path.win32.parse(candidate).root;
  try { directoryStats(driveRoot); }
  catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`工作目录所在盘符不存在或不可访问: ${driveRoot}`, { cause: error });
    throw error;
  }
  try {
    directoryStats(candidate);
    return localDrivePath(fs.realpathSync.native(candidate), { fromFilesystem: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw filesystemError(error, candidate);
    if (!allowMissing) throw new Error(`工作目录不存在: ${candidate}；请先选择已有目录或明确创建`, { cause: error });
  }
  // Only inspect existing ancestors. Resolving or browsing a missing directory
  // never creates it; the directory picker has a separate explicit create step.
  let existing = candidate;
  while (true) {
    try {
      directoryStats(existing);
      const real = localDrivePath(fs.realpathSync.native(existing), { fromFilesystem: true });
      return path.win32.resolve(real, path.win32.relative(existing, candidate));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw filesystemError(error, existing);
      const parent = path.win32.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
}

export function windowsDirectoryError(error, candidate) { return filesystemError(error, candidate); }
