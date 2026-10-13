"""Process-only explicit Bot effort checks; installed native transport owns conversion."""
import importlib
import json
import os
from pathlib import Path
import sys


def install(current, config, isolation, *, preflight=True, reject=RuntimeError):
    requested=os.environ.get('ZIWEI_BOT_REASONING_EFFORT')
    if not requested:
        return None
    from hermes_constants import VALID_REASONING_EFFORTS, resolve_reasoning_config
    if requested not in VALID_REASONING_EFFORTS:
        raise reject('BOT_REASONING_INVALID')
    raw,effective=config.read_raw_config(),config.load_config()
    if raw.get('agent',{}).get('reasoning_effort')!=requested or effective.get('agent',{}).get('reasoning_effort')!=requested:
        raise reject('BOT_REASONING_MANAGED_CONFLICT')
    model=effective.get('model',{}).get('default')
    provider=effective.get('model',{}).get('provider')
    reasoning=resolve_reasoning_config(effective,model)
    if not reasoning or reasoning.get('enabled') is False or reasoning.get('effort')!=requested:
        raise reject('BOT_REASONING_MANAGED_CONFLICT')
    base={'schemaVersion':1,'employeeId':isolation['employeeId'],'revision':isolation['revision'],
          'provider':provider,'model':model,'requested':requested,'effective':reasoning['effort']}

    def emit(actual,status,phase,*,native_actual=None,mode='native',actual_model=model):
        proof={**base,'actual':actual,'nativeActual':native_actual,'mode':mode,'actualModel':actual_model,
               'status':status,'phase':phase,'evidence':'native_codex_transport'}
        print('ZIWEI_BOT_REASONING:'+json.dumps(proof),file=sys.stderr,flush=True)
        return proof

    # Explicit effort on other providers needs its own verified wire adapter.
    # Old Bots without this field never enter this branch.
    if provider!='openai-codex':
        emit(None,'unsupported','preflight')
        if preflight:raise reject('BOT_REASONING_PROVIDER_UNVERIFIED')
        return None
    transport=importlib.import_module('agent.transports.codex')
    if str(Path(transport.__file__).resolve())!=current['paths'].get('reasoning_transport'):
        raise reject('BOT_REASONING_NATIVE_BINDING')
    original=transport._resolve_reasoning
    original_preflight=transport.ResponsesApiTransport.preflight_kwargs
    last_native_actual,last_mode=None,'native'

    def resolve(selected_model,params):
        native_actual,enabled=original(selected_model,params)
        actual,mode=native_actual,'native'
        # Q01's real Codex endpoint accepted this exact model/effort (HTTP200,
        # response model/effort and usage recorded in the acceptance artifact).
        # Do not change installed vocabularies or any other provider/model/level.
        if provider=='openai-codex' and model==selected_model=='gpt-6.1-sol' and requested=='max' and enabled \
                and params.get('is_codex_backend') is True and (params.get('reasoning_config') or {}).get('effort')=='max' \
                and native_actual=='xhigh':
            actual,mode='max','verified_gpt61_sol_max'
        return actual,enabled,native_actual,mode

    def guarded(selected_model,params):
        nonlocal last_native_actual,last_mode
        actual,enabled,last_native_actual,last_mode=resolve(selected_model,params)
        effective_effort=(params.get('reasoning_config') or {}).get('effort')
        matches=selected_model==model and actual==requested and enabled and effective_effort==requested
        emit(actual if enabled else None,'matched' if matches else 'mismatch','conversion',native_actual=last_native_actual,mode=last_mode,actual_model=selected_model)
        if not matches:
            # SystemExit is not retried by native model-error handlers. Stop
            # before a mismatched request reaches the provider.
            raise SystemExit(125)
        return actual,enabled

    def guarded_preflight(self,api_kwargs,**kwargs):
        normalized=original_preflight(self,api_kwargs,**kwargs)
        # The SDK merges extra_body over typed body fields. Account for these
        # final overrides without logging the body or any credential values.
        extra=normalized.get('extra_body') or {}
        wire_reasoning=extra.get('reasoning',normalized.get('reasoning'))
        actual=wire_reasoning.get('effort') if isinstance(wire_reasoning,dict) else None
        wire_model=extra.get('model',normalized.get('model'))
        matches=wire_model==model and actual==requested
        # Record only nonsecret model/effort fields after native request overrides
        # and sanitization, immediately before the SDK consumes these kwargs.
        safe_model=wire_model if isinstance(wire_model,str) and len(wire_model)<=160 and all(c.isalnum() or c in './:_-' for c in wire_model) else None
        emit(actual if actual in VALID_REASONING_EFFORTS else None,'matched' if matches else 'mismatch','request',native_actual=last_native_actual,mode=last_mode,actual_model=safe_model)
        if not matches:raise SystemExit(125)
        return normalized

    transport._resolve_reasoning=guarded
    transport.ResponsesApiTransport.preflight_kwargs=guarded_preflight
    if not preflight:
        return None
    params={'provider':provider,'base_url':effective.get('model',{}).get('base_url') or os.environ.get('HERMES_CODEX_BASE_URL'),
            'is_codex_backend':True,'reasoning_config':reasoning}
    actual,enabled,last_native_actual,last_mode=resolve(model,params)
    matched=actual==requested and enabled
    proof=emit(actual if enabled else None,'matched' if matched else 'mismatch','preflight',native_actual=last_native_actual,mode=last_mode)
    if not matched:
        raise reject('BOT_REASONING_UNSATISFIED')
    return proof
