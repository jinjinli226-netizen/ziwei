import test from 'node:test';
import assert from 'node:assert/strict';
import {AVATAR_SHAPES,AVATAR_COLORS,avatarSpec,avatarValue,avatarSvg,isCharacterAvatar,employeeAvatarSrc} from '../src/employee-avatar.mjs';

test('the reused character system supports all 25 silhouettes and 11 named colors',()=>{
  assert.equal(AVATAR_SHAPES.length,25);assert.equal(AVATAR_COLORS.length,11);
  for(const shape of AVATAR_SHAPES)for(const color of AVATAR_COLORS){
    const value=avatarValue(shape.id,color.id);assert.equal(isCharacterAvatar(value),true);
    const svg=avatarSvg(shape.id,color.id);
    assert.match(svg,/<svg[^>]+viewBox="0 0 100 100"/);assert.ok(svg.includes(`fill="${color.value}"`));
    assert.match(svg,/class="avatar-eyes"/);assert.match(svg,/<mask /);
    assert.doesNotMatch(svg.replace('xmlns="http://www.w3.org/2000/svg"',''),/<script|foreignObject|href=|onload=|https?:/i);
  }
});

test('a saved character overrides the deterministic default and survives a display-name change',()=>{
  const value=avatarValue('cloud','green');
  assert.deepEqual(avatarSpec({name:'first',metadata:{avatar:value}}),{shapeId:'cloud',colorId:'green'});
  assert.deepEqual(avatarSpec({name:'renamed',metadata:{avatar:value}}),{shapeId:'cloud',colorId:'green'});
  assert.equal(employeeAvatarSrc(null,'employee-id'),employeeAvatarSrc(null,'employee-id'));
  assert.equal(employeeAvatarSrc(value,'first'),employeeAvatarSrc(value,'renamed'));
});

test('character descriptors accept only the exact prefix, shape and color vocabulary',()=>{
  for(const value of [null,5,{},'', 'grok:cloud','grok:cloud:green:extra','grok:missing:green','grok:cloud:missing','grok:cloud:#fff','grok:<svg>:green','GROK:cloud:green','grok:cloud:green\n','grok:cloud:url(https://example.invalid)'])assert.equal(isCharacterAvatar(value),false,String(value));
});

test('uploaded image values are preserved byte-for-byte while characters use isolated trusted SVG images',()=>{
  for(const image of ['/api/workspaces/team/employees/e/avatar','data:image/png;base64,aGVsbG8=','https://example.invalid/avatar.webp'])assert.equal(employeeAvatarSrc(image,'e'),image);
  const source=employeeAvatarSrc('grok:bean:violet','e');assert.match(source,/^data:image\/svg\+xml;charset=utf-8,/);
  const svg=decodeURIComponent(source.slice(source.indexOf(',')+1));assert.equal(svg,avatarSvg('bean','violet'));
});
