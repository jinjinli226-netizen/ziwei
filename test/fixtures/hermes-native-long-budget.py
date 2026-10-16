"""Stdlib-only call-boundary fixture; no Hermes install, network, or model."""
from contextlib import contextmanager
from dataclasses import dataclass
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types


context = json.load(sys.stdin)
spec = importlib.util.spec_from_file_location('ziwei_native_budget_fixture', sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


@dataclass
class Task:
    id: str
    tenant: str
    goal_max_turns: int


task = Task('original-task', context['employeeId'], context['config']['maxTurns'])
proof = {'closedConnections': 0}
connection = object()
package = types.ModuleType('hermes_cli')
package.__path__ = []
kb = types.ModuleType('hermes_cli.kanban_db')
kbc = types.ModuleType('hermes_cli.kanban_db_connect')


@contextmanager
def connect_closing(path):
    assert Path(path) == Path(os.environ['HERMES_HOME']) / 'kanban.db'
    try:
        yield connection
    finally:
        proof['closedConnections'] += 1


def create_task(conn, **kwargs):
    assert conn is connection
    proof['create'] = kwargs
    return task.id


def get_task(conn, task_id):
    assert conn is connection and task_id == task.id
    return task


def claim_task(conn, task_id, **kwargs):
    assert conn is connection and task_id == task.id
    proof['claim'] = {**kwargs, 'taskId': task_id}
    return task


kb.create_task = create_task
kb.get_task = get_task
kb.claim_task = claim_task
kb.list_runs = lambda conn, task_id: []
kb.build_worker_context = lambda conn, task_id: 'Original native worker context'
kbc.connect_closing = connect_closing
package.kanban_db = kb
package.kanban_db_connect = kbc
sys.modules.update({'hermes_cli': package, 'hermes_cli.kanban_db': kb, 'hermes_cli.kanban_db_connect': kbc})

with tempfile.TemporaryDirectory(prefix='native-long-budget-') as private:
    os.environ['HERMES_HOME'] = str(Path(private).resolve())
    proof['created'] = bridge.kanban('create', {'title': 'Long native task'}, context, 'original-create')
    proof['prepared'] = bridge.kanban('_prepare', {'taskId': task.id}, context, 'original-prepare')
print(json.dumps(proof))
