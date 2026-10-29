import {isCharacterAvatar} from '../src/employee-avatar.mjs';

export function normalizeEmployeeAvatar(value) {
  const avatar=value?String(value):null;
  if(avatar&&/^grok:/i.test(avatar)&&!isCharacterAvatar(avatar))throw Object.assign(new Error('请选择有效的头像形状和颜色。'),{status:400,code:'EMPLOYEE_AVATAR_INVALID'});
  return avatar;
}
