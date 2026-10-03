const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function normalizeRuntimeProfile(value) {
  const profile = String(value ?? '').trim();
  if (!profile) return null;
  if (!PROFILE_PATTERN.test(profile)) throw new Error('运行时 profile 名称无效');
  return profile;
}

export function composeEmployeePrompt({ prompt, name = '', instructions = '' } = {}) {
  const content = String(prompt ?? '').trim();
  if (!content) throw new Error('执行需要非空 prompt');
  const employeeName = String(name ?? '').trim();
  const role = String(instructions ?? '').trim();
  if (!employeeName && !role) return content;
  return [
    employeeName ? `你是数字伙伴“${employeeName}”。` : '',
    role ? '请持续遵守以下岗位人格与职责：' : '',
    role,
    role ? '---' : '',
    '用户任务：',
    content,
  ].filter(Boolean).join('\n');
}
