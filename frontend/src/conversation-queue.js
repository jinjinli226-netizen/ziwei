export function conversationQueueStatusLabel(status) {
  return {queued:'待发',running:'处理中',cancelled:'已移出待发',failed:'处理失败',expired:'已过期'}[status] || '';
}
