"""Scoped self-service adapter. Only the controller endpoint owns scheduling."""
import hashlib
import json
import os
import urllib.request
import urllib.error
import urllib.parse


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _open(request, timeout):
    return urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout)


def create_tool():
    def call(args, **_kwargs):
        try:
            action = os.environ.get('ZIWEI_BOT_ACTION_ID', '')
            token = os.environ.get('ZIWEI_BOT_DEVICE_TOKEN', '')
            base = os.environ.get('ZIWEI_API_BASE', '').rstrip('/')
            if not action or not token or not base:
                return json.dumps({'error': 'BOT_AUTONOMY_DEVICE_REQUIRED'})
            origin = urllib.parse.urlsplit(base)
            if (origin.scheme != 'https' and not (origin.scheme == 'http' and origin.hostname in {'127.0.0.1', 'localhost', '::1'})) or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment:
                return json.dumps({'error': 'BOT_AUTONOMY_TLS_REQUIRED'})
            body = dict(args)
            # Stable content-derived identity survives uncertain network outcomes.
            body.setdefault('idempotencyKey', hashlib.sha256(json.dumps([action, args], sort_keys=True).encode()).hexdigest())
            request = urllib.request.Request(base + '/a2a/v1/actions/' + action + '/bot-autonomy',
                data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'X-Ziwei-Device-Token': token}, method='POST')
            with _open(request, timeout=20) as response:
                return json.dumps(json.load(response), ensure_ascii=False)
        except urllib.error.HTTPError as error:
            try:
                code = json.load(error).get('code', '')
                if code in {'BOT_AUTONOMY_USER_GRANT_REQUIRED', 'BOT_AUTONOMY_OPERATION_PENDING',
                            'BOT_PERMISSION_CONFLICT', 'BOT_AUTONOMY_BINDING_CHANGED',
                            'BOT_AUTONOMY_DEVICE_REQUIRED', 'BOT_AUTONOMY_INPUT_INVALID',
                            'BOT_DEFERRED_CONFIG_PENDING', 'BOT_MCP_CLIENT_REQUIRED'}:
                    return json.dumps({'error': code, 'outcome_uncertain': False})
            except Exception:
                pass
            return json.dumps({'error': 'BOT_AUTONOMY_REQUEST_REJECTED', 'outcome_uncertain': False})
        except Exception:
            # HTTP errors may contain user-owned payloads. Never reflect them.
            return json.dumps({'error': 'BOT_AUTONOMY_OUTCOME_UNCONFIRMED', 'outcome_uncertain': True,
                'next': 'Read status/routines before retrying the same request. Do not create a second task.'})

    schema = {'name': 'ziwei_autonomy', 'description': 'Manage this employee only through Ziwei. status/routines read current state; configure queues changes within existing grants after this turn; createRoutine creates a single platform-owned schedule; pauseRoutine pauses this employee routine. Native cron/heartbeat spawning is not used. New privileges and new external connections require the user.',
        'parameters': {'type': 'object', 'required': ['operation'], 'additionalProperties': False, 'properties': {
            'operation': {'type': 'string', 'enum': ['status', 'routines', 'configure', 'createRoutine', 'pauseRoutine']},
            'input': {'type': 'object'}, 'routineId': {'type': 'string'}, 'idempotencyKey': {'type': 'string'}}}}
    return schema, call


def install(isolation):
    from tools.registry import registry
    from toolsets import TOOLSETS
    schema, call = create_tool()
    registry.register(name='ziwei_autonomy', toolset='ziwei_autonomy', schema=schema, handler=call, override=True)
    TOOLSETS['ziwei_autonomy'] = {'tools': ['ziwei_autonomy'], 'description': 'Employee-scoped platform configuration and scheduling.'}
