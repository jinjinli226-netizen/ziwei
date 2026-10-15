// Bounded container recognition, not pixel/entropy decoding. The original bytes
// remain untouched, including data following the complete image datastream.
const MAX_BYTES = 10 * 1024 * 1024;
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
const result = (mimeType,width,height,endOffset) => ({mimeType,width,height,endOffset});
const u24 = (bytes,offset) => bytes.readUIntLE(offset,3);

function png(bytes) {
  if (bytes.length < 45 || !bytes.subarray(0,8).equals(pngSignature)) return null;
  let offset=8,width,height,color,palette=false,data=false,dataBytes=0,dataClosed=false;
  while (offset+12 <= bytes.length) {
    const length=bytes.readUInt32BE(offset),end=offset+12+length,type=bytes.toString('ascii',offset+4,offset+8);
    if (length>0x7fffffff || end>bytes.length || !/^[A-Za-z]{4}$/.test(type)) return null;
    if (offset===8) {
      if (type!=='IHDR' || length!==13) return null;
      width=bytes.readUInt32BE(offset+8);height=bytes.readUInt32BE(offset+12);color=bytes[offset+17];
      const depths={0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (!width || !height || width>0x7fffffff || height>0x7fffffff || !depths[color]?.includes(bytes[offset+16]) || bytes[offset+18]!==0 || bytes[offset+19]!==0 || bytes[offset+20]>1) return null;
    } else if (type==='IHDR') return null;
    else if (type==='PLTE') {
      if (palette || data || !length || length%3 || length>768 || color===0 || color===4) return null;
      palette=true;
    } else if (type==='IDAT') {
      if (dataClosed || color===3&&!palette) return null;
      data=true;dataBytes+=length;
    } else if (type==='IEND') {
      return length===0 && data && dataBytes>0 ? result('image/png',width,height,end) : null;
    } else {
      if (data) dataClosed=true;
      // Unknown ancillary chunks are safe to skip by their declared length.
      if ((bytes[offset+4]&32)===0) return null;
    }
    offset=end;
  }
  return null;
}

const frameMarkers = new Set([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf]);
function jpeg(bytes) {
  if (bytes.length<4 || bytes[0]!==0xff || bytes[1]!==0xd8) return null;
  let offset=2,width=0,height=0,components=null,scans=0;
  while (offset<bytes.length) {
    if (bytes[offset++]!==0xff) return null;
    while (offset<bytes.length && bytes[offset]===0xff) offset++;
    if (offset>=bytes.length) return null;
    const marker=bytes[offset++];
    if (marker===0xd9) return components && width && height && scans ? result('image/jpeg',width,height,offset) : null;
    if (marker===0x01) continue;
    if (!marker || marker===0xd8 || marker>=0xd0&&marker<=0xd7 || offset+2>bytes.length) return null;
    const length=bytes.readUInt16BE(offset),end=offset+length;
    if (length<2 || end>bytes.length) return null;
    if (frameMarkers.has(marker)) {
      if (components&&!scans) return null;
      scans=0;
      if (length<11) return null;
      const count=bytes[offset+7];height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);
      if (!width || !count || length!==8+3*count || !bytes[offset+2] || bytes[offset+2]>16) return null;
      components=new Set();
      for(let i=0;i<count;i++) {
        const at=offset+8+i*3,id=bytes[at],sampling=bytes[at+1];
        if (components.has(id) || !(sampling>>4) || !(sampling&15)) return null;
        components.add(id);
      }
    } else if (marker===0xdc) {
      if (!components || length!==4 || height || !bytes.readUInt16BE(offset+2)) return null;
      height=bytes.readUInt16BE(offset+2);
    } else if (marker===0xda) {
      const count=bytes[offset+2];
      if (!components || !count || count>4 || length!==6+2*count) return null;
      const selected=new Set();
      for(let i=0;i<count;i++) {const id=bytes[offset+3+i*2];if(!components.has(id)||selected.has(id))return null;selected.add(id);}
      offset=end;let entropy=0,ended=false;
      while (offset<bytes.length) {
        if (bytes[offset]!==0xff) {entropy++;offset++;continue;}
        const start=offset;while(offset<bytes.length&&bytes[offset]===0xff)offset++;
        if (offset>=bytes.length) return null;
        const next=bytes[offset];
        if (next===0x00) {entropy++;offset++;continue;}
        if (next>=0xd0&&next<=0xd7) {offset++;continue;}
        if (next===0xdc) {
          if (height || offset+5>bytes.length || bytes.readUInt16BE(offset+1)!==4 || !bytes.readUInt16BE(offset+3)) return null;
          height=bytes.readUInt16BE(offset+3);offset+=5;continue;
        }
        offset=start;ended=true;break;
      }
      if (!ended || !entropy) return null;
      scans++;continue;
    }
    offset=end;
  }
  return null;
}

function subBlocks(bytes,offset) {
  let size=0;
  while (offset<bytes.length) {
    const count=bytes[offset++];if(!count)return {end:offset,size};
    if(offset+count>bytes.length)return null;size+=count;offset+=count;
  }
  return null;
}
function gif(bytes) {
  if(bytes.length<14 || !['GIF87a','GIF89a'].includes(bytes.toString('ascii',0,6)))return null;
  const width=bytes.readUInt16LE(6),height=bytes.readUInt16LE(8),global=Boolean(bytes[10]&128);
  if(!width||!height)return null;
  let offset=13+(global?3*(1<<((bytes[10]&7)+1)):0),frames=0;
  if(offset>bytes.length)return null;
  while(offset<bytes.length) {
    const kind=bytes[offset++];
    if(kind===0x3b)return frames?result('image/gif',width,height,offset):null;
    if(kind===0x21) {
      if(offset>=bytes.length)return null;const label=bytes[offset++];
      if(label===0xf9) {if(offset+6>bytes.length||bytes[offset]!==4||bytes[offset+5]!==0)return null;offset+=6;continue;}
      if(label===0xff||label===0x01) {const size=label===0xff?11:12;if(offset+1+size>bytes.length||bytes[offset]!==size)return null;offset+=1+size;}
      const blocks=subBlocks(bytes,offset);if(!blocks)return null;offset=blocks.end;
    } else if(kind===0x2c) {
      if(offset+9>bytes.length || !bytes.readUInt16LE(offset+4) || !bytes.readUInt16LE(offset+6))return null;
      const packed=bytes[offset+8],local=Boolean(packed&128);offset+=9;
      if(!global&&!local)return null;
      if(local)offset+=3*(1<<((packed&7)+1));
      if(offset>=bytes.length||bytes[offset]<2||bytes[offset]>8)return null;offset++;
      const blocks=subBlocks(bytes,offset);if(!blocks||!blocks.size)return null;offset=blocks.end;frames++;
    } else return null;
  }
  return null;
}

function webpFrame(bytes,type,start,size) {
  if(type==='VP8 ') {
    if(size<=10 || bytes[start]&1 || !bytes.subarray(start+3,start+6).equals(Buffer.from([0x9d,1,0x2a])))return null;
    const tag=bytes.readUIntLE(start,3),partition=tag>>>5;
    if(!partition||partition>size-10||((tag>>>1)&7)>3||!(tag&16))return null;
    const width=bytes.readUInt16LE(start+6)&0x3fff,height=bytes.readUInt16LE(start+8)&0x3fff;
    return width&&height?{width,height}:null;
  }
  if(type==='VP8L') {
    if(size<=5 || bytes[start]!==0x2f)return null;
    const bits=bytes.readUInt32LE(start+1);if(bits>>>29)return null;
    return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1};
  }
  return null;
}
function webp(bytes) {
  if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')return null;
  const end=8+bytes.readUInt32LE(4);if(end<20||end>bytes.length||end%2)return null;
  let offset=12,canvas=null,animation=false,anim=false,frames=0,image=null;
  while(offset+8<=end) {
    const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4),start=offset+8,next=start+size+(size&1);
    if(next>end)return null;
    if(type==='VP8X') {
      if(canvas||offset!==12||size!==10||bytes[start]&0xc1||bytes[start+1]||bytes[start+2]||bytes[start+3])return null;
      canvas={width:u24(bytes,start+4)+1,height:u24(bytes,start+7)+1};animation=Boolean(bytes[start]&2);
    } else if(type==='VP8 '||type==='VP8L') {
      if(image||animation)return null;image=webpFrame(bytes,type,start,size);if(!image)return null;
    } else if(type==='ANIM') {
      if(!animation||anim||size!==6||frames)return null;anim=true;
    } else if(type==='ANMF') {
      if(!animation||!anim||size<24||bytes[start+15]&0xfc)return null;
      const width=u24(bytes,start+6)+1,height=u24(bytes,start+9)+1;
      if(u24(bytes,start)*2+width>canvas.width||u24(bytes,start+3)*2+height>canvas.height)return null;
      let at=start+16,frame=null;
      while(at+8<=start+size) {
        const inner=bytes.toString('ascii',at,at+4),length=bytes.readUInt32LE(at+4),data=at+8,after=data+length+(length&1);
        if(after>start+size)return null;
        if(inner==='VP8 '||inner==='VP8L') {if(frame)return null;frame=webpFrame(bytes,inner,data,length);if(!frame)return null;}
        at=after;
      }
      if(at!==start+size||!frame||frame.width!==width||frame.height!==height)return null;frames++;
    }
    offset=next;
  }
  if(offset!==end||(animation?(!anim||!frames):!image))return null;
  const dimensions=canvas||image;
  if(!animation&&canvas&&(canvas.width!==image.width||canvas.height!==image.height))return null;
  return result('image/webp',dimensions.width,dimensions.height,end);
}

export function inspectRasterImage(value) {
  if(!(value instanceof Uint8Array)||!value.length||value.length>MAX_BYTES)return null;
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value.buffer,value.byteOffset,value.byteLength);
  try {return png(bytes)||jpeg(bytes)||gif(bytes)||webp(bytes);} catch {return null;}
}
export const rasterImageMimeType = bytes => inspectRasterImage(bytes)?.mimeType || null;
export function canonicalRasterMimeType(value) {
  const type=String(value||'').trim().toLowerCase();
  return ['image/jpg','image/pjpeg'].includes(type)?'image/jpeg':type;
}
