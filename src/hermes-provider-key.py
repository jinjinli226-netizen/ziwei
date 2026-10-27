"""Bind a Bot's explicit key to the verified native resolver, in memory only."""
import argparse
import importlib
import inspect
import logging
import os


def install(reject, *, validate=False):
    secret = os.environ.pop('ZIWEI_BOT_PROVIDER_KEY', None)
    provider = os.environ.pop('ZIWEI_BOT_KEY_PROVIDER', None)
    endpoint = os.environ.pop('ZIWEI_BOT_KEY_ENDPOINT', None)
    if secret is None:
        return
    if not secret or not provider or not endpoint:
        raise reject('independent provider credentials missing')
    original_message = logging.LogRecord.getMessage

    def safe_message(record):
        return original_message(record).replace(secret, '[REDACTED]')

    logging.LogRecord.getMessage = safe_message
    original_format = logging.Formatter.format

    def safe_format(formatter, record):
        return original_format(formatter, record).replace(secret, '[REDACTED]')

    logging.Formatter.format = safe_format
    module = importlib.import_module('hermes_cli.runtime_provider')
    original = module.resolve_runtime_provider
    parameters = inspect.signature(original).parameters
    if not all(key in parameters for key in ('requested', 'explicit_api_key', 'explicit_base_url')):
        raise reject('independent provider protocol unsupported')

    def resolve(**kwargs):
        if kwargs.get('requested') not in (None, provider):
            raise reject('independent provider binding changed')
        kwargs.update(requested=provider, explicit_api_key=secret, explicit_base_url=endpoint)
        result = original(**kwargs)
        if result.get('api_key') != secret or result.get('base_url', '').rstrip('/') != endpoint.rstrip('/') or result.get('credential_pool'):
            raise reject('independent provider route mismatch')
        return result

    if validate:
        resolve(requested=provider)
    module.resolve_runtime_provider = resolve

    # Newer Hermes runs chat in a separate Gateway process. Its native create
    # and resume protocol accepts a launch-only key, rather than calling this
    # frontend's provider resolver. Keep that key off argv and the caller's
    # Namespace, and let the native protocol manage its lifetime.
    try:
        gateway = importlib.import_module('hermes_cli.gateway_chat')
    except ModuleNotFoundError as error:
        if error.name == 'hermes_cli.gateway_chat':
            return  # Older Hermes still uses the in-process resolver above.
        raise reject('independent provider gateway protocol unsupported') from None
    original_gateway = getattr(gateway, 'run_gateway_chat', None)
    if not inspect.iscoroutinefunction(original_gateway):
        raise reject('independent provider gateway protocol unsupported')

    async def run_gateway_chat(args, *positional, **kwargs):
        if getattr(args, 'provider', None) not in (None, provider):
            raise reject('independent provider binding changed')
        requested_endpoint = getattr(args, 'base_url', None)
        if requested_endpoint is not None and (
            not isinstance(requested_endpoint, str)
            or requested_endpoint.rstrip('/') != endpoint.rstrip('/')
        ):
            raise reject('independent provider binding changed')
        if getattr(args, 'api_key', None) not in (None, secret):
            raise reject('independent provider binding changed')
        resolve(requested=provider)
        scoped = argparse.Namespace(**vars(args))
        scoped.api_key = secret
        scoped.provider = provider
        scoped.base_url = endpoint
        try:
            return await original_gateway(scoped, *positional, **kwargs)
        finally:
            scoped.api_key = None

    gateway.run_gateway_chat = run_gateway_chat
