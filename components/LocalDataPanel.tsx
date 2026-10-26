import NumberingSettings from './NumberingSettings';
import React, { useEffect, useState } from 'react';
import { localRequest, localSession, settingsStorage, localSaveStatus, flushLocalState, setWorkspaceReloading, LocalSummary } from '../services/localPersistence';
import { migrateLegacyWorkspace } from '../services/workspaceStorage';

export default function LocalDataPanel() {
  const [status,setStatus]=useState(localSaveStatus);
  const [open,setOpen]=useState(false);
  const [running,setRunning]=useState(false);
  useEffect(()=>{const changed=(event:Event)=>setRunning(Boolean((event as CustomEvent).detail));window.addEventListener('rh-scheduler-state',changed);return()=>window.removeEventListener('rh-scheduler-state',changed);},[]);
  const [summary,setSummary]=useState<LocalSummary|null>(null);
  const [backups,setBackups]=useState<{id:string;createdAt:number;bytes:number;files:number;incomplete?:boolean}[]>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [restore,setRestore]=useState<string|null>(null),[directory,setDirectory]=useState(''),[confirmDirectory,setConfirmDirectory]=useState(false);
  const refresh=async()=>{setSummary(await localRequest('/summary'));setBackups(await localRequest('/backups'));};
  useEffect(()=>{const changed=()=>setStatus(localSaveStatus()),show=()=>setOpen(true);window.addEventListener('rh-local-status',changed);window.addEventListener('rh-open-data-settings',show);return()=>{window.removeEventListener('rh-local-status',changed);window.removeEventListener('rh-open-data-settings',show);};},[]);
  useEffect(()=>{if(open)void refresh().catch(e=>setError(e.message));},[open]);
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setMessage('');try{await flushLocalState();await fn();await refresh();}catch(e:any){setWorkspaceReloading(false);setError(e.message||'操作失败');}finally{setBusy(false);}};
  if(!localSession())return null;
  return <>
    <div className="local-data-bar" role="status"><button onClick={()=>setOpen(true)}>数据与备份</button><span className="truncate" title={status.rootPath}>{status.rootPath}</span><span className={status.error?'text-red-500':''}>{status.error?'设置尚未保存：'+status.error:status.pending?'正在写入文件库…':'文件库已连接 · 清理浏览器不删除业务数据'}</span>{status.error&&<button onClick={()=>void act(async()=>{})}>重试保存</button>}</div>
    {open&&<div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"><section role="dialog" aria-label="本地数据与备份" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 text-sm text-slate-800 shadow-xl dark:bg-slate-900 dark:text-slate-100">
      <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">本地数据与备份</h2><button onClick={()=>setOpen(false)} disabled={busy}>关闭</button></div>
      <div className="space-y-2"><p className="break-all">数据目录：{summary?.rootPath||status.rootPath}</p><p className="text-slate-500">原件与结果：{((summary?.bytes||0)/1024**2).toFixed(1)} MB · {summary?.files||0} 个文件；{summary?.snapshots||0} 条配置与记录。</p><p className="text-slate-500">账号密钥由当前 Windows 用户保护。草稿、收藏、模板和素材保存在本地文件库；浏览器网站数据不再作为唯一副本。</p></div>
      <div className="my-4 flex flex-wrap gap-3"><button disabled={busy} onClick={()=>void act(async()=>{await localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});})}>打开数据目录</button><button disabled={busy} onClick={()=>void act(async()=>{await localRequest('/backups',{method:'POST'});setMessage('完整备份已建立，包含配置、素材、已归档结果及受保护账号。');})}>立即完整备份</button><button disabled={busy} onClick={()=>void act(async()=>{const count=await migrateLegacyWorkspace(true);setMessage('旧浏览器数据迁移完成，新增 '+count+' 条记录；已有本地记录和浏览器原副本保留。');})}>迁移当前浏览器旧数据</button></div>
      {error&&<p role="alert" className="my-3 text-red-500">{error}</p>}{message&&<p role="status" className="my-3 text-brand-600">{message}</p>}
      {running&&<p className="my-2 text-amber-600">调度正在运行，暂不能恢复或迁移目录。可正常建立备份。</p>}<NumberingSettings running={running}/><h3 className="mt-5 font-medium">完整备份</h3>{settingsStorage.getItem('rh_legacy_backup_warning')&&<p className="mt-2 text-amber-600">{settingsStorage.getItem('rh_legacy_backup_warning')}</p>}<p className="my-2 text-xs text-slate-500">恢复前自动备份当前数据；校验失败不替换当前库。含密钥的恢复目前需要原 Windows 用户，重装系统或换用户后不能保证解锁。浏览器缓存不包含在业务备份中。</p>
      <div className="space-y-2">{!backups.length&&<p className="text-slate-500">尚无备份</p>}{backups.map(item=><div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 py-2 dark:border-slate-700"><span>{new Date(item.createdAt).toLocaleString()} · {(item.bytes/1024**2).toFixed(1)} MB · {item.files} 个文件{item.incomplete?' · 恢复前副本（原数据有缺失文件）':''}</span><button disabled={busy||running||item.incomplete} onClick={()=>setRestore(item.id)}>恢复此备份</button></div>)}</div>
      {restore&&<div className="my-3 rounded border border-amber-500 p-3"><p>恢复会替换当前工作区与收藏等配置；生成记录持续保留，未确认任务及其原账号不会因恢复而丢失。操作前会备份当前数据，生成任务不会自动重新提交。</p><div className="mt-3 flex gap-4"><button disabled={busy||running} onClick={()=>void act(async()=>{setWorkspaceReloading(true);await localRequest('/restore',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:restore,confirmId:restore})});window.location.reload();})}>确认恢复并重新载入</button><button disabled={busy} onClick={()=>setRestore(null)}>取消</button></div></div>}
      <h3 className="mt-5 font-medium">迁移到指定数据目录</h3><p className="my-2 text-xs text-slate-500">填写一个空目录。复制配置、原件、结果和备份，验证可读取后切换；原目录保留。运行中或提交待确认时暂停迁移。浏览器专用配置与缓存将在下次通过启动入口运行时使用新目录。</p><input aria-label="新的数据目录" value={directory} onChange={e=>{setDirectory(e.target.value);setConfirmDirectory(false);}} placeholder="例如 J:\我的生产工作台" className="w-full rounded border border-slate-400 bg-transparent p-2"/>
      {confirmDirectory?<div className="mt-3 flex flex-wrap gap-4"><span className="break-all">确认复制并切换到：{directory}</span><button disabled={busy||running} onClick={()=>void act(async()=>{setWorkspaceReloading(true);await localRequest('/directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:directory,confirmPath:directory})});window.location.reload();})}>确认迁移并重新载入</button><button disabled={busy} onClick={()=>setConfirmDirectory(false)}>取消</button></div>:<button className="mt-3" disabled={busy||running||!directory.trim()} onClick={()=>setConfirmDirectory(true)}>准备迁移到此目录</button>}
      {busy&&<p className="mt-4" role="status">正在处理本地文件，请保留此窗口…</p>}
    </section></div>}
  </>;
}
