"""QA observation and pre-network refresh denial; never changes model/effort."""
import os,sys,json,time,re,socket,ipaddress,hashlib,contextlib
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,os.environ['Q01_INSTALLED_HERMES'])
settings=json.loads(Path(os.environ['Q01_GUARD_SETTINGS']).read_text(encoding='utf-8'))
root=Path(settings['root']); pid=os.getpid(); target=root/('wire-'+str(pid)+'.jsonl')
def record(row):
    with target.open('a',encoding='utf-8') as f:f.write(json.dumps({'at':time.time(),'pid':pid,**row},ensure_ascii=False)+'\n')
def deny(*args,**kwargs):
    record({'kind':'refresh-or-write-blocked-before-network'})
    raise RuntimeError('Q01_SOURCE_REFRESH_OR_WRITE_BLOCKED_BEFORE_NETWORK')
from hermes_cli import auth,auth_codex
for module in [auth,auth_codex]:
    for name in ['refresh_codex_oauth_pure','_refresh_codex_auth_tokens','_save_auth_store','_save_codex_tokens','_recover_codex_tokens_from_cli','_import_codex_cli_tokens']:
        if hasattr(module,name):setattr(module,name,deny)
import httpx
from hermes_cli.auth_constants import _decode_jwt_claims
send=httpx.Client.send
def allowed_request(request):
    u=urlparse(str(request.url));origin=u.scheme+'://'+u.netloc
    if origin==settings['apiOrigin']:return 'owned-product-api'
    if origin!=settings['providerOrigin']:raise RuntimeError('Q01_OTHER_ORIGIN_BLOCKED')
    if request.method=='GET' and u.path=='/backend-api/codex/models':return 'model-metadata'
    if request.method!='POST' or u.path!='/backend-api/codex/responses':raise RuntimeError('Q01_NON_MODEL_REQUEST_BLOCKED')
    return 'model'
def observe_send(client,request,*args,**kwargs):
    kind=allowed_request(request)
    key=request.headers.get('authorization','').removeprefix('Bearer ')
    if kind=='model':
        body=json.loads(request.content);effort=(body.get('reasoning') or {}).get('effort')
        assert body.get('model')=='gpt-6.1-sol' and effort=='max','Q01_PRODUCT_WIRE_MODEL_OR_EFFORT_MISMATCH'
        assert body.get('store') is False,'Q01_MODEL_STORE_POLICY_MISMATCH'
        exp=_decode_jwt_claims(key).get('exp');assert isinstance(exp,(int,float)) and exp>time.time()+300,'Q01_ACTIVE_ACCESS_NOT_LOCALLY_FRESH'
        old_count=sum(1 for p in root.glob('wire-*.jsonl') for line in p.read_text(encoding='utf-8').splitlines() if json.loads(line).get('kind')=='model-request')
        if old_count>=8:raise RuntimeError('Q01_TOTAL_MODEL_REQUEST_BUDGET_EXHAUSTED')
        client_headers={k:v for k,v in request.headers.items() if k.lower() in ['session_id','x-client-request-id']}
        record({'kind':'model-request','endpoint':settings['providerOrigin']+request.url.path,'model':body['model'],'effort':effort,'clientRequest':client_headers,'credentialLocallyFresh':True,'tools':[t.get('name') for t in body.get('tools',[]) if isinstance(t,dict)]})
        def trace(name,info):
            if name.endswith('connect_tcp.started'):
                host=info.get('host');host=host.decode() if isinstance(host,bytes) else host
                record({'kind':'proxy-connect','host':host,'port':info.get('port')})
                assert host=='127.0.0.1' and info.get('port')==7890,'Q01_EXISTING_PROXY_REQUIRED'
        request.extensions['trace']=trace
    try:response=send(client,request,*args,**kwargs)
    except BaseException as exc:
        chain=[];seen=set();current=exc
        while current is not None and id(current) not in seen:
            seen.add(id(current));chain.append(type(current).__name__);current=current.__cause__ or current.__context__
        if kind=='model':record({'kind':'transport-failure','classes':chain})
        raise
    if kind!='model':return response
    record({'kind':'model-http-response','status':response.status_code,'requestId':response.headers.get('x-request-id') or response.headers.get('request-id')})
    inner=response.stream
    class ObservedStream(httpx.SyncByteStream):
        def __iter__(self):
            pending=b''
            for chunk in inner:
                pending+=chunk
                while b'\n' in pending:
                    line,pending=pending.split(b'\n',1)
                    if not line.startswith(b'data:'):continue
                    try:data=json.loads(line[5:].strip())
                    except Exception:continue
                    if data.get('type') in ['response.completed','response.failed','response.incomplete']:
                        r=data.get('response') or {};usage=r.get('usage') or {}
                        record({'kind':'provider-terminal','type':data['type'],'responseId':r.get('id'),'status':r.get('status'),'model':r.get('model'),'reasoningEffort':(r.get('reasoning') or {}).get('effort'),'usage':{k:usage.get(k) for k in ['input_tokens','output_tokens','total_tokens']},'error':{k:v for k,v in (r.get('error') or {}).items() if k in ['code','type','param']}})
                    elif data.get('type')=='error':record({'kind':'provider-error','code':data.get('code'),'param':data.get('param')})
                yield chunk
        def close(self):inner.close()
    response.stream=ObservedStream();return response
httpx.Client.send=observe_send
async_send=httpx.AsyncClient.send
async def guarded_async_send(client,request,*args,**kwargs):
    kind=allowed_request(request)
    if kind=='model':raise RuntimeError('Q01_UNOBSERVED_ASYNC_MODEL_REQUEST_BLOCKED')
    return await async_send(client,request,*args,**kwargs)
httpx.AsyncClient.send=guarded_async_send
# OAuth requests in other HTTP clients are stopped by the socket allowlist.
resolve=socket.getaddrinfo;connect=socket.socket.connect;bind=socket.socket.bind;self_ports=set()
api_port=urlparse(settings['apiOrigin']).port
def guarded_resolve(host,*args,**kwargs):
    if host not in ['127.0.0.1','localhost',None]:raise RuntimeError('Q01_EXTERNAL_DNS_BLOCKED_USE_EXISTING_PROXY')
    return resolve(host,*args,**kwargs)
def guarded_bind(sock,address):
    result=bind(sock,address)
    if isinstance(address,tuple) and address[0] in ['127.0.0.1','localhost']:self_ports.add(sock.getsockname()[1])
    return result
def guarded_connect(sock,address):
    if isinstance(address,tuple) and (not ipaddress.ip_address(address[0]).is_loopback or address[1] not in {api_port,7890,*self_ports}):raise RuntimeError('Q01_OTHER_SOCKET_BLOCKED')
    return connect(sock,address)
socket.getaddrinfo=guarded_resolve;socket.socket.bind=guarded_bind;socket.socket.connect=guarded_connect
record({'kind':'guard-ready','sourceRefreshAndWritesDenied':True,'modelEffortOverride':False})
