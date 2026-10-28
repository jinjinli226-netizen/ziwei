#!/usr/bin/env node
import {runCli} from '../src/main.mjs';
const controller=new AbortController();
const onInterrupt=()=>controller.abort();
process.once('SIGINT',onInterrupt);
try{const result=await runCli(process.argv.slice(2),{signal:controller.signal});process.exitCode=result.exitCode;}
finally{process.removeListener('SIGINT',onInterrupt);}
