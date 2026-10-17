import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createRepository} from './repository.mjs';

function fixture(t){
  const events=[],repo=createRepository({memory:true,onEvent:event=>events.push(event)}),db=repo.db,ws=repo.getWorkspace('test-111');t.after(()=>db.close());
  const human=repo.createMember(ws.slug,{name:'Real human',email:'binding-human@fixture.test'});events.length=0;
  const markers=taskId=>db.prepare("SELECT payload_json FROM audit_events WHERE workspace_id=? AND action IN ('task.created','task.updated') AND json_extract(payload_json,'$.taskId')=? ORDER BY rowid").all(ws.id,taskId).map(row=>JSON.parse(row.payload_json));
  return {repo,db,ws,human,events,markers};
}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('task creation derives one current canonical entity or an explicit unresolved marker without accepting client proof',t=>{
  const f=fixture(t),employee=f.repo.createEmployee(f.ws.slug,{name:'Unique current employee',runtime:'Codex'});f.events.length=0;
  for(const [assignee,kind,entityId] of [[null,'unassigned',null],[f.human.id,'member',f.human.id],[f.human.name,'member',f.human.id],[f.human.email,'member',f.human.id],[employee.id,'employee',employee.id],[employee.name,'employee',employee.id],['No current entity','unresolved',null]]){
    const before=f.db.prepare('SELECT count(*) AS count FROM notifications').get().count;
    const task=f.repo.createTask(f.ws.slug,{title:'Server assignment evidence',assignee,assignmentBinding:{kind:'member',entityId:f.human.id}}),binding=f.markers(task.id)[0].assignmentBinding,stored=f.db.prepare('SELECT assignee FROM tasks WHERE id=?').get(task.id).assignee;
    assert.deepEqual(binding,{schemaVersion:1,workspaceId:f.ws.id,taskId:task.id,assigneeHash:hash(stored),kind,entityId});
    assert.equal(f.db.prepare('SELECT count(*) AS count FROM notifications').get().count,before+1,'existing task.created notification only');
    assert.equal(f.events.at(-1).action,'task.created');assert.equal(f.events.at(-1).payload.assignmentBinding.kind,kind);
  }
});

test('candidate conflicts never prefer canonical IDs over another employee alias, including deleted matches',t=>{
  const f=fixture(t),employee=f.repo.createEmployee(f.ws.slug,{name:f.human.id,runtime:'Codex'}),task=f.repo.createTask(f.ws.slug,{title:'Ambiguous current token',assignee:f.human.id});
  assert.equal(f.markers(task.id)[0].assignmentBinding.kind,'unresolved');
  f.repo.deleteEmployee(employee.id,{force:true});
  const second=f.repo.createTask(f.ws.slug,{title:'Tombstone still conflicts',assignee:f.human.id});assert.equal(f.markers(second.id)[0].assignmentBinding.kind,'unresolved');
});

test('same-value full DTO and SQLite text-coerced echoes preserve evidence; real changes record every marker',t=>{
  const f=fixture(t),numericText=f.db.prepare('SELECT CAST(? AS TEXT) AS value').get(123).value;
  f.db.prepare('INSERT INTO members(id,workspace_id,name,email,role,joined_at) VALUES(?,?,?,?,?,?)').run(numericText,f.ws.id,'Numeric current member','numeric-member@fixture.test','member',new Date().toISOString());
  const task=f.repo.createTask(f.ws.slug,{title:'Numeric token',assignee:123}),initial=f.markers(task.id)[0].assignmentBinding;
  const persisted=f.db.prepare('SELECT assignee FROM tasks WHERE id=?').get(task.id).assignee;
  assert.equal(typeof persisted,'string');assert.equal(initial.assigneeHash,hash(persisted));assert.equal(initial.entityId,numericText);
  f.repo.updateTask(task.id,{title:'Full DTO title change',assignee:123,assignmentBinding:{kind:'employee',entityId:'forged'}});
  f.repo.updateTask(task.id,{dueDate:'2026-11-01'});f.repo.transitionTask(task.id,'todo');
  assert.equal(f.markers(task.id).filter(value=>Object.hasOwn(value,'assignmentBinding')).length,1);
  f.repo.updateTask(task.id,{assignee:'Unknown replacement'});f.repo.updateTask(task.id,{assignee:null});f.repo.updateTask(task.id,{assignee:numericText});
  assert.deepEqual(f.markers(task.id).filter(value=>Object.hasOwn(value,'assignmentBinding')).map(value=>value.assignmentBinding.kind),['member','unresolved','unassigned','member']);
});

test('audit failure rolls task creation and reassignment back with no notification or callback escape',t=>{
  const f=fixture(t),count=table=>f.db.prepare(`SELECT count(*) AS count FROM ${table}`).get().count;
  const before={tasks:count('tasks'),audits:count('audit_events'),notifications:count('notifications')};
  f.db.exec("CREATE TEMP TRIGGER reject_task_create_audit BEFORE INSERT ON audit_events WHEN NEW.action='task.created' BEGIN SELECT RAISE(ABORT,'FIXTURE_AUDIT_REJECTED'); END");
  assert.throws(()=>f.repo.createTask(f.ws.slug,{title:'Must roll back',assignee:f.human.id}),/FIXTURE_AUDIT_REJECTED/);
  assert.deepEqual({tasks:count('tasks'),audits:count('audit_events'),notifications:count('notifications')},before);assert.deepEqual(f.events,[]);
  f.db.exec('DROP TRIGGER reject_task_create_audit');
  const task=f.repo.createTask(f.ws.slug,{title:'Original',assignee:f.human.id}),saved={...f.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)},audits=count('audit_events'),notifications=count('notifications');f.events.length=0;
  f.db.exec("CREATE TEMP TRIGGER reject_task_update_audit BEFORE INSERT ON audit_events WHEN NEW.action='task.updated' BEGIN SELECT RAISE(ABORT,'FIXTURE_AUDIT_REJECTED'); END");
  assert.throws(()=>f.repo.updateTask(task.id,{title:'Must roll back',assignee:'Unresolved replacement'}),/FIXTURE_AUDIT_REJECTED/);
  assert.deepEqual({...f.db.prepare('SELECT * FROM tasks WHERE id=?').get(task.id)},saved);assert.equal(count('audit_events'),audits);assert.equal(count('notifications'),notifications);assert.deepEqual(f.events,[]);
});

test('outer template transactions retain original event deferral and roll back task evidence together',t=>{
  const f=fixture(t),before=f.db.prepare('SELECT count(*) AS count FROM audit_events').get().count;
  assert.throws(()=>f.repo.withEmployeeTemplateTransaction(()=>{f.repo.createTask(f.ws.slug,{title:'Outer rollback',assignee:f.human.id});assert.deepEqual(f.events,[]);throw new Error('OUTER_ROLLBACK');}),/OUTER_ROLLBACK/);
  assert.equal(f.db.prepare("SELECT count(*) AS count FROM tasks WHERE title='Outer rollback'").get().count,0);assert.equal(f.db.prepare('SELECT count(*) AS count FROM audit_events').get().count,before);assert.deepEqual(f.events,[]);
  const task=f.repo.withEmployeeTemplateTransaction(()=>{const value=f.repo.createTask(f.ws.slug,{title:'Outer commit',assignee:f.human.id});assert.deepEqual(f.events,[]);return value;});
  assert.equal(f.events.length,1);assert.equal(f.events[0].payload.assignmentBinding.entityId,f.human.id);assert.equal(f.markers(task.id).length,1);
});
