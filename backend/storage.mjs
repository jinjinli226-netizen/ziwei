import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const KEY_PATTERN = /^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/;
export const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * Object storage boundary. Anything implementing put/get/has/delete can replace
 * the local filesystem store (S3/OSS adapters) without touching the repository.
 * Objects are content-addressed, so identical uploads share one object and every
 * read re-verifies the checksum before returning bytes.
 */
export function createLocalObjectStore({ dir } = {}) {
  if (!dir) throw new TypeError('object store dir is required');
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  const resolveKey = key => {
    if (!KEY_PATTERN.test(String(key))) throw new Error('对象存储 key 无效');
    return path.join(root, ...key.split('/'));
  };
  return {
    kind: 'local-fs',
    put(bytes) {
      const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
      const checksum = sha256(buffer); const key = `sha256/${checksum.slice(0, 2)}/${checksum}`; const target = resolveKey(key);
      if (!fs.existsSync(target)) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(temporary, buffer, { flag: 'wx' });
        fs.renameSync(temporary, target);
      }
      return { key, checksum, size: buffer.length };
    },
    get(key, { checksum } = {}) {
      const bytes = fs.readFileSync(resolveKey(key));
      const actual = sha256(bytes);
      if (actual !== String(key).split('/')[2] || (checksum && actual !== checksum)) throw new Error('对象存储校验失败：checksum 不一致');
      return bytes;
    },
    has(key) { return fs.existsSync(resolveKey(key)); },
    delete(key) { fs.rmSync(resolveKey(key), { force: true }); }
  };
}

export function objectStoreFromOptions(options = {}) {
  if (options.objectStore) return options.objectStore;
  const dir = options.objectStoreDir || process.env.ZIWEI_OBJECT_STORE_DIR;
  return dir ? createLocalObjectStore({ dir }) : null;
}
