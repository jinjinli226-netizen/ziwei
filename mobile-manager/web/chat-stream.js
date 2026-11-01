const active = new Set(['pending', 'queued', 'acked', 'running', 'executing']);
export const chatExecutionRunning = execution => active.has(execution?.status);

export function assistantResponseStream(execution) {
  const stream = execution?.stream;
  if (!chatExecutionRunning(execution) || stream?.schemaVersion !== 1 || stream.phase !== 'streaming' || stream.channel && stream.channel !== 'assistant'
    || typeof stream.responseId !== 'string' || !stream.responseId || typeof stream.text !== 'string' || !stream.text) return null;
  return stream;
}
