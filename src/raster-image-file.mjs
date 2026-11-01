import fs from 'node:fs';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {inspectRasterImageReader} from './raster-image.mjs';
import {MAX_ATTACHMENT_BYTES} from './conversation-attachment-policy.mjs';

const PAGE_BYTES=64*1024;
function inspectFile(filename) {
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|(process.platform==='win32'?0:fs.constants.O_NOFOLLOW));
  const stats={bytesRead:0,maxBufferedBytes:PAGE_BYTES};
  try {
    const initial=fs.fstatSync(fd),length=initial.size;
    if(!initial.isFile()||!length||length>MAX_ATTACHMENT_BYTES)return {image:null,stats};
    const page=Buffer.allocUnsafe(PAGE_BYTES);let pageStart=-1,pageLength=0;
    function load(offset) {
      if(offset>=pageStart&&offset<pageStart+pageLength)return;
      pageStart=Math.floor(offset/PAGE_BYTES)*PAGE_BYTES;
      pageLength=fs.readSync(fd,page,0,Math.min(PAGE_BYTES,length-pageStart),pageStart);stats.bytesRead+=pageLength;
    }
    function range(start,end) {
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>length||end-start>PAGE_BYTES)throw new Error('Invalid bounded image read');
      stats.maxBufferedBytes=Math.max(stats.maxBufferedBytes,PAGE_BYTES+end-start);
      const out=Buffer.allocUnsafe(end-start);let offset=start;
      while(offset<end){load(offset);const count=Math.min(end-offset,pageStart+pageLength-offset);if(count<=0)throw new Error('Image changed while reading');page.copy(out,offset-start,offset-pageStart,offset-pageStart+count);offset+=count;}
      return out;
    }
    const reader={length,
      subarray:(start,end)=>range(start,end),
      toString:(encoding,start,end)=>range(start,end).toString(encoding),
      readUInt16LE:offset=>range(offset,offset+2).readUInt16LE(),
      readUInt16BE:offset=>range(offset,offset+2).readUInt16BE(),
      readUInt32LE:offset=>range(offset,offset+4).readUInt32LE(),
      readUInt32BE:offset=>range(offset,offset+4).readUInt32BE(),
      readUIntLE:(offset,size)=>range(offset,offset+size).readUIntLE(0,size),
      indexOf(value,start=0){let offset=start;while(offset<length){load(offset);const found=page.subarray(offset-pageStart,pageLength).indexOf(value);if(found>=0)return offset+found;offset=pageStart+pageLength;}return -1;}
    };
    const bytes=new Proxy(reader,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key)){const offset=Number(key);if(offset>=length)return undefined;load(offset);return page[offset-pageStart];}return target[key];}});
    const image=inspectRasterImageReader(bytes),final=fs.fstatSync(fd);
    return {image:initial.size===final.size&&initial.mtimeMs===final.mtimeMs?image:null,stats};
  } finally {fs.closeSync(fd);}
}

// Large JPEG entropy scans run outside the API event loop. Each worker keeps
// one 64KiB file page instead of allocating a buffer for the complete upload.
export function inspectRasterImageFileWithStats(filename) {
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:{filename},execArgv:[]});
    worker.once('message',message=>message.error?reject(new Error(message.error)):resolve(message));
    worker.once('error',reject);
    worker.once('exit',code=>{if(code!==0)reject(new Error(`Image file validation exited ${code}`));});
  });
}
export async function inspectRasterImageFile(filename) {return (await inspectRasterImageFileWithStats(filename)).image;}
if(!isMainThread&&workerData?.filename){
  try{parentPort.postMessage(inspectFile(workerData.filename));}
  catch(error){parentPort.postMessage({error:error.message});}
}
