"""Finite GitHub metadata audit through existing Git credentials; no mutations.

Only selected repository/CI/hook/deployment metadata is retained. Credentials
remain in memory, API errors and webhook URLs are never written or printed.
"""
import argparse, datetime, hashlib, json, os, pathlib, subprocess, urllib.error, urllib.parse, urllib.request
REPOSITORY='jinjinli226-netizen/ziwei'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,message,headers,new_url):return None
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True);args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2];output=pathlib.Path(args.output).resolve()
    if root/'.local' not in output.parents or output.exists():raise RuntimeError('NEW_PRIVATE_OUTPUT_REQUIRED')
    env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'Never'}
    remote=subprocess.check_output(['git','remote','get-url','origin'],cwd=root,env=env,text=True,timeout=10).strip()
    if remote!='https://github.com/'+REPOSITORY+'.git':raise RuntimeError('FIXED_REPOSITORY_REQUIRED')
    refs=subprocess.check_output(['git','ls-remote','--heads','--tags','origin'],cwd=root,env=env,text=True,timeout=30)
    credentials={}
    try:
        result=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',cwd=root,env=env,text=True,capture_output=True,timeout=15)
        if result.returncode==0:credentials=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    except subprocess.TimeoutExpired:pass
    headers={'User-Agent':'ziwei-r01-readonly-preflight','Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'}
    if credentials.get('password'):headers['Authorization']='Bearer '+credentials['password']
    opener=urllib.request.build_opener(NoRedirect())
    def get(endpoint,project):
        request=urllib.request.Request('https://api.github.com/repos/'+REPOSITORY+endpoint,headers=headers,method='GET')
        try:
            with opener.open(request,timeout=12) as response:
                data=response.read(4*1024*1024+1)
                if len(data)>4*1024*1024:raise RuntimeError('BOUNDED_RESPONSE_REQUIRED')
                return {'httpStatus':response.status,'completePage':response.headers.get('Link') is None,'data':project(json.loads(data))}
        except urllib.error.HTTPError as error:return {'httpStatus':error.code,'data':None,'readable':False}
        except (urllib.error.URLError,TimeoutError):return {'httpStatus':None,'data':None,'readable':False}
    selected=lambda row,keys:{key:row.get(key) for key in keys}
    def hooks(rows):
        result=[]
        for row in rows:
            url=urllib.parse.urlsplit(row.get('config',{}).get('url',''))
            result.append({**selected(row,['id','name','active','events','updated_at']), 'destinationHost':url.hostname,'destinationPathSha256':hashlib.sha256(url.path.encode()).hexdigest(),'queryPresent':bool(url.query),'embeddedCredentialsPresent':bool(url.username or url.password)})
        return result
    report={'schemaVersion':1,'kind':'r01-github-finite-readonly-preflight','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repository':REPOSITORY,'credentialAvailable':bool(credentials.get('password')),'refs':[{'sha':line.split()[0],'ref':line.split()[1]} for line in refs.splitlines()]}
    report['repositoryMetadata']=get('',lambda row:selected(row,['full_name','private','default_branch','permissions','archived','disabled','pushed_at']))
    report['workflows']=get('/actions/workflows?per_page=100',lambda row:{'totalCount':row.get('total_count'),'workflows':[selected(item,['id','name','path','state']) for item in row.get('workflows',[])]})
    report['recentRuns']=get('/actions/runs?per_page=10',lambda row:{'totalCount':row.get('total_count'),'runs':[selected(item,['id','name','event','head_branch','head_sha','status','conclusion','created_at','html_url']) for item in row.get('workflow_runs',[])]})
    report['hooks']=get('/hooks?per_page=100',hooks)
    report['deployments']=get('/deployments?per_page=10',lambda rows:[selected(item,['id','sha','ref','task','environment','created_at']) for item in rows])
    report['environments']=get('/environments?per_page=100',lambda row:{'totalCount':row.get('total_count'),'environments':[selected(item,['id','name','protection_rules','deployment_branch_policy']) for item in row.get('environments',[])]})
    report['mainProtection']=get('/branches/main/protection',lambda row:selected(row,['required_status_checks','required_pull_request_reviews','enforce_admins','allow_force_pushes','allow_deletions']))
    main=next(row['sha'] for row in report['refs'] if row['ref']=='refs/heads/main')
    report['remoteGithubDirectory']=get('/contents/.github?ref='+main,lambda rows:[selected(item,['name','path','type','sha']) for item in rows])
    report.update({'sourceSha256':hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),'completedUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'remoteWrites':0,'push':False,'deploy':False,'externalPollingAutoDeployQualified':False,'formalGatePassed':False})
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x',encoding='utf-8') as stream:json.dump(report,stream,ensure_ascii=True,indent=2);stream.write('\n')
    print(json.dumps({'path':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'credentialAvailable':report['credentialAvailable'],'metadataHttpStatuses':{key:report[key]['httpStatus'] for key in ['repositoryMetadata','workflows','recentRuns','hooks','deployments','environments','mainProtection','remoteGithubDirectory']},'mainSha':main,'remoteWrites':0,'formalGatePassed':False}))
if __name__=='__main__':
    try:main()
    except Exception as error:print(json.dumps({'errorCode':type(error).__name__,'remoteWrites':0,'formalGatePassed':False}));raise SystemExit(1)
