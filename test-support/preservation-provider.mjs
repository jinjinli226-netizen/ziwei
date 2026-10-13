import http from 'node:http';
let calls=0,activeCalls=0;
const server=http.createServer(async(req,res)=>{
  if(req.url==='/healthz'){res.end(JSON.stringify({ok:true,calls,activeCalls,pid:process.pid}));return;}
  if(req.url==='/catalog'){res.end('{}');return;}
  if(req.url==='/v1/responses'){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls++;const text='LOCAL-CREATOR-REHEARSAL-OK',item={id:'msg_fixture',type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text,annotations:[]}]},response={id:'resp_fixture_'+calls,object:'response',created_at:Math.floor(Date.now()/1000),status:'completed',model:body.model,output:[item],usage:{input_tokens:20,output_tokens:10,total_tokens:30}};
    res.setHeader('content-type','text/event-stream');const event=(type,fields)=>`event: ${type}\ndata: ${JSON.stringify({type,...fields})}\n\n`;res.end(event('response.created',{response:{...response,status:'in_progress',output:[]}})+event('response.output_item.added',{output_index:0,item:{...item,status:'in_progress',content:[]}})+event('response.content_part.added',{item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}})+event('response.output_text.delta',{item_id:item.id,output_index:0,content_index:0,delta:text})+event('response.output_text.done',{item_id:item.id,output_index:0,content_index:0,text})+event('response.content_part.done',{item_id:item.id,output_index:0,content_index:0,part:item.content[0]})+event('response.output_item.done',{output_index:0,item})+event('response.completed',{response}));console.log(JSON.stringify({event:'fixture_creator_call',call:calls,model:body.model,external:false}));return;
  }
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks)),wire=JSON.stringify(body.messages),hasMemory=wire.includes('ROLLBACK-MEMORY-PRESERVED');calls++;activeCalls++;
  if(wire.includes('DELAY-PRESERVATION-COMPLETION'))await new Promise(resolve=>setTimeout(resolve,5000));
  let message={role:'assistant',content:`LOCAL-REHEARSAL-OK memory=${hasMemory}`},finish='stop';
  if(wire.includes('WRITE-ROLLBACK-MEMORY')&&!hasMemory&&body.tools?.some(tool=>tool.function.name==='memory')){message={role:'assistant',content:null,tool_calls:[{id:'rollback-memory',type:'function',function:{name:'memory',arguments:JSON.stringify({action:'add',target:'memory',content:'ROLLBACK-MEMORY-PRESERVED'})}}]};finish='tool_calls';}
  console.log(JSON.stringify({event:'fixture_model_call',call:calls,model:body.model,hasMemory,toolCall:finish==='tool_calls',external:false}));
  activeCalls--;
  if(body.stream){res.setHeader('content-type','text/event-stream');const delta={role:'assistant',...(message.content?{content:message.content}:{}),...(message.tool_calls?{tool_calls:message.tool_calls.map((call,index)=>({...call,index}))}:{})};res.end('data: '+JSON.stringify({id:'rollback-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta,finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'rollback-fixture',object:'chat.completion.chunk',model:body.model,choices:[{index:0,delta:{},finish_reason:finish}]})+'\n\ndata: [DONE]\n\n');}
  else {res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'rollback-fixture',object:'chat.completion',model:body.model,choices:[{index:0,message,finish_reason:finish}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
});
server.listen(Number(process.env.REHEARSAL_PROVIDER_PORT||6389),'127.0.0.1',()=>console.log(JSON.stringify({event:'started',pid:process.pid,port:server.address().port,network:'loopback only'})));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
