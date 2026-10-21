import fs from 'node:fs/promises';
import {CliError,fail} from './errors.mjs';
export function parseJsonStrict(text) {
  let p=0; const invalid=()=>fail('USAGE','Input must be valid JSON with unique object fields and safe numbers');
  const ws=()=>{while(/\s/.test(text[p]||'')&&p<text.length)p++;};
  function string(){const start=p++;while(p<text.length){if(text[p]==='\\'){p+=2;continue;}if(text[p++]==='"'){try{return JSON.parse(text.slice(start,p));}catch{invalid();}}}invalid();}
  function value(depth=0){if(depth>80)invalid();ws();const c=text[p];
    if(c==='"')return string();
    if(c==='{'){p++;ws();const result=Object.create(null),keys=new Set();if(text[p]==='}'){p++;return result;}while(p<text.length){ws();if(text[p]!=='"')invalid();const key=string();if(keys.has(key))fail('USAGE','Duplicate JSON field');keys.add(key);ws();if(text[p++]!==':')invalid();result[key]=value(depth+1);ws();const sep=text[p++];if(sep==='}')return result;if(sep!==',')invalid();}invalid();}
    if(c==='['){p++;ws();const result=[];if(text[p]===']'){p++;return result;}while(p<text.length){result.push(value(depth+1));ws();const sep=text[p++];if(sep===']')return result;if(sep!==',')invalid();}invalid();}
    for(const [literal,result] of [['true',true],['false',false],['null',null]])if(text.slice(p,p+literal.length)===literal){p+=literal.length;return result;}
    const number=text.slice(p).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!number)invalid();p+=number[0].length;const n=Number(number[0]);if(!Number.isFinite(n)||(Number.isInteger(n)&&!Number.isSafeInteger(n)))fail('USAGE','Unsafe numeric input; pass long IDs and exact amounts as strings');return n;
  }
  if(typeof text!=='string'||!text.trim())invalid();const result=value();ws();if(p!==text.length)invalid();return result;
}
export function validateSchema(input,schema,where='input') {
  const types=Array.isArray(schema.type)?schema.type:[schema.type];
  const actual=input===null?'null':Array.isArray(input)?'array':typeof input;
  if(schema.type&&!types.includes(actual)&&!(types.includes('integer')&&Number.isSafeInteger(input)))fail('USAGE',`${where} must be ${types.join(' or ')}`);
  if(schema.enum&&!schema.enum.includes(input))fail('USAGE',`${where} is outside the native allowed values`);
  if(actual==='number'&&(!Number.isFinite(input)||(Number.isInteger(input)&&!Number.isSafeInteger(input))))fail('USAGE',`${where} must use a safe number or exact string`);
  if(actual==='string'&&schema.maxLength&&input.length>schema.maxLength)fail('USAGE',`${where} exceeds native maximum length`);
  if(actual==='string'&&schema.pattern&&!new RegExp(schema.pattern).test(input))fail('USAGE',`${where} violates the native format`);
  if(actual==='number'&&((schema.minimum!==undefined&&input<schema.minimum)||(schema.maximum!==undefined&&input>schema.maximum)))fail('USAGE',`${where} is outside the native numeric range`);
  if(actual==='object'){
    for(const key of schema.required||[])if(!Object.hasOwn(input,key))fail('USAGE',`${where}.${key} is required`);
    for(const [key,value] of Object.entries(input)){
      if(schema.properties&&Object.hasOwn(schema.properties,key))validateSchema(value,schema.properties[key],`${where}.${key}`);
      else if(schema.additionalProperties===false)fail('USAGE',`${where} contains an unknown field`);
      else validateSchema(value,{},`${where}.${key}`);
    }
  }
  if(actual==='array')for(let i=0;i<input.length;i++)validateSchema(input[i],schema.items||{},`${where}[${i}]`);
}
export function rejectBusinessSecrets(input,{allowReferences=false}={}) {
  function walk(node){if(!node||typeof node!=='object')return;for(const [key,value]of Object.entries(node)){
    const safeName=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]*$/.test(v)&&!/^(ZIWEI_|CONTROL_MCP_|HERMES_|PYTHON|NODE_OPTIONS$|HOME$|USERPROFILE$)/.test(v);
    const reference=typeof value==='string'&&/^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)&&safeName(value.slice(2,-1));
    const publicAuthMethod=key==='token_endpoint_auth_method'&&value==='none';
    if(/(?:password|passwd|secret|token|cookie|authorization|api[_-]?key|private[_-]?key|bearer)/i.test(key)&&!(allowReferences&&(reference||(/Env$/.test(key)&&safeName(value))||publicAuthMethod)))fail('USAGE','Secrets cannot be supplied through business input; use the existing authorized Profile/environment reference');
    walk(value);
  }}walk(input);
}
export async function readBusinessInput(options,schema,readStdin,{allowReferences=false}={}) {
  const sources=['input','input-file','input-stdin'].filter(k=>Object.hasOwn(options,k));
  if(sources.length>1)fail('USAGE','--input, --input-file and --input-stdin are mutually exclusive');
  let input={};
  if(sources.length){const mode=sources[0];let raw;
    try{raw=mode==='input'?options.input:mode==='input-file'?await fs.readFile(options['input-file'],'utf8'):await readStdin();}catch(error){if(error instanceof CliError)throw error;fail('USAGE','Cannot read the selected input source');}
    input=parseJsonStrict(raw);if(!input||typeof input!=='object'||Array.isArray(input))fail('USAGE','Business input must be an object');
  }
  for(const [field,fieldSchema]of Object.entries(schema.properties||{}))if(Object.hasOwn(options,field)){
    if(Object.hasOwn(input,field))fail('USAGE','The same business field was supplied more than once');
    const raw=options[field];const types=Array.isArray(fieldSchema.type)?fieldSchema.type:[fieldSchema.type];
    input[field]=types.includes('string')?raw:parseJsonStrict(raw);
  }
  rejectBusinessSecrets(input,{allowReferences});validateSchema(input,schema);return input;
}
