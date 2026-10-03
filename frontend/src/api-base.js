export function resolveApiBase({ configured = '', dev = false, origin = '' } = {}) {
  const explicit = String(configured || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (dev) return 'http://127.0.0.1:4178';
  return String(origin || '').trim().replace(/\/+$/, '');
}
