export const distanceFromEnd = timeline => Math.max(0, timeline.scrollHeight - timeline.clientHeight - timeline.scrollTop);

// Capture a visible message rather than total height: appends and older pages can arrive together.
export function captureChatScroll(timeline) {
  if (!timeline) return null;
  const top = timeline.getBoundingClientRect().top;
  const anchor = [...timeline.querySelectorAll('[data-message-id]')].find(node => node.getBoundingClientRect().bottom > top);
  return {top:timeline.scrollTop, following:distanceFromEnd(timeline) <= 40,
    anchor:anchor ? {id:anchor.dataset.messageId, offset:anchor.getBoundingClientRect().top - top} : null};
}

export function restoreChatScroll(timeline, saved, sameView) {
  if (!timeline) return;
  if (!sameView || !saved || saved.following) timeline.scrollTop = timeline.scrollHeight;
  else {
    timeline.scrollTop = saved.top;
    const anchor = saved.anchor && [...timeline.querySelectorAll('[data-message-id]')].find(node => node.dataset.messageId === saved.anchor.id);
    if (anchor) timeline.scrollTop += anchor.getBoundingClientRect().top - timeline.getBoundingClientRect().top - saved.anchor.offset;
  }
}
