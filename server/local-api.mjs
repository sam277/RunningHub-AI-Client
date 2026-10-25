import { promises as fs, createReadStream } from 'node:fs';
import { join, resolve, dirname, parse, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openLocalStore } from './local-store.mjs';

export async function resolveDataDirectory(project, explicit) {
  if(explicit||process.env.RH_DATA_DIR)return resolve(explicit||process.env.RH_DATA_DIR);
  try{return resolve(JSON.parse(await fs.readFile(join(project,'local-config.json'),'utf8')).dataDirectory);}catch(error){if(error.code!=='ENOENT')throw new Error('本地目录配置损坏，请检查 local-config.json；不会改用空目录。');}
  return resolve(project,'..','工作台数据');
}
const json=async req=>{const parts=[];let bytes=0;for await(const part of req){bytes+=part.length;if(bytes>32*1024**2)throw new Error('数据过大');parts.push(part);}return parts.length?JSON.parse(Buffer.concat(parts).toString('utf8')):{};};
const send=(res,value,status=200)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.end(JSON.stringify(value));};

export async function createLocalAPI({project,dataDirectory,storeOptions}={}){
  const directory=await resolveDataDirectory(project,dataDirectory);let store=await openLocalStore(directory,{...storeOptions,legacyResultsDirectory:resolve(project,'..','实测视频结果')});const token=randomBytes(32).toString('hex');
  const switchDirectory=async target=>{
    const destination=resolve(target||'');if(typeof target!=='string'||!target.trim()||destination===parse(destination).root||destination===resolve(project)||destination===store.root||destination.startsWith(store.root+sep))throw new Error('请选择独立的新数据目录，不能选择程序目录、磁盘根目录或当前目录的子目录。');
    if((await store.list('attempt:')).some(a=>['queued','running','submitting','unknown','query_failed','preparing'].includes(a.status)))throw new Error('有运行中或提交待确认的记录，请先处理后再切换目录。');
    await fs.mkdir(destination,{recursive:true});if((await fs.lstat(destination)).isSymbolicLink()||(await fs.readdir(destination)).length)throw new Error('为避免覆盖，请选择一个空目录。');
    const backup=await store.backup(),source=join(store.root,'backups',backup.id);
    await fs.mkdir(join(destination,'db'));await fs.copyFile(join(source,'workspace.sqlite'),join(destination,'db','workspace.sqlite'));await fs.copyFile(join(source,'vault.key'),join(destination,'vault.key'));
    await fs.writeFile(join(destination,'active-db.json'),JSON.stringify({file:'workspace.sqlite'}));
    for(const name of ['assets','results','backups'])await fs.cp(join(store.root,name),join(destination,name),{recursive:true,errorOnExist:true,force:false});
    const next=await openLocalStore(destination,{...storeOptions,legacyResultsDirectory:resolve(project,'..','实测视频结果')});try{await next.summary();const config=join(project,'local-config.json'),temp=config+'.tmp';await fs.writeFile(temp,JSON.stringify({dataDirectory:destination},null,2));await fs.rename(temp,config);}catch(error){await next.close();throw error;}
    const previous=store;store=next;await previous.close();return {ok:true,rootPath:store.root,previousPath:previous.root};
  };
  return {
    get store(){return store;},
    close:()=>store.close(),
    async middleware(req,res,next){
      const url=new URL(req.url||'/','http://127.0.0.1');if(!url.pathname.startsWith('/__rh/'))return next?.();
      const port=req.socket.localPort,allowed=new Set(['127.0.0.1:'+port,'localhost:'+port]),host=req.headers.host;
      if(!allowed.has(host)||req.headers['sec-fetch-site']==='cross-site'||(req.headers.origin&&req.headers.origin!=='http://'+host)){send(res,{error:'仅允许本机工作台页面访问'},403);return;}
      try{
        if(url.pathname==='/__rh/session'&&req.method==='GET'){res.setHeader('Set-Cookie','rh_local_media='+token+'; HttpOnly; SameSite=Strict; Path=/__rh/result/');send(res,{token,rootPath:store.root,mode:'local',version:1,application:'rh-personal-workspace'});return;}
        const mediaRequest=req.method==='GET'&&url.pathname.startsWith('/__rh/result/')&&String(req.headers.cookie||'').split(';').some(item=>item.trim()==='rh_local_media='+token);
        if(req.headers['x-rh-token']!==token&&!mediaRequest){send(res,{error:'本地会话失效，请重新打开工作台'},403);return;}
        const path=url.pathname.slice('/__rh'.length),method=req.method;
        if(path==='/settings'&&method==='GET')return send(res,await store.settings());
        if(path==='/settings'&&method==='PUT')return send(res,await store.saveSettings(await json(req)));
        if(path==='/summary'&&method==='GET')return send(res,await store.summary());
        if(path==='/snapshots'&&method==='GET')return send(res,await store.list(url.searchParams.get('prefix')||''));
        if(path==='/import'&&method==='POST')return send(res,await store.importSnapshots((await json(req)).entries));
        if(path.startsWith('/snapshot/')){const key=decodeURIComponent(path.slice('/snapshot/'.length));if(method==='GET')return send(res,{value:await store.read(key)});if(method==='PUT')return send(res,await store.write(key,(await json(req)).value));if(method==='PATCH')return send(res,await store.patch(key,(await json(req)).fields));}
        if(path==='/sequence'&&method==='POST')return send(res,{sequence:await store.sequence((await json(req)).key)});
        if(path.startsWith('/asset/')){const hash=path.slice('/asset/'.length);if(method==='PUT')return send(res,await store.receive('assets',hash,req));if(method==='GET'){const file=await store.assetPath(hash);res.setHeader('Content-Type','application/octet-stream');res.setHeader('Cache-Control','no-store');createReadStream(file).on('error',()=>res.destroy()).pipe(res);return;}}
        if(path.startsWith('/result/')&&method==='GET'){
          const file=await store.resultPath(decodeURIComponent(path.slice('/result/'.length))),stat=await fs.stat(file);let start=0,end=stat.size-1;
          if(req.headers.range){const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!match||Number(match[1])>=stat.size){res.statusCode=416;res.setHeader('Content-Range','bytes */'+stat.size);res.end();return;}start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;if(end<start)throw new Error('播放范围不正确');res.statusCode=206;res.setHeader('Content-Range','bytes '+start+'-'+end+'/'+stat.size);}
          const extension=file.split('.').pop().toLowerCase();res.setHeader('Content-Type',({mp4:'video/mp4',webm:'video/webm',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',mp3:'audio/mpeg',wav:'audio/wav'})[extension]||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',String(end-start+1));createReadStream(file,{start,end}).on('error',()=>res.destroy()).pipe(res);return;
        }
        if(path.startsWith('/result/')&&method==='PUT')return send(res,await store.receive('results',decodeURIComponent(path.slice('/result/'.length)),req));
        if(path==='/backups'&&method==='GET')return send(res,await store.backups());
        if(path==='/backups'&&method==='POST')return send(res,await store.backup());
        if(path==='/restore'&&method==='POST'){const body=await json(req);if(body.confirmId!==body.id)throw new Error('请确认要恢复的备份');return send(res,await store.restore(body.id));}
        if(path==='/directory'&&method==='POST'){const body=await json(req);if(body.confirmPath!==body.path)throw new Error('请确认目标目录');return send(res,await switchDirectory(body.path));}
        if(path==='/reveal'&&method==='POST')return send(res,await store.reveal((await json(req)).path));
        send(res,{error:'本地操作不存在'},404);
      }catch(error){send(res,{error:error.code==='ENOENT'?'找不到本地文件，请检查数据目录或备份。':error.message||'本地操作失败'},400);}
    },
  };
}
