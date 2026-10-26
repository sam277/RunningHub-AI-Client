// Disposable profile + real local database/files. Every RunningHub call is mocked.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
const { chromium }=await import(pathToFileURL(join(process.env.RH_PLAYWRIGHT_ROOT||'C:/Users/samko/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright','index.mjs')).href);
const root=await fs.mkdtemp(join(tmpdir(),'rh-workbench-')),dataDir=join(root,'data'),configDir=join(root,'config');await fs.mkdir(configDir);
const portServer=createServer();await new Promise(resolve=>portServer.listen(0,'127.0.0.1',resolve));const port=portServer.address().port;await new Promise(resolve=>portServer.close(resolve));const base='http://127.0.0.1:'+port;
const video=await fs.readFile('.browser-test-output/preview-fixture.mp4');
const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII=','base64');
let server,context,page,serverLog='';const submitted=[],errors=[];const queries=new Map();let holdNewTasks=false,blockUploads=false,mixedQueuedTasks=false;const uploadGates=[],cancelledTasks=new Set(),cancelCalls=[];
const poll=async(fn,message,ms=20000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(message);};
async function start(){server=spawn(process.execPath,['scripts/start-local.mjs','--port',String(port),'--data-dir',dataDir,'--config-dir',configDir],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});server.stdout.on('data',d=>serverLog+=d);server.stderr.on('data',d=>serverLog+=d);await poll(async()=>{try{const response=await fetch(base+'/__rh/session');const info=await response.json();return response.ok&&info.rootPath===dataDir;}catch{return false;}},'local server unavailable: '+serverLog);}
async function stop(){if(!server||server.exitCode!==null)return;server.kill();await new Promise(resolve=>server.once('exit',resolve));}
const nodes=id=>(id==='222'?[{nodeId:'1',fieldName:'prompt',fieldType:'STRING',fieldValue:'另一应用的文字',nodeName:'文字输入'},{nodeId:'2',fieldName:'switch',fieldType:'BOOLEAN',fieldValue:'true',fieldData:JSON.stringify({true:'true',false:'false'}),nodeName:'开关'},{nodeId:'3',fieldName:'image',fieldType:'IMAGE',fieldValue:'None',nodeName:'另一应用参考图'}]:[
  {nodeId:'1',fieldName:'prompt',fieldType:'STRING',fieldValue:'基础提示词',nodeName:'提示词'},
  {nodeId:'2',fieldName:'caption',fieldType:'STRING',fieldValue:'第二段文字',nodeName:'场景补充'},
  ...['image','image','image','image','image','image','audio','audio','audio','video'].map((type,i)=>({nodeId:String(i+3),fieldName:type+(i+1),fieldType:type.toUpperCase(),fieldValue:'None',nodeName:type+' '+(i+1)})),
  ...['时长','步数','种子','分辨率'].map((name,i)=>({nodeId:String(i+20),fieldName:'value'+i,fieldType:i===3?'FLOAT':'INT',fieldValue:String(i===0?10:i===3?1.5:12),nodeName:name})),
]).map(node=>({...node,description:node.nodeName}));
async function browser(profile){
  const ctx=await chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1920,height:1080},executablePath:process.env.RH_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='result.test')return route.fulfill({body:url.pathname.endsWith('.png')?png:url.pathname.endsWith('.wav')?wav:video,contentType:url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.wav')?'audio/wav':'video/mp4'});if(!url.hostname.includes('runninghub.'))return route.continue();let key=route.request().headers().authorization?.replace('Bearer ','')||'';if(!key){try{key=JSON.parse(route.request().postData()||'{}').apiKey||'';}catch{}}if(key==='broken-key')return route.fulfill({status:401,json:{code:401,msg:'Invalid API key'}});let result={code:0,data:{}};
    if(url.pathname.endsWith('/apiCallDemo'))result.data={webappName:url.searchParams.get('webappId')==='222'?'混合参数应用':'H3 测试应用',nodeInfoList:nodes(url.searchParams.get('webappId'))};
    else if(url.pathname.endsWith('/queue/status'))result.data={concurrentLimit:1,runningCount:0,queuedCount:mixedQueuedTasks&&submitted.some((task,i)=>i>=6&&task.key===key&&(i+1)%2===0)?'3':'0'};
    else if(url.pathname.endsWith('/accountStatus'))result.data={remainCoins:'999',currentTaskCounts:'0',remainMoney:null,apiType:'消费级'};
    else if(url.pathname.endsWith('/media/upload/binary')){if(blockUploads)await new Promise(resolve=>uploadGates.push(resolve));result.data={fileName:'upload-'+key+'-'+Date.now()};}
    else if(url.pathname.endsWith('/ai-app/run')){const body=JSON.parse(route.request().postData());submitted.push({key,body});result.data={taskId:'mock-'+submitted.length,taskStatus:'RUNNING'};}
    else if(url.pathname.endsWith('/cancel')){const {taskId}=JSON.parse(route.request().postData());cancelCalls.push({taskId,key});cancelledTasks.add(taskId);result={code:0,msg:'success',data:null};}
    else if(url.pathname.endsWith('/v2/query')){const {taskId}=JSON.parse(route.request().postData());const count=queries.get(taskId)||0;queries.set(taskId,count+1);result=cancelledTasks.has(taskId)?{taskId,status:'',errorCode:'1004',errorMessage:'Task not found, please check the task ID',results:null}:(count===0||(holdNewTasks&&Number(taskId.split('-')[1])>4))?{taskId,status:mixedQueuedTasks&&Number(taskId.split('-')[1])%2===0?'QUEUED':'RUNNING',results:[]}:{taskId,status:'SUCCESS',results:[{url:'https://result.test/'+taskId+'.mp4',type:'video'}]};}
    else if(url.pathname.endsWith('/outputs')){const {taskId}=JSON.parse(route.request().postData());if(cancelledTasks.has(taskId))result={code:807,msg:'APIKEY_TASK_NOT_FOUND',data:null};else result.data=[{fileUrl:'https://result.test/'+taskId+'.mp4',fileType:'mp4',consumeCoins:'12.5',thirdPartyConsumeMoney:'0',taskCostTime:'272'}];}
    else if(url.pathname.endsWith('/list'))result.data={records:[],total:0};
    return route.fulfill({json:result});
  });return ctx;
}
const api=async(path,options={})=>{const {token}=await(await fetch(base+'/__rh/session')).json();const response=await fetch(base+'/__rh'+path,{...options,headers:{'X-RH-Token':token,'Content-Type':'application/json',...options.headers}});if(!response.ok)throw new Error(await response.text());return response.json();};
const snapshots=()=>api('/snapshots?prefix=attempt:');
const workspace=async()=>(await api('/snapshot/current')).value;
const openSettings=async()=>{await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'账号管理',exact:true}).click();};
const closeSettings=async()=>{await page.getByRole('button',{name:'保存账号设置',exact:true}).click();await page.getByRole('button',{name:'多任务模式',exact:true}).click();};
const saved=()=>page.getByText(/工作区已自动保存/).waitFor();
try{
  await start();context=await browser(join(root,'profile'));page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/seed');
  await page.evaluate(async()=>{
    localStorage.setItem('rh_language','en');localStorage.setItem('rh_terms_agreed','true');localStorage.setItem('rh_startup_view','multitask');localStorage.setItem('rh_save_api_enabled','true');
    localStorage.setItem('rh_api_keys_v2',JSON.stringify([{id:'a',apiKey:'account-a',note:'a@example.test',enabled:true,concurrency:1},{id:'b',apiKey:'account-b',note:'b@example.test',enabled:true,concurrency:1}]));
    localStorage.setItem('rh_favorites',JSON.stringify([{webappId:'111',name:'我的 H3'},{webappId:'222',name:'另一工具'}]));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('rh-workspaces',1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({file:new File([new Uint8Array([7,8,9])],'legacy.png',{type:'image/png'})},'migration-proof');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  });
  await page.goto(base);await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();
  const migrated=(await api('/snapshot/migration-proof')).value;assert.match(migrated.file.$rhFile,/^[a-f0-9]{64}$/);assert.equal(migrated.file.name,'legacy.png');
  assert.equal(await page.evaluate(()=>localStorage.getItem('rh_api_keys_v2')),null,'migrated credentials must leave browser storage');
  await openSettings();const manager=page.getByRole('region',{name:'账号管理',exact:true});
  await manager.getByRole('button',{name:'新增账号',exact:true}).click();await page.getByLabel('新增或编辑账号备注').fill('新增测试账号');await page.getByLabel('新增或编辑 API Key').fill('new-account-key');await page.getByRole('button',{name:'添加并验证',exact:true}).click();await poll(async()=>await manager.getByText('新增测试账号',{exact:true}).count()===1,'new account missing');
  await manager.getByRole('button',{name:'批量导入',exact:true}).click();await page.getByLabel('批量导入账号文本').fill('account-a\na@example.test\n\nimport-good\n导入正常账号\n\nbroken-key\n导入异常账号\n\norphan');
  assert.ok(await manager.getByText(/2 条可导入 · 1 条重复 · 1 条需修正/).count());await page.getByRole('button',{name:'导入 2 个有效新账号',exact:true}).click();await poll(async()=>!await page.getByRole('button',{name:'刷新余额',exact:true}).isDisabled(),'import validation stalled');
  assert.equal(await manager.getByRole('row').filter({hasText:'导入异常账号'}).getByRole('checkbox').isChecked(),false);
  await manager.getByRole('button',{name:'批量导入',exact:true}).click();await page.getByLabel('批量导入账号文本').fill(Array.from({length:30},(_,i)=>'bulk-key-'+i+'\n批量账号 '+String(i+1).padStart(2,'0')).join('\n\n'));await page.getByRole('button',{name:'导入 30 个有效新账号',exact:true}).click();await poll(async()=>!await page.getByRole('button',{name:'刷新余额',exact:true}).isDisabled(),'bulk accounts stalled');
  await page.getByLabel('搜索账号').fill('批量账号');assert.equal(await manager.locator('tbody tr').count(),30);await page.getByLabel('搜索账号').fill('');
  await page.getByLabel('筛选账号').selectOption('error');assert.equal(await manager.locator('tbody tr').count(),1);await page.getByLabel('筛选账号').selectOption('all');
  await manager.getByRole('button',{name:'编辑账号 a@example.test',exact:true}).click();await page.getByLabel('新增或编辑账号备注').fill('a@example.test');await page.getByRole('button',{name:'保存修改',exact:true}).click();
  const configured=JSON.parse((await api('/settings')).rh_api_keys_v2);assert.equal(configured.find(a=>a.apiKey==='account-a').id,'a');assert.equal(configured.length,35);
  for(const checkbox of (await manager.getByRole('checkbox').all()).slice(2))if(await checkbox.isChecked())await checkbox.uncheck();
  await fs.mkdir('.browser-test-output',{recursive:true});await page.screenshot({path:'.browser-test-output/批量账号管理.png',fullPage:true});
  await manager.getByRole('button',{name:'导出账号',exact:true}).click();const exported=await page.getByLabel('账号导出文本').inputValue();assert.ok(exported.includes('account-a\na@example.test'));await page.getByLabel('账号导出格式').selectOption('json');assert.equal(JSON.parse(await page.getByLabel('账号导出文本').inputValue()).accounts.length,35);
  await manager.getByRole('button',{name:'批量导入',exact:true}).click();await page.getByLabel('批量导入账号文本').fill(exported);assert.ok(await manager.getByText(/0 条可导入 · 35 条重复/).count());
  await closeSettings();
  await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'首页取消收藏 我的 H3',exact:true}).click();await page.getByRole('button',{name:'撤销取消收藏',exact:true}).click();await page.getByRole('button',{name:'改名',exact:true}).first().click();await page.getByLabel('收藏名称',{exact:true}).fill('H3 临时改名');await page.getByRole('button',{name:'保存收藏',exact:true}).click();await page.getByRole('button',{name:'多任务模式',exact:true}).click();await page.getByRole('button',{name:'H3 临时改名',exact:true}).waitFor();
  await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'改名',exact:true}).first().click();await page.getByLabel('收藏名称',{exact:true}).fill('我的 H3');await page.getByRole('button',{name:'保存收藏',exact:true}).click();await page.getByRole('button',{name:'多任务模式',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:/改名收藏/}).count(),0);
  await page.getByRole('button',{name:'我的 H3',exact:true}).click();await page.getByLabel('提示词',{exact:true}).filter({visible:true}).waitFor();
  await page.getByRole('button',{name:'取消收藏 我的 H3',exact:true}).click();assert.equal(await page.getByRole('button',{name:'我的 H3',exact:true}).count(),0);await page.getByRole('button',{name:'撤销取消收藏',exact:true}).click();

  assert.equal(await page.getByRole('button',{name:'个人中心',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Switch to English',exact:true}).count(),0);
  assert.equal(await page.locator('.result-preview').count(),0,'preview must not occupy editing space before requested');
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
  const imageField=page.getByRole('group',{name:'image 1素材框',exact:true}).filter({visible:true});
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#28a984';ctx.fillRect(0,0,64,48);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
  await imageField.focus();assert.equal(await imageField.evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(213, 163, 0)');
  await page.keyboard.press('Control+V');
  await imageField.getByRole('img',{name:'image 1预览',exact:true}).waitFor();await poll(async()=>await imageField.getByRole('img').evaluate(img=>img.complete&&img.naturalWidth>0),'clipboard image did not decode');
  await poll(async()=>Object.keys((await workspace()).cards[0].initialPendingFiles).length===1,'native clipboard image not saved');

  const firstPastedAsset=Object.values((await workspace()).cards[0].initialPendingFiles)[0].$rhFile;
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=96;canvas.height=72;const ctx=canvas.getContext('2d');ctx.fillStyle='#2682ed';ctx.fillRect(0,0,96,72);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);});
  await imageField.focus();await page.keyboard.press('Control+V');await poll(async()=>await imageField.getByRole('img').evaluate(img=>img.complete&&img.naturalWidth===96),'replacement clipboard preview missing');await poll(async()=>Object.values((await workspace()).cards[0].initialPendingFiles)[0]?.$rhFile!==firstPastedAsset,'replacement original not saved');
  const imageField2=page.getByRole('group',{name:'image 2素材框',exact:true}).filter({visible:true});const chooseFile=page.waitForEvent('filechooser');await imageField2.getByRole('button',{name:'选择文件',exact:true}).click();await (await chooseFile).setFiles({name:'second.png',mimeType:'image/png',buffer:png});await imageField2.getByRole('img').waitFor();await imageField2.getByRole('button',{name:'清除',exact:true}).click();await poll(async()=>Object.keys((await workspace()).cards[0].initialPendingFiles).length===1,'cleared extra image not persisted');
  const initialClipboard=(await workspace()).cards[0].initialPendingFiles;
  const pasteInto=async(field,files,text)=>{await field.focus();await field.evaluate((element,payload)=>{const transfer=new DataTransfer();for(const data of payload.files||[]){const bytes=Uint8Array.from(atob(data.base64),c=>c.charCodeAt(0));transfer.items.add(new File([bytes],data.name,{type:data.type}));}if(payload.text)transfer.setData('text/plain',payload.text);element.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer}));},{files,text});};
  await pasteInto(imageField,[],'https://result.test/only-a-link.png');await imageField.getByRole('alert').waitFor();await saved();assert.deepEqual((await workspace()).cards[0].initialPendingFiles,initialClipboard,'URL paste must preserve existing original');
  await pasteInto(imageField,[{name:'bad.wav',type:'audio/wav',base64:wav.toString('base64')}]);await imageField.getByText(/类型与当前素材框不匹配/).waitFor();
  const audioField=page.getByRole('group',{name:'audio 7素材框',exact:true}).filter({visible:true}),videoField=page.getByRole('group',{name:'video 10素材框',exact:true}).filter({visible:true});
  await pasteInto(audioField,[{name:'reference.wav',type:'audio/wav',base64:wav.toString('base64')}]);await audioField.locator('audio').evaluate(audio=>audio.play());await poll(async()=>await audioField.locator('audio').evaluate(audio=>audio.currentTime>0),'pasted audio did not play');
  await pasteInto(videoField,[{name:'reference.mp4',type:'video/mp4',base64:video.toString('base64')}]);await videoField.locator('video').evaluate(video=>video.play());await poll(async()=>await videoField.locator('video').evaluate(video=>video.currentTime>0),'pasted video did not play');
  await audioField.getByRole('button',{name:'清除',exact:true}).click();await videoField.getByRole('button',{name:'清除',exact:true}).click();
  await page.evaluate(()=>navigator.clipboard.writeText('提示词框正常粘贴文字'));await page.getByLabel('提示词',{exact:true}).filter({visible:true}).focus();await page.keyboard.press('Control+V');assert.ok((await page.getByLabel('提示词',{exact:true}).filter({visible:true}).inputValue()).includes('提示词框正常粘贴文字'));
  await page.getByLabel('任务名称',{exact:true}).fill('基础任务');
  const prompts=page.locator('.editor-text textarea');await prompts.nth(0).fill('本地持久提示词');await page.getByRole('button',{name:'场景补充 已填',exact:true}).click();await page.getByLabel('场景补充',{exact:true}).filter({visible:true}).fill('另一个长文本字段');
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({name:'reference.png',mimeType:'image/png',buffer:png});
  await poll(async()=>await page.locator('input[type=file]:disabled').count()===0,'upload stalled');
  await saved();
  const current=await workspace();assert.equal(current.cards[0].name,'基础任务');assert.equal(Object.keys(current.cards[0].initialPendingFiles).length,1);
  await page.getByRole('button',{name:'新建任务',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('第二应用');await page.getByPlaceholder('请输入 WebApp ID，或粘贴应用详情页链接').filter({visible:true}).fill('222');await page.getByRole('button',{name:'加载',exact:true}).filter({visible:true}).click();await page.getByLabel('文字输入',{exact:true}).filter({visible:true}).waitFor();
  assert.equal(await page.locator('.editor-media').filter({visible:true}).count(),1);assert.equal(await page.locator('.editor-text textarea').filter({visible:true}).count(),1);
  await page.getByRole('button',{name:/1\. 基础任务/}).click();await page.getByRole('button',{name:'复制卡片',exact:true}).filter({visible:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('基础任务对照');
  await page.getByRole('button',{name:'批量对照',exact:true}).click();await page.getByLabel('批量任务名称 3',{exact:true}).fill('对照重命名');await page.getByRole('button',{name:'对照文字参数 3 提示词',exact:true}).click();await page.getByLabel('提示词全文',{exact:true}).fill('只修改对照提示词');await page.getByRole('button',{name:'关闭文字预览',exact:true}).click();
  await saved();await poll(async()=>{const data=await workspace();return data.cards[2].name==='对照重命名'&&data.cards[2].nodes.some(n=>n.fieldValue==='只修改对照提示词');},'batch edits not persisted');
  const comparison=await workspace();assert.equal(comparison.cards[0].nodes.find(n=>n.fieldName==='prompt').fieldValue,'本地持久提示词');assert.deepEqual(comparison.cards[0].initialPendingFiles,comparison.cards[2].initialPendingFiles);

  assert.equal(await page.locator('.comparison-group').count(),2,'different applications must be grouped');
  assert.equal(await page.locator('.task-editing-area .production-task').filter({visible:true}).count(),0,'comparison must not duplicate the full editor');
  assert.deepEqual(await page.locator('.comparison-workspace .task-ordinal').allTextContents(),['1.','3.','2.']);await page.getByRole('button',{name:'删除对照任务 3',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('button',{name:'撤销删除任务',exact:true}).click();await poll(async()=>{const current=await workspace();return current.cards.length===3&&current.cards[2].name==='对照重命名';},'batch delete undo did not preserve input');assert.deepEqual((await workspace()).cards[2].initialPendingFiles,comparison.cards[2].initialPendingFiles);
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();assert.equal(await page.locator('article .task-ordinal').filter({visible:true}).count(),3);await page.getByRole('button',{name:'删除总览任务 2',exact:true}).click();assert.equal((await workspace()).cards.length,3,'first delete click must not delete');await page.getByRole('button',{name:'保留',exact:true}).click();assert.equal((await workspace()).cards.length,3);await page.getByRole('button',{name:'删除总览任务 2',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await page.getByRole('button',{name:'撤销删除任务',exact:true}).click();assert.equal(await page.getByRole('button',{name:'编辑',exact:true}).filter({visible:true}).count(),3);assert.equal(await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).count(),0);await page.getByRole('button',{name:'列表编辑',exact:true}).click();
  await page.getByRole('button',{name:'删除导航任务 2',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await saved();assert.equal((await workspace()).cards.length,2);await page.getByRole('button',{name:'撤销删除任务',exact:true}).click();await poll(async()=>{const current=await workspace();return current.cards.length===3&&current.cards[1].name==='第二应用';},'undo did not persist original task order');
  const splitter=page.getByRole('separator',{name:'调整左侧栏宽度',exact:true});const bounds=await splitter.boundingBox();await page.mouse.move(bounds.x+bounds.width/2,bounds.y+30);await page.mouse.down();await page.mouse.move(bounds.x+60,bounds.y+30);await page.mouse.up();await poll(async()=>JSON.parse((await api('/settings')).rh_workbench_layout_v2).left>250,'sidebar resize did not save');
  const rightSplitter=page.getByRole('separator',{name:'调整右侧栏宽度',exact:true}),rightBounds=await rightSplitter.boundingBox();await page.mouse.move(rightBounds.x+3,rightBounds.y+40);await page.mouse.down();await page.mouse.move(rightBounds.x-35,rightBounds.y+40);await page.mouse.up();await poll(async()=>JSON.parse((await api('/settings')).rh_workbench_layout_v2).right>350,'right resize not persisted');
  await page.getByRole('button',{name:/我的收藏 ▾/}).click();assert.equal(await page.getByRole('button',{name:'我的 H3',exact:true}).count(),0);await page.getByRole('button',{name:/我的收藏 ▸/}).click();
  await page.getByRole('button',{name:'专注编辑',exact:true}).click();assert.equal(await page.locator('.resizable-workbench').getAttribute('data-left-open'),'false');assert.equal(await page.locator('.resizable-workbench').getAttribute('data-right-open'),'false');await page.getByRole('button',{name:'退出专注',exact:true}).click();await page.reload();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.ok(JSON.parse((await api('/settings')).rh_workbench_layout_v2).left>250);
  await page.setViewportSize({width:1366,height:768});for(const button of ['新建任务','保存草稿','全部运行'])assert.equal(await page.getByRole('button',{name:button,exact:true}).isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1920,height:1080});
  await fs.mkdir('.browser-test-output',{recursive:true});await page.screenshot({path:'.browser-test-output/新版生产工作台.png',fullPage:true});
  for(const button of ['新建任务','保存草稿','全部运行'])assert.equal(await page.getByRole('button',{name:button,exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'全部运行',exact:true}).click();await page.getByRole('button',{name:'收起记录与日志',exact:true}).click();assert.equal(await page.getByRole('button',{name:'删除导航任务 1',exact:true}).isDisabled(),true);await poll(async()=>{const list=await snapshots();return list.length===3&&list.every(a=>a.status==='saved');},'mock generation/archive failed',30000);
  await page.getByRole('button',{name:'展开记录与日志',exact:true}).click();
  assert.equal(submitted.length,3);const records=await snapshots();assert.equal(new Set(records.map(a=>a.sequence)).size,3);assert.ok(records.every(a=>a.usage.coinsReported&&a.usage.coins===12.5));assert.ok(records.every(a=>a.files[0].filename.startsWith(String(a.sequence).padStart(4,'0')+'_')));assert.equal(new Set(submitted.map(item=>item.key)).size,2);
  const files=await fs.readdir(join(dataDir,'results'));assert.equal(files.length,3);for(const file of files)assert.deepEqual(await fs.readFile(join(dataDir,'results',file)),video);
  assert.ok(await page.getByText('12.5 RH',{exact:true}).count()>=3);assert.ok(await page.getByText('用时：4分32秒',{exact:true}).count()>=3);assert.ok(records.every(a=>a.timings.acceptedAt&&a.timings.generationObservedAt&&a.timings.archivedAt));
  const tone=await page.locator('[data-record-account]').first().evaluate(el=>getComputedStyle(el).color);assert.ok(['rgb(250, 204, 74)','rgb(154, 103, 0)'].includes(tone));
  await page.getByRole('button',{name:'运行日志',exact:true}).click();assert.ok(await page.locator('[data-log-account]').filter({visible:true}).count());assert.equal(await page.locator('[data-log-account]').first().evaluate(el=>getComputedStyle(el).color),tone);assert.ok(await page.locator('[data-log-balance]').filter({visible:true}).count());await page.getByRole('button',{name:'生成记录',exact:true}).last().click();

  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'立即完整备份',exact:true}).click();await page.getByText(/完整备份已建立/).waitFor();await page.getByRole('button',{name:'多任务模式',exact:true}).click();
  await page.getByRole('button',{name:'取消收藏 我的 H3',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('恢复前临时更改');await saved();
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'恢复此备份',exact:true}).first().click();await page.getByRole('button',{name:'确认恢复并重新载入',exact:true}).click();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();
  assert.equal((await workspace()).cards[2].name,'对照重命名');assert.equal(submitted.length,3,'restore must not submit new generations');
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:base,storageTypes:'all'});await page.reload();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.equal((await snapshots()).length,3);await openSettings();await page.getByText('a@example.test',{exact:true}).first().waitFor();await closeSettings();
  await context.close();context=null;await stop();await start();context=await browser(join(root,'fresh-profile'));page=context.pages()[0];await page.goto(base);await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.equal((await workspace()).cards[0].nodes.find(n=>n.fieldName==='prompt').fieldValue,'本地持久提示词');assert.equal((await snapshots()).length,3);assert.equal(submitted.length,3);
  await page.getByRole('button',{name:/#0003/}).click();const v=page.locator('.result-preview video').first();await v.evaluate(video=>video.play());await poll(async()=>await v.evaluate(video=>video.currentTime>0),'saved local media did not play');assert.match(await v.getAttribute('src'),/^\/__rh\/result\//);
  await page.screenshot({path:'.browser-test-output/清理浏览器后恢复记录.png',fullPage:true});
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'手动重置：开启新编号批次',exact:true}).click();await page.getByRole('button',{name:'确认开启新批次',exact:true}).click();await poll(async()=>(await api('/numbering')).sequenceBatch===2,'numbering reset failed');await page.getByRole('button',{name:'多任务模式',exact:true}).click();
  await page.getByLabel('选择任务 1',{exact:true}).check();await page.getByRole('button',{name:'运行所选 (1)',exact:true}).click();await poll(async()=>{const records=await snapshots();return records.length===4&&records.every(a=>a.status==='saved');},'new batch generation did not archive',30000);const batchRecord=(await snapshots()).find(a=>a.sequenceBatch===2);assert.equal(batchRecord.displaySequence,1);assert.equal(batchRecord.sequence,4);assert.ok(batchRecord.files[0].filename.startsWith('0001_B02_'));assert.equal((await api('/numbering')).next,2);
  await page.reload();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.equal((await api('/numbering')).next,2);assert.equal(submitted.length,4);
  assert.equal((await page.getByLabel('当前任务顺序',{exact:true}).filter({visible:true}).innerText()).trim(),'1.');await page.getByRole('button',{name:'删除卡片',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await poll(async()=>(await workspace()).cards.length===2,'list delete not saved');assert.equal((await snapshots()).length,4);assert.equal((await fs.readdir(join(dataDir,'results'))).length,4);await page.getByRole('button',{name:'撤销删除任务',exact:true}).click();await poll(async()=>{const current=await workspace();return current.cards.length===3&&current.cards[0].name==='基础任务';},'list undo not saved');assert.deepEqual((await workspace()).cards[0].initialPendingFiles,comparison.cards[0].initialPendingFiles);
  await page.screenshot({path:'.browser-test-output/可调布局与用时记录.png',fullPage:true});
  await api('/snapshot/attempt:'+batchRecord.id,{method:'PATCH',body:JSON.stringify({fields:{status:'unknown'}})});await openSettings();await page.getByRole('button',{name:'编辑账号 '+batchRecord.accountNote,exact:true}).click();await page.getByLabel('新增或编辑 API Key').fill('replacement-key');await page.getByRole('button',{name:'保存修改',exact:true}).click();await page.getByText(/暂不能替换密钥/).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('button',{name:'删除账号 '+batchRecord.accountNote,exact:true}).click();await page.getByText(/处理完成后再删除/).waitFor();await closeSettings();await api('/snapshot/attempt:'+batchRecord.id,{method:'PATCH',body:JSON.stringify({fields:{status:'saved'}})});

  const missingPath=batchRecord.files[0].path;assert.ok(missingPath.startsWith(dataDir));await fs.unlink(missingPath);await page.getByRole('button',{name:'刷新记录',exact:true}).click();const missingArticle=page.locator('article').filter({hasText:'B02'});await missingArticle.getByText('文件缺失',{exact:true}).waitFor();assert.equal(await missingArticle.getByRole('button',{name:'定位文件',exact:true}).count(),0);await missingArticle.getByRole('button',{name:'保存结果 / 重试下载',exact:true}).click();await poll(async()=>(await snapshots()).find(a=>a.id===batchRecord.id)?.localResultsMissing===false,'missing result repair failed');assert.equal(submitted.length,4);
  await api('/snapshot/attempt:'+batchRecord.id,{method:'PATCH',body:JSON.stringify({fields:{status:'generation_failed'}})});await page.getByRole('button',{name:'刷新记录',exact:true}).click();const failedStatus=page.locator('article').filter({hasText:'B02'}).getByText('生成失败',{exact:true});await failedStatus.waitFor();assert.equal(await failedStatus.evaluate(el=>getComputedStyle(el).color),'rgb(239, 68, 68)');await api('/snapshot/attempt:'+batchRecord.id,{method:'PATCH',body:JSON.stringify({fields:{status:'saved'}})});

  // Task identity must link every surface, even for duplicated apps/names and multiple runs.
  await page.getByRole('button',{name:'刷新记录',exact:true}).click();
  const taskData=await workspace(),firstId=taskData.cards[0].id,secondId=taskData.cards[1].id;
  const firstAttempt=(await snapshots()).find(a=>a.cardId===firstId&&a.sequenceBatch===1);
  const recordFor=id=>page.locator('.production-record[data-attempt-id="'+id+'"]');
  const focused=async id=>{
    await poll(async()=>await page.locator('.result-preview').getAttribute('data-task-id')===id,'preview task identity mismatch');
    const states=await page.locator('[data-task-id][data-task-focused]').evaluateAll(elements=>elements.map(el=>({id:el.dataset.taskId,focused:el.dataset.taskFocused})));
    assert.ok(states.some(state=>state.id===id&&state.focused==='true'));
    assert.ok(states.every(state=>state.focused!=='true'||state.id===id),'unrelated task highlighted');
    assert.equal(await page.locator('.task-nav-row[data-task-id="'+id+'"]').getAttribute('data-task-focused'),'true');
    for(const record of await page.locator('.production-record[data-task-id="'+id+'"]').all())assert.equal(await record.getAttribute('data-task-focused'),'true');
  };
  await recordFor(firstAttempt.id).locator('.record-summary').click();await focused(firstId);
  assert.equal(await page.locator('.result-preview').getAttribute('data-attempt-id'),firstAttempt.id);
  assert.equal(await recordFor(firstAttempt.id).getAttribute('data-attempt-selected'),'true');
  assert.equal(await recordFor(batchRecord.id).getAttribute('data-task-focused'),'true');
  await recordFor(batchRecord.id).locator('.record-summary').click();await focused(firstId);
  assert.equal(await page.locator('.result-preview').getAttribute('data-attempt-id'),batchRecord.id);
  await page.locator('.task-nav-row[data-task-id="'+secondId+'"]>button').first().click();await focused(secondId);
  await page.getByRole('button',{name:'批量对照',exact:true}).click();
  await page.getByLabel('批量任务名称 1',{exact:true}).focus();await focused(firstId);
  assert.equal(await page.locator('tr[data-task-id="'+firstId+'"]').getAttribute('data-task-focused'),'true');
  await page.getByRole('button',{name:'对照文字参数 2 文字输入',exact:true}).focus();await focused(secondId);
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();
  await page.getByLabel('总览任务名称 '+firstId,{exact:true}).click();await focused(firstId);
  const border=await page.locator('.task-surface[data-task-id="'+firstId+'"]>article').evaluate(el=>getComputedStyle(el).borderTopColor);assert.equal(border,'rgb(213, 163, 0)');
  await page.getByRole('button',{name:'列表编辑',exact:true}).click();await page.locator('.editor-text textarea').filter({visible:true}).first().focus();await focused(firstId);

  // Every output can preview locally; this does not submit a platform generation.
  const outputs=[...batchRecord.outputs,{fileUrl:'https://result.test/image.png',fileType:'png'},{fileUrl:'https://result.test/audio.wav',fileType:'wav'}];
  await api('/snapshot/attempt:'+batchRecord.id,{method:'PATCH',body:JSON.stringify({fields:{outputs,status:'completed'}})});
  await page.getByRole('button',{name:'刷新记录',exact:true}).click();
  await recordFor(batchRecord.id).getByRole('button',{name:'保存结果 / 重试下载',exact:true}).click();
  await poll(async()=>(await snapshots()).find(a=>a.id===batchRecord.id)?.files.length===3,'multiple outputs not archived');
  await recordFor(batchRecord.id).locator('.record-summary').click();
  await page.getByRole('button',{name:'预览结果 2',exact:true}).click();
  await poll(async()=>await page.locator('.preview-player>img').evaluate(img=>img.complete&&img.naturalWidth>0),'local image did not decode');
  assert.match(await page.locator('.preview-player>img').getAttribute('src'),/^\/__rh\/result\//);
  await page.getByRole('button',{name:'预览结果 3',exact:true}).click();
  const audio=page.locator('.preview-player>audio');await audio.evaluate(audio=>audio.play());await poll(async()=>await audio.evaluate(audio=>audio.currentTime>0),'local audio did not play');
  await page.getByRole('button',{name:'预览结果 1',exact:true}).click();
  const newVideo=page.locator('.preview-player>video');await newVideo.evaluate(video=>video.play());await poll(async()=>await newVideo.evaluate(video=>video.currentTime>0),'video selection did not play');
  const resize=page.getByRole('separator',{name:'调整预览高度',exact:true});await resize.focus();await resize.press('ArrowUp');await poll(async()=>Number((await api('/settings')).rh_result_preview_height_v2)===500,'preview height not persisted');

  const previewHeader=page.locator('.result-preview .preview-header'),headerBox=await previewHeader.boundingBox(),windowBefore=await page.locator('.result-preview').boundingBox();
  await page.mouse.move(headerBox.x+12,headerBox.y+12);await page.mouse.down();await page.mouse.move(headerBox.x+112,headerBox.y-28);await page.mouse.up();assert.ok((await page.locator('.result-preview').boundingBox()).x>windowBefore.x,'preview did not move');
  await page.getByRole('button',{name:'放大结果预览',exact:true}).click();await poll(async()=>await page.evaluate(()=>document.fullscreenElement?.classList.contains('result-preview')),'preview fullscreen unavailable');await page.evaluate(()=>document.exitFullscreen());
  const locate=[];await page.route('**/__rh/reveal',async route=>{locate.push(JSON.parse(route.request().postData()).path);return route.fulfill({json:{ok:true}});});
  await page.getByRole('button',{name:'定位预览文件',exact:true}).click();await poll(async()=>locate.length===1,'preview locate request missing');
  await recordFor(batchRecord.id).getByRole('button',{name:'定位文件',exact:true}).click();await poll(async()=>locate.length===2,'record locate request missing');assert.equal(locate[0],(await snapshots()).find(a=>a.id===batchRecord.id).files[0].path);assert.equal(locate[1],locate[0]);
  const summary=recordFor(batchRecord.id).locator('.record-summary');assert.ok((await summary.boundingBox()).height<100,'record summary too tall');
  await page.screenshot({path:'.browser-test-output/任务联动与结果预览.png',fullPage:true});
  await page.setViewportSize({width:1366,height:768});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok((await page.locator('.editor-production-body').filter({visible:true}).boundingBox()).height>100,'preview must leave room for parameter editing');await poll(async()=>{const box=await page.locator('.result-preview').boundingBox();return box.x>=0&&box.y>=0&&box.x+box.width<=1367&&box.y+box.height<=769;},'moved preview escaped smaller viewport');await page.screenshot({path:'.browser-test-output/紧凑记录与预览-1366.png',fullPage:true});await page.setViewportSize({width:1920,height:1080});

  // Removing configuration leaves record preview available and never selects an unrelated task.
  await page.getByRole('button',{name:'删除导航任务 1',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await poll(async()=>(await workspace()).cards.length===2,'history source delete not persisted');
  await recordFor(batchRecord.id).locator('.record-summary').click();
  await page.getByText('历史任务已移出当前列表',{exact:true}).waitFor();
  assert.equal(await page.locator('.task-nav-row[data-task-focused=true]').count(),0);
  assert.equal(await page.locator('.result-preview').getAttribute('data-attempt-id'),batchRecord.id);
  await page.getByRole('button',{name:'关闭结果预览',exact:true}).click();
  await page.getByRole('button',{name:'恢复配置为新任务',exact:true}).click();await poll(async()=>(await workspace()).cards.length===3,'history restore not persisted');
  const restored=(await workspace()).cards.at(-1);assert.notEqual(restored.id,firstId);assert.equal(restored.sourceAttemptId,batchRecord.id);assert.equal(submitted.length,4,'preview and restore must not generate');

  // Custom columns, baseline differences, bulk apply/undo and full prompt editing.
  await page.getByRole('button',{name:'批量对照',exact:true}).click();
  const currentTasks=await workspace(),restoredTask=currentTasks.cards.at(-1);
  const group=page.locator('.comparison-group').filter({has:page.getByRole('button',{name:'对照文字参数 3 提示词',exact:true})});
  await group.getByRole('button',{name:'选择参数列',exact:true}).click();await group.getByRole('checkbox',{name:'种子',exact:true}).uncheck();await group.getByRole('button',{name:'选择参数列',exact:true}).click();
  assert.equal(await group.getByText('基准',{exact:true}).count(),0);
  assert.equal(await group.locator('.media-field').count(),20,'all ten media fields must be available on both tasks');
  const horizontal=page.getByRole('slider',{name:'横向滚动参数',exact:true});assert.ok(await horizontal.isVisible());await horizontal.focus();await page.keyboard.press('End');await poll(async()=>await group.locator('.comparison-scroll').evaluate(el=>el.scrollLeft>500),'top scrollbar did not move table');await horizontal.focus();await page.keyboard.press('Home');
  assert.equal(await group.locator('th').filter({hasText:'种子'}).count(),0);

  await page.getByRole('checkbox',{name:'选择对照任务 3',exact:true}).check();
  const beforeBulk=(await workspace()).cards[2].nodes.find(n=>n.fieldName==='prompt').fieldValue;
  const sourceRow=page.locator('tr[data-task-id="'+currentTasks.cards[1].id+'"]');
  await sourceRow.locator('td').filter({has:page.getByRole('button',{name:'对照文字参数 2 提示词',exact:true})}).getByRole('button',{name:'应用到所选',exact:true}).click();
  await poll(async()=>{const data=await workspace();return data.cards[2].nodes.find(n=>n.fieldName==='prompt').fieldValue===data.cards[1].nodes.find(n=>n.fieldName==='prompt').fieldValue;},'bulk column apply failed');
  await page.getByRole('button',{name:'撤销上次批量操作',exact:true}).click();await poll(async()=>(await workspace()).cards[2].nodes.find(n=>n.fieldName==='prompt').fieldValue===beforeBulk,'comparison undo failed');
  await page.screenshot({path:'.browser-test-output/真正参数对照表.png',fullPage:true});
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();const restoredOverview=page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview');
  assert.equal(await restoredOverview.getByText('当前基准任务',{exact:true}).count(),0);
  const plus=restoredOverview.getByRole('button',{name:'PLUS 任务 3',exact:true});await plus.click();await poll(async()=>await plus.getAttribute('aria-pressed')==='true','PLUS toggle did not activate');assert.match(await plus.evaluate(el=>getComputedStyle(el).backgroundImage),/linear-gradient/);await plus.click();await poll(async()=>await plus.getAttribute('aria-pressed')==='false','PLUS toggle did not deactivate');
  await restoredOverview.getByLabel('总览参数 3 时长',{exact:true}).fill('11');
  await poll(async()=>(await workspace()).cards.find(c=>c.id===restoredTask.id).nodes.find(n=>n.fieldName==='value0').fieldValue==='11','overview parameter did not save');
  await restoredOverview.getByLabel('总览参数 3 时长',{exact:true}).fill('10');
  assert.equal(await restoredOverview.locator('.overview-media .media-field').count(),10,'all media must stay inside the card');
  assert.equal(await restoredOverview.getByRole('button',{name:/全部素材/}).count(),0);
  const cardBoxes=await page.locator('.task-overview').evaluateAll(cards=>cards.map(card=>{const box=card.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width,height:box.height};}));
  assert.equal(cardBoxes.length,3);assert.ok(cardBoxes.every(box=>Math.abs(box.y-cardBoxes[0].y)<1),'wide viewport must have three cards on one row');
  const fields=await restoredOverview.locator('.overview-parameters>label').evaluateAll(items=>items.map(item=>{const box=item.getBoundingClientRect();return {x:box.x,y:box.y,width:box.width};}));
  assert.ok(Math.abs(fields[0].width-fields[1].width)<1&&Math.abs(fields[0].y-fields[1].y)<1&&Math.abs(fields[2].x-fields[0].x)<1&&fields[2].y>fields[0].y,'parameters must form two equal aligned columns');
  const ownScroll=restoredOverview.getByRole('region',{name:'任务 3 参数与素材',exact:true}),neighbor=page.locator('.task-overview').nth(1).locator('.overview-body');
  const neighborBefore=await neighbor.evaluate(el=>el.scrollTop),outerBefore=await page.locator('.overview-area').evaluate(el=>el.scrollTop);
  const area=await ownScroll.boundingBox();await page.mouse.move(area.x+area.width/2,area.y+area.height/2);await page.mouse.wheel(0,420);
  await poll(async()=>await ownScroll.evaluate(el=>el.scrollTop>0),'wheel did not scroll the selected card');
  assert.equal(await neighbor.evaluate(el=>el.scrollTop),neighborBefore);assert.equal(await page.locator('.overview-area').evaluate(el=>el.scrollTop),outerBefore);
  await ownScroll.evaluate(el=>el.scrollTop=0);
  await restoredOverview.getByRole('button',{name:'提示词',exact:true}).click();
  const immediate=page.getByLabel('提示词全文',{exact:true});assert.equal(await immediate.isEditable(),true);assert.equal(await immediate.evaluate(el=>document.activeElement===el),true);
  assert.equal(await page.getByRole('button',{name:'应用修改',exact:true}).count(),0);
  await immediate.fill('自动同步提示词');await immediate.pressSequentially(' ABC');
  await poll(async()=>(await workspace()).cards.find(c=>c.id===restoredTask.id).nodes.find(n=>n.fieldName==='prompt').fieldValue==='自动同步提示词 ABC','typing must update the card without saving');
  await page.getByRole('dialog').getByRole('button',{name:'场景补充',exact:true}).click();await immediate.fill('第二段即时同步');
  await page.keyboard.press('Escape');
  await restoredOverview.getByRole('button',{name:'编辑',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'列表编辑',exact:true}).getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('.overview-inline-editor').count(),0);
  const visibleEditor=page.locator('.production-editor').filter({visible:true});
  await visibleEditor.getByRole('button',{name:/^提示词/}).click();assert.equal(await visibleEditor.getByLabel('提示词',{exact:true}).inputValue(),'自动同步提示词 ABC');
  await visibleEditor.getByRole('button',{name:/^场景补充/}).click();assert.equal(await visibleEditor.getByLabel('场景补充',{exact:true}).inputValue(),'第二段即时同步');
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();
  await restoredOverview.getByRole('button',{name:'提示词',exact:true}).click();await page.getByLabel('提示词全文',{exact:true}).fill(beforeBulk);await page.getByRole('button',{name:'关闭文字预览',exact:true}).click();
  await poll(async()=>(await workspace()).cards.find(c=>c.id===restoredTask.id).nodes.find(n=>n.fieldName==='prompt').fieldValue===beforeBulk,'closing a prompt must preserve its last change');
  assert.ok(await restoredOverview.locator('.overview-app').isVisible());assert.equal(await restoredOverview.locator('.line-clamp-2').count(),0);
  await restoredOverview.getByRole('button',{name:'提示词',exact:true}).click();const fullPrompt=await page.getByLabel('提示词全文',{exact:true}).inputValue();assert.equal(fullPrompt,beforeBulk);
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await page.getByRole('button',{name:'复制全文',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),fullPrompt);await page.getByRole('button',{name:'关闭文字预览',exact:true}).click();
  const beforeCardPaste=(await workspace()).cards.find(c=>c.id===restoredTask.id).initialPendingFiles;
  const cardImage=restoredOverview.getByRole('group',{name:'image 1素材框',exact:true}),cardEmpty=restoredOverview.getByRole('group',{name:'image 2素材框',exact:true});
  const clipboardImage=async(width,color)=>page.evaluate(async({width,color})=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=56;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,56);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);},{width,color});
  await clipboardImage(84,'#8264ef');await cardEmpty.focus();await page.keyboard.press('Control+V');
  await poll(async()=>await cardEmpty.getByRole('img').evaluate(image=>image.complete&&image.naturalWidth===84),'overview empty media frame did not accept native paste');
  await clipboardImage(98,'#ee5688');await cardImage.focus();await page.keyboard.press('Control+V');
  await poll(async()=>await cardImage.getByRole('img').evaluate(image=>image.complete&&image.naturalWidth===98),'overview existing media frame did not accept native replacement');
  await poll(async()=>{const data=await workspace();return (()=>{const files=data.cards.find(c=>c.id===restoredTask.id).initialPendingFiles;return !!files['single|4|image2']?.$rhFile&&files['single|3|image1']?.$rhFile!==beforeCardPaste['single|3|image1']?.$rhFile;})();},'overview pasted originals were not persisted');
  await page.screenshot({path:'.browser-test-output/参数识别卡片总览.png',fullPage:true});
  await page.setViewportSize({width:1366,height:768});
  const firstCard=page.locator('.task-overview').first(),firstCardBox=await firstCard.boundingBox(),overviewBox=await page.locator('.overview-area').boundingBox();
  assert.ok(firstCardBox.y+firstCardBox.height<=overviewBox.y+overviewBox.height+1,'card controls must fit the editing viewport');
  assert.equal(await page.locator('.overview-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),2,'narrow workspace should retain usable card widths');
  await page.screenshot({path:'.browser-test-output/独立卡片与固定操作-1366.png',fullPage:true});
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('button',{name:'列表编辑',exact:true}).click();await page.locator('.task-nav-row[data-task-id="'+restoredTask.id+'"]>button').first().click();
  await page.getByRole('button',{name:/全部参数 ·/}).filter({visible:true}).click();
  await page.getByLabel('搜索参数',{exact:true}).filter({visible:true}).fill('种子');
  await page.getByRole('button',{name:'取消常用',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'收起全部参数',exact:true}).filter({visible:true}).click();
  assert.equal(await page.getByLabel('种子',{exact:true}).filter({visible:true}).count(),0);await page.reload();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();
  await page.locator('.task-nav-row[data-task-id="'+restoredTask.id+'"]>button').first().click();assert.equal(await page.getByLabel('种子',{exact:true}).filter({visible:true}).count(),0);
  const runSize=await page.getByRole('button',{name:'运行',exact:true}).filter({visible:true}).boundingBox();assert.ok(runSize.height<=38&&runSize.width<180,'run control still consumes too much space');
  await page.setViewportSize({width:1366,height:768});await page.screenshot({path:'.browser-test-output/素材文字并排-1366.png',fullPage:true});assert.ok((await page.locator('.editor-text-input textarea').filter({visible:true}).boundingBox()).height>200);await page.setViewportSize({width:1920,height:1080});

  // Cancel accepted tasks remotely as well as pending local batch work.
  const state=await workspace(),runSource=state.cards.find(c=>c.id===restoredTask.id);runSource.initialBatchList=Array.from({length:6},(_,i)=>runSource.nodes.map(n=>({...n,fieldValue:n.fieldName==='prompt'?'停止验收 '+i:n.fieldValue,_taskId:'stop-row-'+i})));
  await api('/snapshot/current',{method:'PUT',body:JSON.stringify({value:state})});await page.reload();await page.getByRole('button',{name:'卡片总览',exact:true}).click();
  holdNewTasks=true;const runningOverview=page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview');
  await runningOverview.getByRole('button',{name:'运行',exact:true}).click();await poll(async()=>submitted.length===6,'two accepted mock tasks missing');await poll(async()=>await runningOverview.getByText('运行中',{exact:true}).count()>0,'card running state missing');assert.ok(await runningOverview.getByLabel('运行日志内容',{exact:true}).isVisible(),'running log must be visible inside the card');
  await openSettings();await page.getByRole('button',{name:'保存与备份',exact:true}).click();assert.equal(await page.getByRole('button',{name:'手动重置：开启新编号批次',exact:true}).isDisabled(),true,'settings must see an already running scheduler');await page.getByRole('button',{name:'多任务模式',exact:true}).click();
  await runningOverview.getByRole('button',{name:'取消',exact:true}).click();
  await poll(async()=>{const list=await snapshots();return list.length===6&&list.filter(a=>a.status==='saved').length===4&&list.filter(a=>a.status==='cancelled').length===2;},'accepted cancellation was not confirmed',30000);
  assert.equal(submitted.length,6,'cancellation must remove the four waiting batch items');
  assert.equal(cancelCalls.length,2);for(const call of cancelCalls)assert.equal(call.key,submitted[Number(call.taskId.split('-')[1])-1].key,'cancel must use original account');
  holdNewTasks=false;
  assert.ok((await snapshots()).filter(a=>a.cardId===restoredTask.id).every(a=>/^[a-f0-9]{64}$/.test(a.sourceDigest)));
  await page.reload();await page.getByRole('button',{name:'卡片总览',exact:true}).click();await page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview').getByText('已取消',{exact:true}).waitFor();

  blockUploads=true;await page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview').getByRole('button',{name:'运行',exact:true}).click();
  await poll(async()=>uploadGates.length===2,'upload cancellation gates not reached');
  await page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview').getByRole('button',{name:'取消',exact:true}).click();
  await poll(async()=>{const list=await snapshots();return list.length===8&&list.filter(a=>a.status==='cancelled').length===4;},'blocked upload did not abort without waiting for the server');
  blockUploads=false;for(const release of uploadGates.splice(0))release();
  assert.equal(submitted.length,6,'stopping during upload must not submit to platform');
  const changedOverview=page.locator('.task-surface[data-task-id="'+restoredTask.id+'"] .task-overview');await changedOverview.getByRole('button',{name:'提示词',exact:true}).click();await page.getByLabel('提示词全文',{exact:true}).fill('生成完成以后再修改的配置');await page.getByRole('button',{name:'关闭文字预览',exact:true}).click();await changedOverview.getByText('已修改，待生成',{exact:true}).waitFor();assert.equal(submitted.length,6);
  // The same controls work in list, table and overview; queued and running are distinct.
  await page.getByRole('button',{name:'列表编辑',exact:true}).click();
  await page.locator('.task-nav-row[data-task-id="'+restoredTask.id+'"]>button').first().click();
  const listPlus=page.getByRole('button',{name:'PLUS 当前任务',exact:true}).filter({visible:true});
  await listPlus.click();await poll(async()=>await listPlus.getAttribute('aria-pressed')==='true','list PLUS not activated');
  await saved();assert.equal((await workspace()).cards.find(c=>c.id===restoredTask.id).instanceType,'plus');
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'PLUS 任务 3',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('button',{name:'批量对照',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'PLUS 任务 3',exact:true}).getAttribute('aria-pressed'),'true');
  holdNewTasks=true;mixedQueuedTasks=true;
  await page.getByRole('button',{name:'全部运行',exact:true}).click();
  await poll(async()=>submitted.length===8,'run all did not use both account slots');
  await poll(async()=>{const list=await snapshots();return list.some(a=>a.taskId==='mock-7'&&a.status==='running')&&list.some(a=>a.taskId==='mock-8'&&a.status==='queued');},'running and platform queue not distinguished');
  await page.getByText('账号排队 3 项',{exact:true}).first().waitFor();
  await poll(async()=>await page.locator('.comparison-status[data-status=running]').count()>0&&await page.locator('.comparison-status[data-status=queued]').count()>0,'table running and queued status missing');
  const runningColor=await page.locator('.comparison-status[data-status=running]').first().evaluate(el=>getComputedStyle(el).color),queuedColor=await page.locator('.comparison-status[data-status=queued]').first().evaluate(el=>getComputedStyle(el).color);
  assert.notEqual(runningColor,queuedColor);
  await page.screenshot({path:'.browser-test-output/运行排队与全部取消.png',fullPage:true});
  await page.getByRole('button',{name:'全部取消',exact:true}).click();
  await poll(async()=>{const list=await snapshots();return list.length===10&&list.filter(a=>a.status==='cancelled').length===6;},'cancel all did not cancel accepted tasks');
  assert.equal(submitted.length,8,'cancel all must remove all waiting items');assert.equal(cancelCalls.length,4);
  assert.equal(await page.getByRole('button',{name:'全部运行',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'列表编辑',exact:true}).click();
  const cancelledList=page.locator('.task-surface[data-task-id="'+currentTasks.cards[0].id+'"]');
  assert.equal(await page.getByRole('button',{name:'停止追踪',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'停止后续',exact:true}).count(),0);
  // A long group must never scroll the horizontal navigation out of the screen.
  const extended=await workspace(),sample=extended.cards.find(c=>c.webappId==='111');
  for(let i=0;i<18;i++)extended.cards.push({...structuredClone(sample),id:'long-table-'+i,name:'长表滚动 '+(i+1)});
  await api('/snapshot/current',{method:'PUT',body:JSON.stringify({value:extended})});await page.reload();
  await page.getByRole('button',{name:'批量对照',exact:true}).click();
  const fixedBar=page.getByLabel('固定参数横向导航',{exact:true}),barBefore=await fixedBar.boundingBox();
  await page.locator('.comparison-groups-scroll').evaluate(el=>el.scrollTop=1800);
  await poll(async()=>await page.getByRole('slider',{name:'横向滚动参数',exact:true}).isEnabled(),'fixed scrollbar not connected to the visible group');
  const barAfter=await fixedBar.boundingBox();assert.ok(Math.abs(barBefore.y-barAfter.y)<1,'horizontal navigation left the viewport');
  await page.getByRole('slider',{name:'横向滚动参数',exact:true}).focus();await page.keyboard.press('End');
  await poll(async()=>await page.locator('.comparison-group').last().locator('.comparison-scroll').evaluate(el=>el.scrollLeft>500),'fixed horizontal navigation did not scroll the visible long group');
  await page.screenshot({path:'.browser-test-output/固定横向导航-长表.png',fullPage:true});
  await page.setViewportSize({width:1366,height:768});assert.ok(await fixedBar.isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'.browser-test-output/固定横向导航-1366.png',fullPage:true});
  // Pure text, pure media and many numeric/options fields must use the whole editor.
  const compatible=await workspace(),template=compatible.cards.find(c=>c.webappId==='111');
  const addCompatibility=(suffix,nodes)=>compatible.cards.push({...structuredClone(template),id:'compat-'+suffix,name:'兼容 '+suffix,webappId:'900'+(suffix==='short'?1:suffix==='text'?2:3),loadedAppId:'900'+(suffix==='short'?1:suffix==='text'?2:3),webAppInfo:{webappName:'兼容 '+suffix},nodes,initialBatchList:[],initialPendingFiles:{}});
  addCompatibility('short',Array.from({length:14},(_,i)=>({nodeId:String(i+1),fieldName:'n'+i,fieldType:i===0?'LIST':i%2?'FLOAT':'INT',fieldData:i===0?JSON.stringify([{name:'低',index:'low'},{name:'高',index:'high'}]):undefined,fieldValue:i===0?'low':'12',nodeName:'兼容参数 '+i,description:'兼容参数 '+i,required:i===10})));
  addCompatibility('text',[{nodeId:'1',fieldName:'first',fieldType:'STRING',fieldValue:'第一段',nodeName:'兼容文字一',description:'兼容文字一'},{nodeId:'2',fieldName:'second',fieldType:'STRING',fieldValue:'第二段',nodeName:'兼容文字二',description:'兼容文字二'}]);
  addCompatibility('media',['IMAGE','AUDIO','VIDEO','FILE'].map((type,i)=>({nodeId:String(i+1),fieldName:'m'+i,fieldType:type,fieldValue:'None',nodeName:'兼容素材 '+type,description:'兼容素材 '+type})));
  await context.close();context=undefined;
  await api('/snapshot/current',{method:'PUT',body:JSON.stringify({value:compatible})});
  context=await browser(join(root,'compatibility-profile'));page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByRole('button',{name:'列表编辑',exact:true}).click();
  const chooseCompatibility=async suffix=>page.locator('.task-nav-row[data-task-id="compat-'+suffix+'"]>button').first().click();
  await chooseCompatibility('text');assert.equal(await page.getByLabel('参考素材',{exact:true}).filter({visible:true}).count(),0);assert.equal(await page.getByLabel('兼容文字一',{exact:true}).filter({visible:true}).count(),1);
  await chooseCompatibility('media');assert.equal(await page.getByLabel('文字参数',{exact:true}).filter({visible:true}).count(),0);assert.equal(await page.locator('.editor-media .media-field').filter({visible:true}).count(),4);
  await chooseCompatibility('short');assert.equal(await page.locator('.compact-parameter').filter({visible:true}).count(),14);assert.equal(await page.locator('.editor-media-text').filter({visible:true}).count(),0);
  await page.getByLabel('兼容参数 0',{exact:true}).filter({visible:true}).selectOption('high');await poll(async()=>(await workspace()).cards.find(c=>c.id==='compat-short').nodes[0].fieldValue==='high','generic dropdown value did not persist');
  const contrast=await page.evaluate(()=>{
    const ratio=(a,b)=>{const luminance=value=>{const c=value.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
    const values=[];for(const dark of [false,true]){document.documentElement.classList.toggle('dark',dark);for(const select of document.querySelectorAll('select')){const style=getComputedStyle(select);values.push(ratio(style.color,style.backgroundColor));for(const option of select.options){const item=getComputedStyle(option);values.push(ratio(item.color,item.backgroundColor));}}}return values;
  });assert.ok(contrast.every(value=>value>=4.5),'dropdown text/background contrast is insufficient');
  await page.screenshot({path:'.browser-test-output/紧凑参数适配与下拉框.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('通过：中文统一设置、原生 Ctrl+V 图片添加替换与文字粘贴、音视频文件接收与播放、链接拒绝、全参数分组对照、移除自动基准、全素材列、顶部横向滚动、统一应用与撤销、全文查看复制、常用参数记忆、紧凑按钮、浮窗拖动、PLUS 渐变开关、真实缺失任务响应的取消闭环、上传即时中断、账号排队数量、固定横向导航、深浅主题下拉对比度及纯文字/纯素材/多参数适配；任务在导航/列表/对照/卡片/记录之间双向联动、旧记录精确预览、三类多文件本地播放、预览高度与全屏、两处定位请求、删除后历史预览与恢复；35 个模拟账号的单个新增、批量导入预览、去重、验证失败停用、搜索筛选、文本与 JSON 导出；首页收藏改名与取消撤销；三种视图临时序号、删除撤销、左右拖宽与重开恢复、专注模式；收起侧栏仍完成查询归档；4分32秒用时与黄色账号积分；手动新批次归档及接续编号；待确认任务禁止换密钥与删除账号；真实本地文件库、Windows 密钥保护、旧 File 迁移、取消收藏与撤销、多应用分组、任务重命名与完整复制、批量独立改参、常驻新建/保存/全部运行、两账号模拟调度、编号文件与积分、真实文件归档、本地视频播放、界面备份恢复、清除全部浏览器网站数据、服务重启与全新浏览器资料恢复；零真实平台生成。');
}catch(error){console.error(serverLog);if(page){await page.screenshot({path:'.browser-test-output/durable-failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-8000));}throw error;}
finally{blockUploads=false;for(const release of uploadGates.splice(0))release();await context?.close();await stop();await fs.rm(root,{recursive:true,force:true});}
