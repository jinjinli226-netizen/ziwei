"""One installed SDK/transport capability probe; secrets stay in process memory."""
import os, sys, json, time, hashlib, subprocess, socket, ipaddress, re
from pathlib import Path
from urllib.parse import urlparse
from datetime import datetime, timezone

install, source, out = map(Path, sys.argv[1:4])
out.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(install))
attempt = out / 'probe-request.json'
result_path = out / 'provider-probe-result.json'
if attempt.exists():
    raise SystemExit('Q01_ORIGINAL_PROBE_ALREADY_RECORDED_QUERY_RECEIPT_DO_NOT_RESEND')
proof = {'kind':'installed-transport-and-sdk-capability-probe', 'probeId':out.name if len(sys.argv)>4 else 'q01-gpt-6.1-sol-ultra-20261013',
         'startedAt':datetime.now(timezone.utc).isoformat(), 'requestedModel':'gpt-6.1-sol',
         'requestedEffort':'ultra','productExecutionAccepted':False,'sdkRetries':0,'modelRequests':0,
         'refreshRequests':0,'loginRequests':0,'responseModel':None,'requestId':None,'responseId':None,'usage':None}
if len(sys.argv)>5:
    assert sys.argv[5] in ('max','xhigh'), 'Q01_UNAUTHORIZED_EFFORT'
    proof['requestedEffort']=sys.argv[5]
effort=proof['requestedEffort'];marker='Q01-CAPABILITY-OK'
def save():
    result_path.write_text(json.dumps(proof,ensure_ascii=False,indent=2),encoding='utf-8')
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def source_hashes(): return {n:digest(source/n) for n in ['config.yaml','.env','auth.json']}
def installed_hashes():
    names=list(json.loads((out/'installed-code-before.json').read_text(encoding='utf-8'))['files'])
    entries={n:digest(install/n) for n in names if n and (install/n).is_file()}
    return {'scope':'all tracked Python/JS/PowerShell code','trackedCodeFiles':len(entries),'manifestSha256':hashlib.sha256(json.dumps(entries,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()}
def stage(name):
    (out/'probe-stage.json').write_text(json.dumps({'stage':name,'pid':os.getpid(),'at':datetime.now(timezone.utc).isoformat(),'requestRecorded':attempt.exists()}),encoding='utf-8')
stage('source-and-installed-code-hash')
before=source_hashes(); installed_before=installed_hashes()
proof['sourceHashesBefore']=before;proof['installedBefore']=installed_before
try:
    stage('import-installed-transport-sdk')
    import yaml, httpx
    from dotenv import dotenv_values
    from hermes_cli import auth, auth_codex
    from hermes_cli.auth_constants import _decode_jwt_claims
    from agent.codex_headers import codex_cloudflare_headers
    from agent.transports.codex import ResponsesApiTransport
    from agent.reasoning_effort import codex_supported_efforts, clamp_effort
    from openai import OpenAI
    def block_refresh(*args,**kwargs): raise RuntimeError('Q01_REFRESH_BLOCKED_BEFORE_NETWORK')
    def block_write(*args,**kwargs): raise RuntimeError('Q01_SOURCE_WRITE_BLOCKED')
    for module in [auth,auth_codex]:
        for name in ['refresh_codex_oauth_pure','_refresh_codex_auth_tokens','_recover_codex_tokens_from_cli','_import_codex_cli_tokens']:
            if hasattr(module,name):setattr(module,name,block_refresh)
        for name in ['_save_auth_store','_save_codex_tokens']:
            if hasattr(module,name):setattr(module,name,block_write)
    try: auth_codex.refresh_codex_oauth_pure()
    except RuntimeError as e: assert str(e)=='Q01_REFRESH_BLOCKED_BEFORE_NETWORK';proof['refreshBlockingVerified']=True
    cfg=yaml.safe_load((source/'config.yaml').read_text(encoding='utf-8-sig'))
    assert cfg.get('model',{}).get('provider')=='openai-codex','Q01_SOURCE_PROVIDER_MISMATCH'
    assert cfg.get('model',{}).get('default')=='gpt-6.1-sol','Q01_SOURCE_MODEL_MISMATCH'
    env=dotenv_values(source/'.env')
    selected=env.get('HERMES_CODEX_BASE_URL') or os.getenv('HERMES_CODEX_BASE_URL')
    if selected: os.environ['HERMES_CODEX_BASE_URL']=selected
    base=auth_codex._codex_base_url().rstrip('/')
    url=urlparse(base)
    assert url.scheme=='https' and not url.username and not url.password and not url.query and not url.fragment,'Q01_UNSAFE_PROVIDER_ENDPOINT'
    proof['endpoint']=base+'/responses';proof['providerOrigin']=url.scheme+'://'+url.netloc
    proxy=(env.get('HTTPS_PROXY') or env.get('HTTP_PROXY')) if len(sys.argv)>4 and sys.argv[4]=='source-proxy' else None
    if proxy:
        proxy_url=urlparse(proxy)
        assert proxy_url.scheme=='http' and proxy_url.hostname=='127.0.0.1' and proxy_url.port==7890 and not proxy_url.username and not proxy_url.password and not proxy_url.query,'Q01_PROXY_ROUTE_MISMATCH'
    proof['proxy']=proxy or 'none: isolated SDK trust_env=False';proof['sourceProvider']='openai-codex'
    proof['sourceConfiguredEffort']=cfg.get('agent',{}).get('reasoning_effort')
    proof['nativeDeclaredEfforts']=list(codex_supported_efforts('gpt-6.1-sol'))
    proof['nativeUnmodifiedClamp']=clamp_effort(effort,codex_supported_efforts('gpt-6.1-sol'))
    creds=auth_codex._read_codex_tokens(_lock=False)
    token=creds['tokens']['access_token'];claims=_decode_jwt_claims(token);exp=claims.get('exp')
    proof['credentialSource']='installed native _read_codex_tokens singleton; credential pool not selected'
    proof['localExpiryNotDue']=isinstance(exp,(int,float)) and exp>time.time()+300
    assert proof['localExpiryNotDue'],'Q01_CREDENTIAL_EXPIRED_OR_EXPIRING_NO_REFRESH'
    stage('credential-readonly-ready-no-network-yet')
    # DNS and socket access are restricted to the one selected TLS provider.
    original_resolve=socket.getaddrinfo;original_connect=socket.socket.connect;allowed_ips=set()
    def resolve(host,*args,**kwargs):
        if host!=url.hostname and not(proxy and host=='127.0.0.1'):raise RuntimeError('Q01_OTHER_DNS_BLOCKED')
        rows=original_resolve(host,*args,**kwargs)
        allowed_ips.update(row[4][0] for row in rows);return rows
    def connect(sock,address):
        selected_proxy=proxy and isinstance(address,tuple) and address[0]=='127.0.0.1' and address[1]==7890
        if not selected_proxy and (not isinstance(address,tuple) or address[0] not in allowed_ips or address[1]!=(url.port or 443)):raise RuntimeError('Q01_OTHER_SOCKET_BLOCKED')
        return original_connect(sock,address)
    socket.getaddrinfo=resolve;socket.socket.connect=connect
    def check_wire(request):
        if request.method!='POST' or str(request.url)!=proof['endpoint']:raise RuntimeError('Q01_NON_MODEL_REQUEST_BLOCKED_BEFORE_NETWORK')
        body=json.loads(request.content)
        assert body.get('model')=='gpt-6.1-sol' and body.get('reasoning',{}).get('effort')==effort,'Q01_EXACT_REQUEST_MISMATCH'
        assert body.get('stream') is True and body.get('store') is False and not body.get('tools'),'Q01_PROBE_BOUNDARY_MISMATCH'
        if proof['modelRequests']:raise RuntimeError('Q01_REPLAY_BLOCKED')
        proof['modelRequests']+=1;proof['wireModel']=body['model'];proof['wireReasoning']=body['reasoning']
        proof['wireStream']=body['stream'];proof['wireToolsCount']=len(body.get('tools') or [])
        proof['transportEvents']=[]
        def trace(name,info):proof['transportEvents'].append({'event':name,'at':datetime.now(timezone.utc).isoformat()})
        request.extensions['trace']=trace
        attempt.write_text(json.dumps({'state':'attempt_started_no_auto_replay','probeId':proof['probeId'],
            'endpoint':proof['endpoint'],'model':body['model'],'reasoning':body['reasoning'],'pid':os.getpid(),
            'startedAt':datetime.now(timezone.utc).isoformat()},indent=2),encoding='utf-8');save()
    def observe_response(response):
        proof['httpStatus']=response.status_code
        proof['requestId']=response.headers.get('x-request-id') or response.headers.get('request-id')
        save()
    def assert_only(request):
        if request.method!='POST' or str(request.url)!=proof['endpoint']:raise RuntimeError('Q01_NON_MODEL_REQUEST_BLOCKED_BEFORE_NETWORK')
    try:assert_only(httpx.Request('POST','https://auth.openai.com/oauth/token'))
    except RuntimeError:proof['oauthEndpointBlockingVerified']=True
    kwargs=ResponsesApiTransport().build_kwargs('gpt-6.1-sol',[{'role':'user','content':'Return only '+marker+'.'}],
        instructions='This is an isolated capability check. Reply with the requested short marker. No tools.',
        provider='openai-codex',base_url=base,is_codex_backend=True,reasoning_config={'effort':effort},
        session_id=proof['probeId'],replay_encrypted_reasoning=False,
        request_overrides={'reasoning':{'effort':effort,'summary':'auto'}},timeout=75)
    assert kwargs['model']=='gpt-6.1-sol' and kwargs['reasoning']['effort']==effort
    proof['capabilityOnlyOverride']='transport request_overrides reasoning '+effort+'; installed source unchanged'
    stage('sdk-request-ready')
    with httpx.Client(trust_env=False,timeout=75,follow_redirects=False,transport=httpx.HTTPTransport(retries=0,proxy=proxy,trust_env=False),
          event_hooks={'request':[check_wire],'response':[observe_response]}) as http:
        with OpenAI(api_key=token,base_url=base,default_headers=codex_cloudflare_headers(token,base_url=base),http_client=http,max_retries=0) as client:
            stream=client.responses.create(**kwargs,stream=True)
            final=None;text='';types=[]
            try:
                for event in stream:
                    types.append(event.type)
                    if event.type=='response.output_text.delta':text+=event.delta
                    if event.type in ('response.completed','response.failed','response.incomplete'):final=event.response
            finally:stream.close()
            proof['eventTypes']=sorted(set(types));proof['outputMarkerMatched']=text.strip()==marker
            if final:
                data=final.model_dump();proof['responseModel']=data.get('model');proof['responseId']=data.get('id');proof['responseStatus']=data.get('status')
                proof['usage']=data.get('usage');proof['responseReasoning']=data.get('reasoning')
                proof['serverError']={k:v for k,v in (data.get('error') or {}).items() if k in ('code','type','param')}
                proof['status']='accepted' if data.get('status')=='completed' else 'rejected_or_incomplete'
            else:proof['status']='uncertain';proof['nullEvidenceReason']='Stream ended without terminal response; original request must not be resent.'
except BaseException as exc:
    proof['status']='rejected' if isinstance(getattr(exc,'status_code',None),int) else 'blocked_or_uncertain'
    proof['errorClass']=type(exc).__name__;proof['httpStatus']=getattr(exc,'status_code',proof.get('httpStatus'))
    chain=[];seen=set();current=exc
    while current is not None and id(current) not in seen:
        seen.add(id(current));chain.append(type(current).__name__);current=current.__cause__ or current.__context__
    proof['causeClasses']=chain
    body=getattr(exc,'body',None);error=body.get('error',body) if isinstance(body,dict) else {}
    proof['serverError']={k:v for k,v in error.items() if k in ('code','type','param') and isinstance(v,(str,int,type(None)))}
    msg=error.get('message') if isinstance(error,dict) else None
    if isinstance(msg,str):
        msg=re.sub(r'(?:sk-[\w-]+|eyJ[\w.\-]+|Bearer\s+\S+)','[REDACTED]',msg)
        proof['serverMessage']=msg[:700]
    if proof['modelRequests']==0:proof['preRequestFailureCode']=str(exc) if str(exc).startswith('Q01_') else 'Q01_LOCAL_SETUP_FAILURE'
    proof['nullEvidenceReason']='No completed provider response; response model/usage unavailable.'
finally:
    proof['sourceHashesAfter']=source_hashes();proof['sourceHashesUnchanged']=proof['sourceHashesAfter']==before
    proof['installedAfter']=installed_hashes();proof['installedCodeUnchanged']=proof['installedAfter']==installed_before
    proof['finishedAt']=datetime.now(timezone.utc).isoformat();save()
    print(json.dumps({k:proof.get(k) for k in ['status','modelRequests','endpoint','wireModel','wireReasoning','httpStatus','requestId','responseModel','usage','serverError','serverMessage','preRequestFailureCode','sourceHashesUnchanged','installedCodeUnchanged']},ensure_ascii=False))
