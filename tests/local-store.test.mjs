import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { openLocalStore } from '../server/local-store.mjs';
import { createLocalAPI } from '../server/local-api.mjs';

const protection={protectKey:async key=>Buffer.from('test-protected:'+key.toString('base64')),unprotectKey:async value=>Buffer.from(value.toString().slice('test-protected:'.length),'base64')};
const fixture=async()=>{const root=await fs.mkdtemp(join(tmpdir(),'rh-durable-'));let store=await openLocalStore(root,protection);return {root,get store(){return store;},reopen:async()=>{await store.close();store=await openLocalStore(root,protection);},close:async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});}};};

test('account secrets are encrypted on disk and settings survive a process restart',async()=>{
  const f=await fixture();try{await f.store.saveSettings({rh_api_keys_v2:JSON.stringify([{id:'a',apiKey:'PRIVATE-test-key',note:'mail'}]),rh_favorites:JSON.stringify([{name:'H3',webappId:'123'}])});const db=await fs.readFile((await f.store.summary()).databaseFile);assert.equal(db.includes(Buffer.from('PRIVATE-test-key')),false);await f.reopen();assert.equal(JSON.parse((await f.store.settings()).rh_api_keys_v2)[0].apiKey,'PRIVATE-test-key');assert.equal(JSON.parse((await f.store.settings()).rh_favorites)[0].name,'H3');}finally{await f.close();}
});
test('asset bytes are checked, deduplicated, and a missing original blocks saving a snapshot',async()=>{
  const f=await fixture();try{const bytes=Buffer.from('original media'),hash=createHash('sha256').update(bytes).digest('hex');await f.store.receive('assets',hash,Readable.from(bytes));await f.store.receive('assets',hash,Readable.from(bytes));assert.equal((await fs.readdir(join(f.root,'assets'))).length,1);await assert.rejects(f.store.receive('assets','0'.repeat(64),Readable.from(bytes)),/校验失败/);await f.store.write('current',{file:{$rhFile:hash,name:'ref.png'}});await assert.rejects(f.store.write('current',{file:{$rhFile:'f'.repeat(64)}}));assert.equal((await f.store.read('current')).file.$rhFile,hash);await f.reopen();assert.deepEqual(await fs.readFile(await f.store.assetPath(hash)),bytes);}finally{await f.close();}
});
test('backups restore snapshots, credentials and files without reusing generation numbers',async()=>{
  const f=await fixture();try{await f.store.saveSettings({rh_favorites:'["original"]',rh_api_keys_v2:'[{"apiKey":"secret-backup"}]'});await f.store.write('current',{cards:[{name:'named task'}]});const bytes=Buffer.from('saved result');await f.store.receive('results','0001_result.mp4',Readable.from(bytes));const initial=await Promise.all(Array.from({length:8},(_,i)=>f.store.sequence('attempt:'+i)));assert.equal(new Set(initial).size,8);const backup=await f.store.backup();await f.store.saveSettings({rh_favorites:'["changed"]'});await f.store.write('current',{cards:[]});assert.equal(await f.store.sequence('attempt:more'),9);await f.store.restore(backup.id);assert.equal((await f.store.settings()).rh_favorites,'["original"]');assert.equal((await f.store.read('current')).cards[0].name,'named task');assert.equal(await f.store.sequence('attempt:after-restore'),10);assert.deepEqual(await fs.readFile(join(f.root,'results','0001_result.mp4')),bytes);await f.reopen();assert.match((await f.store.settings()).rh_api_keys_v2,/secret-backup/);assert.ok((await f.store.backups()).length>=2);}finally{await f.close();}
});
test('corrupt backups do not replace current data, and two services cannot share a directory',async()=>{
  const f=await fixture();try{await assert.rejects(openLocalStore(f.root,protection),/另一个/);await f.store.saveSettings({rh_favorites:'keep'});const backup=await f.store.backup();await fs.appendFile(join(f.root,'backups',backup.id,'workspace.sqlite'),'corruption');await assert.rejects(f.store.restore(backup.id),/校验失败/);assert.equal((await f.store.settings()).rh_favorites,'keep');}finally{await f.close();}
});
test('migration rejects missing originals atomically and does not overwrite existing workspaces',async()=>{
  const f=await fixture();try{await assert.rejects(f.store.importSnapshots([{key:'first',value:{ok:true}},{key:'bad',value:{$rhFile:'0'.repeat(64)}}]));assert.equal(await f.store.read('first'),undefined);await f.store.write('current',{name:'local'});await f.store.importSnapshots([{key:'current',value:{name:'legacy'}},{key:'attempt:legacy',value:{createdAt:1}}]);assert.equal((await f.store.read('current')).name,'local');assert.equal((await f.store.read('attempt:legacy')).sequence,1);}finally{await f.close();}
});
test('local HTTP API rejects foreign origins and missing tokens; cleared-browser sessions retain saved data',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'rh-http-'));const api=await createLocalAPI({project:root,dataDirectory:join(root,'data'),storeOptions:protection});const server=createServer((req,res)=>api.middleware(req,res,()=>{res.statusCode=404;res.end();}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;try{const session=await(await fetch(base+'/__rh/session')).json();const headers={'X-RH-Token':session.token,'Content-Type':'application/json',Origin:base};assert.equal((await fetch(base+'/__rh/settings')).status,403);assert.equal((await fetch(base+'/__rh/settings',{headers:{...headers,Origin:'https://foreign.test'}})).status,403);assert.equal((await fetch(base+'/__rh/session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);assert.equal((await fetch(base+'/__rh/settings',{method:'PUT',headers,body:JSON.stringify({rh_favorites:'saved outside browser'})})).status,200);const fresh=await(await fetch(base+'/__rh/session')).json();const settings=await(await fetch(base+'/__rh/settings',{headers:{'X-RH-Token':fresh.token}})).json();assert.equal(settings.rh_favorites,'saved outside browser');assert.equal((await fetch(base+'/__rh/reveal',{method:'POST',headers,body:JSON.stringify({path:tmpdir()})})).status,400);}finally{await new Promise(resolve=>server.close(resolve));await api.close();await fs.rm(root,{recursive:true,force:true});}
});
test('Windows credential protection round trips without a plaintext key file',{skip:process.platform!=='win32'},async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'rh-dpapi-'));let store;try{store=await openLocalStore(root);await store.saveSettings({rh_api_keys_v2:'[{"apiKey":"dpapi-test-secret"}]'});await store.close();store=await openLocalStore(root);assert.match((await store.settings()).rh_api_keys_v2,/dpapi-test-secret/);assert.ok((await fs.readFile(join(root,'vault.key'))).length>32);}finally{await store?.close();await fs.rm(root,{recursive:true,force:true});}
});

test('archived media is streamed locally with authenticated range requests',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'rh-media-')),api=await createLocalAPI({project:root,dataDirectory:join(root,'data'),storeOptions:protection});
  const server=createServer((req,res)=>api.middleware(req,res,()=>res.end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{const sessionResponse=await fetch(base+'/__rh/session'),cookie=sessionResponse.headers.get('set-cookie').split(';')[0],session=await sessionResponse.json();const bytes=Buffer.from('0123456789');await api.store.receive('results','0001_video.mp4',Readable.from(bytes));assert.equal((await fetch(base+'/__rh/result/0001_video.mp4')).status,403);const range=await fetch(base+'/__rh/result/0001_video.mp4',{headers:{Cookie:cookie,Range:'bytes=2-5'}});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 2-5/10');assert.equal(await range.text(),'2345');assert.equal((await fetch(base+'/__rh/result/0001_video.mp4',{headers:{'X-RH-Token':session.token,Range:'bytes=100-'}})).status,416);}finally{await new Promise(resolve=>server.close(resolve));await api.close();await fs.rm(root,{recursive:true,force:true});}
});

test('legacy archived files are copied with record numbers while originals are preserved',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'rh-legacy-')),source=join(root,'legacy');await fs.mkdir(source);const store=await openLocalStore(join(root,'data'),{...protection,legacyResultsDirectory:source});
  try{const id='12345678-1234-4234-8234-123456789abc',filename='old_'+id+'_1.mp4',bytes=Buffer.from('legacy output');await fs.writeFile(join(source,filename),bytes);await store.importSnapshots([{key:'attempt:'+id,value:{id,createdAt:1,files:[{index:0,filename,path:'legacy/'+filename}]}}]);const attempt=await store.read('attempt:'+id);assert.equal(attempt.sequence,1);assert.equal(attempt.files[0].filename,'0001_'+filename);assert.deepEqual(await fs.readFile(attempt.files[0].path),bytes);assert.deepEqual(await fs.readFile(join(source,filename)),bytes);assert.equal(attempt.localResultsMissing,false);await store.backup();await fs.unlink(attempt.files[0].path);assert.equal((await store.read('attempt:'+id)).localResultsMissing,true);await assert.rejects(store.backup(),/文件缺失/);const partial=await store.backup(true);assert.equal(partial.incomplete,true);await assert.rejects(store.restore(partial.id),/不完整/);}finally{await store.close();await fs.rm(root,{recursive:true,force:true});}
});

test('directory migration preserves accounts, files and backup history, and refuses nonempty targets',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'rh-move-')),project=join(root,'project');await fs.mkdir(project);const api=await createLocalAPI({project,dataDirectory:join(root,'old'),storeOptions:protection});const server=createServer((req,res)=>api.middleware(req,res,()=>res.end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  try{await api.store.saveSettings({rh_api_keys_v2:'[{"apiKey":"move-secret"}]',rh_favorites:'saved'});await api.store.write('current',{cards:[{name:'move task'}]});await api.store.receive('results','result.mp4',Readable.from('video bytes'));const session=await(await fetch(base+'/__rh/session')).json(),headers={'X-RH-Token':session.token,'Content-Type':'application/json'};const target=join(root,'new');const response=await fetch(base+'/__rh/directory',{method:'POST',headers,body:JSON.stringify({path:target,confirmPath:target})});assert.equal(response.status,200,await response.text());assert.equal(api.store.root,target);assert.match((await api.store.settings()).rh_api_keys_v2,/move-secret/);assert.equal((await api.store.read('current')).cards[0].name,'move task');assert.equal(await fs.readFile(join(target,'results','result.mp4'),'utf8'),'video bytes');assert.ok((await api.store.backups()).length);assert.ok(await fs.stat(join(root,'old','active-db.json')));const bad=await fetch(base+'/__rh/directory',{method:'POST',headers,body:JSON.stringify({path:join(root,'old'),confirmPath:join(root,'old')})});assert.equal(bad.status,400);assert.equal(api.store.root,target);}finally{await new Promise(resolve=>server.close(resolve));await api.close();await fs.rm(root,{recursive:true,force:true});}
});

test('restoring an old workspace preserves later submissions and their original account credentials',async()=>{
  const f=await fixture();try{
    await f.store.saveSettings({rh_api_keys_v2:JSON.stringify([{id:'a',apiKey:'old-key',note:'old'}]),rh_favorites:'old'});
    const backup=await f.store.backup();
    await f.store.saveSettings({rh_api_keys_v2:JSON.stringify([{id:'a',apiKey:'new-key',note:'new'}]),rh_favorites:'new'});
    const signature=createHash('sha256').update('new-key').digest('hex');
    await f.store.write('attempt:pending',{id:'pending',cardId:'card',status:'unknown',accountId:'a',accountSignature:signature,updatedAt:5,sequence:await f.store.sequence('attempt:pending')});
    await f.store.write('attempt:done',{id:'done',status:'saved',updatedAt:6,outputs:[],files:[]});
    await f.store.restore(backup.id);
    const pending=await f.store.read('attempt:pending'),accounts=JSON.parse((await f.store.settings()).rh_api_keys_v2);
    assert.equal(pending.status,'unknown');assert.equal(accounts.find(a=>a.id===pending.accountId).apiKey,'new-key');
    assert.equal(accounts.find(a=>a.id==='a').apiKey,'old-key');
    assert.equal((await f.store.read('attempt:done')).status,'saved');
    assert.equal((await f.store.settings()).rh_favorites,'old');assert.equal(await f.store.sequence('attempt:next'),2);
  }finally{await f.close();}
});

test('number reservations are idempotent, survive restart and keep batch counters across restore',async()=>{
 const f=await fixture();try{
  const first=await f.store.reserveNumber('attempt:one');assert.deepEqual(first,{sequence:1,displaySequence:1,sequenceBatch:1});
  assert.deepEqual(await f.store.reserveNumber('attempt:one'),first);
  const backup=await f.store.backup();await f.store.resetNumbering(1);
  const numbers=await Promise.all(Array.from({length:12},(_,i)=>f.store.reserveNumber('attempt:batch-'+i)));
  assert.equal(new Set(numbers.map(n=>n.sequence)).size,12);assert.deepEqual(numbers[0],{sequence:2,displaySequence:1,sequenceBatch:2});
  await f.reopen();assert.equal((await f.store.numbering()).next,13);assert.equal((await f.store.numbering()).sequenceBatch,2);
  await f.store.restore(backup.id);assert.deepEqual(await f.store.reserveNumber('attempt:batch-0'),numbers[0]);
  assert.deepEqual(await f.store.reserveNumber('attempt:after'),{sequence:14,displaySequence:13,sequenceBatch:2});
  await assert.rejects(f.store.resetNumbering(1),/批次已变化/);
  await f.store.write('attempt:pending',{status:'unknown'});await assert.rejects(f.store.resetNumbering(2),/待确认/);
 }finally{await f.close();}
});
test('new-batch output prefixes remain unchanged on reopening the local library',async()=>{
 const f=await fixture();try{
  await f.store.reserveNumber('old');await f.store.resetNumbering(1);
  const id='12345678-1234-4234-8234-123456789abc',number=await f.store.reserveNumber('attempt:'+id),filename='0001_B02_result_'+id+'_1.mp4';
  const receipt=await f.store.receive('results',filename,Readable.from('batch2 bytes'));
  await f.store.write('attempt:'+id,{id,createdAt:1,...number,status:'saved',files:[{index:0,...receipt}]});
  await f.reopen();const record=await f.store.read('attempt:'+id);assert.equal(record.files[0].filename,filename);assert.equal(record.displaySequence,1);assert.equal(record.sequence,2);
  assert.deepEqual(await fs.readdir(join(f.root,'results')),[filename]);
 }finally{await f.close();}
});

test('reveal resolves the real saved file and propagates Explorer errors through the local API',async()=>{
 const root=await fs.mkdtemp(join(tmpdir(),'rh-reveal-'));let selected;
 const api=await createLocalAPI({project:root,dataDirectory:join(root,'data'),storeOptions:{...protection,revealPath:async(path,directory)=>{selected={path,directory};throw new Error('native reveal rejected');}}});
 const server=createServer((req,res)=>api.middleware(req,res,()=>res.end()));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{const receipt=await api.store.receive('results',"0001_中文 逗号,测试.mp4",Readable.from('fake video'));const session=await(await fetch(base+'/__rh/session')).json(),headers={'X-RH-Token':session.token,'Content-Type':'application/json'};
 const response=await fetch(base+'/__rh/reveal',{method:'POST',headers,body:JSON.stringify({path:receipt.path})});assert.equal(response.status,400);assert.match((await response.json()).error,/native reveal rejected/);assert.equal(selected.path,await fs.realpath(receipt.path));assert.equal(selected.directory,false);
 selected=undefined;const outside=await fetch(base+'/__rh/reveal',{method:'POST',headers,body:JSON.stringify({path:root})});assert.equal(outside.status,400);assert.equal(selected,undefined);
 }finally{await new Promise(resolve=>server.close(resolve));await api.close();await fs.rm(root,{recursive:true,force:true});}
});
