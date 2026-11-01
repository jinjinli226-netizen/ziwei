const bytes = value => Buffer.byteLength(JSON.stringify(value));

function preview(value, budget = 1000) {
  const text = String(value || '');
  if (bytes(text) <= budget) return text;
  const characters = Array.from(text);
  let low = 0, high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (bytes(characters.slice(0, middle).join('') + '…') <= budget) low = middle;
    else high = middle - 1;
  }
  return characters.slice(0, low).join('') + '…';
}

function pageBefore(items, before) {
  if (!before) return items;
  const index = items.findIndex(item => item.id === before);
  if (index < 0) throw Object.assign(new Error('群聊分页位置已变化，请刷新'), { status: 409, code: 'MIXED_GROUP_CURSOR_CHANGED' });
  return items.slice(0, index);
}

function attachmentPreview(item) {
  return { name: item.attachmentId ? item.name : preview(item.name, 100), mimeType: item.attachmentId ? item.mimeType : preview(item.mimeType, 80),
    ...(item.attachmentId ? { attachmentId: item.attachmentId, conversationId: item.conversationId, size: item.size, sha256: item.sha256, url: item.url, downloadUrl: item.downloadUrl } : {}),
  };
}

export function mobileMixedGroup(group, { before } = {}) {
  const history = pageBefore(group.messages, before), selected = history.slice(-10);
  const messages = selected.map(message => ({ ...message, text: preview(message.text),
    ...(message.error ? { error: preview(message.error, 200) } : {}),
    ...(message.attachments?.length ? { attachments: message.attachments.slice(0, 3).map(attachmentPreview), attachmentCount: message.attachments.length } : {}),
    ...(bytes(message.text) > 1000 ? { textTruncated: true } : {}),
  }));
  const value = { ...group, title: preview(group.title, 300), members: group.members.map(member => ({ ...member, name: preview(member.name, 150) })), messages, runs: (group.runs || []).map(({ output, error, ...run }) => ({ ...run, ...(run.attachments?.length ? { attachments: run.attachments.slice(0, 3).map(attachmentPreview), attachmentCount: run.attachments.length } : {}), ...(error ? { error: preview(error, 200) } : {}) })) };
  while (bytes(value) > 18000 && messages.length > 1) messages.shift();
  value.pagination = { limit: 10, before: before || null, nextBefore: messages[0]?.id || null, hasMore: history.length > messages.length };
  return value;
}

export function mobileMixedGroupList(groups, { before } = {}) {
  let start = 0;
  if (before) {
    start = groups.findIndex(group => group.id === before) + 1;
    if (!start) throw Object.assign(new Error('群聊列表已变化，请刷新'), { status: 409, code: 'MIXED_GROUP_CURSOR_CHANGED' });
  }
  const selected = [];
  for (const group of groups.slice(start, start + 10)) {
    const row = { id: group.id, workspace: group.workspace, title: preview(group.title, 200), state: group.state,
      members: group.members.map(member => ({ employeeId: member.employeeId, name: preview(member.name, 100), runtime: member.runtime })),
      messages: [], updatedAt: group.updatedAt, preview: preview(group.messages.at(-1)?.text, 200) };
    if (bytes({ groups: [...selected, row] }) > 18000) break;
    selected.push(row);
  }
  return { groups: selected, pagination: { nextBefore: selected.at(-1)?.id || null, hasMore: start + selected.length < groups.length } };
}
