"""Thin, process-scoped calls into the installed Hermes; no replacement state store."""
import asyncio
import base64
from dataclasses import asdict, is_dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid


class NativeOperationError(Exception):
    pass


def decode(value):
    return json.loads(value) if isinstance(value, str) else value


def plain(value):
    if is_dataclass(value):
        return asdict(value)
    if hasattr(value, 'model_dump'):
        return value.model_dump(mode='json', by_alias=True)
    return value


def checked(value):
    value = decode(value)
    if isinstance(value, dict) and value.get('outcome_uncertain'):
        raise NativeOperationError('EXECUTION_UNCERTAIN')
    if isinstance(value, dict) and (value.get('error') or value.get('success') is False or value.get('isError') is True):
        # Credential/provider exception bodies are never returned to the API.
        raise NativeOperationError('NATIVE_OPERATION_REJECTED')
    return value


def home_path(relative):
    home = Path(os.environ['HERMES_HOME']).resolve()
    path = home / relative
    for parent in [path, *path.parents]:
        if parent == home.parent:
            break
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise NativeOperationError('BOT_PATH_REDIRECT')
    if not path.resolve().is_relative_to(home):
        raise NativeOperationError('BOT_PATH_ESCAPE')
    return path


def digest(path):
    # Match Hermes _read_raw_checked: UTF-8 BOM removal and universal newlines.
    return hashlib.sha256(path.read_text(encoding='utf-8-sig').encode('utf-8') if path.exists() else b'').hexdigest()


def scoped_config():
    from hermes_cli.config import load_config
    return load_config()


def native_session(context, create=False):
    from hermes_state import SessionDB
    path = home_path('state.db')
    if not path.exists() and not create:
        return None
    db = SessionDB(db_path=path, read_only=not create)
    try:
        title = 'Ziwei ' + context['conversationId']
        session_id = db.resolve_session_by_title(title)
        if not session_id and create:
            session_id = str(uuid.uuid4())
            db.create_session(session_id, 'cli', model=context.get('model'))
            if not db.set_session_title(session_id, title):
                raise NativeOperationError('SESSION_TITLE_NOT_SAVED')
        return session_id
    finally:
        db.close()


def memory(op, args):
    from tools.memory_tool import MemoryStore, memory_tool
    scope = args.get('scope', 'memory')
    path = home_path('memories/USER.md' if scope == 'user' else 'memories/MEMORY.md')
    config = scoped_config().get('memory', {})
    store = MemoryStore(memory_char_limit=config.get('memory_char_limit', 2200),
                        user_char_limit=config.get('user_char_limit', 1375),
                        memory_enabled=config.get('memory_enabled', True),
                        user_profile_enabled=config.get('user_profile_enabled', True))
    raw, read_ok = store._read_raw_checked(path)
    if not read_ok:
        raise NativeOperationError('MEMORY_READ_FAILED')
    if op == 'write':
        if digest(path) != args['expectedHash']:
            raise NativeOperationError('MEMORY_HASH_CONFLICT')
        old = list(dict.fromkeys(store._parse_entries(raw)))
        new = list(dict.fromkeys(store._parse_entries(args['content'])))
        if old == new:
            result = {'success': True, 'done': True, 'unchanged': True}
        else:
            # This check runs again INSIDE Hermes' file lock, before its scanner,
            # drift guard, final char budget and atomic write.
            read_checked = store._read_raw_checked
            def cas_read(p):
                value, ok = read_checked(p)
                if ok and hashlib.sha256(value.encode('utf-8')).hexdigest() != args['expectedHash']:
                    raise NativeOperationError('MEMORY_HASH_CONFLICT')
                return value, ok
            store._read_raw_checked = cas_read
            if not new:
                if len(old) != 1:
                    raise NativeOperationError('MEMORY_EMPTY_BATCH_REQUIRES_ENTRY_REMOVAL')
                result = decode(memory_tool(action='remove', target=scope, old_text=old[0], store=store))
            else:
                operations = [{'action': 'remove', 'old_text': entry} for entry in sorted(old, key=len, reverse=True)]
                operations.extend({'action': 'add', 'content': entry} for entry in new)
                result = decode(memory_tool(target=scope, operations=operations, store=store))
            checked(result)
        if result.get('staged'):
            return {'scope': scope, 'mutation': result, 'saved': False}
        raw, read_ok = read_checked(path) if old != new else store._read_raw_checked(path)
        if not read_ok or store._parse_entries(raw) != new:
            raise NativeOperationError('MEMORY_READBACK_FAILED')
    else:
        result = None
    return {'scope': scope, 'content': raw, 'entries': store._parse_entries(raw), 'hash': digest(path),
            'limit': config.get('user_char_limit', 1375) if scope == 'user' else config.get('memory_char_limit', 2200),
            'saved': op == 'write', 'mutation': result}


def sessions(op, args):
    from hermes_state import SessionDB
    from tools.session_search_tool import session_search
    path = home_path('state.db')
    if not path.exists():
        return {'success': True, 'results': [], 'mode': 'browse'}
    session_id = args.get('sessionId')
    if session_id and ('/' in session_id or '\\' in session_id):
        raise NativeOperationError('SESSION_SCOPE_INVALID')
    with SessionDB(db_path=path, read_only=True) as db:
        return checked(session_search(query=args.get('query', ''), db=db, profile=None,
                     session_id=session_id, limit=args.get('limit', 10),
                     around_message_id=args.get('aroundMessageId'), window=args.get('window', 5),
                     role_filter=args.get('roleFilter'), after=args.get('after'), before=args.get('before'),
                     sort=args.get('sort')))


def skill_dir(name):
    if not re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', name) or name in {'.', '..'}:
        raise NativeOperationError('SKILL_NAME_INVALID')
    return home_path('skills/' + name)


def skills(op, args, request_id):
    from tools.skills_tool import _find_all_skills, skill_view
    from tools.skills_hub import HubLockFile
    from tools.skills_guard import content_hash, scan_skill, should_allow_install
    from tools.skills_hub_install import quarantine_bundle, install_from_quarantine, uninstall_skill, check_for_skill_updates
    from tools.skills_hub_models import SkillBundle
    from hermes_cli.skills_config import get_disabled_skills
    cfg = scoped_config()
    disabled = get_disabled_skills(cfg, 'cli')
    if op in {'list', 'enable', 'disable'}:
        if op in {'enable', 'disable'} and ((args['name'] in disabled) != (op == 'disable')):
            raise NativeOperationError('SKILL_CONFIG_READBACK_FAILED')
        return {'items': [{**item, 'enabled': item['name'] not in disabled} for item in _find_all_skills(skip_disabled=True)],
                'installed': HubLockFile().list_installed(), 'disabled': sorted(disabled), 'autoLoad': cfg.get('skills', {}).get('auto_load', [])}
    if op == 'read':
        path = skill_dir(args['name'])
        if not (path / 'SKILL.md').exists():
            raise NativeOperationError('SKILL_NOT_FOUND')
        if args['name'] in disabled:
            from tools.skill_manager_tool import _find_skill
            found = _find_skill(args['name'])
            if not found or Path(found['path']).resolve() != path.resolve():
                raise NativeOperationError('SKILL_PATH_SCOPE_INVALID')
            relative = args.get('filePath') or 'SKILL.md'
            file = home_path('skills/' + args['name'] + '/' + relative)
            if not file.resolve().is_relative_to(path.resolve()) or not file.is_file():
                raise NativeOperationError('SKILL_FILE_SCOPE_INVALID')
            result = {'success': True, 'content': file.read_text(encoding='utf-8'), 'name': args['name'], 'enabled': False}
        else:
            result = checked(skill_view(args['name'], file_path=args.get('filePath'), preprocess=False))
        return {**result, 'hash': content_hash(path)}
    if op == 'check_updates':
        return {'items': [{key: value for key, value in item.items() if key != 'bundle'} for item in check_for_skill_updates(args.get('name'))]}
    if op == 'hub_search':
        from tools.skills_hub_search import create_source_router, unified_search
        from tools.skills_hub_sources import WellKnownSkillSource
        sources = [WellKnownSkillSource()] if args.get('source') == 'well-known' else create_source_router()
        return {'items': [asdict(item) for item in unified_search(args.get('query', ''), sources, source_filter=args.get('source', 'all'), limit=args.get('limit', 10))]}
    if op == 'hub_install':
        from hermes_cli.skills_hub import _resolve_source_meta_and_bundle
        from tools.skills_hub_search import create_source_router
        from tools.skills_hub_sources import WellKnownSkillSource
        sources = [WellKnownSkillSource()] if args['identifier'].startswith('well-known:') else create_source_router()
        meta, bundle, source = _resolve_source_meta_and_bundle(args['identifier'], sources)
        if bundle is None:
            raise NativeOperationError('HUB_BUNDLE_UNAVAILABLE')
        name = args.get('name', bundle.name)
        bundle.name = name
    else:
        name = args['name']
        bundle = None
    path = skill_dir(name)
    if op in {'update', 'remove'}:
        if not path.exists() or content_hash(path) != args['expectedHash']:
            raise NativeOperationError('SKILL_HASH_CONFLICT')
    elif path.exists():
        raise NativeOperationError('SKILL_ALREADY_INSTALLED')
    if op == 'remove':
        ok, _ = uninstall_skill(name)
        if not ok or path.exists() or HubLockFile().get_installed(name):
            raise NativeOperationError('SKILL_REMOVE_FAILED')
        return {'name': name, 'removed': True}
    if bundle is None:
        files = args.get('files') or {'SKILL.md': args.get('content', '')}
        if 'SKILL.md' not in files or not all(isinstance(k, str) and isinstance(v, str) for k, v in files.items()):
            raise NativeOperationError('SKILL_BUNDLE_INVALID')
        bundle = SkillBundle(name=name, files=files, source='local', identifier='upload:' + request_id, trust_level='community')
    from agent.skill_utils import parse_frontmatter
    from tools.skill_manager_tool import _validate_frontmatter, _validate_name
    skill_text = bundle.files.get('SKILL.md', '')
    metadata, _ = parse_frontmatter(skill_text)
    if _validate_name(name) or _validate_frontmatter(skill_text, new_skill=False) or not isinstance(metadata.get('name'), str) or metadata['name'] != name:
        raise NativeOperationError('SKILL_IDENTITY_MISMATCH')
    qpath = quarantine_bundle(bundle)
    from agent.skill_utils import iter_skill_index_files
    if {file.resolve() for file in iter_skill_index_files(qpath, 'SKILL.md')} != {(qpath / 'SKILL.md').resolve()}:
        raise NativeOperationError('SKILL_BUNDLE_MULTIPLE_IDENTITIES')
    scan = scan_skill(qpath, source='community')
    allowed, reason = should_allow_install(scan, force=False)
    if allowed is not True:
        return {'name': name, 'installed': False, 'scan': plain(scan), 'requiresReview': True, 'reason': reason}
    installed = install_from_quarantine(qpath, name, '', bundle, scan)
    record = HubLockFile().get_installed(name)
    if installed.resolve() != path.resolve() or not record or not (path / 'SKILL.md').is_file():
        raise NativeOperationError('SKILL_INSTALL_READBACK_FAILED')
    return {'name': name, 'installed': True, 'hash': content_hash(path), 'record': record, 'scanVerdict': scan.verdict}


def env_refs(value):
    if isinstance(value, dict):
        return {key: env_refs(v) for key, v in value.items()}
    if isinstance(value, list):
        return [env_refs(v) for v in value]
    if isinstance(value, str) and re.fullmatch(r'\$\{[A-Z][A-Z0-9_]*\}', value):
        key = value[2:-1]
        if re.match(r'^(ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$)', key):
            raise NativeOperationError('INTERNAL_CREDENTIAL_REFERENCE_FORBIDDEN')
        if not os.environ.get(key):
            raise NativeOperationError('CREDENTIAL_REFERENCE_NOT_CONFIGURED')
        return os.environ[key]
    return value


def mcp(op, args):
    from tools.mcp_tool_discovery import register_mcp_servers, get_mcp_status
    from tools.mcp_tool_lifecycle import shutdown_mcp_servers
    from tools.registry import registry
    logical_server = args['server']
    if not isinstance(logical_server, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', logical_server) or logical_server.startswith('ziwei'):
        raise NativeOperationError('MCP_SERVER_NOT_CONFIGURED')
    servers = scoped_config().get('mcp_servers', {})
    if not isinstance(servers, dict):
        raise NativeOperationError('MCP_SERVER_NOT_CONFIGURED')
    candidates = []
    for name, oauth in [(logical_server, True), ('ziwei_external_' + logical_server, False)]:
        entry = servers.get(name)
        if isinstance(entry, dict) and entry.get('auth') in (('oauth',) if oauth else (None, 'header')) and entry.get('enabled', True) is True:
            candidates.append((name, entry))
    if len(candidates) != 1:
        raise NativeOperationError('MCP_SERVER_NOT_CONFIGURED')
    server, config = candidates[0]
    if config.get('auth') == 'oauth':
        from toolsets import TOOLSETS
        if server == 'all' or server in TOOLSETS:
            raise NativeOperationError('MCP_OAUTH_NAME_CONFLICT')
    if op == 'authorize':
        if config.get('auth') != 'oauth':
            raise NativeOperationError('MCP_OAUTH_REQUIRED')
        import importlib.util
        import sys
        public_codes = {'MCP_OAUTH_REQUIRES_DEPENDENCY', 'MCP_OAUTH_INVALID_CONFIGURATION', 'MCP_OAUTH_RELAY_FAILED',
                        'MCP_OAUTH_RELAY_INVALID_RESPONSE', 'MCP_OAUTH_CANCELLED', 'MCP_OAUTH_EXPIRED',
                        'MCP_OAUTH_STATE_MISMATCH', 'MCP_OAUTH_DENIED', 'MCP_OAUTH_CONNECTION_FAILED',
                        'MCP_OAUTH_TOKEN_NOT_CONFIRMED', 'MCP_OAUTH_NO_TOOLS', 'MCP_OAUTH_FAILED'}
        try:
            spec = importlib.util.spec_from_file_location('ziwei_remote_mcp_oauth', Path(__file__).with_name('hermes-remote-mcp-oauth.py'))
            module = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = module
            spec.loader.exec_module(module)
            return module.authorize_mcp(logical_server, server, config)
        except (ImportError, FileNotFoundError):
            raise NativeOperationError('MCP_OAUTH_REQUIRES_DEPENDENCY') from None
        except Exception as error:
            code = getattr(error, 'code', None)
            raise NativeOperationError(code if isinstance(code, str) and code in public_codes else 'MCP_OAUTH_FAILED') from None
    try:
        names = register_mcp_servers({server: env_refs(config)})
        statuses = [{'name': item.get('name'), 'connected': item.get('connected') is True, 'status': item.get('status')} for item in get_mcp_status() or [] if item.get('name') == server]
        schemas = [{ 'name': name, 'schema': registry.get_schema(name)} for name in names]
        if not statuses or not any(item['connected'] for item in statuses):
            raise NativeOperationError('MCP_CONNECTION_NOT_CONFIRMED')
        if op == 'inspect':
            return {'server': logical_server, 'connected': True, 'tools': schemas, 'status': statuses}
        selected = [item['name'] for item in schemas if item['name'] == args['tool'] or (item['schema'] or {}).get('name') == args['tool']]
        if len(selected) != 1:
            raise NativeOperationError('MCP_TOOL_NOT_ALLOWED')
        result = checked(registry.dispatch(selected[0], args.get('arguments', {})))
        return {'server': logical_server, 'tool': selected[0], 'result': result}
    finally:
        shutdown_mcp_servers()


def control(resource, op, args, context, request_id):
    from hermes_cli.goals import GoalManager, GoalContract, load_goal
    from hermes_cli.heartbeat import HeartbeatManager, load_heartbeat
    sid = native_session(context, create=op not in {'status', 'pause', 'resume', 'stop'})
    if not sid:
        return {'sessionId': None, 'state': None, 'run': False}
    is_goal = resource == 'goals'
    mgr = GoalManager(sid, default_max_turns=context['config']['maxTurns']) if is_goal else HeartbeatManager(sid)
    load = load_goal if is_goal else load_heartbeat
    if op == 'start':
        if is_goal:
            mgr.set(args['objective'], max_turns=args.get('maxTurns', context['config']['maxTurns']), contract=GoalContract(**args.get('contract', {})))
        else:
            mgr.set(args['prompt'], args['intervalSeconds'])
    elif op == 'pause':
        mgr.pause()
    elif op == 'resume':
        if is_goal:
            if not mgr.state or mgr.state.status not in {'paused', 'active'}:
                raise NativeOperationError('GOAL_NOT_RESUMABLE')
            mgr.resume(reset_budget=False)
        else:
            mgr.resume()
    elif op == 'stop':
        mgr.clear()
    elif op == '_prepare':
        if is_goal:
            if mgr.state and mgr.state.turns_used >= context['config'].get('drivers', {}).get('maxTotalTurns', 100):
                mgr.pause(reason='platform-total-turn-budget')
            prompt = mgr.next_continuation_prompt() if mgr.is_active() and not mgr.is_waiting() else None
        else:
            state = mgr.state
            maximum = context['config'].get('drivers', {}).get('maxTotalTurns', 100)
            if state and state.fire_count >= maximum:
                mgr.pause()
                prompt = None
            else:
                prompt = mgr.due_prompt(now=args.get('_now'))
        state = load(sid)
        return {'sessionId': sid, 'state': plain(state), 'prompt': prompt, 'run': bool(prompt)}
    elif op in {'_settle', '_fail'}:
        from hermes_state import SessionDB
        db = SessionDB(db_path=home_path('state.db'))
        try:
            key = 'ziwei.driver.settled:' + request_id + ':' + resource
            previous = db.get_meta(key)
            if previous:
                return json.loads(previous)
            if is_goal:
                if op == '_settle' and args.get('evaluate', True):
                    decision = mgr.evaluate_after_turn(args['response'], user_initiated=False)
                else:
                    from hermes_cli.goals import save_goal
                    if mgr.state:
                        if not args.get('neverStarted'):
                            mgr.state.turns_used += 1
                        mgr.pause(reason='platform-control-revoked' if not args.get('evaluate', True) else 'platform-turn-failed')
                        save_goal(sid, mgr.state)
                    decision = {'status': 'paused', 'should_continue': False, 'reason': 'original-turn-recorded-without-new-model-call'}
            else:
                if op == '_fail' and args.get('neverStarted'):
                    pending = json.loads(db.get_meta('ziwei.driver.pending:' + request_id + ':' + resource) or '{}')
                    prior = pending.get('priorHeartbeat')
                    if prior and mgr.state:
                        mgr._last_claim = (prior['last_fired_at'], prior['fire_count'])
                        mgr.abandon_fire()
                if not args.get('evaluate', True): mgr.pause()
                decision = {'status': plain(load(sid)).get('status') if load(sid) else None, 'should_continue': False}
            result = {'sessionId': sid, 'state': plain(load(sid)), 'decision': decision, 'sourceActionId': args['actionId']}
            db.set_meta(key, json.dumps(result))
            if db.get_meta(key) != json.dumps(result):
                raise NativeOperationError('DRIVER_SETTLEMENT_NOT_SAVED')
            return result
        finally:
            db.close()
    state = load(sid)
    if op not in {'status', 'stop'} and plain(state) != plain(mgr.state):
        raise NativeOperationError('NATIVE_CONTROL_READBACK_FAILED')
    return {'sessionId': sid, 'state': plain(state), 'schedulerAuthority': 'ziwei'}


def kanban(op, args, context, request_id):
    from hermes_cli import kanban_db as kb, kanban_db_connect as kbc
    path = home_path('kanban.db')
    if op == 'list' and not path.exists():
        return {'items': []}
    with kbc.connect_closing(path) as conn:
        if op == 'list':
            return {'items': [asdict(item) for item in kb.list_tasks(conn, tenant=context['employeeId'], status=args.get('status'), limit=args.get('limit', 100))]}
        if op == 'create':
            tid = kb.create_task(conn, title=args['title'], body=args.get('body'), tenant=context['employeeId'],
                     created_by=context['employeeId'], priority=args.get('priority', 0), parents=args.get('parents', []),
                     triage=args.get('triage', False), idempotency_key=request_id, max_retries=0,
                     goal_max_turns=args.get('maxTurns', context['config']['maxTurns']), max_runtime_seconds=context['runBudgetSeconds'], workspace_kind='scratch')
            return {'task': asdict(kb.get_task(conn, tid))}
        tid = args['taskId']
        task = kb.get_task(conn, tid)
        if not task or task.tenant != context['employeeId']:
            raise NativeOperationError('KANBAN_TASK_NOT_FOUND')
        if op in {'claim', '_prepare'}:
            if len(kb.list_runs(conn, tid)) >= min(task.goal_max_turns or 100, context['config'].get('drivers', {}).get('maxTotalTurns', 100)):
                raise NativeOperationError('KANBAN_TOTAL_TURN_BUDGET')
            claimed = kb.claim_task(conn, tid, ttl_seconds=context['runBudgetSeconds'] + 60, claimer=context['employeeId'])
            if not claimed:
                raise NativeOperationError('KANBAN_CLAIM_CONFLICT')
            return {'task': asdict(claimed), 'prompt': kb.build_worker_context(conn, tid), 'run': True}
        if op == 'complete':
            ok = kb.complete_task(conn, tid, result=args.get('result'), summary=args.get('summary'), expected_run_id=args.get('runId'), fire_lifecycle_hook=False)
        elif op == 'block':
            ok = kb.block_task(conn, tid, reason=args.get('reason'), expected_run_id=args.get('runId'))
        elif op == 'unblock':
            ok = kb.unblock_task(conn, tid)
        elif op == 'edit':
            if 'result' in args:
                ok = kb.edit_completed_task_result(conn, tid, result=args['result'], summary=args.get('summary'))
            elif task.status == 'triage':
                ok = kb.specify_triage_task(conn, tid, title=args.get('title'), body=args.get('body'), author=context['employeeId'])
            else:
                raise NativeOperationError('KANBAN_NATIVE_EDIT_STATE_UNSUPPORTED')
        elif op == 'show':
            ok = True
        elif op in {'_settle', '_fail'}:
            if kb.goal_run_status(conn, tid, expected_run_id=args['runId']) not in {'running', 'active'}:
                return {'task': asdict(kb.get_task(conn, tid)), 'settled': False, 'reason': 'run_already_terminal'}
            # A finite model turn is not evidence of task acceptance. The native
            # goal judge decides; only done commits the original claimed run.
            if op == '_settle' and args.get('evaluate', True):
                from hermes_cli.goals import judge_goal
                verdict, reason, parse_failed, wait, transport_failed = judge_goal(task.title + '\n' + (task.body or ''), args['response'])
            else:
                verdict, reason, parse_failed, transport_failed = 'blocked', 'Platform control revoked or finite turn failed', False, False
            if verdict == 'done' and not parse_failed and not transport_failed:
                ok = kb.complete_task(conn, tid, result=args['response'], expected_run_id=args['runId'], fire_lifecycle_hook=False)
            else:
                ok = kb.block_task(conn, tid, reason=reason or 'Finite turn needs follow-up', expected_run_id=args['runId'])
            if not ok:
                raise NativeOperationError('KANBAN_SETTLEMENT_CONFLICT')
            return {'task': asdict(kb.get_task(conn, tid)), 'verdict': verdict, 'reason': reason, 'sourceActionId': args['actionId']}
        else:
            raise NativeOperationError('KANBAN_OPERATION_UNSUPPORTED')
        if not ok:
            raise NativeOperationError('KANBAN_MUTATION_REJECTED')
        return {'task': asdict(kb.get_task(conn, tid)), 'runs': [asdict(item) for item in kb.list_runs(conn, tid)]}


def voice(op, args, context):
    cfg = scoped_config()
    if op in {'status', 'configure'}:
        def status(kind):
            section = cfg.get(kind, {})
            requested = context['config'].get('voice', {}).get(kind, {})
            provider = requested.get('provider')
            return {'provider': provider, 'enabled': requested.get('enabled', bool(provider)), 'configured': bool(provider), 'credentialsReturned': False}
        return {'stt': status('stt'), 'tts': status('tts'), 'transport': 'server_relay'}
    directory = home_path('cache/audio')
    directory.mkdir(parents=True, exist_ok=True)
    requested = context['config'].get('voice', {}).get('stt' if op == 'transcribe' else 'tts', {})
    if not requested.get('provider') or requested.get('enabled') is False:
        raise NativeOperationError('VOICE_PROVIDER_NOT_CONFIGURED')
    selected = cfg.get('stt' if op == 'transcribe' else 'tts', {})
    provider_config = selected.get(selected.get('provider'), {})
    if provider_config.get('api_key'):
        os.environ['VOICE_TOOLS_OPENAI_KEY'] = provider_config['api_key']
    if op == 'transcribe':
        from tools.transcription_tools import transcribe_audio
        suffix = {'audio/wav': '.wav', 'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a'}.get(args.get('mimeType'))
        if suffix is None:
            raise NativeOperationError('AUDIO_MIME_UNSUPPORTED')
        path = directory / (uuid.uuid4().hex + suffix)
        data = base64.b64decode(args['audioBase64'], validate=True)
        if not data or len(data) > 5 * 1024 * 1024:
            raise NativeOperationError('AUDIO_SIZE_INVALID')
        path.write_bytes(data)
        try:
            return checked(transcribe_audio(str(path), model=args.get('model'), source='ziwei_bot'))
        finally:
            path.unlink(missing_ok=True)
    from tools.tts_tool import text_to_speech_tool
    provider = cfg.get('tts', {}).get('provider')
    if args.get('provider') and args['provider'] != provider:
        raise NativeOperationError('VOICE_PROVIDER_OVERRIDE_FORBIDDEN')
    path = directory / (uuid.uuid4().hex + '.wav')
    result = checked(text_to_speech_tool(args['text'], output_path=str(path), speed=args.get('speed'), instructions=args.get('instructions'), provider=provider))
    files = []
    for name in result.get('file_paths', [result.get('file_path')]):
        output = Path(name).resolve()
        if not output.is_relative_to(directory.resolve()) or output.stat().st_size > 5 * 1024 * 1024:
            raise NativeOperationError('VOICE_OUTPUT_SCOPE_INVALID')
        mime = {'.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.opus': 'audio/ogg'}.get(output.suffix)
        if not mime:
            raise NativeOperationError('VOICE_OUTPUT_MIME_UNSUPPORTED')
        files.append({'name': output.name, 'mimeType': mime, 'audioBase64': base64.b64encode(output.read_bytes()).decode('ascii')})
    return {'success': True, 'provider': result.get('provider'), 'files': files, 'voiceCompatible': result.get('voice_compatible'), 'chunkCount': result.get('chunk_count')}


def gateway(op, args):
    from gateway.config import GatewayConfig
    cfg = GatewayConfig.from_dict(scoped_config().get('gateway', {}))
    if op in {'status', 'configure'}:
        return {'configuredPlatforms': [platform.value for platform in cfg.get_connected_platforms()],
                'runtime': gateway_observations(), 'configuredIsConnected': False}
    raise NativeOperationError('GATEWAY_LIFECYCLE_REQUIRES_CONTROLLED_WORKER')


def gateway_observations():
    from gateway.status import read_runtime_status
    runtime = []
    for platform in scoped_config().get('gateway', {}).get('platforms', {}):
        observed = read_runtime_status(home_path('ziwei-gateway-state/' + platform + '.json'))
        if observed:
            fresh = time.time() - observed.get('lastHeartbeat', 0) <= 20
            runtime.append({**observed, 'status': observed.get('status') if fresh or observed.get('status') != 'connected' else 'unconfirmed', 'heartbeatFresh': fresh})
    return runtime


def collaboration(op, args, context, request_id):
    from tools.bot_relay import enqueue_envelope
    from gateway import hosted_rooms as rooms, hosted_room_discussion as discussion
    targets = args.get('targets', [])
    if op == 'publish':
        from gateway.hosted_room_driver import TaskIdentity
        db = home_path('hosted_rooms.db')
        room = rooms.room_state(db, room_id=args['groupId'])
        events = room_log(db, args['groupId'])['events']
        profiles = [item['profile'] for item in room['members']]
        task = discussion.reconstruct_task_plan(room, events, {'identity': TaskIdentity(**args['task']['identity']), 'payload': args['task']['payload']}, local_profiles=profiles)
        publication = discussion.plan_publication(room, events, task, status=args['status'], result=args.get('result'), execution_generation=1, local_profiles=profiles)
        for event in publication.events: rooms.append_event(db, **event.append_kwargs(room['room_id']))
        return groups('read', {'groupId': room['room_id']})
    envelopes = [enqueue_envelope(home_path('collaboration'), target={'profile': item['id'], 'handle': item['id'], 'connection_id': context['workspace']}, message=args['content'], sender_profile=context['employeeId'], sender_handle=context['employeeId']) for item in targets]
    result = {'envelopes': envelopes, 'targetEmployeeIds': [item['id'] for item in targets], 'dispatchAuthority': 'ziwei'}
    if args.get('mode') == 'group':
        db = home_path('hosted_rooms.db')
        rid = args['groupId']
        members = [{'member_id': item['id'], 'profile': item['id'], 'handle': item['id'], 'display_name': item['name'], 'target': {'kind': 'local', 'profile': item['id']}} for item in [{'id': context['employeeId'], 'name': context['name']}, *targets]]
        discussion.validate_roster(members, local_profiles=[item['profile'] for item in members])
        rooms.create_room(db, room_id=rid, name=rid, members=members, authority_gateway_id='ziwei')
        room = rooms.room_state(db, room_id=rid)
        text = args['content']
        # Match the installed native policy exactly, including punctuation;
        # a prefix of an unknown handle must never authorize that mention.
        mentioned = discussion._MENTION_RE.findall(text)
        allowed = {item['member_id'] for item in room['members']}
        if set(mentioned) - allowed: raise NativeOperationError('GROUP_MENTION_NOT_AUTHORIZED')
        if not mentioned: text = ' '.join('@' + item['id'] for item in targets) + '\n' + text
        rooms.append_event(db, room_id=rid, event_id=request_id, kind='message.user', actor={'kind': 'user', 'id': context['employeeId']}, payload={'text': text, 'thread_id': request_id}, authority_gateway_id='ziwei', authority_epoch=room['authority_epoch'])
        result.update(groups('read', {'groupId': rid}))
    return result


def room_log(db, group_id):
    from gateway import hosted_rooms as rooms
    events, cursor = [], 0
    while True:
        page = rooms.read_events(db, room_id=group_id, since_seq=cursor, limit=100)
        events.extend(page['events'])
        if not page['has_more']: return {**page, 'events': events}
        if page['cursor'] <= cursor: raise NativeOperationError('GROUP_LOG_INCOMPLETE')
        cursor = page['cursor']


def group_page(rooms, db, room, args):
    limit, after_seq = args['limit'], args.get('afterSeq', 0)
    safe_integer = lambda value: isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= 9007199254740991
    if not safe_integer(limit) or not 1 <= limit <= 100 or not safe_integer(after_seq):
        raise NativeOperationError('GROUP_PAGE_INPUT_INVALID')
    if not isinstance(room, dict) or room.get('room_id') != args['groupId']:
        raise NativeOperationError('GROUP_PAGE_INVALID')
    if not safe_integer(room.get('authority_epoch')) or room['authority_epoch'] < 1:
        raise NativeOperationError('GROUP_PAGE_INVALID')
    # This is a display-only delta, exactly one native read. It must never
    # become a planner input or silently fall back to the complete room log.
    page = rooms.read_events(db, room_id=args['groupId'], since_seq=after_seq, limit=limit)
    if not isinstance(page, dict) or not isinstance(page.get('events'), list) or len(page['events']) > limit:
        raise NativeOperationError('GROUP_PAGE_INVALID')
    cursor, latest, has_more = page.get('cursor'), page.get('latest_seq'), page.get('has_more')
    if not safe_integer(cursor) or not safe_integer(latest) or cursor < after_seq or latest < cursor or not isinstance(has_more, bool):
        raise NativeOperationError('GROUP_PAGE_INVALID')
    if 'latest_seq' in room and (not safe_integer(room['latest_seq']) or latest < room['latest_seq']):
        raise NativeOperationError('GROUP_PAGE_INVALID')
    previous = after_seq
    for event in page['events']:
        if not isinstance(event, dict) or event.get('room_id') != args['groupId'] or not safe_integer(event.get('seq')) or event['seq'] != previous + 1:
            raise NativeOperationError('GROUP_PAGE_INVALID')
        previous = event['seq']
    authority = page.get('authority')
    if cursor != previous or has_more != (cursor < latest) or has_more and cursor == after_seq:
        raise NativeOperationError('GROUP_PAGE_INVALID')
    if not isinstance(authority, dict) or not isinstance(authority.get('gateway_id'), str) or not authority['gateway_id'] or not safe_integer(authority.get('epoch')) or authority.get('gateway_id') != room.get('authority_gateway_id') or authority.get('epoch') != room.get('authority_epoch'):
        raise NativeOperationError('GROUP_PAGE_INVALID')
    return {'room': room, 'events': page, 'pagedRead': True,
            'pagination': {'limit': limit, 'afterSeq': after_seq, 'nextAfterSeq': cursor, 'hasMore': has_more},
            'decision': None, 'plan': None}


def groups(op, args):
    from gateway import hosted_rooms as rooms
    db = home_path('hosted_rooms.db')
    if op == 'list':
        return {'items': rooms.list_rooms(db) if db.exists() else []}
    if op != 'read' and ('afterSeq' in args or 'limit' in args):
        raise NativeOperationError('GROUP_PAGE_INPUT_INVALID')
    if op == 'read' and 'afterSeq' in args and 'limit' not in args:
        raise NativeOperationError('GROUP_PAGE_INPUT_INVALID')
    room = rooms.room_state(db, room_id=args['groupId'])
    if op == 'read' and 'limit' in args:
        return group_page(rooms, db, room, args)
    from gateway import hosted_room_discussion as discussion
    events = room_log(db, args['groupId'])
    profiles = [item['profile'] for item in room['members']]
    decision = discussion.plan_next_task(room, events['events'], local_profiles=profiles)
    return {'room': room, 'events': events, 'decision': plain(decision), 'plan': plain(decision.task) if decision.task else None}


def run_operation(request, context):
    resource, op, args = request['resource'], request['operation'], request.get('input', {})
    expires = context['config'].get('drivers', {}).get('expiresAt')
    if op == '_prepare' and expires:
        from datetime import datetime
        if datetime.fromisoformat(expires.replace('Z', '+00:00')).timestamp() <= time.time():
            raise NativeOperationError('BOT_DRIVER_EXPIRED')
    os.environ['HERMES_KANBAN_HOME'] = str(home_path(''))
    os.environ['HERMES_KANBAN_DB'] = str(home_path('kanban.db'))
    request_id = request.get('requestId', 'operation')
    pending_db = None
    pending_key = 'ziwei.driver.pending:' + request_id + ':' + resource
    prior_heartbeat = None
    try:
        if resource in {'goals', 'heartbeat', 'kanban'} and op == '_prepare':
            from hermes_state_registry import acquire
            pending_db = acquire(home_path('state.db'))
            if pending_db.get_meta(pending_key):
                raise NativeOperationError('EXECUTION_UNCERTAIN')
            if resource == 'heartbeat':
                from hermes_cli.heartbeat import load_heartbeat
                sid = native_session(context, create=False)
                prior_heartbeat = plain(load_heartbeat(sid)) if sid else None
        if resource == 'memory': data = memory(op, args)
        elif resource == 'sessions': data = sessions(op, args)
        elif resource == 'skills': data = skills(op, args, request_id)
        elif resource == 'mcp': data = mcp(op, args)
        elif resource in {'goals', 'heartbeat'}: data = control(resource, op, args, context, request_id)
        elif resource == 'kanban': data = kanban(op, args, context, request_id)
        elif resource == 'voice': data = voice(op, args, context)
        elif resource == 'gateway': data = gateway(op, args)
        elif resource == 'collaboration': data = collaboration(op, args, context, request_id)
        elif resource == 'groups': data = groups(op, args)
        else: raise NativeOperationError('NATIVE_RESOURCE_UNSUPPORTED')
        if pending_db is not None and data.get('run'):
            pending_db.set_meta(pending_key, json.dumps({**data, 'priorHeartbeat': prior_heartbeat}))
            if not pending_db.get_meta(pending_key): raise NativeOperationError('DRIVER_CLAIM_NOT_SAVED')
        import hermes_cli
        status = 'requires_authorization' if isinstance(data, dict) and (data.get('requiresReview') or (data.get('mutation') or {}).get('staged')) else 'succeeded'
        return {'schemaVersion': 2, 'resource': resource, 'operation': op, 'employeeId': context['employeeId'], 'revision': context['revision'], 'nativeVersion': hermes_cli.__version__, 'status': status, 'data': data}
    finally:
        if pending_db is not None:
            pending_db.close()


def platform_call(isolation, body):
    import urllib.request
    base = os.environ.get('ZIWEI_API_BASE', '').rstrip('/')
    token = os.environ.get('ZIWEI_BOT_DEVICE_TOKEN', '')
    action_id = os.environ.get('ZIWEI_BOT_ACTION_ID', '')
    if not base or not token or not action_id:
        raise NativeOperationError('BOT_COLLABORATION_CREDENTIAL_MISSING')
    request = urllib.request.Request(base + '/a2a/v1/actions/' + action_id + '/bot-collaboration',
                  data=json.dumps(body).encode('utf-8'), headers={'Content-Type': 'application/json', 'X-Ziwei-Device-Token': token}, method='POST')
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def install_collaboration_tools(isolation):
    """Native schemas, platform admission; native subagent/terminal spawn disabled."""
    from tools.registry import registry
    from tools import bot_mode_dm, delegate_tool
    import run_agent
    from toolsets import TOOLSETS
    def dm(target='', message='', task_id=None, agent=None):
        try:
            data = platform_call(isolation, {'mode': 'message', 'targetEmployeeIds': [target], 'content': message, 'idempotencyKey': 'dm:' + hashlib.sha256(json.dumps([os.environ.get('ZIWEI_BOT_ACTION_ID'), task_id, target, message]).encode()).hexdigest()})
            envelopes = [enqueue_native(item['payload']['employeeId'], message, isolation) for item in data.get('actions', [])]
            return json.dumps({'status': 'dispatched', 'actions': [{'id': item['id'], 'status': item['status']} for item in data.get('actions', [])], 'envelopes': envelopes})
        except Exception:
            return json.dumps({'error': 'BOT_COLLABORATION_OUTCOME_UNCONFIRMED', 'outcome_uncertain': True})
    def delegate(args, agent=None):
        try:
            action = args.get('action', 'spawn')
            if action == 'list':
                return json.dumps(platform_call(isolation, {'operation': 'list'}))
            if action != 'spawn':
                return json.dumps({'error': 'Use the platform Bot stop control for owned work; no native process is spawned.'})
            tasks = args.get('tasks') or [{'goal': args.get('goal'), 'context': args.get('context'), 'target_employee_id': args.get('target_employee_id')}]
            dispatched = []
            for index, task in enumerate(tasks[:5]):
                target = task.get('target_employee_id')
                if not target:
                    match = re.search(r'@(employee_[A-Za-z0-9_-]+)', task.get('context') or '')
                    target = match.group(1) if match else None
                if not target:
                    raise NativeOperationError('DELEGATION_EXPLICIT_TARGET_REQUIRED')
                text = (task.get('goal') or '') + '\n' + (task.get('context') or '')
                result = platform_call(isolation, {'mode': 'delegate', 'targetEmployeeIds': [target], 'content': text, 'idempotencyKey': 'delegate:' + hashlib.sha256(json.dumps([os.environ.get('ZIWEI_BOT_ACTION_ID'), index, target, text]).encode()).hexdigest()})
                dispatched.extend(result.get('actions', []))
                enqueue_native(target, text, isolation)
            return json.dumps({'status': 'dispatched', 'mode': 'background', 'count': len(dispatched), 'delegation_id': os.environ['ZIWEI_BOT_ACTION_ID'], 'subagent_ids': [item['id'] for item in dispatched], 'goals': [task.get('goal') for task in tasks]})
        except Exception:
            return json.dumps({'error': 'BOT_DELEGATION_OUTCOME_UNCONFIRMED', 'outcome_uncertain': True})
    bot_mode_dm.message_agent_tool = dm
    delegate_tool.delegate_task = lambda **kwargs: delegate(kwargs, kwargs.get('parent_agent'))
    run_agent.AIAgent._dispatch_delegate_task = lambda agent, args: delegate(args, agent)
    registry.register(name='message_agent', toolset='ziwei_collaboration', schema=bot_mode_dm.message_agent_tool_schema()['function'], handler=lambda args, **kw: dm(**args), override=True)
    schema = json.loads(json.dumps(delegate_tool.DELEGATE_TASK_SCHEMA))
    schema['parameters']['properties']['target_employee_id'] = {'type': 'string', 'description': 'An explicitly authorized current workspace employee ID.'}
    task_schema = schema['parameters']['properties'].get('tasks', {}).get('items', {})
    task_schema.setdefault('properties', {})['target_employee_id'] = {'type': 'string'}
    registry.register(name='delegate_task', toolset='ziwei_collaboration', schema=schema, handler=lambda args, **kw: delegate(args, kw.get('parent_agent')), override=True)
    TOOLSETS['ziwei_collaboration'] = {'tools': ['message_agent', 'delegate_task'], 'description': 'Workspace-controlled native Bot collaboration.'}
    # The wrapped delegate now belongs to the scoped platform toolset. The
    # original native delegation resolver must not re-add/strip its old spawn.
    TOOLSETS['delegation']['tools'] = []


def enqueue_native(target, text, isolation):
    from tools.bot_relay import enqueue_envelope
    return enqueue_envelope(home_path('collaboration'), target={'profile': target, 'handle': target, 'connection_id': isolation['workspace']}, message=text, sender_profile=isolation['employeeId'], sender_handle=isolation['employeeId'])


def adapter_state(adapter):
    """Running is a prerequisite, never proof that a receiver is usable."""
    if adapter.has_fatal_error:
        code = adapter.fatal_error_code or 'GATEWAY_ADAPTER_FATAL'
        return 'failed', code if re.fullmatch(r'[A-Za-z0-9_-]{1,100}', code) else 'GATEWAY_ADAPTER_FATAL'
    if not adapter.is_connected:
        return 'disconnected', 'GATEWAY_ADAPTER_DISCONNECTED'


def task_live(task):
    return task is not None and not task.done()


def socket_open(socket):
    if socket is None: return False
    value = getattr(socket, 'open', None)
    if isinstance(value, bool): return value
    state = getattr(getattr(socket, 'state', None), 'name', None)
    return state == 'OPEN' if state in {'OPEN', 'CONNECTING', 'CLOSING', 'CLOSED'} else None


def listener_serving(runner):
    return any(getattr(site, '_server', None) and site._server.is_serving() for site in getattr(runner, 'sites', ()))


async def adapter_health(adapter, platform_name):
    """Read installed 0.21.3 receive evidence; no network request or generic task scan."""
    try:
        return await _adapter_receive_health(adapter, platform_name)
    except Exception:
        return adapter_state(adapter) or ('unconfirmed', 'GATEWAY_HEALTH_PROBE_UNAVAILABLE')


async def _adapter_receive_health(adapter, platform_name):
    state = adapter_state(adapter)
    if state: return state
    if adapter.send_path_degraded:
        return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    if platform_name == 'mattermost':
        listener = getattr(adapter, '_ws_task', None)
        if listener is None or listener.done():
            return 'failed', 'GATEWAY_LISTENER_ENDED'
        socket = getattr(adapter, '_ws', None)
        if socket is None or socket.closed:
            return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    elif platform_name == 'webhook':
        if not listener_serving(getattr(adapter, '_runner', None)):
            return 'failed', 'GATEWAY_LISTENER_ENDED'
    elif platform_name == 'slack':
        handler, task = getattr(adapter, '_handler', None), getattr(adapter, '_socket_mode_task', None)
        lock = getattr(adapter, '_socket_reconnect_lock', None)
        if lock is not None and lock.locked(): return 'retrying', 'GATEWAY_RECEIVER_RECONNECTING'
        if handler is None or not task_live(task): return 'retrying', 'GATEWAY_LISTENER_UNAVAILABLE'
        client = getattr(handler, 'client', None)
        # These are the exact SDK receiver/dispatch tasks that the installed
        # adapter cancels before closing Socket Mode. Missing API stays unknown.
        receiver, processor = getattr(client, 'message_receiver', None), getattr(client, 'message_processor', None)
        if receiver is None or processor is None: return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
        if not task_live(receiver) or not task_live(processor): return 'retrying', 'GATEWAY_LISTENER_UNAVAILABLE'
        connected = await asyncio.wait_for(adapter._socket_transport_connected(), timeout=.5)
        state = adapter_state(adapter)
        if state: return state
        if (handler is not adapter._handler or task is not adapter._socket_mode_task
                or receiver is not getattr(client, 'message_receiver', None)
                or processor is not getattr(client, 'message_processor', None)
                or not task_live(task) or not task_live(receiver) or not task_live(processor)
                or lock is not None and lock.locked()):
            return 'retrying', 'GATEWAY_RECEIVER_RECONNECTING'
        if connected is None: return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
        if not connected or adapter._socket_ping_pong_stale(): return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    elif platform_name == 'discord':
        if not task_live(getattr(adapter, '_bot_task', None)) or getattr(adapter, '_disconnecting', False):
            return 'retrying', 'GATEWAY_LISTENER_UNAVAILABLE'
        healthy, _ = adapter._read_websocket_health(getattr(adapter, '_client', None))
        if not healthy: return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    elif platform_name == 'telegram':
        if getattr(adapter, '_webhook_mode', False):
            # PTB webhook listener internals are not installed/verified here.
            return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
        updater = getattr(getattr(adapter, '_app', None), 'updater', None)
        progress = getattr(adapter, '_polling_progress_event', None)
        if not getattr(updater, 'running', False) or not getattr(adapter, '_polling_progress_accepting', False) or progress is None or not progress.is_set():
            return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    elif platform_name == 'feishu':
        if getattr(adapter, '_connection_mode', None) == 'webhook':
            if not listener_serving(getattr(adapter, '_webhook_runner', None)):
                return 'failed', 'GATEWAY_LISTENER_ENDED'
        else:
            loop = getattr(adapter, '_ws_thread_loop', None)
            if not task_live(getattr(adapter, '_ws_future', None)) or loop is None or not loop.is_running():
                return 'retrying', 'GATEWAY_LISTENER_UNAVAILABLE'
            opened = socket_open(getattr(getattr(adapter, '_ws_client', None), '_conn', None))
            if opened is None: return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
            if not opened: return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    elif platform_name == 'dingtalk':
        if not task_live(getattr(adapter, '_stream_task', None)): return 'retrying', 'GATEWAY_LISTENER_UNAVAILABLE'
        opened = socket_open(getattr(getattr(adapter, '_stream_client', None), 'websocket', None))
        if opened is None: return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
        if not opened: return 'retrying', 'GATEWAY_RECEIVE_PATH_UNCONFIRMED'
    else:
        return 'unconfirmed', 'GATEWAY_RECEIVE_HEALTH_UNAVAILABLE'
    return adapter_state(adapter) or ('connected', None)


def run_gateway_worker(request, context):
    """Native adapters only; every model task goes back to Ziwei admission."""
    import queue
    import sys
    import threading
    from gateway.config import Platform, GatewayConfig
    from gateway.run import _instantiate_builtin_adapter
    from gateway.platform_registry import platform_registry
    platform_name = request['input']['platform']
    saved = context['config'].get('gateway', {}).get('platforms', {}).get(platform_name)
    if not saved or not saved.get('enabled'):
        raise NativeOperationError('GATEWAY_PLATFORM_NOT_ENABLED')
    for name, value in env_refs(saved.get('envRefs', {})).items():
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name) or re.match(r'ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$', name): raise NativeOperationError('GATEWAY_ENV_REFERENCE_INVALID')
        os.environ[name] = value
    config = {'enabled': True, 'extra': env_refs(saved.get('extra', {})), 'gateway_restart_notification': False, 'typing_indicator': False}
    if saved.get('tokenEnv'):
        token = os.environ.get(saved['tokenEnv'])
        if not token: raise NativeOperationError('GATEWAY_TOKEN_NOT_CONFIGURED')
        config['token'] = token
        from gateway.config import PLATFORM_TOKEN_ENV_NAMES
        canonical = PLATFORM_TOKEN_ENV_NAMES.get(Platform(platform_name))
        if canonical: os.environ[canonical] = token
    # Native bundled platforms moved to plugins in 0.21.3. Load only the
    # requested adapter plugin; never start a GatewayRunner or its watchers.
    from hermes_cli.plugins import discover_plugins
    discover_plugins()
    from gateway.config_env import _apply_env_overrides
    selected_config = GatewayConfig.from_dict({'platforms': {platform_name: config}})
    _apply_env_overrides(selected_config)
    adapter_config = selected_config.platforms[Platform(platform_name)]
    adapter = platform_registry.create_adapter(platform_name, adapter_config) if platform_registry.is_registered(platform_name) else _instantiate_builtin_adapter(Platform(platform_name), adapter_config)
    if adapter is None:
        raise NativeOperationError('GATEWAY_DEPENDENCY_MISSING')
    allowed = set(saved.get('allowedUsers', []))
    adapter.set_authorization_check(lambda user_id, chat_type=None, chat_id=None, **kw: user_id in allowed or platform_name == 'webhook' and user_id.startswith('webhook:'))
    commands = queue.Queue()
    def read_commands():
        for line in sys.stdin:
            try: commands.put(json.loads(line))
            except Exception: commands.put({'operation': 'invalid'})
        commands.put({'operation': 'disconnect'})
    threading.Thread(target=read_commands, daemon=True).start()
    state_path = home_path('ziwei-gateway-state/' + platform_name + '.json')
    def emit(event, **data):
        print('ZIWEI_GATEWAY_EVENT:' + json.dumps({'event': event, **data}, ensure_ascii=False), flush=True)
    health = {'status': 'starting', 'code': None}
    accepting = False
    closing = False
    connection_generation = 0
    def state(status, code=None):
        from utils import atomic_write_text
        atomic_write_text(state_path, json.dumps({'pid': os.getpid(), 'platform': platform_name, 'status': status, 'code': code, 'lastHeartbeat': time.time(), 'employeeId': context['employeeId'], 'revision': context['revision'], 'controlEpoch': context.get('controlEpoch'), 'sourceActionId': request['actionId']}))
    def update_health(status, code=None):
        nonlocal accepting, connection_generation
        if health['status'] == 'failed': return
        accepting = status == 'connected' and not closing
        if health == {'status': status, 'code': code}: return
        if status == 'connected': connection_generation += 1
        health.update(status=status, code=code)
        state(status, code)
        import hermes_cli
        emit('connected' if status == 'connected' else 'failed' if status == 'failed' else 'status', pid=os.getpid(), platform=platform_name, nativeVersion=hermes_cli.__version__, **health)
    async def refresh_health():
        if not closing: update_health(*(await adapter_health(adapter, platform_name)))
        return accepting
    # This callback closes admission synchronously. Disconnecting here could
    # cancel the native task that is delivering its own fatal notification.
    adapter.set_fatal_error_handler(lambda _: update_health(*(adapter_state(adapter) or ('failed', 'GATEWAY_ADAPTER_FATAL'))))
    async def handler(event):
        if not await refresh_health():
            emit('inbound_rejected', code='GATEWAY_NOT_CONNECTED');return None
        # No prompt payload can choose profile/employee/model or bypass the
        # platform's revision, occupancy and active/validated checks.
        if platform_name != 'webhook' and str(event.source.user_id) not in allowed:
            emit('inbound_rejected', code='GATEWAY_USER_NOT_AUTHORIZED')
            return None
        routes = context['config'].get('gateway', {}).get('profileRoutes', [])
        if routes:
            from gateway.profile_routing import parse_profile_routes, match_profile_route
            native_routes = parse_profile_routes([{**route, 'profile': context['employeeId']} for route in routes])
            route = match_profile_route(native_routes, platform_name, guild_id=getattr(event.source, 'guild_id', None), chat_id=str(event.source.chat_id), thread_id=getattr(event.source, 'thread_id', None), parent_chat_id=getattr(event.source, 'parent_chat_id', None))
            if route is None:
                emit('inbound_rejected', code='GATEWAY_ROUTE_NOT_AUTHORIZED');return None
        message_id = str(event.message_id or '')
        if not message_id:
            emit('inbound_rejected', code='GATEWAY_MESSAGE_ID_REQUIRED')
            return None
        from hermes_state_registry import acquire
        db = acquire(home_path('state.db'))
        try:
            inbound_key = 'ziwei.gateway.inbound:' + hashlib.sha256(json.dumps([platform_name, str(event.source.chat_id), message_id]).encode()).hexdigest()
            record = {'platform': platform_name, 'sourceActionId': request['actionId'], 'messageId': message_id, 'content': event.text, 'chatId': str(event.source.chat_id), 'revision': context['revision'], 'controlEpoch': context.get('controlEpoch'), 'state': 'pending'}
            previous = db.get_meta(inbound_key)
            if previous:
                record = json.loads(previous)
                if record.get('platform') != platform_name or record.get('sourceActionId') != request['actionId']:
                    emit('inbound_rejected', code='GATEWAY_INBOUND_REQUIRES_AUTHORIZATION');return None
                if record.get('state') not in {'pending', 'accepted'}: return None
            else:
                db.set_meta(inbound_key, json.dumps(record))
                if db.get_meta(inbound_key) != json.dumps(record): raise NativeOperationError('GATEWAY_INBOUND_NOT_SAVED')
            emit('inbound', **{key: record[key] for key in ('messageId', 'content', 'chatId')})
            # Parent provides a terminal reply command only after the original
            # platform action result. Receipt acceptance alone never becomes text.
            return None
        finally:
            db.close()
    adapter.set_message_handler(handler)
    async def worker():
        nonlocal accepting, closing
        connected = False
        db = None
        try:
            connected = await asyncio.wait_for(adapter.connect(), timeout=45)
            if not connected:
                update_health('failed', adapter_state(adapter)[1] if adapter.has_fatal_error else 'GATEWAY_CONNECTION_REJECTED');return
            await refresh_health()
            from hermes_state_registry import acquire
            db = acquire(home_path('state.db'))
            restored_generation = 0
            deadline = time.monotonic() + min(86400, max(1, request['input'].get('durationSeconds', 86400)))
            last_heartbeat = time.monotonic()
            while time.monotonic() < deadline:
                await refresh_health()
                if health['status'] in {'failed', 'disconnected'}: break
                if accepting and restored_generation != connection_generation:
                    for key, raw in db.list_meta_prefix('ziwei.gateway.inbound:'):
                        record = json.loads(raw)
                        if record.get('platform') == platform_name and record.get('sourceActionId') == request['actionId'] and record.get('state') in {'pending', 'accepted'} and record.get('revision') == context['revision'] and record.get('controlEpoch') == context.get('controlEpoch'):
                            emit('inbound', **{key: record[key] for key in ('messageId', 'content', 'chatId')})
                    restored_generation = connection_generation
                if time.monotonic() - last_heartbeat >= 5:
                    state(**health);emit('heartbeat', pid=os.getpid(), **health);last_heartbeat = time.monotonic()
                try: command = commands.get_nowait()
                except queue.Empty:
                    await asyncio.sleep(.05);continue
                operation = command.get('operation')
                if operation == 'disconnect': break
                if not await refresh_health():
                    emit('command_result', commandId=command.get('commandId'), success=False, code='GATEWAY_NOT_CONNECTED');continue
                if operation == 'send':
                    delivery_key = None
                    if command.get('messageId'):
                        delivery_key = 'ziwei.gateway.inbound:' + hashlib.sha256(json.dumps([platform_name, str(command['chatId']), command['messageId']]).encode()).hexdigest()
                        previous = db.get_meta(delivery_key)
                        record = json.loads(previous or '{}')
                        if record.get('platform') != platform_name or record.get('sourceActionId') != request['actionId'] or record.get('chatId') != command['chatId']:
                            emit('command_result', commandId=command['commandId'], success=False, code='GATEWAY_DELIVERY_SOURCE_INVALID');continue
                        if record.get('state') not in {'pending', 'accepted'}:
                            emit('command_result', commandId=command['commandId'], success=record.get('state') == 'delivered', duplicate=True, code='EXECUTION_UNCERTAIN' if record.get('state') == 'delivery_started' else 'GATEWAY_REPLY_ALREADY_ATTEMPTED');continue
                        record['state'] = 'delivery_started'
                        claimed = json.dumps(record)
                        if db._write_rowcount('UPDATE state_meta SET value=? WHERE key=? AND value=?', (claimed, delivery_key, previous)) != 1:
                            emit('command_result', commandId=command['commandId'], success=False, code='EXECUTION_UNCERTAIN');continue
                    try:
                        result = await asyncio.wait_for(adapter.send(command['chatId'], command['content'], reply_to=command.get('replyTo')), timeout=30)
                        emit('command_result', commandId=command['commandId'], success=result.success, messageId=result.message_id, code=None if result.success else 'GATEWAY_SEND_REJECTED')
                        if delivery_key:
                            record['state'] = 'delivered' if result.success else 'delivery_failed'
                            db._write_rowcount('UPDATE state_meta SET value=? WHERE key=? AND value=?', (json.dumps(record), delivery_key, claimed))
                    except Exception:
                        emit('command_result', commandId=command['commandId'], success=False, code='EXECUTION_UNCERTAIN')
                elif operation == 'inbound' and platform_name == 'webhook':
                    # Reuse the native signature/dedupe/template pipeline.
                    class LocalRequest:
                        method = 'POST'
                        match_info = {'route_name': command['route']}
                        headers = command.get('headers', {})
                        content_length = len(json.dumps(command['body']).encode())
                        async def read(self): return json.dumps(command['body'], separators=(',', ':')).encode()
                    response = await adapter._handle_webhook(LocalRequest())
                    emit('command_result', commandId=command['commandId'], success=response.status < 400, httpStatus=response.status)
                else:
                    emit('command_result', commandId=command.get('commandId'), success=False, code='GATEWAY_COMMAND_UNSUPPORTED')
        except Exception:
            update_health('failed', 'GATEWAY_CONNECTION_ERROR')
        finally:
            closing = True
            accepting = False
            try:
                await asyncio.wait_for(adapter.disconnect(), timeout=10)
            finally:
                try:
                    if health['status'] != 'failed': update_health('disconnected', health['code'])
                    state(**health);emit('disconnected', pid=os.getpid(), **health)
                finally:
                    if db is not None:
                        db.close()
    asyncio.run(worker())
