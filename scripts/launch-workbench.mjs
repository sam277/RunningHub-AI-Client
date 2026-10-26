import { spawn, spawnSync } from 'node:child_process';
import { promises as fs, openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const arg=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const port=Number(arg('--port')||5187);
const url='http://127.0.0.1:'+port+'/';
const session=async()=>{try{const response=await fetch(url+'__rh/session',{signal:AbortSignal.timeout(1200)});if(response.ok){const value=await response.json();if(value.application==='rh-personal-workspace')return value;}}catch{}return null;};
function runNpm(command,env){
  const child=spawnSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm '+command],{cwd:project,env,stdio:'inherit',windowsHide:true});
  if(child.error||child.status!==0)throw new Error('依赖安装或界面构建失败，请保留此窗口中的错误信息。');
}
try{
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('请安装 Node.js 24 或更新版本。');
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('端口不正确。');
  let current=await session();
  if(current){
    console.log('工作台已在运行：'+url);console.log('数据目录：'+current.rootPath);
    if(!args.includes('--no-open')){const child=spawn(process.execPath,['scripts/start-local.mjs','--port',String(port),'--open'],{cwd:project,detached:true,windowsHide:true,stdio:'ignore'});child.on('error',error=>console.error('自动打开失败，请手动打开网页：'+error.message));child.unref();}
  }else{
    const {resolveDataDirectory}=await import('../server/local-api.mjs');
    const configProject=arg('--config-dir')||project;
    const root=await resolveDataDirectory(configProject,arg('--data-dir'));
    for(const folder of ['cache','tmp'])await fs.mkdir(join(root,folder),{recursive:true});
    const env={...process.env,npm_config_cache:join(project,'.npm-cache'),TEMP:join(root,'tmp'),TMP:join(root,'tmp')};
    if(!await fs.stat(join(project,'node_modules','vite','bin','vite.js')).catch(()=>null))runNpm('ci',env);
    if(!args.includes('--skip-build'))runNpm('run build',env);
    const outPath=join(root,'cache','local-service.log'),errorPath=join(root,'cache','local-service-error.log');
    const stdout=openSync(outPath,'a'),stderr=openSync(errorPath,'a');
    let child;
    try{child=spawn(process.execPath,['scripts/start-local.mjs','--port',String(port),'--data-dir',root,'--config-dir',configProject,...(args.includes('--no-open')?[]:['--open'])],{cwd:project,env,detached:true,windowsHide:true,stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
    let launchError;child.on('error',error=>{launchError=error;});child.unref();
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){current=await session();if(current)break;if(launchError||child.exitCode!==null)break;await new Promise(resolve=>setTimeout(resolve,200));}
    if(!current)throw new Error('本地服务未能启动。日志：'+errorPath+(launchError?'；'+launchError.message:''));
    if(resolve(current.rootPath)!==resolve(root))throw new Error('该端口连接到了另一数据目录，请检查启动日志。');
    console.log('工作台已启动：'+url);console.log('数据目录：'+current.rootPath);
  }
  console.log('浏览器未自动打开时，请把上面的网址粘贴到现有浏览器地址栏。');
}catch(error){console.error(error.message||String(error));process.exitCode=1;}
