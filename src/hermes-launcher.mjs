import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const error=()=>Object.assign(new Error('Hermes 原生入口未绑定可核实的绝对解释器；请更新 Hermes 安装，不会改用系统 Python'),{code:'HERMES_LAUNCHER_UNBOUND'});
const need=value=>{if(!value)throw error();};
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);

/** Read named UV RT_RCDATA resources through the PE directory, never string scanning. */
export function readUvLauncherResources(bytes){
  if(bytes.length<2||bytes.toString('ascii',0,2)!=='MZ')return null;
  const range=(offset,size)=>{need(Number.isSafeInteger(offset)&&Number.isSafeInteger(size)&&offset>=0&&size>=0&&offset+size<=bytes.length);return offset;};
  const u16=offset=>bytes.readUInt16LE(range(offset,2)),u32=offset=>bytes.readUInt32LE(range(offset,4));
  const pe=u32(0x3c);need(bytes.toString('binary',range(pe,4),pe+4)==='PE\0\0');
  const sectionCount=u16(pe+6),optionalSize=u16(pe+20),optional=pe+24,magic=u16(optional);
  need(sectionCount>0&&sectionCount<=96&&(magic===0x10b||magic===0x20b));range(optional,optionalSize);
  const directory=optional+(magic===0x20b?112:96),directoryCount=u32(optional+(magic===0x20b?108:92));
  if(directoryCount<3)return null;need(directory+24<=optional+optionalSize);
  const resourceRva=u32(directory+16),resourceSize=u32(directory+20);if(!resourceRva&&!resourceSize)return null;need(resourceRva>0&&resourceSize>=16);
  const sections=[];
  for(let i=0;i<sectionCount;i++){const at=range(optional+optionalSize+i*40,40);sections.push({rva:u32(at+12),size:u32(at+16),offset:u32(at+20)});}
  const mapped=(rva,size)=>{const matches=sections.filter(section=>rva>=section.rva&&rva-section.rva+size<=section.size);need(matches.length===1);return range(matches[0].offset+rva-matches[0].rva,size);};
  const base=mapped(resourceRva,resourceSize);
  const relative=(offset,size)=>{need(offset>=0&&offset+size<=resourceSize);return range(base+offset,size);};
  const entries=offset=>{const at=relative(offset,16),count=u16(at+12)+u16(at+14);need(count<=256);relative(offset+16,count*8);return Array.from({length:count},(_,i)=>({name:u32(at+16+i*8),target:u32(at+20+i*8)}));};
  const name=value=>{need((value&0x80000000)!==0);const offset=value&0x7fffffff,at=relative(offset,2),length=u16(at);need(length>0&&length<=128);return bytes.toString('utf16le',relative(offset+2,length*2),base+offset+2+length*2);};
  const types=entries(0).filter(entry=>entry.name===10);if(!types.length)return null;need(types.length===1&&(types[0].target&0x80000000)!==0);
  const wanted=new Set(['UV_TRAMPOLINE_KIND','UV_PYTHON_PATH','UV_SCRIPT_DATA']),found=new Map();
  for(const entry of entries(types[0].target&0x7fffffff)){
    if(!(entry.name&0x80000000))continue;const key=name(entry.name);if(!wanted.has(key))continue;
    need(!found.has(key)&&(entry.target&0x80000000)!==0);
    const languages=entries(entry.target&0x7fffffff);need(languages.length===1&&languages[0].name===0&&(languages[0].target&0x80000000)===0);
    const data=relative(languages[0].target,16),rva=u32(data),size=u32(data+4);need(size>0&&size<=2*1024*1024&&u32(data+12)===0);
    const offset=mapped(rva,size);found.set(key,{offset,size,bytes:bytes.subarray(offset,offset+size)});
  }
  if(!found.size)return null;need(found.size===3);
  const kind=found.get('UV_TRAMPOLINE_KIND'),python=found.get('UV_PYTHON_PATH'),script=found.get('UV_SCRIPT_DATA');
  need(kind.size===1&&kind.bytes[0]===1&&python.size<=32768&&script.size<=1024*1024);
  const pythonPath=utf8(python.bytes);need(pythonPath.length>0&&!/[\0\r\n]/.test(pythonPath)&&script.bytes.subarray(0,4).equals(Buffer.from('PK\x03\x04','binary')));
  return {pythonPath,resource:{kind:'uv-pe-resource',offset:script.offset,size:script.size,sha256:sha(script.bytes),launcherSha256:sha(bytes)}};
}

/** Distlib appends a shebang and one console-script ZIP after its PE stub. */
function launcherHeader(bytes){
  if(bytes.toString('ascii',0,2)!=='MZ'){
    need(bytes.subarray(0,2).equals(Buffer.from('#!')));let end=2;
    while(end<bytes.length&&bytes[end]!==10&&bytes[end]!==13)end++;need(end<bytes.length&&end<=32768);return utf8(bytes.subarray(2,end));
  }
  let eocd=-1;
  for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--)if(bytes.readUInt32LE(at)===0x06054b50&&at+22+bytes.readUInt16LE(at+20)===bytes.length){eocd=at;break;}
  need(eocd>=0&&bytes.readUInt16LE(eocd+4)===0&&bytes.readUInt16LE(eocd+6)===0&&bytes.readUInt16LE(eocd+8)===1&&bytes.readUInt16LE(eocd+10)===1);
  const central=eocd-bytes.readUInt32LE(eocd+12),start=central-bytes.readUInt32LE(eocd+16);
  need(start>0&&central>=start+30&&central+46<=eocd&&bytes.readUInt32LE(central)===0x02014b50&&bytes.readUInt32LE(start)===0x04034b50);
  const nameLength=bytes.readUInt16LE(central+28),extra=bytes.readUInt16LE(central+30),comment=bytes.readUInt16LE(central+32);
  need(central+46+nameLength+extra+comment===eocd&&bytes.readUInt16LE(central+34)===0&&bytes.readUInt32LE(central+42)===0&&bytes.subarray(central+46,central+46+nameLength).equals(Buffer.from('__main__.py')));
  const localName=bytes.readUInt16LE(start+26),localExtra=bytes.readUInt16LE(start+28),size=bytes.readUInt32LE(central+20);
  need(start+30+localName+localExtra+size<=central&&bytes.subarray(start+30,start+30+localName).equals(Buffer.from('__main__.py')));
  let end=start;while(end>0&&(bytes[end-1]===10||bytes[end-1]===13))end--;need(end<start);
  const shebang=bytes.lastIndexOf(Buffer.from('#!'),end-1);need(shebang>=0&&end-shebang<=32768);
  const header=utf8(bytes.subarray(shebang+2,end));need(!/[\0\r\n]/.test(header));return header;
}

/** Resolve only the interpreter declared by this native installation. */
export function resolveHermesLauncher(binary,{platform=process.platform,io=fs}={}){
  const paths=platform==='win32'?path.win32:path.posix;
  try{
    need(typeof binary==='string'&&paths.isAbsolute(binary));
    const read=file=>{need(io.statSync(file).isFile());const bytes=io.readFileSync(file);need(bytes.length>0&&bytes.length<=32*1024*1024);return bytes;};
    let launcher=binary,bytes=read(launcher),delegated=false,wrapper;
    if(platform==='win32'&&/\.cmd$/i.test(launcher)){
      need(bytes.length<=16*1024);const lines=utf8(bytes).replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      need(lines.length===2&&/^@echo\s+off$/i.test(lines[0]));const match=lines[1].match(/^"([^"%\r\n]+)"\s+%\*$/);need(match&&paths.isAbsolute(match[1])&&/^hermes\.exe$/i.test(paths.basename(match[1]))&&/^Scripts$/i.test(paths.basename(paths.dirname(match[1]))));
      wrapper={path:binary,sha256:sha(bytes)};launcher=paths.normalize(match[1]);need(io.statSync(paths.join(paths.dirname(paths.dirname(launcher)),'pyvenv.cfg')).isFile());bytes=read(launcher);delegated=true;
    }
    const uv=platform==='win32'?readUvLauncherResources(bytes):null;
    let interpreter,resource,isolated=false;
    if(uv){
      interpreter=uv.pythonPath;resource=uv.resource;
      if(!paths.isAbsolute(interpreter)){
        need(/^python\.exe$/i.test(interpreter)&&/^Scripts$/i.test(paths.basename(paths.dirname(launcher))));
        const config=utf8(read(paths.join(paths.dirname(paths.dirname(launcher)),'pyvenv.cfg')));
        need(/^\s*relocatable\s*=\s*true\s*$/im.test(config));interpreter=paths.join(paths.dirname(launcher),interpreter);
      }
      resource={...resource,interpreter};
    }else{
      let header=launcherHeader(bytes).trim();
      if(header.endsWith(' -I')){isolated=true;header=header.slice(0,-3).trimEnd();}
      interpreter=header.replace(/^"([^"\r\n]+)"$/,'$1');
    }
    need(interpreter&&paths.isAbsolute(interpreter)&&!/[\0\r\n"]/.test(interpreter)&&!/(?:^|[\\/])env(?:\s|$)/.test(interpreter)&&io.statSync(interpreter).isFile());
    return {launcher,interpreter,...(isolated?{pythonArgs:['-I']}:{}),...(resource?{resource}:{}),...((resource||wrapper||isolated)?{binding:{schemaVersion:1,...(resource?{resource}:{}),...(wrapper?{wrapper}:{}),...(isolated?{isolated:{kind:'distlib-isolated',interpreter,launcherSha256:sha(bytes)}}:{})}}:{}),kind:uv?'uv-resource':isolated?'distlib-isolated':delegated?'official-cmd':'absolute-shebang'};
  }catch{throw error();}
}
