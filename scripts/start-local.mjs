import { createServer } from 'node:http';
import { promises as fs, createReadStream } from 'node:fs';
import { resolve, dirname, join, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createLocalAPI } from '../server/local-api.mjs';
import { prepareFileRevealer } from '../server/reveal-file.mjs';

const project=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),arg=name=>{const index=args.indexOf(name);return index>=0?args[index+1]:undefined;};
const port=Number(arg('--port')||5187),url='http://127.0.0.1:'+port+'/';
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('端口不正确');
async function openBrowser(root){
  if(process.platform!=='win32')return;
  const bases=[process.env.PROGRAMFILES,process.env['PROGRAMFILES(X86)'],process.env.LOCALAPPDATA].filter(Boolean);
  for(const base of bases){const chrome=join(base,'Google','Chrome','Application','chrome.exe');if(await fs.stat(chrome).catch(()=>null)){const child=spawn(chrome,['--user-data-dir='+join(root,'browser-profile'),'--disk-cache-dir='+join(root,'cache','browser'),'--new-window',url],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',error=>console.error('浏览器未能打开：'+error.message));child.unref();return;}}
  console.log('请在浏览器打开 '+url+'；专用浏览器入口暂未找到 Chrome。');
}
let existing;
try{const response=await fetch(url+'__rh/session',{signal:AbortSignal.timeout(1200)});if(response.ok)existing=await response.json();}catch{}
if(existing?.application==='rh-personal-workspace'){
  if(args.includes('--open'))await openBrowser(existing.rootPath);
  console.log('工作台已在运行：'+url);
}else{
  const dist=join(project,'dist');await fs.access(join(dist,'index.html')).catch(()=>{throw new Error('尚未构建界面，请先运行 npm run build。');});
  const api=await createLocalAPI({project:arg('--config-dir')||project,dataDirectory:arg('--data-dir')});
  process.env.TEMP=join(api.store.root,'tmp');process.env.TMP=process.env.TEMP;
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2'};
  const server=createServer((req,res)=>{void api.middleware(req,res,()=>{void(async()=>{try{const pathname=decodeURIComponent(new URL(req.url||'/',url).pathname),file=resolve(dist,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(dist+sep))throw new Error('path');const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('file');res.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");createReadStream(file).on('error',()=>res.destroy()).pipe(res);}catch{res.statusCode=404;res.end('Not found');}})();});});
  server.on('error',async error=>{console.error('无法启动工作台：'+error.message);await api.close();process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{void prepareFileRevealer();console.log('工作台：'+url);console.log('数据目录：'+api.store.root);if(args.includes('--open'))void openBrowser(api.store.root);});
  const close=()=>server.close(()=>{void api.close().then(()=>process.exit(0));});process.once('SIGINT',close);process.once('SIGTERM',close);
}
