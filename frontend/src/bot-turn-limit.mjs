export const unlimitedBotTurns = config => config?.turnLimitMode === 'unlimited';

// Keep the bounded value in the same draft when changing modes. Legacy Bot
// configs stay byte-for-byte unchanged until the user actually changes mode.
export function setUnlimitedBotTurns(config, enabled) {
  if (typeof enabled !== 'boolean') throw new TypeError('Turn limit mode requires a boolean');
  if (!config || typeof config !== 'object' || Array.isArray(config)) return;
  if (unlimitedBotTurns(config) === enabled) return;
  if (enabled) config.turnLimitMode = 'unlimited';
  else delete config.turnLimitMode;
}
