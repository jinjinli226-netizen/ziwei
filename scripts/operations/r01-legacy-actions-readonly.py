"""Read-only pre-upgrade evidence projection. No mutation or proof fabrication."""
import collections,datetime,hashlib,json,sqlite3,time
sha=lambda value:hashlib.sha256(value).hexdigest()
def parse(value):
    try:return json.loads(value) if value else None
    except Exception:return None
def uncertainty(value):
    if isinstance(value,list):return any(uncertainty(item) for item in value)
    if not isinstance(value,dict):return False
    return any(value.get(key) in ['uncertain','EXECUTION_UNCERTAIN'] for key in ['code','status','executionState']) or any(uncertainty(item) for item in value.values())
def exit_projections(value):
    if isinstance(value,list):return [part for item in value for part in exit_projections(item)]
    if not isinstance(value,dict):return []
    results=[]
    if 'treeConfirmed' in value or 'rootPid' in value:
        results.append({key:value.get(key) for key in ['supervisor','launched','treeConfirmed','activeProcesses','rootConfirmed','rootPid','rootExitCode','failureCode']})
    return results+[part for item in value.values() for part in exit_projections(item)]
src=sqlite3.connect('file:/opt/ziwei/data/ziwei.sqlite?mode=ro',uri=True,timeout=3)
src.execute('PRAGMA query_only=ON');db=sqlite3.connect(':memory:');deadline=time.monotonic()+20
def progress(*args):
    if time.monotonic()>deadline:raise TimeoutError('Snapshot deadline')
try:src.backup(db,pages=64,sleep=.01,progress=progress)
finally:src.close()
db.row_factory=sqlite3.Row;rows=[]
for record in db.execute('SELECT * FROM a2a_actions ORDER BY created_at,id'):
    action=dict(record);payload=parse(action.get('payload_json'));result=parse(action.get('result_json'))
    item={key:action.get(key) for key in ['id','workspace_id','type','status','acked_at','completed_at','created_at','updated_at']}
    item.update(payloadSha256=sha((action.get('payload_json') or '').encode()),resultSha256=sha((action.get('result_json') or '').encode()),payloadReadable=isinstance(payload,dict),resultReadable=isinstance(result,dict),uncertain=uncertainty(result),processExit=exit_projections(result))
    item['dedupeKeySha256']=sha(str(action['dedupe_key']).encode()) if action.get('dedupe_key') is not None else None
    item['target']={key:payload.get(key) for key in ['deviceId','employeeId','conversationId','taskId']} if isinstance(payload,dict) else None
    item['legacyTreeEvidenceMissing']=bool(action.get('acked_at')) and not any(proof.get('treeConfirmed') is True and proof.get('activeProcesses')==0 and proof.get('rootConfirmed') is True for proof in item['processExit'])
    rows.append(item)
db.close()
print(json.dumps({'kind':'r01-legacy-action-readonly','captureUTC':datetime.datetime.now(datetime.timezone.utc).isoformat(),'database':'/opt/ziwei/data/ziwei.sqlite','actions':rows,'statusCounts':dict(collections.Counter(row['status'] for row in rows)),'expiredAcked':[row['id'] for row in rows if row['status']=='expired' and row['acked_at']],'uncertainActionIds':[row['id'] for row in rows if row['uncertain']],'ackedWithoutLegacyTreeIds':[row['id'] for row in rows if row['legacyTreeEvidenceMissing']],'formalDrainProven':False,'databaseWrites':0,'serviceActions':0,'modelCalls':0,'phoneActions':0},ensure_ascii=True,indent=2))
