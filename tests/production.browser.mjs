// Local UI + execution safety regression. RunningHub and native filesystem boundaries are mocked.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.RH_PLAYWRIGHT_ROOT ? pathToFileURL(join(process.env.RH_PLAYWRIGHT_ROOT, 'index.mjs')).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'rh-production-'));
const launch = () => chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1680, height: 1100 }, ...(process.env.RH_BROWSER_PATH ? { executablePath: process.env.RH_BROWSER_PATH } : {}) });
const mock = { submitted: [], rejected: [], uploads: [], queries: [], hold: false, release: null, invalidAccount: '', failQuery: false, uncertainNext: false, runHold: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII=', 'base64');
const video = process.env.RH_TEST_VIDEO ? await readFile(process.env.RH_TEST_VIDEO) : null;
const mocks = async context => {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === 'result.test') return route.fulfill({ body: video || png, contentType: 'video/mp4' });
    if (!url.hostname.includes('runninghub.')) return route.continue();
    const key = route.request().headers().authorization?.replace('Bearer ', '') || '';
    let data = { code: 0, data: {} };
    if (url.pathname.endsWith('/apiCallDemo')) data.data = { webappName: '完整输入应用', nodeInfoList: [
      { nodeId:'1',fieldName:'prompt',fieldType:'STRING',fieldValue:'原始提示词',nodeName:'提示词' },
      ...['image','audio','video'].map((name,i)=>({nodeId:String(i+2),fieldName:name,fieldType:name.toUpperCase(),fieldValue:'',nodeName:name})),
    ] };
    else if (url.pathname.endsWith('/queue/status')) data.data = { concurrentLimit:1,runningCount:0,queuedCount:0 };
    else if (url.pathname.endsWith('/media/upload/binary')) {
      if (mock.hold) await new Promise(resolve => { mock.release = resolve; });
      mock.uploads.push(key);
      data.data = { fileName: 'uploaded-'+key+'-'+mock.uploads.length };
    } else if (url.pathname.endsWith('/ai-app/run')) {
      if (key === mock.invalidAccount) { mock.rejected.push(key); return route.fulfill({ json:{code:401,msg:'invalid key'} }); }
      const body = JSON.parse(route.request().postData());
      mock.submitted.push({ key, body });
      data.data = mock.uncertainNext ? {} : { taskId:'generated-'+mock.submitted.length,taskStatus:'RUNNING' }; mock.uncertainNext=false;
    } else if (url.pathname.endsWith('/v2/query') || url.pathname.endsWith('/outputs')) {
      mock.queries.push({key,host:url.hostname});
      if (mock.failQuery) return route.fulfill({status:503,body:'unavailable'});
      const taskId = JSON.parse(route.request().postData()).taskId;
      data = url.pathname.endsWith('/v2/query') ? { taskId,status:mock.runHold?'RUNNING':'SUCCESS',results:[1,2].map(i=>({url:'https://result.test/'+taskId+'-'+i+'.mp4',type:'video'})) } : {code:0,data:[]};
    }
    await route.fulfill({json:data});
  });
};
let context, page;
const errors = [];
const current = () => page.evaluate(async () => (await import('/services/workspaceStorage.ts')).readWorkspaceData('current'));
const attempts = () => page.evaluate(async () => (await import('/services/production.ts')).listAttempts());
const poll = async (fn, message) => {
  const end=Date.now()+20000;
  while(Date.now()<end) { if(await fn()) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error(message);
};
const save = async () => { await page.getByRole('button',{name:'立即保存 / 重试',exact:true}).click(); await page.getByText(/工作区已自动保存 ·/).waitFor(); };
try {
  context=await launch(); await mocks(context); page=context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    localStorage.setItem('rh_terms_agreed','true'); localStorage.setItem('rh_startup_view','multitask');
    localStorage.setItem('rh_save_api_enabled','true');
    localStorage.setItem('rh_api_keys_v2',JSON.stringify([{id:'a',apiKey:'account-a',note:'a@example.com',concurrency:1},{id:'b',apiKey:'account-b',note:'b@example.com',concurrency:1}]));
  });
  await page.goto(process.env.RH_TEST_URL || 'http://127.0.0.1:5187');
  await page.getByRole('button',{name:'个人中心',exact:true}).click();
  await page.getByLabel('账号 1 参与自动调度',{exact:true}).uncheck();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rh_api_keys_v2'))[0].enabled),false);
  await page.getByLabel('账号 1 参与自动调度',{exact:true}).check();
  await page.getByRole('button',{name:'保存并关闭',exact:true}).click();
  await page.getByPlaceholder('请输入 WebApp ID，或粘贴应用详情页链接').fill('123456');
  await page.getByRole('button',{name:'加载',exact:true}).click();
  await page.getByPlaceholder('请输入文本...').fill('基础提示词');
  for (const type of ['audio','video']) {
    await page.locator('input[type=file][accept="'+type+'/*"]').setInputFiles({name:'reference.'+type,mimeType:type+'/'+type,buffer:Buffer.from(type+' original bytes')});
    await poll(async()=>await page.locator('input[type=file]:disabled').count()===0,'媒体上传未结束');
  }
  mock.hold=true;
  await page.locator('input[type=file][accept="image/*"]').setInputFiles({name:'reference.png',mimeType:'image/png',buffer:png});
  await poll(()=>!!mock.release,'未捕获上传请求');
  await page.getByRole('button',{name:'复制卡片',exact:true}).click();
  assert.equal(await page.locator('img[alt=Preview]').filter({visible:true}).count(),1,'当前副本缺少图片预览');
  mock.hold=false; mock.release();
  await poll(async()=>await page.locator('input[type=file]:disabled').count()===0,'原上传未结束');
  await save();
  let workspace=await current();
  const fileFacts=await page.evaluate(async()=>{
    const data=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('current');
    return Promise.all(data.cards.slice(0,2).map(card=>Promise.all(Object.values(card.initialPendingFiles).map(async f=>({name:f.name,type:f.type,bytes:Array.from(new Uint8Array(await f.arrayBuffer()))})))));
  });
  assert.deepEqual(fileFacts[0],fileFacts[1]);
  assert.equal(Object.keys(workspace.cards[1].initialPendingFiles).length,3);
  await page.getByRole('button',{name:'加载',exact:true}).filter({visible:true}).click();
  await poll(async()=>await page.getByRole('button',{name:'加载',exact:true}).filter({visible:true}).isEnabled(),'刷新应用未完成');
  assert.equal(await page.getByPlaceholder('请输入文本...').filter({visible:true}).inputValue(),'基础提示词');
  await save(); workspace=await current();
  assert.equal(Object.keys(workspace.cards[1].initialPendingFiles).length,3,'刷新同一应用丢失原素材');
  console.log('通过：上传中复制，全部三种原始媒体、提示词、图片预览保留');
  await page.getByRole('button',{name:'保存为模板',exact:true}).filter({visible:true}).click();
  await page.getByLabel('模板名称',{exact:true}).fill('三媒体基础模板');
  await page.getByRole('button',{name:'保存模板',exact:true}).click();
  await page.getByRole('dialog',{name:'保存任务模板'}).waitFor({state:'hidden'});
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByRole('button',{name:'三媒体基础模板',exact:true}).click();
  assert.equal(await page.getByPlaceholder('请输入文本...').filter({visible:true}).inputValue(),'基础提示词');
  await page.getByRole('button',{name:'生成提示词变体',exact:true}).filter({visible:true}).click();
  await page.getByLabel('变体提示词').fill('变体甲第一行\n第二行\n---\n变体乙');
  await page.getByRole('button',{name:'创建变体',exact:true}).click();
  await save();
  workspace=await current();
  assert.equal(workspace.cards.length,5);
  assert.equal(workspace.cards[3].nodes[0].fieldValue,'变体甲第一行\n第二行');
  assert.equal(Object.keys(workspace.cards[4].initialPendingFiles).length,3);
  await page.getByRole('checkbox',{name:'选择任务 1',exact:true}).check();
  await page.getByRole('checkbox',{name:'选择任务 2',exact:true}).check();
  await page.getByRole('button',{name:'批量修改参数',exact:true}).click();
  await page.getByLabel('统一参数值').fill('统一提示词');
  await page.getByRole('button',{name:'应用修改',exact:true}).click();
  await save(); workspace=await current();
  assert.equal(workspace.cards[0].nodes[0].fieldValue,'统一提示词');
  assert.equal(workspace.cards[1].nodes[0].fieldValue,'统一提示词');
  assert.equal(workspace.cards[2].nodes[0].fieldValue,'基础提示词');
  await page.getByRole('button',{name:'撤销上次批量操作',exact:true}).click();
  await save(); workspace=await current();
  assert.equal(workspace.cards[0].nodes[0].fieldValue,'基础提示词'); assert.equal(workspace.cards.length,5);
  await page.getByRole('button',{name:'批量修改参数',exact:true}).click();
  await page.getByLabel('要修改的参数').selectOption('1');
  await page.getByLabel('批量替换素材').setInputFiles({name:'shared.png',mimeType:'image/png',buffer:png});
  await page.getByRole('button',{name:'应用修改',exact:true}).click();
  await save();
  assert.deepEqual(await page.evaluate(async()=>{
    const data=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('current');
    return data.cards.slice(0,3).map(card=>card.initialPendingFiles['single|2|image'].name);
  }),['shared.png','shared.png','reference.png']);
  await page.getByRole('button',{name:'撤销上次批量操作',exact:true}).click();await save();
  console.log('通过：完整模板、含多行文本的变体、选择修改与换素材，以及撤销不影响其他任务');
  await page.getByRole('button',{name:'收藏应用 / 备注名称',exact:true}).filter({visible:true}).click();
  await page.getByLabel('收藏名称',{exact:true}).fill('我的独家视频应用');
  await page.getByRole('button',{name:'保存收藏',exact:true}).click();
  await page.getByRole('button',{name:'运行所选 (2)',exact:true}).click();
  await poll(async()=>mock.submitted.length===2 && (await attempts()).filter(a=>a.status==='completed').length===2,'两账号并发未完成');
  assert.deepEqual(new Set(mock.submitted.map(item=>item.key)),new Set(['account-a','account-b']));
  mock.submitted.forEach(item => item.body.nodeInfoList.filter(n=>n.fieldType!=='STRING').forEach(n=>assert.ok(n.fieldValue.startsWith('uploaded-'+item.key))));
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  await page.getByRole('button',{name:/^2\. /}).click();
  await page.getByRole('button',{name:'再生成一次',exact:true}).filter({visible:true}).click();
  await poll(async()=>mock.submitted.length===3 && (await attempts()).filter(a=>a.status==='completed').length===3,'再次生成未保留三次记录');
  if (video) {
    const player=page.locator('video[src^="https://result.test/"]').filter({visible:true}).first();
    await poll(()=>player.evaluate(el=>el.readyState>=2),'结果视频无法解码');
    await player.evaluate(async el=>{el.muted=true;await el.play();});
    await poll(()=>player.evaluate(el=>el.currentTime>0),'结果视频无法播放');
    console.log('通过：真实本地测试视频解码与播放（模拟结果链接）');
  }
  const beforeDisable=mock.submitted.length;
  const priorDisableIds=new Set((await attempts()).map(a=>a.id));
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  for(const n of [1,2,3])await page.getByRole('checkbox',{name:'选择任务 '+n,exact:true}).check();
  mock.runHold=true;
  await page.getByRole('button',{name:'运行所选 (3)',exact:true}).click();
  await poll(()=>mock.submitted.length===beforeDisable+2,'未启动两个并发任务');
  await page.getByRole('button',{name:'个人中心',exact:true}).click();
  await page.getByLabel('账号 1 参与自动调度',{exact:true}).uncheck();
  await page.getByRole('button',{name:'保存并关闭',exact:true}).click();
  mock.runHold=false;
  await poll(async()=>mock.submitted.length===beforeDisable+3&&(await attempts()).filter(a=>!priorDisableIds.has(a.id)&&a.status==='completed').length===3,'停用后的剩余任务未完成');
  assert.equal(mock.submitted.at(-1).key,'account-b','被停用账号仍领取新任务');
  await page.getByRole('button',{name:'个人中心',exact:true}).click();
  await page.getByLabel('账号 1 参与自动调度',{exact:true}).check();
  await page.getByRole('button',{name:'保存并关闭',exact:true}).click();
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  console.log('通过：调度中停用账号立即停止领取新任务，原任务继续查询完成');
  const beforeDownload=mock.submitted.length;
  await page.evaluate(async()=>{
    window.rhSavedFiles=[]; window.rhFailDownload=true;
    window.__TAURI_INTERNALS__={invoke:async(command,args)=>{
      if(command==='get_saved_directory')return '/virtual-output';
      if(command==='check_directory_writable')return true;
      if(command==='save_file_from_url'){
        if(window.rhFailDownload && window.rhSavedFiles.length===1)throw new Error('模拟第二个文件下载失败');
        window.rhSavedFiles.push(args.filename); return '/virtual-output/'+args.filename;
      }
      throw new Error('Unexpected command '+command);
    }};
    await (await import('/services/autoSaveService.ts')).initAutoSave();
    const service=await import('/services/production.ts');
    const first=(await service.listAttempts())[0]; await service.archiveAttempt(first.id);
  });
  let records=await attempts(); const downloaded=records.find(a=>a.status==='download_failed');
  assert.ok(downloaded); assert.equal(downloaded.files.length,1,downloaded.error);assert.ok(downloaded.files[0].filename.endsWith('.mp4'));
  await page.evaluate(async id=>{window.rhFailDownload=false;await(await import('/services/production.ts')).archiveAttempt(id);},downloaded.id);
  records=await attempts(); assert.equal(records.find(a=>a.id===downloaded.id).status,'saved');
  assert.equal(await page.evaluate(()=>window.rhSavedFiles.length),2);
  assert.equal(mock.submitted.length,beforeDownload);
  await page.evaluate(()=>{delete window.__TAURI_INTERNALS__;});
  console.log('通过：完成后再次生成、历史快照、账号绑定上传、部分下载失败仅补存缺失文件');
  const base=records[0];
  await page.evaluate(async base=>{
    base=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('attempt:'+base.id);
    const {saveAttempt}=await import('/services/production.ts');
    await saveAttempt({...base,id:'known-recovery',taskId:'known-remote',status:'running',outputs:[],files:[]});
    await saveAttempt({...base,id:'unknown-recovery',taskId:undefined,status:'submitting',outputs:[],files:[]});
  },base);
  await save(); await context.close();
  context=await launch();await mocks(context);page=context.pages()[0]||await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(process.env.RH_TEST_URL || 'http://127.0.0.1:5187');
  await poll(async()=>{const a=await attempts();return a.find(a=>a.id==='known-recovery')?.status==='completed' && a.find(a=>a.id==='unknown-recovery')?.status==='unknown';},'重启接续状态不正确');
  assert.equal(mock.submitted.length,beforeDownload);
  workspace=await current(); assert.equal(workspace.cards.length,5);
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('rh_favorites')).some(f=>f.name==='我的独家视频应用')));
  const assetCount=await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('rh-workspaces');r.onsuccess=()=>{const t=r.result.transaction('assets');const c=t.objectStore('assets').count();c.onsuccess=()=>resolve(c.result);};}));
  assert.equal(assetCount,3,'同一原件在模板、多个任务和记录中重复存储');
  const originalId=base.cardId;
  const index=workspace.cards.findIndex(c=>c.id===originalId);
  await page.getByRole('button',{name:new RegExp('^'+(index+1)+'\\. ')}).click();
  await page.getByRole('button',{name:'运行',exact:true}).filter({visible:true}).click();
  await page.getByText('存在尚未确认完成的生成，请在生成记录中继续查询或核对提交结果，再发起新生成。',{exact:true}).waitFor();
  assert.equal(mock.submitted.length,beforeDownload);
  // Query interruption must preserve task ID and bind the original account and site.
  mock.failQuery=true;
  await page.evaluate(async base=>{
    base=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('attempt:'+base.id);
    const p=await import('/services/production.ts');
    await p.saveAttempt({...base,id:'query-interruption',taskId:'known-query',status:'running',outputs:[],files:[]});
    await p.recoverAttempt('query-interruption',JSON.parse(localStorage.getItem('rh_api_keys_v2')),false);
  },base);
  assert.equal((await attempts()).find(a=>a.id==='query-interruption').status,'query_failed');
  mock.failQuery=false;
  await page.evaluate(async()=>{localStorage.setItem('rh_runninghub_region_mode','cn');await(await import('/services/production.ts')).recoverAttempt('query-interruption',JSON.parse(localStorage.getItem('rh_api_keys_v2')),false);});
  assert.equal(mock.queries.at(-1).host,'www.runninghub.ai');
  assert.equal(mock.submitted.length,beforeDownload);
  console.log('通过：浏览器进程重启、原件去重、收藏持久化、已知编号只查询、未知提交阻止重发、查询失败恢复原账号原站点');
  // An invalid account cannot consume all remaining tasks.
  await page.evaluate(async()=>{
    const p=await import('/services/production.ts');
    const item=(await p.listAttempts()).find(a=>a.id==='unknown-recovery');
    await p.saveAttempt({...item,status:'rejected',error:'模拟人工已核对未提交'});
    localStorage.setItem('rh_runninghub_region_mode','global');
  });
  await page.getByRole('button',{name:'返回编辑',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择任务 1',exact:true}).check();
  await page.getByRole('checkbox',{name:'选择任务 2',exact:true}).check();
  mock.invalidAccount='account-a';
  const beforeIsolation=mock.submitted.length;
  const beforeIsolationIds=new Set((await attempts()).map(a=>a.id));
  await page.getByRole('button',{name:'运行所选 (2)',exact:true}).click();
  await poll(async()=>mock.submitted.length===beforeIsolation+2 && (await attempts()).filter(a=>!beforeIsolationIds.has(a.id)&&(a.status==='completed'||a.status==='saved')).length===2,'故障账号隔离后任务未完成');
  assert.equal(mock.rejected.length,1,'无效账号被反复使用');
  assert.ok(mock.submitted.slice(beforeIsolation).every(item=>item.key==='account-b'));
  mock.invalidAccount='';
  console.log('通过：一个账号认证失败，健康账号继续完成所有剩余任务');
  // An actual ambiguous submit response and a query failure must follow different recovery paths.
  const directRun=async cardId=>page.evaluate(async({base,cardId})=>{
    base=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('attempt:'+base.id);
    try {await(await import('/services/production.ts')).runProductionTask({apiKey:'account-a',webappId:'123456',taskNodes:base.originalNodes,pendingFiles:base.pendingFiles,autoSaveEnabled:false},{cardId,name:cardId,account:JSON.parse(localStorage.getItem('rh_api_keys_v2'))[0]});return '';}
    catch(error){return error.message;}
  },{base,cardId});
  mock.uncertainNext=true;
  assert.ok(await directRun('uncertain-response'));
  assert.equal((await attempts()).find(a=>a.cardId==='uncertain-response').status,'unknown');
  mock.failQuery=true;
  assert.ok(await directRun('failed-after-acceptance'));
  const queryFailed=(await attempts()).find(a=>a.cardId==='failed-after-acceptance');
  assert.equal(queryFailed.status,'query_failed');assert.ok(queryFailed.taskId);
  const acceptedCount=mock.submitted.length;
  mock.failQuery=false;
  await page.evaluate(async id=>{await(await import('/services/production.ts')).recoverAttempt(id,JSON.parse(localStorage.getItem('rh_api_keys_v2')),false);},queryFailed.id);
  assert.equal((await attempts()).find(a=>a.id===queryFailed.id).status,'completed');
  assert.equal(mock.submitted.length,acceptedCount);
  console.log('通过：实际模拟提交缺少编号进入待确认，接受后查询失败只恢复查询，未额外提交');
  // Different AI applications share the same queue without mixing their IDs or inputs.
  await page.getByRole('button',{name:'清空选择',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择任务 1',exact:true}).check();
  await page.getByRole('button',{name:'新建任务',exact:true}).click();
  await page.getByRole('button',{name:'创建空白卡片',exact:true}).click();
  await page.getByPlaceholder('请输入 WebApp ID，或粘贴应用详情页链接').filter({visible:true}).fill('654321');
  await page.getByRole('button',{name:'加载',exact:true}).filter({visible:true}).click();
  await page.getByPlaceholder('请输入文本...').filter({visible:true}).fill('第二应用提示词');
  await page.getByRole('checkbox',{name:'选择任务 6',exact:true}).check();
  const beforeDifferent=mock.submitted.length;
  const priorDifferentIds=new Set((await attempts()).map(a=>a.id));
  await page.getByRole('button',{name:'运行所选 (2)',exact:true}).click();
  await poll(async()=>mock.submitted.length===beforeDifferent+2&&(await attempts()).filter(a=>!priorDifferentIds.has(a.id)&&a.status==='completed').length===2,'不同应用并发未完成');
  assert.deepEqual(new Set(mock.submitted.slice(beforeDifferent).map(item=>item.body.webappId)),new Set(['123456','654321']));
  assert.equal(mock.submitted.slice(beforeDifferent).find(item=>item.body.webappId==='654321').body.nodeInfoList[0].fieldValue,'第二应用提示词');
  console.log('通过：不同应用在同一并发队列执行，应用 ID 与各自参数没有串用');
  // A failed durable write must prevent the network submission altogether.
  const beforeFailure=mock.submitted.length;
  const failure=await page.evaluate(async base=>{
    base=await(await import('/services/workspaceStorage.ts')).readWorkspaceData('attempt:'+base.id);
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(names,mode,opts){if(mode==='readwrite')throw new Error('模拟本地存储失败');return original.call(this,names,mode,opts);};
    try { await(await import('/services/production.ts')).runProductionTask({apiKey:'account-a',webappId:'123456',taskNodes:base.originalNodes,pendingFiles:base.pendingFiles,autoSaveEnabled:false},{cardId:'blocked-by-storage',name:'存储故障测试',account:JSON.parse(localStorage.getItem('rh_api_keys_v2'))[0]});return false; }
    catch {return true;} finally {IDBDatabase.prototype.transaction=original;}
  },base);
  assert.equal(failure,true);assert.equal(mock.submitted.length,beforeFailure);
  await page.getByRole('button',{name:'生成记录',exact:true}).click();
  const article=page.locator('article').filter({hasText:queryFailed.taskId});
  await article.getByRole('button',{name:'标记采用',exact:true}).click();
  await poll(async()=>(await attempts()).find(a=>a.id===queryFailed.id)?.decision==='adopted','结果采用标记未保存');
  await article.getByRole('button',{name:'按此输入准备新任务',exact:true}).click();
  await save();
  const restored=await current();
  assert.equal(restored.cards.at(-1).sourceAttemptId,queryFailed.id);
  assert.equal(Object.keys(restored.cards.at(-1).initialPendingFiles).length,3);
  await page.getByPlaceholder('请输入文本...').filter({visible:true}).fill('恢复后独立修改');
  assert.equal((await attempts()).find(a=>a.id===queryFailed.id).originalNodes[0].fieldValue,'基础提示词');
  console.log('通过：从单条记录准备重做，原件完整、来源关联保留、历史输入不被新编辑修改');
  await page.getByRole('button',{name:'生成记录',exact:true}).click();
  await mkdir('.browser-test-output',{recursive:true});
  await page.screenshot({path:'.browser-test-output/生产记录.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('通过：落盘失败阻止提交；所有场景使用模拟接口，零真实生成。');
} catch(error) {
  await mkdir('.browser-test-output',{recursive:true});
  await page?.screenshot({path:'.browser-test-output/production-failure.png',fullPage:true}).catch(()=>{});
  console.error(errors);
  console.error(await page?.locator('body').innerText());
  throw error;
} finally {mock.release?.();await context?.close();await rm(profile,{recursive:true,force:true});}
