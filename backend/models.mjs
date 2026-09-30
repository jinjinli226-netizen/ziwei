/*
 * Model discovery is kept behind the API so the UI never has to invent model
 * options.  A connected runtime can later replace this catalog with its own
 * discovery adapter without changing the employee-creation flow.
 */
const MODEL_CATALOG = [
  { id:'anthropic:claude-fable-5.1', provider:'Anthropic', label:'claude-fable-5.1', runtime:'Claude', source:'runtime-catalog' },
  { id:'anthropic:claude-fable-5', provider:'Anthropic', label:'claude-fable-5', runtime:'Claude', source:'runtime-catalog' },
  { id:'anthropic:claude-opus-5', provider:'Anthropic', label:'claude-opus-5', runtime:'Claude', source:'runtime-catalog' },
  { id:'anthropic:claude-sonnet-5', provider:'Anthropic', label:'claude-sonnet-5', runtime:'Claude', source:'runtime-catalog' },
  { id:'anthropic:claude-opus-4-8', provider:'Anthropic', label:'claude-opus-4-8', runtime:'Claude', source:'runtime-catalog' },
  { id:'openai:gpt-6', provider:'OpenAI', label:'gpt-6', runtime:'Codex', source:'runtime-catalog' },
  { id:'openai:gpt-6-mini', provider:'OpenAI', label:'gpt-6-mini', runtime:'Codex', source:'runtime-catalog' },
  { id:'google:gemini-2.5-pro', provider:'Google', label:'gemini-2.5-pro', runtime:'Gemini', source:'runtime-catalog' },
  { id:'google:gemini-2.5-flash', provider:'Google', label:'gemini-2.5-flash', runtime:'Gemini', source:'runtime-catalog' },
  { id:'aurababa:hermes-0.3.71', provider:'AuraBaba', label:'hermes-0.3.71', runtime:'Hermes', source:'runtime-catalog' }
];

export function listModels({ runtime, query = '' } = {}) {
  const needle = String(query).trim().toLowerCase();
  return MODEL_CATALOG.filter(model => (!runtime || model.runtime === runtime) && (!needle || `${model.provider} ${model.label} ${model.id}`.toLowerCase().includes(needle)));
}

export { MODEL_CATALOG };
