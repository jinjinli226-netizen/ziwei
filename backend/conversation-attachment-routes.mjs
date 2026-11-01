import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {ATTACHMENT_TRANSFER_VERSION,MAX_ATTACHMENT_BYTES,ATTACHMENT_CHUNK_BYTES} from '../src/conversation-attachment-policy.mjs';
export const attachmentTransfer={version:ATTACHMENT_TRANSFER_VERSION,maxBytes:MAX_ATTACHMENT_BYTES,chunkBytes:ATTACHMENT_CHUNK_BYTES};
export function mountConversationAttachmentRoutes(app,{repo,employeeContext,mode='user'}) {
  const store=repo.conversationAttachmentStore;
  const base=mode==='action'?'/a2a/v1/actions/:id/attachments':'/api/conversations/:id/attachments';
  function scope(req){
    if(mode==='user'){
      const actor=employeeContext(req),conversation=repo.getConversationAccess(req.params.id,actor);
      if(!conversation)throw Object.assign(new Error('Conversation not found'),{status:404});
      return {workspaceId:conversation.workspace_id,conversationId:conversation.id,uploaderId:actor.actorUserId||null};
    }
    const credential=req.deviceCredential;
    if(req.app.locals.requireDeviceAuth&&!credential)throw Object.assign(new Error('Device authentication required'),{status:401});
    const action=repo.deviceAction(req.params.id,{deviceId:credential?.deviceId});
    const row=repo.db.prepare('SELECT workspace_id FROM a2a_actions WHERE id=?').get(action.id);
    if(credential?.workspaceId&&credential.workspaceId!==row.workspace_id)throw Object.assign(new Error('Action workspace mismatch'),{status:403});
    if(credential?.workspace&&repo.workspaceSlugForA2AAction(action.id)!==credential.workspace)throw Object.assign(new Error('Action workspace mismatch'),{status:403});
    const conversationId=action.payload?.conversationId;
    const conversation=repo.db.prepare('SELECT workspace_id FROM conversations WHERE id=?').get(conversationId||'');
    if(!conversation||conversation.workspace_id!==row.workspace_id)throw Object.assign(new Error('Action conversation not found'),{status:404});
    return {workspaceId:row.workspace_id,conversationId,actionId:action.id,deviceId:credential?.deviceId||action.payload?.deviceId||null,action};
  }
  const handle=fn=>async(req,res,next)=>{try{const context=scope(req);await fn(req,res,context);}catch(error){next(error);}};
  const renew=context=>{if(mode==='action'&&context.deviceId&&context.action.status==='acked')repo.ackA2AAction(context.actionId,{deviceId:context.deviceId,agentId:'ziwei_user',receiptOnly:true,renewLease:true});};
  app.post(`${base}/uploads`,handle((req,res,context)=>{if(mode==='action'&&!['acked','pending'].includes(context.action.status))throw Object.assign(new Error('Action no longer accepts artifacts'),{status:409});res.status(201).json(store.create(context,req.body,req.headers['idempotency-key']||null));}));
  app.get(`${base}/uploads/:uploadId`,handle((req,res,context)=>res.json(store.status(context,req.params.uploadId))));
  app.put(`${base}/uploads/:uploadId`,handle(async(req,res,context)=>{
    if(String(req.headers['content-type']||'').split(';')[0]!=='application/octet-stream')throw Object.assign(new Error('Expected application/octet-stream'),{status:415});
    if(req.headers['content-length']&&Number(req.headers['content-length'])>ATTACHMENT_CHUNK_BYTES)throw Object.assign(new Error('Chunk exceeds 8 MiB'),{status:413});
    const offset=Number(req.query.offset);if(req.query.offset===undefined||!Number.isSafeInteger(offset)||offset<0)throw Object.assign(new Error('Invalid offset'),{status:400});
    renew(context);res.json(await store.append(context,req.params.uploadId,offset,req));
  }));
  app.post(`${base}/uploads/:uploadId/complete`,handle(async(req,res,context)=>res.json(await store.complete(context,req.params.uploadId))));
  app.get(`${base}/:attachmentId`,handle(async(req,res,context)=>{
    const id=req.params.attachmentId;
    if(mode==='action'){
      const own=repo.db.prepare('SELECT 1 FROM conversation_attachments WHERE attachment_id=? AND action_id=?').get(id,context.actionId);
      const input=context.action.payload?.attachments?.some(item=>item.attachmentId===id);
      if(!own&&!input)throw Object.assign(new Error('Attachment does not belong to action'),{status:403});
    }
    const file=store.open(context,id);res.setHeader('Content-Type',file.mimeType);res.setHeader('Content-Length',file.size);
    renew(context);
    const disposition=req.query.download==='1'||!['image/png','image/jpeg','image/gif','image/webp'].includes(file.mimeType)?'attachment':'inline';
    res.setHeader('Content-Disposition',`${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`);res.setHeader('Cache-Control','private, no-store');
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");
    let transferred=0,lastRenewed=Date.now();
    const lease=new Transform({transform(chunk,_encoding,callback){
      transferred+=chunk.length;
      if(transferred>=ATTACHMENT_CHUNK_BYTES||Date.now()-lastRenewed>=60_000){try{renew(context);transferred=0;lastRenewed=Date.now();}catch(error){return callback(error);}}
      callback(null,chunk);
    }});
    await pipeline(file.stream,lease,res);
  }));
}
