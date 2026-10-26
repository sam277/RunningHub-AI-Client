import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { createLocalAPI } from '../server/local-api.mjs';

// Real SQLite persistence and request races, with every platform request mocked.
test('durable cancellation covers submit races, rejection/retry, completed races and recovery',async t=>{
 const root=await mkdtemp(join(tmpdir(),'rh-cancel-')),outfile=join(root,'production.mjs');
 await build({stdin:{contents:"export * from './services/production';export * from './services/localPersistence';export * from './services/workspaceStorage';export * from './services/taskExecutor';",resolveDir:process.cwd(),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile});
 const api=await createLocalAPI({project:root,dataDirectory:join(root,'data'),storeOptions:{protectKey:async key=>key,unprotectKey:async key=>key}});
 const server=createServer((req,res)=>api.middleware(req,res,()=>res.end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port,realFetch=globalThis.fetch,oldWindow=globalThis.window;
 const storage=new Map([['rh_runninghub_region_mode','global']]);
 globalThis.window={localStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},addEventListener(){},dispatchEvent(){}};
 let platform=async()=>{throw new Error('unexpected platform call');};
 globalThis.fetch=(url,init)=>String(url).includes('runninghub.')?platform(String(url),init):realFetch(new URL(url,base),init);
 const app=await import(pathToFileURL(outfile).href);
 const account={id:'original',apiKey:'original-key',note:'original@example.test',enabled:true,concurrency:1};
 const request={apiKey:account.apiKey,webappId:'123',taskNodes:[],autoSaveEnabled:false,control:{pollOffsetMs:-3490}};
 const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
 const wait=async(fn)=>{for(let n=0;n<200;n++){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('condition timeout');};
 const record=async cardId=>(await app.listAttemptSummaries()).find(a=>a.cardId===cardId);
 const run=cardId=>app.runProductionTask(request,{cardId,name:cardId,account}).catch(error=>error);
 try{
  await app.initializeLocalPersistence();
  await t.test('cancellation during POST is persisted and sent with original credentials on acceptance',async()=>{
   let release,received=false,cancelled=false,submits=0,cancels=0;
   platform=async(url,init)=>{
    if(url.endsWith('/ai-app/run')){submits++;received=true;await new Promise(resolve=>release=resolve);return json({code:0,data:{taskId:'race-task',taskStatus:'RUNNING'}});}
    if(url.endsWith('/cancel')){cancels++;assert.equal(init.headers.Authorization,'Bearer original-key');assert.equal(url,'https://www.runninghub.ai/task/openapi/cancel');assert.deepEqual(JSON.parse(init.body),{apiKey:'original-key',taskId:'race-task'});cancelled=true;return json({code:0,msg:'success'});}
    return json({taskId:'race-task',status:cancelled?'CANCEL':'RUNNING',results:[]});
   };
   const pending=run('race');await wait(()=>received);
   const before=await record('race');assert.equal(before.status,'submitting');assert.equal(before.taskId,undefined);
   await app.requestAttemptCancellation(before.id,[account]);release();
   assert.ok(await pending instanceof app.RemoteTaskCancelledError);
   const after=await record('race');assert.equal(after.status,'cancelled');assert.ok(after.cancelRequestedAt);assert.ok(after.cancelSentAt);assert.equal(submits,1);assert.equal(cancels,1);
  });
  await t.test('platform refusal remains active and explicit retry clears the error durably',async()=>{
   let cancels=0,submits=0,cancelled=false;
   platform=async url=>{
    if(url.endsWith('/ai-app/run')){submits++;return json({code:0,data:{taskId:'retry-task',taskStatus:'RUNNING'}});}
    if(url.endsWith('/cancel')){cancels++;if(cancels===1)return json({code:807,msg:'cancel refused'});cancelled=true;return json({code:0,msg:'success'});}
    return json({taskId:'retry-task',status:cancelled?'CANCEL':'RUNNING',results:[]});
   };
   const pending=run('retry');await wait(async()=>!!(await record('retry'))?.taskId);const id=(await record('retry')).id;
   await assert.rejects(app.requestAttemptCancellation(id,[account]),/cancel refused/);
   const refused=await record('retry');assert.ok(['queued','running'].includes(refused.status));assert.equal(refused.cancelError,'cancel refused');assert.equal(app.cancellationPending(refused),false);
   await app.requestAttemptCancellation(id,[account]);assert.ok(await pending instanceof app.RemoteTaskCancelledError);
   const after=await record('retry');assert.equal(after.status,'cancelled');assert.equal(after.cancelError,null);assert.equal(cancels,2);assert.equal(submits,1);
  });
  await t.test('completion racing cancellation retains the generated result',async()=>{
   let finish=false;
   platform=async url=>{
    if(url.endsWith('/ai-app/run'))return json({code:0,data:{taskId:'completed-task',taskStatus:'RUNNING'}});
    if(url.endsWith('/cancel')){finish=true;return json({code:0,msg:'success'});}
    if(url.endsWith('/outputs'))return json({code:0,data:[{fileUrl:'https://result.test/video.mp4',consumeCoins:'10'}]});
    return json({taskId:'completed-task',status:finish?'SUCCESS':'RUNNING',results:finish?[{url:'https://result.test/video.mp4',type:'video'}]:[]});
   };
   const pending=run('complete');await wait(async()=>!!(await record('complete'))?.taskId);await app.requestAttemptCancellation((await record('complete')).id,[account]);
   assert.equal((await pending).outputs.length,1);const after=await record('complete');assert.equal(after.status,'completed');assert.equal(after.outputs.length,1);assert.equal(app.cancellationPending(after),false);
  });
  await t.test('pending intent survives service recovery; wrong accounts cannot cancel or resubmit',async()=>{
   let cancels=0,queries=0;
   platform=async(url,init)=>{
    assert.equal(init.headers.Authorization,'Bearer original-key');
    if(url.endsWith('/cancel')){cancels++;return json({code:0,msg:'success'});}
    assert.ok(url.endsWith('/v2/query'));queries++;return json({taskId:'recovered-task',status:'CANCEL',results:[]});
   };
   const source=await record('race'),id=crypto.randomUUID();
   await app.writeWorkspaceData('attempt:'+id,{...source,id,cardId:'recovered',status:'running',taskId:'recovered-task',cancelSentAt:null,cancelError:null});
   await assert.rejects(app.requestAttemptCancellation(id,[{...account,apiKey:'wrong-key'}]),/原账号/);assert.equal(cancels,0);
   // A user retry saves intent, then a restart-style recovery sends it.
   await app.patchWorkspaceFields('attempt:'+id,{cancelError:null,cancelSentAt:null});
   await app.recoverAttempt(id,[account],false);assert.equal((await record('recovered')).status,'cancelled');assert.equal(cancels,1);assert.equal(queries,1);
   await app.recoverAttempt(id,[account],false);assert.equal(cancels,1);assert.equal(queries,1);
  });
 }finally{globalThis.fetch=realFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;await new Promise(resolve=>server.close(resolve));await api.close();await rm(root,{recursive:true,force:true});}
});
