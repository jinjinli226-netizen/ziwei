import test from 'node:test';
import assert from 'node:assert/strict';
import { createRepository } from '../backend/repository.mjs';
import { createApp } from '../backend/app.mjs';

test('calendar events persist independently with timezone edits and date moves', () => {
  const repo = createRepository({ memory: true });
  const created = repo.createCalendarEvent('test-111', { name:'产品评审', startAt:'2026-10-03', timezone:'Asia/Tokyo', description:'季度评审' });
  assert.equal(created.source, 'event');
  assert.equal(created.start_date, '2026-10-03');
  assert.equal(created.timezone, 'Asia/Tokyo');
  const updated = repo.updateCalendarEvent(created.id, { startAt:'2026-10-05', timezone:'America/Los_Angeles', status:'in_progress' });
  assert.equal(updated.start_at, '2026-10-05');
  assert.equal(updated.timezone, 'America/Los_Angeles');
  assert.equal(repo.listCalendarEvents('test-111').length, 1);
  assert.equal(repo.listCalendar('test-111')[0].events.some(event => event.id === created.id), true);
  assert.equal(repo.deleteCalendarEvent(created.id).deleted, true);
  assert.equal(repo.listCalendarEvents('test-111').length, 0);
});

test('calendar event HTTP CRUD exposes workspace timezone and event collection', async () => {
  const app = createApp({ memory: true });
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const json = (path, options) => fetch(`${base}${path}`, { headers:{'content-type':'application/json'}, ...options }).then(async response => ({ status:response.status, body:await response.json() }));
  try {
    const created = await json('/api/workspaces/test-111/calendar/events', { method:'POST', body:JSON.stringify({name:'演示',startAt:'2026-10-08',timezone:'Asia/Shanghai'}) });
    assert.equal(created.status, 201);
    const edited = await json(`/api/calendar-events/${created.body.id}`, { method:'PATCH', body:JSON.stringify({startAt:'2026-10-09',timezone:'UTC'}) });
    assert.equal(edited.body.start_date, '2026-10-09');
    assert.equal(edited.body.timezone, 'UTC');
    const listed = await json('/api/workspaces/test-111/calendar');
    assert.equal(listed.body.calendars[0].timezone, 'Asia/Shanghai');
    assert.equal(listed.body.calendars[0].events.some(event => event.id === created.body.id), true);
    assert.equal((await json(`/api/calendar-events/${created.body.id}`, { method:'DELETE' })).body.deleted, true);
  } finally { server.close(); }
});
