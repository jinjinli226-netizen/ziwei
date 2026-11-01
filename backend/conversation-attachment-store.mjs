import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {MAX_ATTACHMENT_BYTES,MAX_ATTACHMENT_TOTAL_BYTES,MAX_ATTACHMENTS,ATTACHMENT_CHUNK_BYTES} from '../src/conversation-attachment-policy.mjs';
import {inspectRasterImageFile} from '../src/raster-image-file.mjs';
import {canonicalRasterMimeType} from '../src/raster-image.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status,code:'ATTACHMENT_INVALID'});};
const ref=row=>({attachmentId:row.attachment_id,name:row.name,mimeType:row.mime_type,size:row.size,sha256:row.checksum});
export function createConversationAttachmentStore({db,objectStore}) {
  const active=new Set();
  const root=objectStore?.root?path.join(objectStore.root,'.conversation-uploads'):null;
  db.exec(`CREATE TABLE IF NOT EXISTS conversation_attachment_uploads (
    id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,action_id TEXT,device_id TEXT,uploader_id TEXT,
    name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,offset INTEGER NOT NULL DEFAULT 0,attachment_id TEXT,created_at TEXT NOT NULL,request_key TEXT);
    CREATE TABLE IF NOT EXISTS conversation_attachments (
    attachment_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,conversation_id TEXT NOT NULL,action_id TEXT,device_id TEXT,
    name TEXT NOT NULL,mime_type TEXT NOT NULL,size INTEGER NOT NULL,checksum TEXT NOT NULL,storage_key TEXT NOT NULL,created_at TEXT NOT NULL);`);
  if(!db.prepare('PRAGMA table_info(conversation_attachment_uploads)').all().some(row=>row.name==='request_key'))db.exec('ALTER TABLE conversation_attachment_uploads ADD COLUMN request_key TEXT');
  const available=()=>{if(!root||typeof objectStore?.putStream!=='function')fail('附件对象存储尚未配置',503);};
  function upload(scope,id){const row=db.prepare('SELECT * FROM conversation_attachment_uploads WHERE id=?').get(id);if(!row||row.workspace_id!==scope.workspaceId||row.conversation_id!==scope.conversationId||row.action_id!==(scope.actionId||null)||row.device_id!==(scope.deviceId||null)||row.uploader_id!==(scope.uploaderId||null))fail('upload not found',404);return row;}
  function metadata(id){return db.prepare('SELECT * FROM conversation_attachments WHERE attachment_id=?').get(id);}
  const view=row=>({uploadId:row.id,offset:row.offset,size:row.size,chunkSize:ATTACHMENT_CHUNK_BYTES,...(row.attachment_id?{attachment:ref(metadata(row.attachment_id))}:{})});
  const folder=id=>path.join(root,id);
  function get(scope,id){const row=metadata(id);if(!row||row.workspace_id!==scope.workspaceId||row.conversation_id!==scope.conversationId)fail('attachment not found',404);return row;}
  return {objectStore,
    create(scope,input={},requestKey=null) {available();const size=input.size;if(!Number.isSafeInteger(size)||size<=0||size>MAX_ATTACHMENT_BYTES)fail('附件大小必须大于0且不超过500 MiB',413);
      const name=path.posix.basename(String(input.name||'attachment').replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f]/g,'_').slice(0,255)||'attachment';
      const mime=canonicalRasterMimeType(input.mimeType||'application/octet-stream');if(mime.length>255||!/^[-\w.+]+\/[-\w.+]+$/.test(mime))fail('附件 MIME 无效');
      if(requestKey!==null){if(typeof requestKey!=='string'||!requestKey.length||requestKey.length>128)fail('Invalid Idempotency-Key');const old=db.prepare('SELECT * FROM conversation_attachment_uploads WHERE workspace_id=? AND conversation_id=? AND action_id IS ? AND device_id IS ? AND uploader_id IS ? AND request_key=?').get(scope.workspaceId,scope.conversationId,scope.actionId||null,scope.deviceId||null,scope.uploaderId||null,requestKey);if(old){if(old.name!==name||old.mime_type!==mime||old.size!==size)fail('Idempotency-Key metadata conflict',409);return view(old);}}
      const row={id:`upload_${randomUUID()}`,workspace_id:scope.workspaceId,conversation_id:scope.conversationId,action_id:scope.actionId||null,device_id:scope.deviceId||null,uploader_id:scope.uploaderId||null,name,mime_type:mime,size,offset:0,attachment_id:null,created_at:new Date().toISOString(),request_key:requestKey};
      db.prepare('INSERT INTO conversation_attachment_uploads VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));return view(row);
    },
    status(scope,id){return view(upload(scope,id));},
    async append(scope,id,offset,stream){available();const row=upload(scope,id);if(row.attachment_id||active.has(id)||!Number.isSafeInteger(offset)||offset!==row.offset)fail('upload offset conflict',409);if(offset>=row.size)fail('upload size already complete',409);
      active.add(id);fs.mkdirSync(folder(id),{recursive:true});const temporary=path.join(folder(id),`${offset}.tmp`),target=path.join(folder(id),`${offset}.part`);let size=0;
      const meter=new Transform({transform(chunk,_encoding,cb){size+=chunk.length;if(size>ATTACHMENT_CHUNK_BYTES||offset+size>row.size)return cb(Object.assign(new Error('chunk size limit exceeded'),{status:413}));cb(null,chunk);}});
      try {await pipeline(stream,meter,fs.createWriteStream(temporary,{flags:'w',mode:0o600}));if(!size)fail('empty upload chunk');fs.renameSync(temporary,target);db.prepare('UPDATE conversation_attachment_uploads SET offset=? WHERE id=?').run(offset+size,id);return this.status(scope,id);}
      finally{fs.rmSync(temporary,{force:true});active.delete(id);}
    },
    async complete(scope,id){available();const row=upload(scope,id);if(row.attachment_id)return ref(metadata(row.attachment_id));if(active.has(id))fail('upload is busy',409);if(row.offset!==row.size)fail('upload incomplete',409);active.add(id);
      try{const files=fs.readdirSync(folder(id)).filter(x=>/^\d+\.part$/.test(x)).sort((a,b)=>Number(a.split('.')[0])-Number(b.split('.')[0]));
        async function* contents(){for(const file of files)yield* fs.createReadStream(path.join(folder(id),file));}
        const stored=await objectStore.putStream(Readable.from(contents()),{maxBytes:row.size});if(stored.size!==row.size)fail('upload incomplete',409);
        let mimeType=canonicalRasterMimeType(row.mime_type);
        if(['image/png','image/jpeg','image/gif','image/webp'].includes(mimeType)||/\.(?:png|jpe?g|gif|webp)$/i.test(row.name)){
          const image=await inspectRasterImageFile(path.join(objectStore.root,...stored.key.split('/')));
          if(!image)fail('图片内容无效或容器不完整；支持 PNG、JPEG、GIF、WebP');
          if(mimeType!=='application/octet-stream'&&mimeType!==image.mimeType)fail('图片类型与实际内容不一致');
          mimeType=image.mimeType;
        }
        const attachmentId=`attachment_${randomUUID()}`;
        db.exec('SAVEPOINT attachment_complete');
        try {
          db.prepare('INSERT INTO conversation_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(attachmentId,row.workspace_id,row.conversation_id,row.action_id,row.device_id,row.name,mimeType,stored.size,stored.checksum,stored.key,new Date().toISOString());
          db.prepare('UPDATE conversation_attachment_uploads SET attachment_id=? WHERE id=?').run(attachmentId,id);
          db.exec('RELEASE attachment_complete');
        }catch(error){db.exec('ROLLBACK TO attachment_complete; RELEASE attachment_complete');throw error;}
        fs.rmSync(folder(id),{recursive:true,force:true});return ref(metadata(attachmentId));
      }finally{active.delete(id);}
    },
    resolve(scope,items,{actionId=null}={}) {if(!Array.isArray(items)||items.length>MAX_ATTACHMENTS)fail('附件最多20个');let total=0;return items.map(item=>{const row=get(scope,String(item.attachmentId||''));if(actionId&&row.action_id!==actionId)fail('attachment does not belong to action',403);total+=row.size;if(total>MAX_ATTACHMENT_TOTAL_BYTES)fail('附件总大小不能超过500 MiB',413);return ref(row);});},
    clone(sourceScope,targetScope,id){const row=get(sourceScope,id);if(row.workspace_id!==targetScope.workspaceId)fail('attachment workspace mismatch',403);const clone={...row,attachment_id:`attachment_${randomUUID()}`,conversation_id:targetScope.conversationId,action_id:null,device_id:null};db.prepare('INSERT INTO conversation_attachments VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(clone));return ref(clone);},
    open(scope,id){const row=get(scope,id);return {...ref(row),stream:objectStore.openReadStream(row.storage_key,{checksum:row.checksum})};}
  };
}
