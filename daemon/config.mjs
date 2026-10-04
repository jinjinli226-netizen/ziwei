import os from 'node:os';
import path from 'node:path';

/**
 * Resolve files for a daemon installation. Project mode deliberately keeps
 * the historical data/ path, while a packaged daemon can set ZIWEI_USER_HOME
 * and keep credentials, logs and runtime state outside any checkout.
 */
export function defaultUserDir({ platform = process.platform, home = os.homedir(), env = process.env } = {}) {
  if (env.ZIWEI_USER_HOME) return path.resolve(String(env.ZIWEI_USER_HOME));
  if (platform === 'win32') return path.join(String(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')), 'Ziwei', 'ziwei_user');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Ziwei', 'ziwei_user');
  return path.join(String(env.XDG_STATE_HOME || path.join(home, '.local', 'state')), 'ziwei_user');
}

export function resolveConfigPath({ root = process.cwd(), env = process.env } = {}) {
  if (env.ZIWEI_CONFIG) return path.resolve(String(env.ZIWEI_CONFIG));
  if (env.ZIWEI_USER_HOME) return path.join(defaultUserDir({ env, home: os.homedir() }), 'ziwei_user.json');
  return path.join(path.resolve(root), 'data', 'ziwei_user.json');
}

export function resolveConfigFile(value, { configPath, root = process.cwd() } = {}) {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  const base = configPath ? path.dirname(path.resolve(configPath)) : path.resolve(root);
  return path.resolve(base, candidate);
}
