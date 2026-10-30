"""Private stdio MCP for the existing action-scoped Bot self-service tool."""
import importlib.util
import json
from pathlib import Path
import sys


sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('ziwei_autonomy_tool', Path(__file__).with_name('hermes-autonomy-tools.py'))
autonomy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(autonomy)
schema, call = autonomy.create_tool()
tool = {'name': schema['name'], 'description': schema['description'], 'inputSchema': schema['parameters']}


def handle(request):
    if not isinstance(request, dict) or request.get('jsonrpc') != '2.0' or not isinstance(request.get('method'), str):
        return _error(None, -32600, 'Invalid Request')
    if 'id' not in request or request['method'].startswith('notifications/'):
        return None
    identifier, method, params = request['id'], request['method'], request.get('params', {})
    if not isinstance(params, dict):
        return _error(identifier, -32602, 'Invalid params')
    if method == 'initialize':
        result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}},
                  'serverInfo': {'name': 'ziwei-bot-tools', 'version': '1.0.0'}}
    elif method == 'ping':
        result = {}
    elif method == 'tools/list':
        result = {'tools': [tool]}
    elif method == 'tools/call':
        arguments = params.get('arguments', {})
        if params.get('name') != tool['name'] or not isinstance(arguments, dict):
            return _error(identifier, -32602, 'Invalid tool or arguments')
        try:
            text = call(arguments)
            value = json.loads(text)
            result = {'content': [{'type': 'text', 'text': text}], 'isError': bool(value.get('error'))}
        except Exception:
            return _error(identifier, -32603, 'Internal error')
    else:
        return _error(identifier, -32601, 'Method not found')
    return {'jsonrpc': '2.0', 'id': identifier, 'result': result}


def _error(identifier, code, message):
    return {'jsonrpc': '2.0', 'id': identifier, 'error': {'code': code, 'message': message}}


def main():
    sys.stdin.reconfigure(encoding='utf-8')
    sys.stdout.reconfigure(encoding='utf-8')
    for line in sys.stdin:
        try:
            request = json.loads(line)
        except ValueError:
            response = _error(None, -32700, 'Parse error')
        else:
            response = handle(request)
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
