// Business failure ends immediately; only positive process evidence reserves a slot.
export function executionProcessActive(result) {
  while (result && typeof result === 'object') {
    if (result.processAlive === true || result.processExit?.activeProcesses > 0) return true;
    result = result.result;
  }
  return false;
}
