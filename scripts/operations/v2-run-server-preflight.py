"""Use an existing private SSH reference; print only the server's safe projection.

Never prints SSH credentials, raw errors or the private reference contents.
Unknown hosts are rejected. Remote execution is stdin only; it writes no remote
probe, database or service file. Evidence output must be new and inside .local.
"""
import argparse, hashlib, json, pathlib, sys

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--ssh-reference',required=True)
    parser.add_argument('--paramiko-path',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    root=pathlib.Path(__file__).resolve().parents[2]
    output=pathlib.Path(args.output).resolve()
    private=root/'.local'
    if private not in output.parents or output.exists():
        raise RuntimeError('New private evidence output required')
    output.parent.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,args.paramiko_path)
    import paramiko
    credentials=json.loads(pathlib.Path(args.ssh_reference).read_text(encoding='utf-8-sig'))
    probe=pathlib.Path(__file__).with_name('v2-server-preflight-readonly.py')
    client=paramiko.SSHClient()
    client.load_host_keys(credentials['knownHosts'])
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    try:
        client.connect(credentials['host'],port=credentials['port'],username=credentials['user'],
                       password=credentials['password'],timeout=20,look_for_keys=False,allow_agent=False)
        stdin,stdout,stderr=client.exec_command('python3 -',timeout=180)
        stdin.write(probe.read_text(encoding='utf-8'));stdin.flush();stdin.channel.shutdown_write()
        data=stdout.read();error=stderr.read();status=stdout.channel.recv_exit_status()
        if status:
            with output.with_suffix('.error.private.log').open('xb') as stream:stream.write(error)
            raise RuntimeError('SERVER_PROBE_FAILED_PRIVATE_ERROR_RETAINED')
        report=json.loads(data)
        report['readerSourceSha256']=hashlib.sha256(probe.read_bytes()).hexdigest()
        report['runnerSourceSha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
        with output.open('x',encoding='utf-8') as stream:
            json.dump(report,stream,ensure_ascii=True,indent=2);stream.write('\n')
        keys=['captureUTC','completedUTC','mainRelease','controlRelease','mainMarker','controlMarker',
              'persistentLinks','officialMetadata','services','health','listeningPorts','terminalMcpV1LocationPresent',
              'nginxLoopbackUpstreams','persistentJournalDirectoryPresent','frontendIndexAssetReferences',
              'publicFiles','officialArchiveRegularFiles','protectedIdentityStable']
        print(json.dumps({'evidence':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
                          **{key:report.get(key) for key in keys},
                          'databases':{label:{key:value.get(key) for key in ['source','integrity','foreignKeyErrors','actionStatusCounts']} for label,value in report['databases'].items()},
                          'objectFiles':len(report['objects']['files']),'serviceActions':0,'databaseWrites':0,
                          'formalGatePassed':False},ensure_ascii=True,indent=2))
    finally:client.close()

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'errorCode':type(error).__name__,'formalGatePassed':False}));sys.exit(1)
