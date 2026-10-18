"""Browser callbacks via the authenticated relay; OAuth stays in the target Hermes HOME."""
import asyncio
from asyncio.proactor_events import BaseProactorEventLoop
from asyncio.selector_events import BaseSelectorEventLoop
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import re
import socket
import sys
import time
from urllib.parse import parse_qs, quote, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


PUBLIC_CODES = frozenset({
    'MCP_OAUTH_REQUIRES_DEPENDENCY', 'MCP_OAUTH_INVALID_CONFIGURATION',
    'MCP_OAUTH_RELAY_FAILED', 'MCP_OAUTH_RELAY_INVALID_RESPONSE',
    'MCP_OAUTH_CANCELLED', 'MCP_OAUTH_EXPIRED', 'MCP_OAUTH_STATE_MISMATCH',
    'MCP_OAUTH_DENIED', 'MCP_OAUTH_CONNECTION_FAILED',
    'MCP_OAUTH_TOKEN_NOT_CONFIRMED', 'MCP_OAUTH_NO_TOOLS', 'MCP_OAUTH_FAILED',
})
CALLBACK_SECONDS = 300.0
POLL_SECONDS = 1.0
_no_listener_installed = False
_IS_WINDOWS = sys.platform == 'win32'
_SOCKETPAIR_CODES = frozenset(code for function in
    (socket.socketpair, getattr(socket, '_fallback_socketpair', None))
    if (code := getattr(function, '__code__', None)) is not None)
_SELF_PIPE_CODES = frozenset(function.__code__ for function in
    (BaseProactorEventLoop._make_self_pipe, BaseSelectorEventLoop._make_self_pipe))


def _windows_asyncio_self_pipe_bind(args):
    # Windows implements socketpair with a short-lived loopback TCP listener.
    # Permit only the stdlib event-loop wakeup pipe, never an OAuth callback.
    if not _IS_WINDOWS or not isinstance(args, tuple) or len(args) != 2:
        return False
    target, address = args
    if (not isinstance(address, tuple) or len(address) != 2
            or type(address[1]) is not int or address[1] != 0):
        return False
    try:
        if (target.type != socket.SOCK_STREAM or target.proto != 0
                or (target.family, address[0]) not in
                ((socket.AF_INET, '127.0.0.1'), (socket.AF_INET6, '::1'))):
            return False
    except AttributeError:
        return False
    frame = sys._getframe(1)
    try:
        for _ in range(4):
            if frame is None:
                return False
            if frame.f_code in _SOCKETPAIR_CODES:
                return (frame.f_locals.get('lsock') is target
                        and frame.f_back is not None
                        and frame.f_back.f_code in _SELF_PIPE_CODES)
            frame = frame.f_back
        return False
    finally:
        del frame


class NativeOperationError(RuntimeError):
    def __init__(self, code):
        self.code = code if code in PUBLIC_CODES else 'MCP_OAUTH_FAILED'
        super().__init__(self.code)


def fail(code):
    raise NativeOperationError(code) from None


def https_url(value):
    if not isinstance(value, str) or not value or len(value) > 16384 or any(ord(c) < 33 for c in value):
        fail('MCP_OAUTH_INVALID_CONFIGURATION')
    try:
        parsed = urlsplit(value)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            fail('MCP_OAUTH_INVALID_CONFIGURATION')
        parsed.port
        return parsed
    except ValueError:
        fail('MCP_OAUTH_INVALID_CONFIGURATION')


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward a device credential to a redirected host or endpoint.
        return None


class Relay:
    def __init__(self):
        # Consume before importing native MCP: child tools must never inherit the
        # employee connection credential, including on a rejected configuration.
        self.base = os.environ.pop('ZIWEI_MCP_OAUTH_API_BASE', '').rstrip('/')
        self.token = os.environ.pop('ZIWEI_MCP_OAUTH_DEVICE_TOKEN', '')
        self.action = os.environ.pop('ZIWEI_MCP_OAUTH_ACTION_ID', '')
        origin = https_url(self.base)
        if origin.path or origin.query:
            fail('MCP_OAUTH_INVALID_CONFIGURATION')
        if not self.token or len(self.token) > 8192 or any(ord(c) < 33 for c in self.token):
            fail('MCP_OAUTH_INVALID_CONFIGURATION')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', self.action):
            fail('MCP_OAUTH_INVALID_CONFIGURATION')
        self.redirect_uri = self.base + '/api/mcp-oauth/callback'
        self.endpoint = self.base + '/a2a/v1/actions/' + quote(self.action, safe='') + '/mcp-oauth/'
        self.opener = build_opener(NoRedirect())

    def request(self, operation, body=None, timeout=10):
        request = Request(self.endpoint + operation,
                          data=None if body is None else json.dumps(body).encode('utf-8'),
                          method='GET' if body is None else 'POST',
                          headers={'X-Ziwei-Device-Token': self.token,
                                   'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with self.opener.open(request, timeout=timeout) as response:
                if response.status != 200:
                    fail('MCP_OAUTH_RELAY_FAILED')
                raw = response.read(65537)
            if len(raw) > 65536:
                fail('MCP_OAUTH_RELAY_INVALID_RESPONSE')
            result = json.loads(raw)
            if not isinstance(result, dict):
                fail('MCP_OAUTH_RELAY_INVALID_RESPONSE')
            return result
        except NativeOperationError:
            raise
        except (ValueError, UnicodeError):
            fail('MCP_OAUTH_RELAY_INVALID_RESPONSE')
        except Exception:
            fail('MCP_OAUTH_RELAY_FAILED')


def remote_flow_type(native_flow):
    class RemoteFlow(native_flow):
        failure_code = None
        callback_deadline = None
        published = False

        def reject(self, code):
            self.failure_code = self.failure_code or code
            self.mark_error(self.failure_code)
            fail(self.failure_code)

        async def publish_authorization_url(self, url):
            if self.failure_code or self.published:
                self.reject(self.failure_code or 'MCP_OAUTH_CONNECTION_FAILED')
            try:
                parsed = https_url(url)
                query = parse_qs(parsed.query)
                if query.get('redirect_uri') != [self.redirect_uri] or len(query.get('state', [])) != 1 or not query['state'][0]:
                    self.reject('MCP_OAUTH_REQUIRES_DEPENDENCY')
                started = await asyncio.to_thread(self.relay.request, 'start', {})
                if started.get('redirectUri') != self.redirect_uri:
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
                try:
                    expiry = datetime.fromisoformat(started['expiresAt'].replace('Z', '+00:00'))
                    if expiry.tzinfo is None:
                        raise ValueError()
                    remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
                except (KeyError, TypeError, AttributeError, ValueError):
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
                if remaining <= 0:
                    self.reject('MCP_OAUTH_EXPIRED')
                self.callback_deadline = time.monotonic() + min(CALLBACK_SECONDS, remaining)
                await super().publish_authorization_url(url)
                result = await asyncio.to_thread(self.relay.request, 'authorization', {'authorizationUrl': url})
                if result.get('ok') is not True:
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
                self.published = True
            except NativeOperationError as error:
                self.reject(error.code)
            except Exception:
                self.reject('MCP_OAUTH_RELAY_FAILED')

        async def wait_for_callback(self, timeout=CALLBACK_SECONDS):
            if self.failure_code:
                self.reject(self.failure_code)
            if not self.published or self.callback_deadline is None:
                self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
            deadline = min(self.callback_deadline, time.monotonic() + min(float(timeout), CALLBACK_SECONDS))
            while time.monotonic() < deadline:
                try:
                    value = await asyncio.to_thread(self.relay.request, 'callback', None, min(10, max(0.01, deadline - time.monotonic())))
                except NativeOperationError as error:
                    self.reject(error.code)
                if time.monotonic() >= deadline:
                    self.reject('MCP_OAUTH_EXPIRED')
                if value.get('status') == 'waiting':
                    await asyncio.sleep(min(POLL_SECONDS, max(0, deadline - time.monotonic())))
                    continue
                if value.get('status') in ('cancelled', 'expired'):
                    self.reject('MCP_OAUTH_CANCELLED' if value['status'] == 'cancelled' else 'MCP_OAUTH_EXPIRED')
                callback = value.get('callback')
                if value.get('status') != 'callback' or not isinstance(callback, dict):
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
                if any(callback.get(key) is not None and (not isinstance(callback[key], str) or len(callback[key]) > 16384)
                       for key in ('code', 'state', 'error', 'iss')):
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
                try:
                    super().deliver_callback(**{key: callback.get(key) for key in ('code', 'state', 'error', 'iss')})
                except ValueError:
                    self.reject('MCP_OAUTH_STATE_MISMATCH')
                if callback.get('error'):
                    self.reject('MCP_OAUTH_DENIED')
                try:
                    return await super().wait_for_callback(timeout=0)
                except Exception:
                    self.reject('MCP_OAUTH_RELAY_INVALID_RESPONSE')
            self.reject('MCP_OAUTH_EXPIRED')

    return RemoteFlow


def _authorize_mcp(logical_server, server, config):
    if not isinstance(logical_server, str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', logical_server) or server != logical_server:
        fail('MCP_OAUTH_INVALID_CONFIGURATION')
    if not isinstance(config, dict) or config.get('auth') != 'oauth' or config.get('command') or config.get('enabled', True) is not True:
        fail('MCP_OAUTH_INVALID_CONFIGURATION')
    https_url(config.get('url'))
    if not isinstance(config.get('oauth', {}), dict):
        fail('MCP_OAUTH_INVALID_CONFIGURATION')
    relay = Relay()
    try:
        from hermes_constants import get_hermes_home, set_hermes_home_override, reset_hermes_home_override
        from agent.secret_scope import build_profile_secret_scope, set_secret_scope, reset_secret_scope
        from tools.mcp_dashboard_oauth import DashboardOAuthFlow, dashboard_oauth_flow
        from tools.mcp_oauth import HermesTokenStorage, apply_oauth_provider_defaults, force_interactive_oauth
        from tools.mcp_oauth_manager import get_manager
        from hermes_cli.mcp_config import _probe_single_server
    except (ImportError, AttributeError):
        fail('MCP_OAUTH_REQUIRES_DEPENDENCY')
    home = Path(os.environ.get('HERMES_HOME', ''))
    if not os.environ.get('HERMES_HOME') or not home.is_absolute() or home.resolve() != Path(get_hermes_home()).resolve():
        fail('MCP_OAUTH_INVALID_CONFIGURATION')
    oauth = dict(config.get('oauth', {}))
    apply_oauth_provider_defaults(oauth, server_name=server, server_url=config['url'])
    # Both inspected native versions keep a listener for this pre-registered case.
    if oauth.get('client_id') and oauth.get('redirect_port') or oauth.get('flow', 'browser') != 'browser':
        fail('MCP_OAUTH_REQUIRES_DEPENDENCY')
    if oauth.get('redirect_uri') and oauth['redirect_uri'] != relay.redirect_uri:
        fail('MCP_OAUTH_REQUIRES_DEPENDENCY')
    oauth.update({'redirect_uri': relay.redirect_uri, 'timeout': CALLBACK_SECONDS})
    selected = {**config, 'oauth': oauth, 'connect_timeout': 315}
    flow = remote_flow_type(DashboardOAuthFlow)(flow_id=relay.action, server_name=server,
        profile=None, hermes_home=str(home.resolve()), redirect_uri=relay.redirect_uri, reconnect_live=False)
    flow.relay = relay
    home_token = set_hermes_home_override(flow.hermes_home)
    secret_token = None
    try:
        secret_token = set_secret_scope(build_profile_secret_scope(home))
        with force_interactive_oauth(), dashboard_oauth_flow(flow):
            manager = get_manager()
            if not callable(getattr(manager, 'evict', None)):
                fail('MCP_OAUTH_REQUIRES_DEPENDENCY')
            # Drop only the process cache: existing grants and native refresh stay intact.
            manager.evict(server, hermes_home=flow.hermes_home)
            tools = _probe_single_server(server, selected, connect_timeout=315)
            if flow.failure_code:
                fail(flow.failure_code)
            storage = HermesTokenStorage(server, hermes_home=flow.hermes_home)
            tokens = asyncio.run(storage.get_tokens()) if storage.has_cached_tokens() else None
            if not tokens or not getattr(tokens, 'access_token', None):
                fail('MCP_OAUTH_TOKEN_NOT_CONFIRMED')
            if not isinstance(tools, list) or not tools or len(tools) > 2000:
                fail('MCP_OAUTH_NO_TOOLS')
            output = []
            for item in tools:
                if not isinstance(item, (tuple, list)) or len(item) != 2 or not isinstance(item[0], str) or not item[0] or not isinstance(item[1], str):
                    fail('MCP_OAUTH_NO_TOOLS')
                output.append({'name': item[0], 'description': item[1]})
            flow.mark_approved()
            return {'server': logical_server, 'connected': True, 'tools': output, 'toolsCount': len(output),
                    'credentialLocation': 'target_profile', 'loadedForNextRun': True}
    except NativeOperationError:
        raise
    except Exception:
        fail(flow.failure_code or 'MCP_OAUTH_CONNECTION_FAILED')
    finally:
        flow.mark_worker_done()
        if secret_token is not None:
            reset_secret_scope(secret_token)
        reset_hermes_home_override(home_token)


class DiscardOutput:
    encoding = 'utf-8'
    def write(self, text):
        return len(text)
    def flush(self):
        pass
    def isatty(self):
        return False


def authorize_mcp(logical_server, server, config):
    # This is an isolated authorize subprocess, not the shared Hermes gateway.
    # SDK diagnostics may include provider URLs; only our public result/error escapes.
    global _no_listener_installed
    if not _no_listener_installed:
        # OAuth callbacks must use the relay. An older SDK's callback listener
        # is rejected; only Windows asyncio's internal wakeup pipe may bind.
        def no_listener(event, _args):
            if event == 'socket.bind' and not _windows_asyncio_self_pipe_bind(_args):
                fail('MCP_OAUTH_REQUIRES_DEPENDENCY')
        sys.addaudithook(no_listener)
        _no_listener_installed = True
    previous_logging = logging.root.manager.disable
    try:
        logging.disable(logging.CRITICAL)
        with redirect_stdout(DiscardOutput()), redirect_stderr(DiscardOutput()):
            try:
                return _authorize_mcp(logical_server, server, config)
            except NativeOperationError:
                raise
            except Exception:
                fail('MCP_OAUTH_FAILED')
    finally:
        logging.disable(previous_logging)
