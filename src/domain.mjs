export const TASK_STATES = ['planned','todo','in_progress','review','completed','blocked','cancelled'];

const TRANSITIONS = new Map([
  ['planned', new Set(['todo','blocked','cancelled'])],
  ['todo', new Set(['in_progress','blocked','cancelled'])],
  ['in_progress', new Set(['review','blocked','cancelled'])],
  ['review', new Set(['completed','in_progress','blocked','cancelled'])],
  ['completed', new Set()],
  ['blocked', new Set(['todo','in_progress','cancelled'])],
  ['cancelled', new Set()]
]);

export function transitionTask(from, to) {
  if (!TRANSITIONS.get(from)?.has(to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
  return to;
}
