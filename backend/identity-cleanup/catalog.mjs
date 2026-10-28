// Explicit source-family map. Unknown future tables never acquire an inferred owner.
const families = {
  'login-account':['local_users'],
  'native-actor':['employees','hermes_bots','runtime_metadata','runtime_device_metadata','runtimes','device_updates','ziwei_connect_runs'],
  'device-pairing':['devices','employee_phone_mcp','device_workspace_grants'],
  'system-credential':['local_sessions','api_keys','device_credentials','device_pairing_codes','employee_environment_variables','unified_identity_bindings','unified_identity_sessions','unified_identity_transactions','unified_identity_logout_replay','unified_identity_op_logout'],
  'platform-account':['platform_accounts','ziwei_connect_bindings'],
  'business-resource':['workspaces','members','invitations','management_requests','bot_deferred_configs','bot_routines','bot_gateway_inbox','tasks','task_messages','task_attachments','documents','document_versions','skills','skill_versions','automations','automation_runs','webhook_deliveries','employee_custom_params','calendar_events','audit_events','a2a_actions','a2a_action_events','notifications','conversations','conversation_messages','conversation_reads','employee_template_instances','workspace_preferences'],
};
export const TABLE_KINDS = Object.freeze(Object.fromEntries(Object.entries(families).flatMap(([kind, tables]) => tables.map(table => [table, kind]))));
export const INFRASTRUCTURE_TABLES = new Set(['schema_migrations','server_code_rollout','version_preservation','version_preservation_events','cleanup_fixture_guard']);
export const SAFE_COLUMNS = new Set(['id','workspace_id','user_id','owner_user_id','employee_id','device_id','task_id','conversation_id','automation_id','run_id','document_id','skill_id','source_workspace_id','target_workspace_id','source_device_id','target_device_id','member_id','action_id','connection_id','created_by','sender_user_id','version','event_id','parent_id','binding_id','actor_user_id']);
export const PRIVATE_IDENTIFIER_TABLES = new Set(['unified_identity_sessions','unified_identity_transactions','unified_identity_logout_replay','unified_identity_op_logout']);
export const SOFT_RELATIONS = Object.freeze({owner_user_id:'local_users',user_id:'local_users',workspace_id:'workspaces',source_workspace_id:'workspaces',target_workspace_id:'workspaces',employee_id:'employees',device_id:'devices',source_device_id:'devices',target_device_id:'devices',task_id:'tasks',conversation_id:'conversations',automation_id:'automations',document_id:'documents',skill_id:'skills',action_id:'a2a_actions',member_id:'members',event_id:'audit_events',parent_id:'documents',binding_id:'ziwei_connect_bindings',actor_user_id:'local_users'});
export const OWNERSHIP_NOTES = Object.freeze({
  local_users:'Exact protected-email lookup is only a candidate identity resolution; no password fields are projected.',
  members:'user_id links membership, not exclusive ownership of every workspace resource.',
  workspaces:'Workspace owner/member role does not own all child records. Shared/mixed workspaces remain pending.',
  tasks:'created_by is mutable and may be a generic actor. It is a provenance hint, never exclusive ownership proof.',
  devices:'Operational device pairing is distinct from a website login and requires separate review.',
  documents:'Native schema has workspace ownership only unless an explicit owner_user_id column is present. Object storage requires independent reference review.',
  unified_identity_bindings:'Local bindings do not authorize deleting a central subject or another site grant.',
  device_updates:'backend/device-updates.mjs: native maintenance intents tied to device/workspace; actor_user_id is authority provenance, not ownership. claim_token/idempotency_key are never projected.',
  ziwei_connect_bindings:'backend/ziwei-connect.mjs: external Control account/device/employee binding; distinct from website login. account_id/account_label and Control credentials are not projected.',
  ziwei_connect_runs:'backend/ziwei-connect.mjs: native phone/Control execution receipts; preserve prior terminal/unknown semantics. No replay, device action or website-account ownership inference.',
});
