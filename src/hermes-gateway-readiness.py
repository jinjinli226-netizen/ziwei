"""Execution-only startup budget for the native Gateway's single ensure loop."""
import functools
import importlib
import inspect


COLD_START_TIMEOUT = 180.0


def install(reject=RuntimeError):
    try:
        runtime = importlib.import_module('hermes_cli.gateway_runtime')
    except ModuleNotFoundError as error:
        if error.name == 'hermes_cli.gateway_runtime':
            return False
        raise reject('BOT_GATEWAY_READINESS_PROTOCOL_UNSUPPORTED') from None
    original = runtime.ensure_gateway_runtime
    if getattr(original, '_ziwei_ready_budget', False):
        return True
    if not callable(original) or 'timeout' not in inspect.signature(original).parameters:
        raise reject('BOT_GATEWAY_READINESS_PROTOCOL_UNSUPPORTED')

    @functools.wraps(original)
    def ensure(*args, **kwargs):
        # Cold multiplexer startup can exceed a minute. Keep one native ensure call:
        # it owns the reservation/start gates and returns the original terminal verdict.
        kwargs.setdefault('timeout', COLD_START_TIMEOUT)
        return original(*args, **kwargs)

    ensure._ziwei_ready_budget = True
    runtime.ensure_gateway_runtime = ensure
    return True
