"""Scoped adaptation of the installed Hermes /compress implementation.

No summary implementation, new-session migration, transcript SQL or retry of
the original user prompt lives here. Hermes owns compression and persistence.
"""
import functools
import importlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import re
import sys


class OfficialCompressionError(Exception):
    pass


def require(condition, code='HERMES_OFFICIAL_COMPRESSION_UNSUPPORTED'):
    if not condition:
        raise OfficialCompressionError(code)


def identifier(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]{0,199}', value) is not None


def module_at(name, root, relative):
    module = importlib.import_module(name)
    require(Path(module.__file__).resolve() == root / relative)
    return module


def closed_tool_history(messages):
    """A completed native batch, including every parallel call, is required."""
    if not isinstance(messages, list) or not messages:
        return False
    pending, seen = set(), set()
    for message in messages:
        if not isinstance(message, dict):
            return False
        calls = message.get('tool_calls')
        if message.get('role') == 'assistant' and calls:
            if not isinstance(calls, list):
                return False
            for call in calls:
                call_id = call.get('id') if isinstance(call, dict) else None
                if not identifier(call_id) or call_id in seen:
                    return False
                seen.add(call_id)
                pending.add(call_id)
        if message.get('role') == 'tool':
            call_id = message.get('tool_call_id')
            if call_id not in pending:
                return False
            pending.remove(call_id)
    return not pending


def interrupted(agent):
    if getattr(agent, '_interrupt_requested', False):
        return True
    event = getattr(agent, '_hard_interrupt_requested', None)
    return bool(event is not None and callable(getattr(event, 'is_set', None)) and event.is_set())


def compress_agent(agent, history, *, native_root, keep_last=None, focus_topic=None, preview=False):
    """Use the same public core and installation sequence as native /compress."""
    root = Path(native_root).resolve(strict=True)
    manual = module_at('agent.conversation_compression_manual', root, 'agent/conversation_compression_manual.py')
    lifecycle = module_at('agent.conversation_compression', root, 'agent/conversation_compression.py')
    compress_now, finalize = manual.compress_now, lifecycle.finalize_context_engine_compression_notification
    require(not inspect.iscoroutinefunction(compress_now) and not inspect.iscoroutinefunction(finalize))
    old_session = getattr(agent, 'session_id', None)
    require(identifier(old_session), 'HERMES_COMPRESSION_SESSION_INVALID')
    require(closed_tool_history(history), 'HERMES_COMPRESSION_PENDING_TOOLS')
    require(not interrupted(agent), 'HERMES_COMPRESSION_CANCELLED')
    require(not getattr(agent, '_incremental_persistence_failed', False), 'HERMES_COMPRESSION_PERSISTENCE_FAILED')
    require(keep_last is None or type(keep_last) is int and 1 <= keep_last <= 100)
    require(focus_topic is None or isinstance(focus_topic, str) and 0 < len(focus_topic) <= 2000)
    require(type(preview) is bool)
    request = manual.CompressRequest(preview=preview, partial=keep_last is not None,
                                     keep_last=keep_last or 2, focus_topic=focus_topic)
    try:
        inspect.signature(compress_now).bind(agent, history, request, task_id=old_session)
        inspect.signature(finalize).bind(agent, committed=True)
        inspect.signature(agent._flush_messages_to_session_db).bind(history, None)
    except (TypeError, ValueError, AttributeError):
        raise OfficialCompressionError('HERMES_OFFICIAL_COMPRESSION_UNSUPPORTED') from None
    installed = False
    before_count = len(history)
    try:
        outcome = compress_now(agent, history, request, task_id=old_session)
        status = getattr(outcome, 'status', None)
        before, after = getattr(outcome, 'before_tokens', None), getattr(outcome, 'after_tokens', None)
        messages = getattr(outcome, 'after_messages', None)
        summary = getattr(outcome, 'summary', None) or {}
        require(isinstance(summary, dict))
        before_messages = getattr(outcome, 'before_messages', None)
        receipt = {'method': 'official_compress_now', 'status': status if status in {'preview', 'compressed', 'lock_skipped', 'nothing_to_do'} else 'unsupported',
                   'previousSessionId': old_session, 'sessionId': getattr(agent, 'session_id', old_session),
                   'beforeMessages': len(before_messages) if isinstance(before_messages, list) else before_count,
                   'afterMessages': len(messages) if isinstance(messages, list) else None,
                   'beforeTokens': before if type(before) is int and before >= 0 else None,
                   'afterTokens': after if type(after) is int and after >= 0 else None,
                   'aborted': summary.get('aborted') is True, 'fallbackUsed': summary.get('fallback_used') is True,
                   'refusedWouldGrow': summary.get('refused_would_grow') is True, 'noop': summary.get('noop') is True,
                   'persisted': False, 'safeToContinue': False, 'preview': preview}
        if preview:
            return receipt, history
        if status != 'compressed' or receipt['aborted'] or receipt['refusedWouldGrow'] or receipt['noop']:
            finalize(agent, committed=False)
            return receipt, history
        require(isinstance(messages, list) and messages and closed_tool_history(messages), 'HERMES_COMPRESSION_RESULT_INVALID')
        require(identifier(receipt['sessionId']), 'HERMES_COMPRESSION_SESSION_INVALID')
        # Exactly as the native CLI: the official engine owns in-place commits;
        # a rotated official successor must flush its returned history from the
        # engine's own reset index. No local rows or flush offsets are rewritten.
        if receipt['sessionId'] != old_session:
            require(agent._flush_messages_to_session_db(messages, None) is not False, 'HERMES_COMPRESSION_PERSISTENCE_FAILED')
        require(not getattr(agent, '_incremental_persistence_failed', False), 'HERMES_COMPRESSION_PERSISTENCE_FAILED')
        agent._session_messages = messages
        finalize(agent, committed=True)
        installed = True
        receipt['persisted'] = True
        receipt['safeToContinue'] = (type(before) is int and type(after) is int and 0 <= after < before
                                     and not receipt['fallbackUsed'] and not interrupted(agent))
        return receipt, messages
    except Exception:
        if not installed:
            try:
                finalize(agent, committed=False)
            except Exception:
                pass
        raise


def compress_session(args, context, *, native_root):
    """Load a specific session through the native CLI; perform no business turn."""
    session = args.get('sessionId')
    require(identifier(session), 'HERMES_COMPRESSION_SESSION_REQUIRED')
    root, home, cwd = Path(native_root).resolve(strict=True), Path(os.environ['HERMES_HOME']).resolve(strict=True), Path.cwd().resolve()
    cli_module = module_at('cli', root, 'cli.py')
    config = module_at('hermes_cli.config', root, 'hermes_cli/config.py').load_config()
    model = config.get('model') or {}
    require(isinstance(model, dict))
    selected = config.get('platform_toolsets', {}).get('cli', [])
    require(isinstance(selected, list) and all(isinstance(item, str) for item in selected))
    kwargs = {'resume': session, 'model': context.get('model') or model.get('default'),
              'provider': model.get('provider'), 'toolsets': selected}
    try:
        constructor = inspect.signature(cli_module.HermesCLI)
        if 'restore_cwd' in constructor.parameters:
            kwargs['restore_cwd'] = False
        elif 'no_restore_cwd' in constructor.parameters:
            kwargs['no_restore_cwd'] = True
        constructor.bind(**kwargs)
    except (TypeError, ValueError):
        raise OfficialCompressionError('HERMES_OFFICIAL_COMPRESSION_UNSUPPORTED') from None
    cli = None
    try:
        cli = cli_module.HermesCLI(**kwargs)
        # A native resume may restore its historic cwd. Compression must never
        # silently retarget the action's approved directory.
        require(Path.cwd().resolve() == cwd and Path(os.environ['HERMES_HOME']).resolve() == home,
                'HERMES_COMPRESSION_BINDING_CHANGED')
        require(getattr(cli, 'session_id', None) == session, 'HERMES_COMPRESSION_SESSION_MISMATCH')
        require(cli._ensure_runtime_credentials() is True, 'HERMES_COMPRESSION_PROVIDER_UNAVAILABLE')
        require(cli._init_agent() is not False and cli.agent is not None, 'HERMES_COMPRESSION_AGENT_UNAVAILABLE')
        require(getattr(cli.agent, 'session_id', None) == session, 'HERMES_COMPRESSION_SESSION_MISMATCH')
        require(Path.cwd().resolve() == cwd and Path(os.environ['HERMES_HOME']).resolve() == home,
                'HERMES_COMPRESSION_BINDING_CHANGED')
        receipt, messages = compress_agent(cli.agent, cli.conversation_history, native_root=root,
                                          keep_last=args.get('keepLast'), focus_topic=args.get('focusTopic'),
                                          preview=args.get('preview', False))
        cli.conversation_history = messages
        cli.session_id = receipt['sessionId']
        return receipt
    finally:
        # These handles belong only to this compression process. Do not invoke
        # CLI-wide cleanup, run_conversation, memory extraction or global stop.
        if cli is not None:
            agent = getattr(cli, 'agent', None)
            try:
                if agent is not None and callable(getattr(agent, 'close', None)):
                    agent.close()
            finally:
                database = getattr(cli, '_session_db', None)
                if database is not None and callable(getattr(database, 'close', None)):
                    database.close()


def install(native_root, *, maintenance_control=None, agent_class=None, external_ready=None, background_idle=None):
    """One bounded official recovery inside the original supervised CLI process."""
    root = Path(native_root).resolve(strict=True)
    if agent_class is None:
        agent_class = module_at('run_agent', root, 'run_agent.py').AIAgent
    original = getattr(agent_class, 'run_conversation', None)
    require(callable(original) and not inspect.iscoroutinefunction(original))
    if external_ready is None or background_idle is None:
        module = importlib.util.spec_from_file_location('ziwei_compression_boundary', Path(__file__).with_name('hermes-maintenance-checkpoint.py'))
        boundary = importlib.util.module_from_spec(module)
        module.loader.exec_module(boundary)
        if external_ready is None:
            external_ready = lambda: boundary.external_receipts_ready({'phone': os.environ.get('ZIWEI_TERMINAL_AUDIT_FILE') or None,
                                                                       'management': os.environ.get('ZIWEI_MCP_AUDIT_FILE') or None})
        if background_idle is None:
            def background_idle():
                registry = importlib.import_module('tools.process_registry').process_registry
                active = getattr(registry, 'has_any_active', None)
                return callable(active) and not inspect.iscoroutinefunction(active) and active() is False
    owner, attempted = None, False

    def notice(phase, **fields):
        print('ZIWEI_CONTEXT_RECOVERY:' + json.dumps({'schemaVersion': 1, 'phase': phase, **fields}, separators=(',', ':')), file=sys.stderr, flush=True)

    def maintenance_pending():
        if maintenance_control is None:
            return False
        try:
            settings = json.loads(Path(maintenance_control).read_text(encoding='utf-8'))
            request = Path(settings['directory']) / 'request.json'
            return request.exists()
        except Exception:
            return True

    @functools.wraps(original)
    def run(agent, *args, **kwargs):
        nonlocal owner, attempted
        primary = not (getattr(agent, '_persist_disabled', False) or getattr(agent, '_delegate_depth', 0)
                       or getattr(agent, '_side_agent', False) or getattr(agent, 'side_agent', False)
                       or getattr(agent, '_parent_session_id', None) and getattr(agent, 'platform', None) != 'cli')
        if owner is None and primary:
            owner = agent
        result = original(agent, *args, **kwargs)
        typed_overflow = (isinstance(result, dict) and result.get('completed') is not True
                          and result.get('compression_deferred') is not True
                          and (result.get('compression_exhausted') is True or result.get('failure_reason') == 'context_overflow'))
        if agent is not owner or attempted or not typed_overflow:
            return result
        attempted = True
        history = result.get('messages')
        if interrupted(agent) or maintenance_pending():
            notice('deferred_control')
            return result
        if not closed_tool_history(history) or getattr(agent, '_active_children', []):
            notice('blocked_pending_tools')
            return result
        continuation_started = False
        try:
            if not background_idle() or not external_ready():
                notice('blocked_external_receipts')
                return result
            receipt, compressed = compress_agent(agent, history, native_root=root)
            notice('compressed' if receipt['safeToContinue'] else 'compression_not_recovered', **receipt)
            if not receipt['safeToContinue'] or interrupted(agent) or maintenance_pending() or not background_idle() or not external_ready():
                return {**result, 'ziwei_context_recovery': receipt}
            # A continuation is a fresh *remaining-work* turn over the native
            # compacted transcript. Never resend the original user message.
            continuation = ('Continue only the unfinished part of the current task using this officially compacted session. '
                            'Keep completed work and original tool receipts. Do not repeat completed external operations. '
                            'For any uncertain phone or external operation, inspect its original receipt/current state first; '
                            'do not resubmit that operation. Respect any user stop or changed instructions.')
            parameters = inspect.signature(original).parameters
            optional = {key: value for key, value in kwargs.items() if key in {'task_id', 'stream_callback', 'turn_author', 'relay_metadata'} and key in parameters}
            if 'task_id' in parameters and 'task_id' not in optional:
                try:
                    bound = inspect.signature(original).bind(agent, *args, **kwargs)
                    if bound.arguments.get('task_id') is not None:
                        optional['task_id'] = bound.arguments['task_id']
                except (TypeError, ValueError):
                    pass
            continuation_started = True
            resumed = original(agent, continuation, conversation_history=compressed, **optional)
            if isinstance(resumed, dict):
                resumed = {**resumed, 'ziwei_context_recovery': {**receipt, 'continued': True}}
            notice('continued', sessionId=getattr(agent, 'session_id', None))
            return resumed
        except Exception as error:
            if continuation_started:
                # A real follow-up turn may already have executed tools. Keep
                # native exception/persistence handling and its actual audits;
                # never relabel it as an unstarted compression attempt.
                notice('continuation_failed', code='HERMES_CONTEXT_CONTINUATION_FAILED')
                raise
            code = str(error) if isinstance(error, OfficialCompressionError) else 'HERMES_OFFICIAL_COMPRESSION_FAILED'
            notice('failed', code=code)
            return {**result, 'ziwei_context_recovery': {'method': 'official_compress_now', 'status': 'failed', 'code': code, 'continued': False}}
    agent_class.run_conversation = run
    return run
