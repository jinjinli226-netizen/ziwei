"""Execution-local maintenance at a durable, completed native tool boundary."""
import functools
import hashlib
import importlib
import inspect
import json
import os
from pathlib import Path
import re
import sqlite3
import threading
import uuid


class CheckpointError(Exception):
    pass


def _require(value):
    if not value:
        raise CheckpointError('MAINTENANCE_CHECKPOINT_INVALID')


def _hex(value):
    return isinstance(value, str) and re.fullmatch(r'[a-f0-9]{64}', value) is not None


def _identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,199}', value) is not None


def _path(value):
    _require(isinstance(value, str) and '\0' not in value and Path(value).is_absolute())
    p = Path(value)
    for item in (p, *p.parents):
        _require(not item.is_symlink())
    return p.resolve(strict=True)


def _write(file, value):
    temporary = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
            stream.flush()
            os.fsync(stream.fileno())
        _require(not file.is_symlink())
        os.replace(temporary, file)
    finally:
        temporary.unlink(missing_ok=True)


def _canonical(value):
    if isinstance(value, bytes):
        return {'sqliteBlobHex': value.hex()}
    if isinstance(value, dict):
        return {key: _canonical(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    return value


def session_snapshot(home, session_id):
    """Read exactly one native transcript; no writes or transcript repair."""
    _require(_identifier(session_id))
    database = _path(str(Path(home) / 'state.db'))
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA query_only=ON')
        db.row_factory = sqlite3.Row
        columns = [row[1] for row in db.execute('PRAGMA table_info(messages)')]
        _require({'id', 'session_id', 'role', 'tool_calls', 'tool_call_id'}.issubset(columns))
        rows = [dict(row) for row in db.execute('SELECT * FROM messages WHERE session_id=? ORDER BY id', (session_id,))]
    _require(bool(rows))
    pending = set()
    for row in rows:
        calls = row.get('tool_calls')
        if row['role'] == 'assistant' and calls:
            calls = json.loads(calls) if isinstance(calls, str) else calls
            _require(isinstance(calls, list))
            for call in calls:
                call_id = call.get('id') if isinstance(call, dict) else None
                _require(_identifier(call_id) and call_id not in pending)
                pending.add(call_id)
        if row['role'] == 'tool':
            call_id = row.get('tool_call_id')
            _require(call_id in pending)
            pending.remove(call_id)
    encoded = json.dumps(_canonical({'sessionId': session_id, 'columns': columns, 'rows': rows}), sort_keys=True, separators=(',', ':'), ensure_ascii=True, allow_nan=False)
    return {'checkpointDigest': hashlib.sha256(encoded.encode('utf-8')).hexdigest(), 'messageCount': len(rows), 'pendingTools': len(pending)}



def _audit_events(file):
    if file is None:
        return None
    path = _path(file)
    _require(path.is_file() and path.stat().st_size <= 16 * 1024 * 1024)
    rows = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines() if line.strip()]
    _require(all(isinstance(row, dict) for row in rows))
    _require(any(row.get('method') in ('initialize', 'tools/list') and row.get('ok') is True for row in rows))
    return rows


def external_receipts_ready(audits):
    """Observe only scoped protocol metadata; never issue or replay a command."""
    try:
        _require(isinstance(audits, dict) and set(audits).issubset({'phone', 'management'}))
        phone = _audit_events(audits.get('phone'))
        management = _audit_events(audits.get('management'))
        issued = {}
        submit_tools = {'ziwei_phone_action', 'ziwei_phone_screenshot', 'ziwei_phone_upgrade'}
        read_tools = {'ziwei_phone_list', 'ziwei_phone_status', 'ziwei_phone_receipt',
                      'ziwei_phone_wait', 'ziwei_enrollment_pending'}
        for row in phone or []:
            if row.get('method') != 'tools/call':
                continue
            name = row.get('toolName')
            # Control changes, enrollment approval and future/unknown tools do
            # not have a terminal command receipt in this audit format. Even
            # ok=True only proves the RPC returned, not that no external work
            # remains. Neither maintenance nor compression may infer otherwise.
            if name not in read_tools | submit_tools:
                return False
            submit = name in submit_tools
            if submit and not any(row.get(key) for key in ('commandId', 'updateId')):
                if row.get('commandExecutionState') != 'not_started':
                    return False
            for kind in ('command', 'update'):
                key = (kind, row.get(kind + 'Id'))
                if not key[1]:
                    continue
                _require(_identifier(key[1]))
                if submit:
                    issued.setdefault(key, {})
                if key in issued and row.get('ok') is True:
                    status = row.get(kind + 'Status') or row.get('status')
                    if status:
                        issued[key]['status'] = status
                    if kind == 'command' and 'commandExecutionState' in row:
                        issued[key]['executionState'] = row['commandExecutionState']
            if row.get('ok') is True:
                for item in row.get('receipts', []):
                    for kind in ('command', 'update'):
                        key = (kind, item.get(kind + 'Id'))
                        if key in issued and item.get('status'):
                            issued[key]['status'] = item['status']
                            if kind == 'command' and 'executionState' in item:
                                issued[key]['executionState'] = item['executionState']
        failures = {'failed', 'expired', 'cancelled', 'superseded', 'aborted', 'rejected', 'timed_out'}
        for (kind, _id), item in issued.items():
            status, state = item.get('status'), item.get('executionState')
            if status not in failures | {'succeeded' if kind == 'command' else 'committed'} or state in ('pending', 'uncertain'):
                return False
        reads = {'ziwei_mcp_health', 'ziwei_discover_environment', 'ziwei_get_employee', 'ziwei_get_employee_mcp_status', 'ziwei_get_action', 'ziwei_get_task', 'ziwei_list_employees', 'ziwei_list_tasks', 'ziwei_list_documents', 'ziwei_read_document', 'ziwei_phone_mcp_setup', 'ziwei_get_phone_mcp_status'}
        for row in management or []:
            if row.get('method') == 'tools/call':
                # The existing management audit deliberately omits arguments and
                # async action state. Unknown writes/async dispatch therefore
                # wait for normal idle rather than fabricate completion.
                if row.get('toolName') not in reads:
                    return False
        return True
    except Exception:
        return False

def install(settings_file, native_root, agent_class=None, process_registry=None):
    """Chain the real agent, never native files or the user's plugin config."""
    settings = json.loads(_path(settings_file).read_text(encoding='utf-8'))
    _require(settings.get('schemaVersion') == 1 and _identifier(settings.get('actionId')) and _hex(settings.get('executionBinding')) and _hex(settings.get('nonce')))
    home, cwd, directory = (_path(settings.get(key)) for key in ('home', 'cwd', 'directory'))
    _require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', settings.get('profile', '')) is not None)
    _require(_path(os.environ.get('HERMES_HOME')) == home and Path.cwd().resolve() == cwd)
    root = _path(native_root)
    ready = directory / 'ready.json'
    def state(**value):
        _write(ready, {'schemaVersion': 1, 'nonce': settings['nonce'], **value})
    required = ('run_conversation', '_execute_tool_calls', '_flush_messages_to_session_db', '_persist_session', 'interrupt')
    if agent_class is None:
        try:
            module = importlib.import_module('run_agent')
            _require(Path(module.__file__).resolve() == root / 'run_agent.py')
            agent_class = module.AIAgent
        except (ImportError, AttributeError, CheckpointError):
            state(supported=False, reasonCode='MAINTENANCE_CHECKPOINT_UNSUPPORTED')
            if settings.get('resume') is not None:
                raise CheckpointError('MAINTENANCE_RESUME_REJECTED') from None
            return lambda: None
    parser = ''.join(p.read_text(encoding='utf-8') for p in (root / 'hermes_cli/main.py', root / 'hermes_cli/_parser.py') if p.is_file())
    supported = '--resume' in parser and '--no-restore-cwd' in parser
    shapes = {'run_conversation': (None, 'query'), '_execute_tool_calls': (None, None, [], 'task'), '_flush_messages_to_session_db': (None, []), '_persist_session': (None, []), 'interrupt': (None,)}
    try:
        for name in required:
            method = getattr(agent_class, name, None)
            _require(callable(method) and not inspect.iscoroutinefunction(method) and not inspect.isgeneratorfunction(method))
            inspect.signature(method).bind(*shapes[name])
        if process_registry is None:
            module = importlib.import_module('tools.process_registry')
            _require(Path(module.__file__).resolve() == root / 'tools/process_registry.py')
            process_registry = module.process_registry
        _require(callable(getattr(process_registry, 'has_any_active', None)))
    except Exception:
        supported = False
    if not supported:
        state(supported=False, reasonCode='MAINTENANCE_CHECKPOINT_UNSUPPORTED')
        if settings.get('resume') is not None:
            raise CheckpointError('MAINTENANCE_RESUME_REJECTED')
        return lambda: None
    resume = settings.get('resume')
    if resume is not None:
        _require(isinstance(resume, dict) and all(resume.get(key) == settings[key] for key in ('actionId', 'executionBinding', 'profile', 'home', 'cwd')) and resume.get('runtime') == 'Hermes')
        snapshot = session_snapshot(home, resume.get('sessionId'))
        _require(snapshot['pendingTools'] == 0 and all(resume.get(key) == value for key, value in snapshot.items()))
    lock = threading.RLock()
    owner = None
    paused = None
    finalized = False
    enabled = True
    original_run, original_tools = agent_class.run_conversation, agent_class._execute_tool_calls
    def request():
        if not enabled:
            return None
        try:
            value = json.loads(_path(str(directory / 'request.json')).read_text(encoding='utf-8'))
        except FileNotFoundError:
            return None
        _require(set(value) == {'schemaVersion', 'nonce', 'id', 'targetBuild'} and value['schemaVersion'] == 1 and value['nonce'] == settings['nonce'] and _identifier(value['id']) and _hex(value['targetBuild']))
        return value
    def flush(agent, messages):
        _require(not getattr(agent, '_incremental_persistence_failed', False))
        _require(agent._flush_messages_to_session_db(messages) is not False)
        _require(_path(os.environ.get('HERMES_HOME')) == home and Path.cwd().resolve() == cwd)
        value = session_snapshot(home, getattr(agent, 'session_id', None))
        _require(value['pendingTools'] == 0)
        return value
    def background_idle():
        try:
            return process_registry.has_any_active() is False
        except Exception:
            return False
    def primary(agent):
        # Compression lineage is allowed for a root CLI session. Delegates and
        # persistence-isolated review/memory forks cannot claim its boundary.
        return not (getattr(agent, '_persist_disabled', False) or getattr(agent, '_delegate_depth', 0) or getattr(agent, '_side_agent', False) or getattr(agent, 'side_agent', False) or (getattr(agent, '_parent_session_id', None) and getattr(agent, 'platform', None) != 'cli'))
    def interrupt(agent):
        parameters = inspect.signature(agent.interrupt).parameters
        agent.interrupt(**({'tool_reason': 'ziwei_maintenance'} if 'tool_reason' in parameters else {}))
    @functools.wraps(original_tools)
    def tools(agent, assistant_message, messages, *args, **kwargs):
        nonlocal paused, enabled
        if agent is not owner:
            return original_tools(agent, assistant_message, messages, *args, **kwargs)
        current = request()
        # A completed dispatch may own background child agents. Their native
        # lifecycle must finish without an interrupt or a failed-root cleanup.
        if current and (getattr(agent, '_active_children', []) or not background_idle() or not external_receipts_ready(settings.get('audits', {}))):
            current = None
        result = None
        if current:
            # This batch has not dispatched: pair its persisted calls with truthful
            # deferred results, rather than executing or silently dropping them.
            calls = list(assistant_message.tool_calls)
            ids = [getattr(call, 'id', None) for call in calls]
            _require(all(_identifier(value) for value in ids) and len(set(ids)) == len(ids))
            for call in calls:
                messages.append({'role': 'tool', 'tool_call_id': call.id, 'name': call.function.name, 'content': 'Deferred for Ziwei maintenance. This tool call was not dispatched; continue the remaining task after maintenance.'})
        else:
            result = original_tools(agent, assistant_message, messages, *args, **kwargs)
            current = request()
        if current and not getattr(agent, '_active_children', []):
            if not background_idle():
                state(supported=True, phase='defer_until_background_exit')
                return result
            if not external_receipts_ready(settings.get('audits', {})):
                state(supported=True, phase='defer_until_receipt')
                return result
            try:
                flush(agent, messages)
            except Exception:
                # Missing/changed persistence capabilities cannot turn a live
                # normal invocation into a forced maintenance stop. Native code
                # still owns any genuine persistence-failure handling.
                enabled = False
                state(supported=False, reasonCode='MAINTENANCE_CHECKPOINT_UNSUPPORTED')
                return result
            paused = (agent, current)
            interrupt(agent)
        return result
    @functools.wraps(original_run)
    def run(agent, *args, **kwargs):
        nonlocal owner, finalized
        with lock:
            if owner is None and primary(agent):
                owner = agent
        if agent is owner and resume is not None:
            _require(getattr(agent, 'session_id', None) == resume['sessionId'])
            actual = session_snapshot(home, resume['sessionId'])
            _require(all(resume.get(key) == value for key, value in actual.items()))
        result = original_run(agent, *args, **kwargs)
        if agent is owner and paused is not None:
            _require(not (isinstance(result, dict) and result.get('failed') is True))
            flush(agent, agent._session_messages)
            finalized = True
        return result
    agent_class._execute_tool_calls, agent_class.run_conversation = tools, run
    state(supported=True, phase='running')
    def finalize():
        if paused is not None and not finalized:
            state(supported=True, phase='failed', reasonCode='MAINTENANCE_CHECKPOINT_UNCONFIRMED')
            raise CheckpointError('MAINTENANCE_CHECKPOINT_UNCONFIRMED')
        if paused is not None:
            agent, intent = paused
            _require(_path(os.environ.get('HERMES_HOME')) == home and Path.cwd().resolve() == cwd)
            _require(background_idle() and not getattr(agent, '_active_children', []))
            _require(external_receipts_ready(settings.get('audits', {})))
            final = session_snapshot(home, agent.session_id)
            _require(final['pendingTools'] == 0)
            receipt = {key: settings[key] for key in ('actionId', 'executionBinding', 'profile', 'home', 'cwd')}
            receipt.update(schemaVersion=1, runtime='Hermes', updateId=intent['id'], targetBuild=intent['targetBuild'], sessionId=agent.session_id, **final)
            _write(directory / 'checkpoint.json', {'schemaVersion': 1, 'nonce': settings['nonce'], 'receipt': receipt})
            state(supported=True, phase='paused')
            return True
        return False
    return finalize
