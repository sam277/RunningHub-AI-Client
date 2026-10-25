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
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOsAAAAASUVORK5CYII=','base64');
let server,context,page,serverLog='';const submitted=[],errors=[];
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
  await ctx.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='result.test')return route.fulfill({body:video,contentType:'video/mp4'});if(!url.hostname.includes('runninghub.'))return route.continue();const key=route.request().headers().authorization?.replace('Bearer ','')||'';let result={code:0,data:{}};
    if(url.pathname.endsWith('/apiCallDemo'))result.data={webappName:url.searchParams.get('webappId')==='222'?'混合参数应用':'H3 测试应用',nodeInfoList:nodes(url.searchParams.get('webappId'))};
    else if(url.pathname.endsWith('/queue/status'))result.data={concurrentLimit:1,runningCount:0,queuedCount:0};
    else if(url.pathname.endsWith('/accountStatus'))result.data={remainCoins:'999',currentTaskCounts:'0',remainMoney:null,apiType:'消费级'};
    else if(url.pathname.endsWith('/media/upload/binary'))result.data={fileName:'upload-'+key+'-'+Date.now()};
    else if(url.pathname.endsWith('/ai-app/run')){const body=JSON.parse(route.request().postData());submitted.push({key,body});result.data={taskId:'mock-'+submitted.length,taskStatus:'RUNNING'};}
    else if(url.pathname.endsWith('/v2/query')){const {taskId}=JSON.parse(route.request().postData());result={taskId,status:'SUCCESS',results:[{url:'https://result.test/'+taskId+'.mp4',type:'video'}]};}
    else if(url.pathname.endsWith('/outputs')){const {taskId}=JSON.parse(route.request().postData());result.data=[{fileUrl:'https://result.test/'+taskId+'.mp4',fileType:'mp4',consumeCoins:'12.5',thirdPartyConsumeMoney:'0',taskCostTime:'1'}];}
    else if(url.pathname.endsWith('/list'))result.data={records:[],total:0};
    return route.fulfill({json:result});
  });return ctx;
}
const api=async(path,options={})=>{const {token}=await(await fetch(base+'/__rh/session')).json();const response=await fetch(base+'/__rh'+path,{...options,headers:{'X-RH-Token':token,'Content-Type':'application/json',...options.headers}});if(!response.ok)throw new Error(await response.text());return response.json();};
const snapshots=()=>api('/snapshots?prefix=attempt:');
const workspace=async()=>(await api('/snapshot/current')).value;
const saved=()=>page.getByText(/工作区已自动保存/).waitFor();
try{
  await start();context=await browser(join(root,'profile'));page=context.pages()[0];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/seed');
  await page.evaluate(async()=>{
    localStorage.setItem('rh_terms_agreed','true');localStorage.setItem('rh_startup_view','multitask');localStorage.setItem('rh_save_api_enabled','true');
    localStorage.setItem('rh_api_keys_v2',JSON.stringify([{id:'a',apiKey:'account-a',note:'a@example.test',enabled:true,concurrency:1},{id:'b',apiKey:'account-b',note:'b@example.test',enabled:true,concurrency:1}]));
    localStorage.setItem('rh_favorites',JSON.stringify([{webappId:'111',name:'我的 H3'},{webappId:'222',name:'另一工具'}]));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('rh-workspaces',1);request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put({file:new File([new Uint8Array([7,8,9])],'legacy.png',{type:'image/png'})},'migration-proof');tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};});
  });
  await page.goto(base);await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();
  const migrated=(await api('/snapshot/migration-proof')).value;assert.match(migrated.file.$rhFile,/^[a-f0-9]{64}$/);assert.equal(migrated.file.name,'legacy.png');
  assert.equal(await page.evaluate(()=>localStorage.getItem('rh_api_keys_v2')),null,'migrated credentials must leave browser storage');
  await page.getByRole('button',{name:'我的 H3',exact:true}).click();await page.getByRole('heading',{name:'提示词',exact:true}).waitFor();
  await page.getByRole('button',{name:'取消收藏 我的 H3',exact:true}).click();assert.equal(await page.getByRole('button',{name:'我的 H3',exact:true}).count(),0);await page.getByRole('button',{name:'撤销取消收藏',exact:true}).click();
  await page.getByLabel('任务名称',{exact:true}).fill('基础任务');
  const prompts=page.locator('.editor-text textarea');await prompts.nth(0).fill('本地持久提示词');await prompts.nth(1).fill('另一个长文本字段');
  await page.locator('input[type=file][accept="image/*"]').first().setInputFiles({name:'reference.png',mimeType:'image/png',buffer:png});
  await poll(async()=>await page.locator('input[type=file]:disabled').count()===0,'upload stalled');
  await saved();
  const current=await workspace();assert.equal(current.cards[0].name,'基础任务');assert.equal(Object.keys(current.cards[0].initialPendingFiles).length,1);
  await page.getByRole('button',{name:'新建任务',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('第二应用');await page.getByPlaceholder('请输入 WebApp ID，或粘贴应用详情页链接').filter({visible:true}).fill('222');await page.getByRole('button',{name:'加载',exact:true}).filter({visible:true}).click();await page.getByRole('heading',{name:'文字输入',exact:true}).waitFor();
  assert.equal(await page.locator('.editor-media').filter({visible:true}).count(),1);assert.equal(await page.locator('.editor-text textarea').filter({visible:true}).count(),1);
  await page.getByRole('button',{name:/1\. 基础任务/}).click();await page.getByRole('button',{name:'复制卡片',exact:true}).filter({visible:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('基础任务对照');
  await page.getByRole('button',{name:'批量对照',exact:true}).click();await page.getByLabel('批量任务名称 3',{exact:true}).fill('对照重命名');await page.getByLabel('批量文字参数 3',{exact:true}).fill('只修改对照提示词');
  await saved();await poll(async()=>{const data=await workspace();return data.cards[2].name==='对照重命名'&&data.cards[2].nodes.some(n=>n.fieldValue==='只修改对照提示词');},'batch edits not persisted');
  const comparison=await workspace();assert.equal(comparison.cards[0].nodes.find(n=>n.fieldName==='prompt').fieldValue,'本地持久提示词');assert.deepEqual(comparison.cards[0].initialPendingFiles,comparison.cards[2].initialPendingFiles);
  await page.getByRole('button',{name:'卡片总览',exact:true}).click();assert.equal(await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).count(),0);await page.getByRole('button',{name:'列表编辑',exact:true}).click();
  await page.setViewportSize({width:1366,height:768});for(const button of ['新建任务','保存草稿','全部运行'])assert.equal(await page.getByRole('button',{name:button,exact:true}).isVisible(),true);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1920,height:1080});
  await fs.mkdir('.browser-test-output',{recursive:true});await page.screenshot({path:'.browser-test-output/新版生产工作台.png',fullPage:true});
  for(const button of ['新建任务','保存草稿','全部运行'])assert.equal(await page.getByRole('button',{name:button,exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'全部运行',exact:true}).click();await poll(async()=>{const list=await snapshots();return list.length===3&&list.every(a=>a.status==='saved');},'mock generation/archive failed',30000);
  assert.equal(submitted.length,3);const records=await snapshots();assert.equal(new Set(records.map(a=>a.sequence)).size,3);assert.ok(records.every(a=>a.usage.coinsReported&&a.usage.coins===12.5));assert.ok(records.every(a=>a.files[0].filename.startsWith(String(a.sequence).padStart(4,'0')+'_')));assert.equal(new Set(submitted.map(item=>item.key)).size,2);
  const files=await fs.readdir(join(dataDir,'results'));assert.equal(files.length,3);for(const file of files)assert.deepEqual(await fs.readFile(join(dataDir,'results',file)),video);
  assert.ok(await page.getByText('12.5 RH',{exact:true}).count()>=3);
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'立即完整备份',exact:true}).click();await page.getByText(/完整备份已建立/).waitFor();await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'取消收藏 我的 H3',exact:true}).click();await page.getByLabel('任务名称',{exact:true}).filter({visible:true}).fill('恢复前临时更改');await saved();
  await page.getByRole('button',{name:'数据与备份',exact:true}).click();await page.getByRole('button',{name:'恢复此备份',exact:true}).first().click();await page.getByRole('button',{name:'确认恢复并重新载入',exact:true}).click();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();
  assert.equal((await workspace()).cards[2].name,'对照重命名');assert.equal(submitted.length,3,'restore must not submit new generations');
  const cdp=await context.newCDPSession(page);await cdp.send('Storage.clearDataForOrigin',{origin:base,storageTypes:'all'});await page.reload();await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.equal((await snapshots()).length,3);await page.getByRole('button',{name:'个人中心',exact:true}).click();await page.getByText('a@example.test',{exact:true}).first().waitFor();await page.getByRole('button',{name:'保存并关闭',exact:true}).click();
  await context.close();context=null;await stop();await start();context=await browser(join(root,'fresh-profile'));page=context.pages()[0];await page.goto(base);await page.getByRole('button',{name:'我的 H3',exact:true}).waitFor();assert.equal((await workspace()).cards[0].nodes.find(n=>n.fieldName==='prompt').fieldValue,'本地持久提示词');assert.equal((await snapshots()).length,3);assert.equal(submitted.length,3);
  await page.getByRole('button',{name:/#0003/}).click();const v=page.locator('article video').first();await v.evaluate(video=>video.play());await poll(async()=>await v.evaluate(video=>video.currentTime>0),'saved local media did not play');assert.match(await v.getAttribute('src'),/^\/__rh\/result\//);
  await page.screenshot({path:'.browser-test-output/清理浏览器后恢复记录.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('通过：真实本地文件库、Windows 密钥保护、旧 File 迁移、取消收藏与撤销、多应用分组、任务重命名与完整复制、批量独立改参、常驻新建/保存/全部运行、两账号模拟调度、编号文件与积分、真实文件归档、本地视频播放、界面备份恢复、清除全部浏览器网站数据、服务重启与全新浏览器资料恢复；零真实平台生成。');
}catch(error){console.error(serverLog);if(page){await page.screenshot({path:'.browser-test-output/durable-failure.png',fullPage:true}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-8000));}throw error;}
finally{await context?.close();await stop();await fs.rm(root,{recursive:true,force:true});}
