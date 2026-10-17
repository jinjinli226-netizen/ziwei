/** A press belongs to one persisted message; scrolling and short image taps stay native. */
export function installMessageGestures(root, { enabled, openMenu, delay = 500, setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now } = {}) {
  let press = null, suppressed = null;
  const anchorFor = target => target?.closest?.('[data-forwardable-message]')?.closest('[data-message-id]');
  function cancel() { if (press) clearTimer(press.timer); press = null; }
  function show(anchor) {
    if (!enabled() || !anchor?.isConnected) return;
    suppressed = { id: anchor.dataset.messageId, pointerId: press?.pointerId, until: press ? Infinity : now() + 900 };
    cancel(); openMenu(anchor.dataset.messageId);
  }
  const down = event => {
    // A fresh intentional press must work immediately, even when the previous
    // platform omitted its compatibility click after a long press.
    if (event.isPrimary !== false) suppressed = null;
    cancel();
    const anchor = anchorFor(event.target);
    if (!enabled() || !anchor || event.isPrimary === false || event.button !== 0 || event.target.closest('button,input,textarea,select,a')) return;
    press = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, timer: setTimer(() => show(anchor), delay) };
  };
  const move = event => { if (press && press.pointerId === event.pointerId && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) cancel(); };
  const up = event => {
    if (press?.pointerId === event.pointerId) cancel();
    if (suppressed?.pointerId === event.pointerId) suppressed.until = now() + 900;
  };
  const click = event => {
    // Touch release is hit-tested against the new dialog. Its compatibility
    // click can land on the backdrop, so matching the original bubble misses it.
    if (suppressed && now() <= suppressed.until && event.detail !== 0) {
      suppressed = null; event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  const context = event => {
    const anchor = anchorFor(event.target);
    if (!anchor) return;
    if (suppressed && now() <= suppressed.until && anchor.dataset.messageId === suppressed.id) { event.preventDefault(); return; }
    if (enabled()) { event.preventDefault(); show(anchor); }
  };
  root.addEventListener('pointerdown', down);
  root.addEventListener('pointermove', move);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', up);
  root.addEventListener('scroll', cancel, true);
  root.addEventListener('click', click, true);
  root.addEventListener('contextmenu', context);
  return { cancel, dispose() {
    cancel(); root.removeEventListener('pointerdown', down); root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up); root.removeEventListener('pointercancel', up);
    root.removeEventListener('scroll', cancel, true); root.removeEventListener('click', click, true); root.removeEventListener('contextmenu', context);
  } };
}

export function lastVisibleMessage(timeline, viewportHeight) {
  if (!timeline || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  const bounds = timeline.getBoundingClientRect(), top = Math.max(0, bounds.top), bottom = Math.min(viewportHeight, bounds.bottom);
  if (bottom <= top) return null;
  let last = null;
  for (const node of timeline.querySelectorAll('[data-message-id]')) {
    const rect = node.getBoundingClientRect();
    if (Math.min(rect.bottom, bottom) - Math.max(rect.top, top) >= 2) last = node.dataset.messageId;
  }
  return last;
}
