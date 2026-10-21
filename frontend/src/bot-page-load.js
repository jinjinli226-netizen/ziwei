// BotWorkbench owns its roster and selected Bot. Do not compete with those
// requests by downloading tasks, conversations and every employee's avatar.
export const workspaceDataKey=(workspace,actorId)=>JSON.stringify([actorId||'',workspace||'']);

export async function loadBotPageOptions(api, settingsRequest) {
  const [summary, models, skills, devices, settings] = await Promise.all([
    api.summary(), api.models(), api.skills(), api.devices(), settingsRequest,
  ]);
  return {summary, models:models.models || [], skills:skills.skills || [], devices:devices.devices || [], settings};
}

// A compact roster is metadata, never a replacement for a loaded employee's
// editable instructions, persona or original avatar value.
export function mergeBotRosterEmployee(employee, rosterEmployee) {
  const {avatar,...metadata}=rosterEmployee || {};
  return {...employee,...metadata,avatar:employee?.avatar || avatar || null};
}
