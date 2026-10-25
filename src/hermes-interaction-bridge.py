"""Native Hermes prompt ABI adapter. Transport is injected by the trusted device host.

No secret is printed, persisted, passed through a tool result or put into the
conversation. Installing this module alone does not advertise a working relay.
"""
import functools
import base64
import importlib
import json
import os
from pathlib import Path
import threading
import time
import socket
from uuid import uuid4


class InteractionUnsupported(RuntimeError):
    pass


_FIELDS = {'workspaceId', 'employeeId', 'profile', 'deviceId', 'actionId', 'revision', 'controlEpoch'}


def transport_from_environment():
    # Consume private channel material before native tools/subprocesses run.
    address = os.environ.pop('ZIWEI_INTERACTION_PIPE', '')
    encoded_key = os.environ.pop('ZIWEI_INTERACTION_PIPE_KEY', '')
    raw_binding = os.environ.pop('ZIWEI_INTERACTION_BINDING', '')
    if not address and not encoded_key and not raw_binding:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = bytearray(base64.b64decode(encoded_key, validate=True))
        if len(key) != 32:
            raise ValueError()
        binding = json.loads(raw_binding)
        if os.name == 'nt':
            if not address.startswith('\\\\.\\pipe\\ziwei-interaction-'):
                raise ValueError()
        elif not Path(address).is_absolute():
            raise ValueError()
    except Exception:
        raise InteractionUnsupported('HERMES_INTERACTION_TRANSPORT_UNSUPPORTED') from None
    encoded_key = raw_binding = None
    aad = b'ziwei-hermes-interaction-v1'

    def exchange(request):
        nonce = os.urandom(12)
        cipher = AESGCM(bytes(key))
        body = cipher.encrypt(nonce, json.dumps(request, ensure_ascii=False).encode('utf-8'), aad)
        packet = json.dumps({'iv': base64.b64encode(nonce).decode(), 'body': base64.b64encode(body).decode()}).encode() + b'\n'
        connection = None
        stream = None
        try:
            if os.name == 'nt':
                stream = open(address, 'r+b', buffering=0)
            else:
                connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                connection.settimeout(310)
                connection.connect(address)
                stream = connection.makefile('rwb', buffering=0)
            stream.write(packet)
            response = stream.readline(131073)
            if len(response) > 131072 or not response.endswith(b'\n'):
                return None
            response = json.loads(response)
            nonce = base64.b64decode(response['iv'], validate=True)
            body = base64.b64decode(response['body'], validate=True)
            return json.loads(cipher.decrypt(nonce, body, aad))
        finally:
            if stream is not None: stream.close()
            if connection is not None: connection.close()
    def cleanup():
        for index in range(len(key)): key[index] = 0
    return binding, exchange, cleanup


def install_from_environment(root):
    prepared = transport_from_environment()
    if prepared is None:
        return None
    binding, exchange, transport_cleanup = prepared
    try:
        native_cleanup = install(root, binding, exchange)
    except Exception:
        transport_cleanup()
        raise
    def cleanup():
        native_cleanup()
        transport_cleanup()
    return cleanup


def create_callbacks(binding, exchange, *, now=time.time):
    if (not isinstance(binding, dict) or set(binding) != _FIELDS
            or any(not isinstance(binding[k], str) or not binding[k] or len(binding[k]) > 200
                   for k in _FIELDS - {'revision', 'controlEpoch'})
            or any(type(binding[k]) is not int or binding[k] < 0 for k in ('revision', 'controlEpoch'))
            or not callable(exchange)):
        raise InteractionUnsupported('HERMES_INTERACTION_BINDING_INVALID')
    binding = dict(binding)

    def ask(kind, display, *, secure=False, choices=None, options=None):
        request = dict(binding, purpose='hermes-interaction', requestId=str(uuid4()),
                       kind=kind, expiresAt=int(now() + 300), secure=secure,
                       display=display, choices=choices, options=options)
        try:
            # The exchange is blocking; native execution remains in the same
            # tool call until answered/cancelled/expired, never replays the turn.
            response = exchange(request)
            if (now() >= request['expiresAt'] or not isinstance(response, dict)
                    or response.get('requestId') != request['requestId']
                    or response.get('state') != 'answered'
                    or not isinstance(response.get('value'), dict)):
                return None
            return response['value']
        except Exception:
            # Transport exceptions may include bodies/URLs; never propagate.
            return None

    def secret(kind, display, fields):
        answer = ask(kind, display, secure=True)
        if answer is None:
            return None
        try:
            if set(answer) != set(fields) or any(not isinstance(answer[k], str) or not answer[k]
                                                or len(answer[k]) > 16384 for k in fields):
                return None
            return {k: answer[k] for k in fields}
        finally:
            answer.clear()

    def unlock(backend, display_name):
        answer = secret('vault_unlock', {'backend': str(backend)[:100], 'label': str(display_name)[:200]}, ['password'])
        return answer.pop('password') if answer else ''

    def save_login(origin, site):
        return secret('vault_save_login', {'origin': str(origin)[:2000], 'site': str(site)[:200]}, ['identifier', 'password'])

    def code(site, hint):
        answer = secret('vault_code', {'site': str(site)[:200], 'hint': str(hint)[:500]}, ['code'])
        return answer.pop('code') if answer else ''

    def clarify(question, choices=None, *, multi_select=False, questions=None):
        answer = ask('question', {'question': str(question)[:4000], 'questions': questions},
                     choices=choices, options={'multiSelect': multi_select})
        return answer.get('answer') if answer else None

    def approval(command, description, *, allow_permanent=True, allow_session=True,
                 smart_denied=False, **kwargs):
        allowed = ['once', 'deny']
        if not smart_denied:
            if allow_session: allowed.append('session')
            if allow_permanent: allowed.append('always')
        answer = ask('approval', {'command': str(command)[:8000], 'description': str(description)[:4000]}, choices=allowed)
        choice = answer.get('answer') if answer else 'cancelled'
        return choice if choice in allowed or choice == 'cancelled' else 'deny'

    return dict(unlock=unlock, save_login=save_login, code=code, clarify=clarify, approval=approval)


def install(root, binding, exchange):
    """Install only against verified native modules; returns cleanup for this host.

    The host MUST provide an authenticated, encrypted, single-use exchange and
    keep its private IPC out of environment inherited by ordinary tool children.
    """
    root = Path(root).resolve()
    def native(name, relative):
        module = importlib.import_module(name)
        if Path(module.__file__).resolve() != root / relative:
            raise InteractionUnsupported('HERMES_INTERACTION_NATIVE_CHANGED')
        return module
    vault = native('agent.vault_backends.unlock', 'agent/vault_backends/unlock.py')
    context = native('tools.approval_context', 'tools/approval_context.py')
    terminal = native('tools.terminal_tool', 'tools/terminal_tool.py')
    approvals = native('tools.approval', 'tools/approval.py')
    browser_vault = native('tools.browser_vault_tool', 'tools/browser_vault_tool.py')
    agent = native('run_agent', 'run_agent.py').AIAgent
    pairs = [('unlock', 'unlock_prompt'), ('save_login', 'save_login_prompt'), ('code', 'code_prompt')]
    for _, name in pairs:
        if not callable(getattr(vault, 'set_' + name + '_callback', None)) or not callable(getattr(vault, 'get_' + name + '_callback', None)):
            raise InteractionUnsupported('HERMES_INTERACTION_ABI_UNSUPPORTED')
    if not callable(getattr(terminal, '_get_approval_callback', None)) or not callable(getattr(terminal, 'set_approval_callback', None)):
        raise InteractionUnsupported('HERMES_INTERACTION_ABI_UNSUPPORTED')
    for name in ('_is_cron_approval_context', '_is_unattended_platform_approval_context'):
        if not callable(getattr(context, name, None)):
            raise InteractionUnsupported('HERMES_INTERACTION_ABI_UNSUPPORTED')
    if not callable(getattr(approvals, '_presence', None)):
        raise InteractionUnsupported('HERMES_INTERACTION_ABI_UNSUPPORTED')
    redact = native('agent.redact', 'agent/redact.py')
    if not callable(getattr(redact, 'register_vault_redaction_value', None)):
        raise InteractionUnsupported('HERMES_INTERACTION_ABI_UNSUPPORTED')
    def safe_exchange(request):
        response = exchange(request)
        if request.get('secure') and isinstance(response, dict) and isinstance(response.get('value'), dict):
            for value in response['value'].values():
                if isinstance(value, str) and value:
                    redact.register_vault_redaction_value(value)
        return response
    callbacks = create_callbacks(binding, safe_exchange)
    original_run, original_can_prompt = agent.run_conversation, vault.can_prompt_here
    active = threading.local()
    owner = [None]
    original_presence = approvals._presence
    original_save_login = browser_vault.browser_vault_save_login

    @functools.wraps(original_save_login)
    def save_login_result(*args, **kwargs):
        result = original_save_login(*args, **kwargs)
        if not getattr(active, 'enabled', False):
            return result
        try:
            value = json.loads(result)
            # Native Hermes deliberately returns the account identifier as
            # model-visible metadata. Remote secure input keeps that account
            # field private too; no arbitrary exception text crosses the tool.
            safe = {k: value[k] for k in ('success', 'handle', 'origin', 'error_type') if k in value}
            if 'fill' in value and isinstance(value['fill'], dict):
                safe['fill'] = {'success': value['fill'].get('success') is True}
            if safe.get('success'):
                safe['next'] = 'The login was saved in this profile. Ask the user to check the account field on the page before continuing; never ask for credentials in chat.'
            return json.dumps(safe)
        except Exception:
            return json.dumps({'success': False, 'error_type': 'secure_login_result_unavailable'})

    def presence(approval_callback=None):
        if getattr(active, 'enabled', False) and not context._is_cron_approval_context() and not context._is_unattended_platform_approval_context():
            # Only the human surface changes; native hardline/user deny rules,
            # caches, approval scopes and grant persistence remain host-owned.
            return callbacks['approval'], True, False, False
        return original_presence(approval_callback)

    def can_prompt():
        if getattr(active, 'enabled', False):
            return not context._is_cron_approval_context() and not context._is_unattended_platform_approval_context()
        return original_can_prompt()

    @functools.wraps(original_run)
    def run(self, *args, **kwargs):
        # Nested calls and background/subagent turns retain native behavior.
        if owner[0] is None:
            owner[0] = self
        if self is not owner[0] and getattr(active, 'enabled', False):
            # A synchronous child can share the parent's thread-local slots.
            # Suspend them rather than letting the child borrow this action.
            saved = [(name, getattr(vault, 'get_' + name + '_callback')()) for _, name in pairs]
            saved_approval = terminal._get_approval_callback()
            saved_clarify = getattr(self, 'clarify_callback', None)
            active.enabled = False
            try:
                for _, name in pairs: getattr(vault, 'set_' + name + '_callback')(None)
                terminal.set_approval_callback(None)
                self.clarify_callback = None
                return original_run(self, *args, **kwargs)
            finally:
                active.enabled = True
                self.clarify_callback = saved_clarify
                terminal.set_approval_callback(saved_approval)
                for name, callback in saved: getattr(vault, 'set_' + name + '_callback')(callback)
        if self is not owner[0] or getattr(active, 'enabled', False) or context._is_cron_approval_context() or context._is_unattended_platform_approval_context():
            return original_run(self, *args, **kwargs)
        saved = [(name, getattr(vault, 'get_' + name + '_callback')()) for _, name in pairs]
        approval = terminal._get_approval_callback()
        clarify = getattr(self, 'clarify_callback', None)
        active.enabled = True
        try:
            for key, name in pairs:
                getattr(vault, 'set_' + name + '_callback')(callbacks[key])
            terminal.set_approval_callback(callbacks['approval'])
            self.clarify_callback = callbacks['clarify']
            return original_run(self, *args, **kwargs)
        finally:
            active.enabled = False
            self.clarify_callback = clarify
            terminal.set_approval_callback(approval)
            for name, callback in saved:
                getattr(vault, 'set_' + name + '_callback')(callback)

    vault.can_prompt_here, agent.run_conversation, approvals._presence = can_prompt, run, presence
    browser_vault.browser_vault_save_login = save_login_result
    def cleanup():
        if agent.run_conversation is run: agent.run_conversation = original_run
        if vault.can_prompt_here is can_prompt: vault.can_prompt_here = original_can_prompt
        if approvals._presence is presence: approvals._presence = original_presence
        if browser_vault.browser_vault_save_login is save_login_result: browser_vault.browser_vault_save_login = original_save_login
    return cleanup
