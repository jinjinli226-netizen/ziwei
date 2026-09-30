export class RealtimeHub {
  #listeners = new Map();
  subscribe(workspaceSlug, listener) {
    const set = this.#listeners.get(workspaceSlug) || new Set(); set.add(listener); this.#listeners.set(workspaceSlug, set);
    return () => { set.delete(listener); if (!set.size) this.#listeners.delete(workspaceSlug); };
  }
  publish(event) { for (const listener of this.#listeners.get(event.workspaceSlug) || []) { try { listener(event); } catch {} } }
}
