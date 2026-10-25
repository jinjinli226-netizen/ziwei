"""Bind a Bot's explicit key to the verified native resolver, in memory only."""
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
