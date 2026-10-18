// Update the current screen without disconnecting its editor. In particular,
// removing and refocusing a textarea cancels Android's live IME composition.
export function createDomRenderer(root) {
  const composing = new WeakSet(), desiredValues = new WeakMap();
  const namedField = node => node?.nodeType === 1 && /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);
  const controlled = node => ['draft','search','chatSearch','chatFind'].includes(node.name) || node.form?.hasAttribute('data-state-fields');
  const key = node => {
    if (node.nodeType !== 1) return '';
    const prefix = node.tagName;
    if (node.id) return `${prefix}:id:${node.id}`;
    if (node.hasAttribute('data-message-id')) return `${prefix}:message:${node.dataset.messageId}`;
    if (node.hasAttribute('data-read-resource')) return `${prefix}:read:${node.dataset.readResource}`;
    if (node.name) return `${prefix}:field:${node.name}:${node.type || ''}:${/^(radio|checkbox)$/.test(node.type) ? node.value : ''}`;
    if (node.hasAttribute('data-form')) return `${prefix}:form:${node.dataset.form}`;
    if (node.hasAttribute('data-action')) return `${prefix}:action:${node.dataset.action}:${node.dataset.id || node.dataset.tab || ''}`;
    return node.classList.length ? `${prefix}:class:${node.classList[0]}` : '';
  };
  const compatible = (a,b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName && key(a) === key(b));
  function remember(node) {
    if (namedField(node)) desiredValues.set(node, node.type === 'checkbox' || node.type === 'radio' ? node.checked : node.value);
    for (const child of node.children || []) remember(child);
  }
  function attributes(current,next) {
    for (const attribute of [...current.attributes]) if (!(current.tagName === 'DETAILS' && attribute.name === 'open') && !next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of next.attributes) if (!(current.tagName === 'DETAILS' && attribute.name === 'open') && current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name,attribute.value);
  }
  function patch(current,next) {
    if (current.nodeType !== 1) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    // Unchanged histories retain decoded image nodes and avoid cloning or
    // serializing the entire timeline for every auxiliary status response.
    if (current.classList.contains('chat-timeline') && current.isEqualNode(next)) return;
    if (namedField(current)) {
      const checkbox = current.type === 'checkbox' || current.type === 'radio';
      const wanted = checkbox ? next.checked : next.value, previous = desiredValues.get(current);
      const value = checkbox ? current.checked : current.value;
      attributes(current,next);
      // A live composing value may be ahead of the last input event. A poll
      // must never replace it with an older model value. No deferred write is
      // replayed at compositionend; the editor reports its final live value.
      if (controlled(current) && wanted !== previous && !composing.has(current) && value !== wanted) {
        if (checkbox) current.checked = wanted; else current.value = wanted;
      }
      desiredValues.set(current,wanted);
      if (current.tagName !== 'SELECT') return;
      children(current,next);
      if (controlled(current) && !composing.has(current) && wanted !== previous && current.value !== wanted) current.value = wanted;
      return;
    }
    attributes(current,next);
    children(current,next);
  }
  function children(current,next) {
    const original = [...current.childNodes], used = new Set();
    const wantedChildren = [...next.childNodes];
    const wantedKeys = new Set(wantedChildren.map(key).filter(Boolean)), byKey = new Map();
    for (const child of original) {
      const identity = key(child);
      if (identity) { if (!byKey.has(identity)) byKey.set(identity,[]); byKey.get(identity).push(child); }
    }
    // Delete disappeared status siblings first. Moving a still-focused form
    // around one of them would restart the keyboard even with identical nodes.
    for (const child of original) if (key(child) && !wantedKeys.has(key(child))) child.remove();
    let cursor = current.firstChild;
    for (const wanted of wantedChildren) {
      let match = cursor && !used.has(cursor) && compatible(cursor,wanted) ? cursor : null;
      if (!match && key(wanted)) match = byKey.get(key(wanted))?.find(node => node.parentNode === current && !used.has(node) && compatible(node,wanted));
      if (!match) {
        match = wanted.cloneNode(true); remember(match); current.insertBefore(match,cursor);
      } else {
        if (match !== cursor) {
          if (match.contains(current.ownerDocument.activeElement)) {
            while (cursor && cursor !== match) {
              const following = cursor.nextSibling;
              current.insertBefore(cursor,match.nextSibling); cursor = following;
            }
          } else current.insertBefore(match,cursor);
        }
        patch(match,wanted);
      }
      used.add(match); cursor = match.nextSibling;
    }
    for (const child of original) if (!used.has(child)) child.remove();
  }
  return {
    compositionStart(field) { if (namedField(field) && root.contains(field)) composing.add(field); },
    compositionEnd(field) { composing.delete(field); },
    update(fragment,{sameView = false} = {}) {
      if (!sameView) { root.replaceChildren(fragment); remember(root); return; }
      children(root,fragment);
    },
  };
}
