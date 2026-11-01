"""Session-private transport for the existing action-scoped collaboration handlers."""
import importlib.util
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ziwei_collaboration_bridge', Path(__file__).with_name('hermes-native-bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

TOOLS = [
    {'name': 'message_agent', 'description': 'Send an explicitly authorized message through this employee action. Target must be a current workspace employee ID allowed by the original Bot configuration. The platform owns dispatch; a queued acknowledgement is not delivery success.',
     'inputSchema': {'type': 'object', 'additionalProperties': False, 'required': ['target', 'message'], 'properties': {
         'target': {'type': 'string'}, 'message': {'type': 'string'}, 'task_id': {'type': 'string'}}}},
    {'name': 'delegate_task', 'description': 'Use action=list to read this source action\'s delegated work. Spawn delegates only to explicitly authorized workspace employee IDs through Ziwei. No native child process is created; do not retry uncertain dispatches with another key.',
     'inputSchema': {'type': 'object', 'additionalProperties': False, 'properties': {
         'action': {'type': 'string', 'enum': ['list', 'spawn']},
         'target_employee_id': {'type': 'string'}, 'goal': {'type': 'string'}, 'context': {'type': 'string'},
         'tasks': {'type': 'array', 'minItems': 1, 'maxItems': 5, 'items': {'type': 'object', 'additionalProperties': False,
             'required': ['goal', 'target_employee_id'], 'properties': {'goal': {'type': 'string'}, 'context': {'type': 'string'}, 'target_employee_id': {'type': 'string'}}}}}}}
]


def bound_handlers():
    binding = json.loads(os.environ.get('ZIWEI_COLLABORATION_BINDING', '{}'))
    home = Path(os.environ.get('HERMES_HOME', '')).resolve(strict=True)
    if binding.get('kind') != 'hermes-bot' or not binding.get('home') or home != Path(binding['home']).resolve(strict=True):
        raise ValueError('binding')
    metadata = json.loads((home / 'ziwei-instance.json').read_text(encoding='utf-8'))
    fields = ('employeeId', 'workspace', 'sourceProfile', 'key')
    if metadata.get('templateId') != 'ziwei-hermes-bot' or any(not binding.get(key) or metadata.get(key) != binding[key] for key in fields):
        raise ValueError('binding')
    if not all(os.environ.get(key) for key in ('ZIWEI_BOT_ACTION_ID', 'ZIWEI_BOT_DEVICE_TOKEN', 'ZIWEI_API_BASE')):
        raise ValueError('grant')
    # The Gateway owner must not route legacy local envelopes or borrow its HOME.
    # The controller endpoint creates the sole authorized child action.
    return bridge.create_collaboration_handlers(binding)


def handle(request):
    if not isinstance(request, dict) or request.get('jsonrpc') != '2.0' or not isinstance(request.get('method'), str):
        return error(None, -32600, 'Invalid Request')
    if 'id' not in request or request['method'].startswith('notifications/'):
        return None
    identifier, method, params = request['id'], request['method'], request.get('params', {})
    if not isinstance(params, dict):
        return error(identifier, -32602, 'Invalid params')
    if method == 'initialize':
        result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'ziwei-collaboration', 'version': '1.0.0'}}
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': TOOLS}
    elif method == 'tools/call':
        name, arguments = params.get('name'), params.get('arguments', {})
        if name not in {'message_agent', 'delegate_task'} or not isinstance(arguments, dict):
            return error(identifier, -32602, 'Invalid tool or arguments')
        try:
            handlers = bound_handlers()
        except Exception:
            value = {'error': 'BOT_COLLABORATION_BINDING_INVALID', 'outcome_uncertain': False}
        else:
            try:
                text = handlers[name](**arguments) if name == 'message_agent' else handlers[name](arguments)
                value = json.loads(text)
            except Exception:
                value = {'error': 'BOT_COLLABORATION_OUTCOME_UNCONFIRMED', 'outcome_uncertain': True}
        result = {'content': [{'type': 'text', 'text': json.dumps(value, ensure_ascii=False)}], 'isError': bool(value.get('error'))}
    else:
        return error(identifier, -32601, 'Method not found')
    return {'jsonrpc': '2.0', 'id': identifier, 'result': result}


def error(identifier, code, message):
    return {'jsonrpc': '2.0', 'id': identifier, 'error': {'code': code, 'message': message}}


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            response = error(None, -32700, 'Parse error')
        else:
            response = handle(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
