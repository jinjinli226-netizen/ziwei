export function conversationStreamMessages(messages=[],execution){
 const stream=execution?.stream;
 if(!['pending','acked','running'].includes(execution?.status)||!stream?.text||stream.channel&&stream.channel!=='assistant')return messages;
 const id=stream.responseId||stream.messageId||`stream:${execution.id}`;
 if(messages.some(message=>message.id===id))return messages;
 // Each response is an authoritative snapshot; reconnects never append it twice.
 return [...messages,{id,role:'assistant',content:stream.text,streaming:true,actionId:execution.id}];
}
