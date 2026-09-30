import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const ALLOWED = new Set(['init', 'add', 'commit', 'rev-parse', 'status']);
const REPO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_IMPORT_FILE = 10 * 1024 * 1024;

export const gitSyncRoot = () => path.resolve(process.env.ZIWEI_GIT_SYNC_ROOT || path.join(ROOT, 'data', 'git-sync'));

export function resolveSyncDir(name, root = gitSyncRoot()) {
  if (!REPO_NAME.test(String(name || '')) || String(name).includes('..')) throw new Error('Git 同步目录名只能包含字母、数字、点、下划线和连字符');
  return path.join(root, name);
}

// git is spawned without a shell, with a fixed sub-command allow-list; callers
// never supply raw argv, only the arguments this module builds.
function git(cwd, subcommand, args = []) {
  if (!ALLOWED.has(subcommand)) throw new Error(`git 子命令不在白名单内: ${subcommand}`);
  const identity = subcommand === 'commit' ? ['-c', 'user.name=ziwei', '-c', 'user.email=ziwei@localhost', '-c', 'commit.gpgsign=false'] : [];
  const result = spawnSync('git', [...identity, subcommand, ...args], { cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30_000 });
  if (result.error) throw new Error(`git 不可用: ${result.error.code || result.error.message}`);
  return result;
}

const safeSegment = (name, fallback) => String(name || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+$/, '_').slice(0, 120) || fallback;

function exportTree(repo, slug, dir) {
  const docs = repo.listDocuments(slug); const byParent = new Map();
  for (const doc of docs) { const list = byParent.get(doc.parent_id || null) || []; list.push(doc); byParent.set(doc.parent_id || null, list); }
  let files = 0;
  const walk = (parent, target) => {
    const used = new Set();
    for (const doc of byParent.get(parent) || []) {
      let name = safeSegment(doc.name, doc.id);
      if (name === '.git' || used.has(name.toLowerCase())) name = `${name}.${doc.id.slice(-6)}`;
      used.add(name.toLowerCase());
      const full = path.join(target, name);
      if (doc.type === 'folder') { fs.mkdirSync(full, { recursive: true }); walk(doc.id, full); continue; }
      const file = repo.downloadDocument(doc.id);
      fs.writeFileSync(full, file.content_encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content || '', 'utf8')); files++;
    }
  };
  walk(null, dir);
  return files;
}

export function exportDocumentsToGit(repo, slug, name, { message } = {}) {
  const dir = resolveSyncDir(name); fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(path.join(dir, '.git'))) { const init = git(dir, 'init'); if (init.status !== 0) throw new Error(`git init 失败: ${String(init.stderr).trim()}`); }
  for (const entry of fs.readdirSync(dir)) if (entry !== '.git') fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  const files = exportTree(repo, slug, dir);
  git(dir, 'add', ['-A']);
  const status = git(dir, 'status', ['--porcelain']);
  let committed = false;
  if (String(status.stdout).trim()) {
    const commit = git(dir, 'commit', ['-m', String(message || `ziwei document sync ${new Date().toISOString()}`).slice(0, 200)]);
    if (commit.status !== 0) throw new Error(`git commit 失败: ${String(commit.stderr || commit.stdout).trim()}`);
    committed = true;
  }
  const head = git(dir, 'rev-parse', ['HEAD']);
  return { name, files, committed, commit: head.status === 0 ? String(head.stdout).trim() : null };
}

const isText = name => /\.(md|markdown|txt)$/i.test(name);
export function importDocumentsFromGit(repo, slug, name) {
  const dir = resolveSyncDir(name); if (!fs.existsSync(dir)) throw new Error('Git 同步目录不存在');
  let created = 0; let updated = 0; let skipped = 0;
  const walk = (folder, parentId) => {
    const siblings = repo.listDocuments(slug).filter(doc => (doc.parent_id || null) === parentId);
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      if (entry.isSymbolicLink()) { skipped++; continue; }
      const full = path.join(folder, entry.name);
      const match = siblings.find(doc => doc.name === entry.name);
      if (entry.isDirectory()) {
        let folderDoc = match?.type === 'folder' ? match : null;
        if (!folderDoc) { folderDoc = repo.createDocument(slug, { type: 'folder', name: entry.name, parentId }); created++; }
        walk(full, folderDoc.id); continue;
      }
      if (!entry.isFile()) { skipped++; continue; }
      const bytes = fs.readFileSync(full); if (bytes.length > MAX_IMPORT_FILE) { skipped++; continue; }
      const payload = isText(entry.name) ? { content: bytes.toString('utf8') } : { data: bytes.toString('base64'), contentEncoding: 'base64' };
      if (match?.type === 'file') { repo.updateDocument(match.id, payload); updated++; }
      else { repo.createDocument(slug, { type: 'file', name: entry.name, parentId, ...payload }); created++; }
    }
  };
  walk(dir, null);
  return { name, created, updated, skipped };
}
