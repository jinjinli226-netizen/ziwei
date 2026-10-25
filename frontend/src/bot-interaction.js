const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const base64=value=>{let result='';for(const byte of new Uint8Array(value))result+=String.fromCharCode(byte);return btoa(result);};
export async function sealBrowserAnswer(publicKey,binding,value){
 const subtle=globalThis.crypto?.subtle;if(!subtle)throw Error('请使用 HTTPS 安全页面提交。');
 const pem=publicKey.replace(/-----[A-Z ]+-----/g,'').replace(/\s/g,'');
 const rsa=await subtle.importKey('spki',bytes(pem),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
 const key=await subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12)),aad=new TextEncoder().encode(canonical(binding));
 const plain=new TextEncoder().encode(JSON.stringify(value));
 try{const encrypted=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,plain)),raw=await subtle.exportKey('raw',key);try{return{wrappedKey:base64(await subtle.encrypt({name:'RSA-OAEP',label:aad},rsa,raw)),iv:base64(iv),ciphertext:base64(encrypted.slice(0,-16)),tag:base64(encrypted.slice(-16))};}finally{new Uint8Array(raw).fill(0);}}finally{plain.fill(0);}
}
