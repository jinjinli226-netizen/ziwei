import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { employeeAvatarSrc, AVATAR_SHAPES, AVATAR_COLORS } from '../../src/employee-avatar.mjs';
import { avatarUrl, initialState } from '../web/model.js';
import { render } from '../web/view.js';

test('mobile packaged character renderer stays byte-identical to the shared desktop source', async () => {
  assert.deepEqual(await readFile(new URL('../web/employee-avatar.js', import.meta.url)), await readFile(new URL('../../src/employee-avatar.mjs', import.meta.url)));
});

test('mobile preserves every saved desktop character shape and color, including projected avatar metadata', () => {
  for (const shape of AVATAR_SHAPES) for (const color of AVATAR_COLORS) {
    const character = `grok:${shape.id}:${color.id}`, expected = employeeAvatarSrc(character, 'original-employee');
    assert.equal(avatarUrl({ id: 'original-employee', avatar: character }), expected);
    assert.equal(avatarUrl({ id: 'original-employee', avatar: '/api/workspaces/team/employees/e/avatar?v=original', avatar_character: character }), expected);
    assert.equal(avatarUrl({ employee: { id: 'original-employee', avatar_character: character } }), expected);
  }
});

test('mobile defaults match desktop employee identity and survive renaming without saving new data', () => {
  const employee = { id: 'same-employee', name: '原名字', avatar: null }, saved = JSON.stringify(employee);
  assert.equal(avatarUrl(employee), employeeAvatarSrc(null, employee.id));
  assert.equal(avatarUrl({ ...employee, name: '新名字' }), avatarUrl(employee));
  assert.equal(JSON.stringify(employee), saved);
});

test('uploaded images override old character metadata while arbitrary SVG is never rendered as an avatar', () => {
  const image = 'data:image/png;base64,aGVsbG8=';
  assert.equal(avatarUrl({ id: 'e', avatar: image, avatar_character: 'grok:cloud:violet' }), image);
  const malicious = 'data:image/svg+xml,<svg onload="alert(1)"/>';
  assert.equal(avatarUrl({ id: 'e', avatar: malicious }), employeeAvatarSrc(null, 'e'));
  assert.equal(avatarUrl({ id: 'e', avatar: 'https://example.test/avatar.png' }), 'https://example.test/avatar.png');
});

test('employee home and profile render an image instead of the name initial', () => {
  const employee = { id: 'original-employee', name: '策划伙伴', avatar: 'grok:bean:blue' };
  const state = { ...initialState(), phase: 'ready', workspace: { slug: 'team' }, employees: [employee] };
  const home = render(state);
  assert.match(home, /data-avatar-kind="character"/); assert.match(home, /src="data:image\/svg\+xml/);
  assert.doesNotMatch(home, /<span>策<\/span>/);
  const profile = render({ ...state, page: 'detail', selectedEmployee: employee, bot: { employee } });
  assert.match(profile, /src="data:image\/svg\+xml/);
});
