"""Real stdlib self-pipe/fallback code with fake sockets: never binds a real port."""
import ast
import asyncio.proactor_events
import asyncio.selector_events
import importlib.util
from functools import partial
from pathlib import Path
import socket
import sys
import types
import unittest
from unittest.mock import patch

ROOT = Path(sys.argv.pop(1))
SOCKET_SOURCE = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(socket.__file__)
spec = importlib.util.spec_from_file_location('isolated_remote_oauth', ROOT / 'src/hermes-remote-mcp-oauth.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
# Install the actual immutable process audit hook; skip only the OAuth operation.
with patch.object(helper, '_authorize_mcp', return_value=None):
    helper.authorize_mcp(None, None, None)


def no_network(event, _args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
        raise AssertionError('EXTERNAL_IO_DENIED')
sys.addaudithook(no_network)

# Compile this interpreter's real Windows fallback, including the 3.13+ peer
# check when present. Only its socket factory is replaced with in-memory fakes.
parsed = ast.parse(SOCKET_SOURCE.read_text())
fallback_node = next(item for item in reversed(list(ast.walk(parsed)))
    if isinstance(item, ast.FunctionDef) and item.name in ('socketpair', '_fallback_socketpair')
    and any(isinstance(part, ast.Attribute) and part.attr == 'bind' for part in ast.walk(item)))


class Tests(unittest.TestCase):
    def setUp(self):
        self.sockets = []
        self.address = None
        self.audit_target = None
        self.socket_kind = socket.SOCK_STREAM
        self.socket_proto = 0
        owner = self
        class FakeSocket:
            def __init__(self, family=socket.AF_INET, kind=socket.SOCK_STREAM, proto=0):
                self.family, self.type, self.proto = family, owner.socket_kind, owner.socket_proto
                self.bound, self.listening, self.closed = False, False, False
                owner.sockets.append(self)
            def bind(self, address):
                address = owner.address or address
                sys.audit('socket.bind', owner.audit_target or self, address)
                self.bound = True
            def listen(self):
                self.listening = True
            def getsockname(self):
                return ('::1' if self.family == socket.AF_INET6 else '127.0.0.1', 49152)
            def getpeername(self):
                return self.getsockname()
            def connect(self, address):
                pass
            def setblocking(self, blocking):
                pass
            def accept(self):
                return FakeSocket(self.family, self.type, self.proto), self.getsockname()
            def fileno(self):
                return -123  # The fake loop never registers this fake descriptor.
            def close(self):
                self.closed = True
        self.FakeSocket = FakeSocket
        namespace = {'AF_INET':socket.AF_INET, 'AF_INET6':socket.AF_INET6,
            'SOCK_STREAM':socket.SOCK_STREAM, '_LOCALHOST':'127.0.0.1',
            '_LOCALHOST_V6':'::1', 'socket':FakeSocket, 'sys':sys}
        exec(compile(ast.Module(body=[fallback_node], type_ignores=[]), str(SOCKET_SOURCE), 'exec'), namespace)
        self.fallback = namespace[fallback_node.name]
        self.windows = patch.object(helper, '_IS_WINDOWS', True)
        self.codes = patch.object(helper, '_SOCKETPAIR_CODES', frozenset([self.fallback.__code__]))
        self.windows.start();self.addCleanup(self.windows.stop)
        self.codes.start();self.addCleanup(self.codes.stop)

    def make_pipe(self, kind='proactor', family=socket.AF_INET):
        loop = types.SimpleNamespace(_internal_fds=0, _add_reader=lambda *_:None, _read_from_self=lambda:None)
        function = (asyncio.proactor_events.BaseProactorEventLoop if kind == 'proactor'
                    else asyncio.selector_events.BaseSelectorEventLoop)._make_self_pipe
        # partial adds no Python caller frame to the real fallback function.
        pair = self.fallback if family == socket.AF_INET else partial(self.fallback, family)
        with patch.object(socket, 'socketpair', pair):
            function(loop)
        return loop

    def assert_rejected(self, invoke):
        with self.assertRaises(helper.NativeOperationError) as error:
            invoke()
        self.assertEqual(error.exception.code, 'MCP_OAUTH_REQUIRES_DEPENDENCY')
        self.assertFalse(any(item.listening for item in self.sockets))

    def test_previous_guard_reproduces_windows_failure_before_listen(self):
        with patch.object(helper, '_windows_asyncio_self_pipe_bind', return_value=False):
            self.assert_rejected(self.make_pipe)

    def test_real_stdlib_proactor_and_selector_self_pipes_accept_only_internal_socketpair(self):
        for kind in ('proactor','selector'):
            for family in (socket.AF_INET,socket.AF_INET6):
                with self.subTest(kind=kind,family=family):
                    self.sockets=[]
                    loop=self.make_pipe(kind,family)
                    self.assertEqual(loop._internal_fds,1)
                    self.assertTrue(self.sockets[0].bound)
                    self.assertTrue(self.sockets[0].closed)
                    self.assertFalse(loop._ssock.listening)
                    self.assertFalse(loop._csock.listening)
                    loop._ssock.close();loop._csock.close()
                    self.assertTrue(all(item.closed for item in self.sockets))

    def test_direct_bind_and_direct_socketpair_still_cannot_create_oauth_listener(self):
        self.assert_rejected(lambda:self.FakeSocket().bind(('127.0.0.1',0)))
        self.assert_rejected(self.fallback)

    def test_same_named_caller_cannot_impersonate_stdlib_make_self_pipe(self):
        def _make_self_pipe():
            return self.fallback()
        self.assert_rejected(_make_self_pipe)

    def test_non_loopback_fixed_port_and_wrong_socket_object_are_denied(self):
        for address in [('0.0.0.0',0),('192.0.2.1',0),('127.0.0.1',12345),('::',0)]:
            with self.subTest(address=address):
                self.address=address
                self.assert_rejected(self.make_pipe)
        self.address=None
        self.audit_target=self.FakeSocket()
        self.assert_rejected(self.make_pipe)
        self.audit_target=None
        self.socket_kind=socket.SOCK_DGRAM
        self.assert_rejected(self.make_pipe)
        self.socket_kind=socket.SOCK_STREAM
        self.socket_proto=socket.IPPROTO_TCP
        self.assert_rejected(self.make_pipe)

    def test_non_windows_runtime_keeps_the_original_no_bind_policy(self):
        with patch.object(helper, '_IS_WINDOWS', False):
            self.assert_rejected(self.make_pipe)


if __name__ == '__main__':
    unittest.main()
