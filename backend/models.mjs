/* Model choices come from the connected local CLI, never a fabricated server catalog. */
export function listModels({ runtime, query = '', discovery = null } = {}) {
  const needle = String(query || '').trim().toLowerCase();
  const agents = discovery?.agents || {};
  const runtimes = runtime ? [runtime] : Object.keys(agents);
  const result = [];
  const seen = new Set();
  for (const name of runtimes) {
    const entry = agents[name];
    for (const model of Array.isArray(entry?.models) ? entry.models : []) {
      const id = String(model?.id || '').trim();
      if (!id || seen.has(`${name}:${id}`)) continue;
      const provider = name === 'Claude' ? 'Anthropic' : name === 'Codex' ? 'OpenAI' : name === 'Gemini' ? 'Google' : name;
      const item = { id, label: String(model.label || id), provider, runtime: name, source: model.source || 'local-config', cli_version: entry.version || null, cli_binary: entry.binary || null };
      if (!needle || `${item.provider} ${item.label} ${item.id} ${item.runtime}`.toLowerCase().includes(needle)) {
        result.push(item); seen.add(`${name}:${id}`);
      }
    }
  }
  return result;
}
