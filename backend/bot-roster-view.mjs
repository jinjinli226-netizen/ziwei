import {botProfileBinding} from './bot-profiles.mjs';
import {createBotManagementActionReader} from './bot-management-view.mjs';
import {createMobileReadView} from './mobile-read-view.mjs';
import {botExecutionOccupiesSlot} from './bot-execution-occupancy.mjs';

// A roster needs identity and status, not the last 100 prompts, event streams,
// generated files, or native-resource contents of every employee. Keep the
// original detail/action endpoints authoritative for all of those bodies.
export function createBotRosterView(repo) {
  const db=repo.db,readAction=createBotManagementActionReader(repo),images=createMobileReadView(repo);
  const latestByEmployee=db.prepare(`SELECT employee_id,id FROM (
    SELECT id,CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.hermesBot.employeeId') END employee_id,
      row_number() OVER (PARTITION BY CASE WHEN json_valid(payload_json) THEN json_extract(payload_json,'$.hermesBot.employeeId') END ORDER BY created_at DESC,rowid DESC) ordinal
    FROM a2a_actions WHERE workspace_id=?
  ) WHERE ordinal=1 AND employee_id IS NOT NULL`);
  const bindings=db.prepare('SELECT employee_id,revision,control_epoch,control_state,main_conversation_id,active_action_id,profile_binding_json FROM hermes_bots WHERE workspace_id=?');
  const creatorIds=db.prepare("SELECT employee_id FROM employee_template_instances WHERE workspace_id=? AND template_id='ziwei-employee-creator'");
  const conversation=db.prepare("SELECT id FROM conversations WHERE employee_id=? AND workspace_id=? ORDER BY updated_at DESC LIMIT 1");
  return(slug,workspaceId,employees)=>{
    const latest=new Map(latestByEmployee.all(workspaceId).map(row=>[row.employee_id,row.id]));
    const bots=new Map(bindings.all(workspaceId).map(row=>[row.employee_id,row]));
    const creators=new Set(creatorIds.all(workspaceId).map(row=>row.employee_id));
    const actionCache=new Map(),action=id=>{
      if(!id)return null;
      if(!actionCache.has(id))actionCache.set(id,readAction(id,workspaceId));
      return actionCache.get(id);
    };
    return employees.map(employee=>{
      const row=bots.get(employee.id),binding=row?botProfileBinding(row):null;
      const fields=['id','workspace_id','name','description','avatar','runtime','model_id','runtime_profile','target_device_id','status','visibility','owner_user_id'];
      const identity=images.employee(slug,Object.fromEntries(fields.map(key=>[key,employee[key]])));
      const current=row?action(row.active_action_id):null,recent=row?action(latest.get(employee.id)):null;
      // An older unresolved execution must not disappear behind a newer
      // read-only inspection. Summary omission never releases an execution.
      const active=current&&botExecutionOccupiesSlot(current,{workspaceId,employeeId:employee.id})?current:null;
      return {
        id:employee.id,employee_id:employee.id,workspace:slug,employee:identity,
        configuration_state:row?'initialized':'uninitialized',kind:!row&&creators.has(employee.id)?'creator':'employee',
        revision:row?.revision||0,control_epoch:row?.control_epoch||0,
        control_state:row?.control_state||(employee.status==='paused'?'paused':'draft'),
        main_conversation_id:row?.main_conversation_id||conversation.get(employee.id,workspaceId)?.id||null,
        ...(binding?{instance:{mode:binding.mode,profile:binding.profile||employee.runtime_profile,templateProfile:binding.templateProfile||employee.runtime_profile}}:{}),
        latest_run:active||recent,active_run:active,
        rosterView:{schemaVersion:1,historyIncluded:false,configurationIncluded:false,detailOperation:'GET bot by id'},
      };
    });
  };
}
