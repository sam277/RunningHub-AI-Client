import { listAttemptSummaries } from '../services/production';
import React, { useRef, useState } from 'react';
import { Plus, RefreshCw, Trash2, X, Eye, EyeOff, Pencil, Copy, Search, Upload, Download } from 'lucide-react';
import { ApiKeyEntry, AutoSaveConfig, RunningHubRegionMode } from '../types';
import { getApiInfo } from '../services/api';
import { getRunningHubRegionMode, setRunningHubRegionMode } from '../services/runningHubRegion';
import { settingsStorage, localSession, flushLocalSettings } from '../services/localPersistence';
import { parseAccountImport, mergeImportedAccounts, exportAccounts, maskAccountKey } from '../services/accountManagement';

interface SettingsModalProps {
  isOpen:boolean;onClose:()=>void;apiKeys:ApiKeyEntry[];enterpriseApi:ApiKeyEntry;
  onUpdateApiKeys:(keys:ApiKeyEntry[],saveToStorage?:boolean)=>void;
  onUpdateEnterpriseApi:(key:ApiKeyEntry,saveToStorage?:boolean)=>void;
  autoSaveConfig:AutoSaveConfig;onUpdateAutoSave:(config:AutoSaveConfig)=>void;
}
export default function SettingsModal({isOpen,onClose,apiKeys,enterpriseApi,onUpdateApiKeys,onUpdateEnterpriseApi}:SettingsModalProps){
  const entries=apiKeys.filter(a=>a.apiKey.trim()||a.note?.trim());
  const latest=useRef(apiKeys);latest.current=apiKeys;
  const [persist,setPersist]=useState(()=>settingsStorage.getItem('rh_save_api_enabled')==='true');
  const persistRef=useRef(persist);persistRef.current=persist;
  const [query,setQuery]=useState(''),[filter,setFilter]=useState('all');
  const [form,setForm]=useState<{id?:string;apiKey:string;note:string}|null>(null);
  const [reveal,setReveal]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [tool,setTool]=useState<'import'|'export'|null>(null),[importText,setImportText]=useState(''),[exportFormat,setExportFormat]=useState<'text'|'json'>('text');
  const [busy,setBusy]=useState(false),[expanded,setExpanded]=useState<string|null>(null),[advanced,setAdvanced]=useState(false);
  const [region,setRegion]=useState<RunningHubRegionMode>(getRunningHubRegionMode);
  const rows=parseAccountImport(importText,latest.current),valid=rows.filter(r=>!r.issue&&!r.duplicate);
  const update=(next:ApiKeyEntry[])=>{latest.current=next;onUpdateApiKeys(next,persistRef.current);};
  const change=(id:string,fn:(a:ApiKeyEntry)=>ApiKeyEntry)=>update(latest.current.map(a=>a.id===id?fn(a):a));
  const refresh=async(id:string,enableOnSuccess=false)=>{
    const entry=latest.current.find(a=>a.id===id);if(!entry?.apiKey.trim())return;
    const key=entry.apiKey;change(id,a=>({...a,loading:true,error:undefined}));
    try{const info=await getApiInfo(key);change(id,a=>a.apiKey!==key?a:{...a,loading:false,apiInfo:info,accountInfo:info.account,concurrency:Math.max(1,Number(info.queue.concurrentLimit)||1),enabled:enableOnSuccess?true:a.enabled,error:undefined});}
    catch(e:any){change(id,a=>a.apiKey!==key?a:{...a,loading:false,enabled:enableOnSuccess?false:a.enabled,error:e.message||'验证失败'});}
  };
  const refreshMany=async(ids:string[],enable:boolean|Set<string>=false)=>{
    setBusy(true);try{for(let i=0;i<ids.length;i+=3)await Promise.all(ids.slice(i,i+3).map(id=>refresh(id,typeof enable==='boolean'?enable:enable.has(id))));await flushLocalSettings();}catch(e:any){setError(e.message);}finally{setBusy(false);}
  };
  const saveForm=async(event:React.FormEvent)=>{
    event.preventDefault();if(!form)return;setError('');const key=form.apiKey.trim(),note=form.note.trim();
    if(!key||!note){setError('请填写 API Key 和备注 / 邮箱。');return;}
    if(latest.current.some(a=>a.id!==form.id&&a.apiKey.trim()===key)){setError('这个 API Key 已存在，未重复添加。');return;}
    if(/\s/.test(key)){setError('API Key 中不能包含空白字符。');return;}
    const existing=latest.current.find(a=>a.id===form.id),id=existing?.id||crypto.randomUUID(),changed=existing?.apiKey.trim()!==key;
    if(existing&&changed&&(await listAttemptSummaries()).some(a=>a.accountId===existing.id&&['preparing','submitting','unknown','queued','running','query_failed'].includes(a.status))){setError('该账号有未完成或待确认任务，暂不能替换密钥。请先停用新任务并处理已有记录。');return;}
    const entry:ApiKeyEntry={...existing,id,apiKey:key,note,enabled:changed?false:existing?.enabled,concurrency:changed?1:existing?.concurrency,apiInfo:changed?null:existing?.apiInfo,accountInfo:changed?null:existing?.accountInfo,error:undefined};
    update(existing?latest.current.map(a=>a.id===id?entry:a):[...latest.current.filter(a=>a.apiKey.trim()),entry]);
    setMessage(existing?'账号已保存。':'账号已添加，正在验证；成功后参与调度。');setForm(null);
    try{await flushLocalSettings();if(changed)await refreshMany([id],true);}catch(e:any){setError(e.message);}
  };
  const applyImport=async()=>{
    const parsed=parseAccountImport(importText,latest.current),result=mergeImportedAccounts(latest.current.filter(a=>a.apiKey.trim()),parsed);
    if(!result.added.length)return;update(result.accounts);setTool(null);setImportText('');setMessage('已添加 '+result.added.length+' 个账号，正在逐批验证；验证失败项保留并暂停调度。');
    await refreshMany(result.added.map(a=>a.id),new Set(result.added.filter(a=>parsed.find(row=>row.apiKey===a.apiKey)?.enabled!==false).map(a=>a.id)));
  };
  const close=async()=>{try{await flushLocalSettings();setTool(null);setImportText('');setForm(null);setReveal(false);setError('');setMessage('');onClose();}catch(e:any){setError(e.message||'设置尚未保存，请重试。');}};
  const visible=entries.filter(a=>(a.note+' '+maskAccountKey(a.apiKey)).toLowerCase().includes(query.toLowerCase())&&(filter==='all'||filter==='enabled'&&a.enabled!==false||filter==='disabled'&&a.enabled===false||filter==='error'&&!!a.error));
  if(!isOpen)return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
    <section role="dialog" aria-label="个人中心" className="account-manager flex h-[90vh] w-full max-w-[1440px] flex-col overflow-hidden rounded-xl bg-white text-slate-800 shadow-xl dark:bg-[#161920] dark:text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700"><div><h2 className="font-semibold">个人中心 · 账号管理</h2><p className="mt-1 text-xs text-slate-500">{entries.length} 个账号 · {entries.filter(a=>a.enabled!==false).length} 个启用 · 可用并发上限 {entries.filter(a=>a.enabled!==false).reduce((sum,a)=>sum+(a.concurrency||1),0)}（以平台实时队列为准）</p></div><button aria-label="关闭个人中心" title="关闭" onClick={()=>void close()}><X size={18}/></button></header>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <button className="account-primary" onClick={()=>{setForm({apiKey:'',note:''});setTool(null);setReveal(false);}}><Plus size={15}/>新增账号</button>
        <button className="account-button" onClick={()=>{setTool(tool==='import'?null:'import');setForm(null);}}><Upload size={15}/>批量导入</button>
        <button className="account-button" onClick={()=>{setTool(tool==='export'?null:'export');setForm(null);}}><Download size={15}/>导出账号</button>
        <button className="account-button" disabled={busy} onClick={()=>void refreshMany(entries.map(a=>a.id))}><RefreshCw size={15} className={busy?'animate-spin':''}/>刷新余额</button>
        <label className="ml-auto flex items-center gap-2 rounded border border-slate-400 px-2"><Search size={14}/><input aria-label="搜索账号" placeholder="搜索备注、邮箱或密钥尾号" value={query} onChange={e=>setQuery(e.target.value)} className="w-56 bg-transparent py-1.5 text-sm outline-none"/></label>
        <select aria-label="筛选账号" value={filter} onChange={e=>setFilter(e.target.value)} className="rounded border border-slate-400 bg-transparent p-1.5 text-sm"><option value="all">全部账号</option><option value="enabled">已启用</option><option value="disabled">已停用</option><option value="error">异常账号</option></select>
        <button className="account-button" onClick={()=>setAdvanced(!advanced)}>站点与保存设置</button>
      </div>
      {advanced&&<div className="flex flex-wrap items-center gap-4 border-b border-slate-300 p-3 text-sm dark:border-slate-700"><label>站点 <select aria-label="RunningHub 站点" value={region} onChange={e=>{const mode=e.target.value as RunningHubRegionMode;setRegion(mode);setRunningHubRegionMode(mode);}} className="rounded border border-slate-400 bg-transparent p-1"><option value="global">国际站</option><option value="cn">国内站</option><option value="auto">自动识别</option></select></label><label className="flex items-center gap-2"><input type="checkbox" checked={persist} onChange={e=>{const enabled=e.target.checked;persistRef.current=enabled;setPersist(enabled);settingsStorage.setItem('rh_save_api_enabled',String(enabled));onUpdateApiKeys(latest.current,enabled);onUpdateEnterpriseApi(enterpriseApi,enabled);}}/>本地保存账号</label>{!persist&&<span className="text-amber-600">已关闭持久保存，重开后不保留账号。</span>}</div>}
      {form&&<form onSubmit={event=>void saveForm(event).catch(e=>setError(e.message))} className="account-entry-form border-b border-brand-500 bg-brand-50/40 p-3 dark:bg-brand-900/10">
        <label>备注 / 邮箱<input autoFocus aria-label="新增或编辑账号备注" value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="方便识别的邮箱或名称"/></label>
        <label className="min-w-0 flex-1">API Key<div className="flex gap-1"><input aria-label="新增或编辑 API Key" type={reveal?'text':'password'} value={form.apiKey} onChange={e=>setForm({...form,apiKey:e.target.value})} autoComplete="off" placeholder="粘贴国际站个人 API Key"/><button type="button" aria-label={reveal?'隐藏 API Key':'显示 API Key'} onClick={()=>setReveal(!reveal)}>{reveal?<EyeOff size={16}/>:<Eye size={16}/>}</button></div></label>
        <button type="submit" disabled={busy} className="account-primary">{form.id?'保存修改':'添加并验证'}</button><button type="button" onClick={()=>setForm(null)}>取消</button>
      </form>}
      {tool==='import'&&<div className="account-transfer border-b border-slate-300 p-3 dark:border-slate-700"><div><h3 className="mb-2 font-medium">批量导入预览</h3><p className="mb-2 text-xs text-slate-500">一行 API、一行备注 / 邮箱，空行分组；也支持导出的 JSON。只追加新账号，不改已有账号。</p><textarea aria-label="批量导入账号文本" value={importText} onChange={e=>setImportText(e.target.value)} placeholder={'API_KEY_A\n邮箱或备注 A\n\nAPI_KEY_B\n邮箱或备注 B'} className="h-36 w-full rounded border border-slate-400 bg-transparent p-2 font-mono text-xs"/></div><div className="min-w-0"><div className="mb-2 text-sm">{valid.length} 条可导入 · {rows.filter(r=>r.duplicate).length} 条重复 · {rows.filter(r=>r.issue).length} 条需修正</div><div className="h-28 overflow-auto text-xs">{rows.map((r,i)=><p key={i} className={r.issue?'text-red-500':r.duplicate?'text-slate-500':''}>第 {r.line} 行 · {r.note||'未填写备注'} · {maskAccountKey(r.apiKey)} · {r.issue|| (r.duplicate?'已存在，跳过':'可导入')}</p>)}</div><button disabled={busy||!valid.length} className="account-primary mt-2" onClick={()=>void applyImport().catch(e=>setError(e.message))}>导入 {valid.length} 个有效新账号</button></div></div>}
      {tool==='export'&&<div className="border-b border-slate-300 p-3 dark:border-slate-700"><div className="mb-2 flex flex-wrap items-center gap-3"><strong className="text-sm">导出 {entries.length} 个账号</strong><select aria-label="账号导出格式" value={exportFormat} onChange={e=>setExportFormat(e.target.value as 'text'|'json')} className="rounded border bg-transparent p-1 text-xs"><option value="text">API 与备注分行文本</option><option value="json">JSON</option></select><button className="account-button" onClick={()=>void navigator.clipboard.writeText(exportAccounts(entries,exportFormat)).then(()=>setMessage('账号文本已复制。')).catch(()=>setError('剪贴板不可用，请选中文本后手动复制。'))}><Copy size={14}/>复制导出文本</button><span className="text-xs text-amber-600 dark:text-amber-400">包含真实密钥，请自行妥善保管；不会写入运行日志。</span></div><textarea aria-label="账号导出文本" readOnly value={exportAccounts(entries,exportFormat)} className="h-32 w-full rounded border border-slate-400 bg-transparent p-2 font-mono text-xs"/></div>}
      {error&&<p role="alert" className="px-4 py-2 text-sm text-red-500">{error}</p>}{message&&<p role="status" className="px-4 py-2 text-sm text-brand-600">{message}</p>}
      <div className="min-h-0 flex-1 overflow-auto"><table className="account-table"><thead><tr><th>#</th><th>备注 / 邮箱</th><th>密钥</th><th>剩余 RH</th><th>运行 / 排队</th><th>并发</th><th>参与调度</th><th>操作</th></tr></thead><tbody>{visible.map((entry,index)=>{const account=entry.apiInfo?.account||entry.accountInfo,queue=entry.apiInfo?.queue;return <React.Fragment key={entry.id}><tr><td>{index+1}</td><td><button className="max-w-64 truncate text-left font-medium" title={entry.note} onClick={()=>setExpanded(expanded===entry.id?null:entry.id)}>{entry.note||'未备注'}</button>{entry.error&&<p className="max-w-64 truncate text-xs text-red-500" title={entry.error}>{entry.error}</p>}</td><td className="font-mono text-xs text-slate-500">{maskAccountKey(entry.apiKey)}</td><td className="key-data">{account?.remainCoins??'未查询'}</td><td>{queue?queue.runningCount+' / '+queue.queuedCount:account?.currentTaskCounts??'—'}</td><td>{entry.concurrency||1}</td><td><label className="flex items-center gap-1"><input aria-label={'账号 '+(index+1)+' 参与自动调度'} type="checkbox" checked={entry.enabled!==false} onChange={e=>change(entry.id,a=>({...a,enabled:e.target.checked}))}/><span className="text-xs">{entry.loading?'验证中':entry.enabled===false?'已停用':'已启用'}</span></label></td><td><div className="flex items-center gap-1"><button title="编辑账号" aria-label={'编辑账号 '+entry.note} onClick={()=>{setForm({id:entry.id,apiKey:entry.apiKey,note:entry.note||''});setTool(null);setReveal(false);}}><Pencil size={15}/></button><button title="刷新余额" aria-label={'刷新账号 '+entry.note} disabled={entry.loading} onClick={()=>void refresh(entry.id)}><RefreshCw size={15} className={entry.loading?'animate-spin':''}/></button><button title="删除账号" aria-label={'删除账号 '+entry.note} onClick={()=>void(async()=>{if((await listAttemptSummaries()).some(a=>a.accountId===entry.id&&['preparing','submitting','unknown','queued','running','query_failed'].includes(a.status))){setError('该账号有未完成或待确认任务，请先停用，处理完成后再删除。');return;}if(window.confirm('删除账号配置“'+(entry.note||'未备注')+'”？生成记录保留；有未完成任务时请先停用账号。'))update(latest.current.filter(a=>a.id!==entry.id));})().catch(e=>setError(e.message))}><Trash2 size={15}/></button></div></td></tr>{expanded===entry.id&&<tr><td colSpan={8} className="text-xs text-slate-500">账号：{entry.note} · 站点：{entry.apiInfo?.region==='cn'?'国内站':entry.apiInfo?.region==='global'?'国际站':'未查询'} · 钱包：{account?.remainMoney??'未返回'} · 类型：{account?.apiType||'未返回'}{entry.error&&<p className="mt-1 text-red-500">{entry.error}</p>}</td></tr>}</React.Fragment>;})}</tbody></table>{!visible.length&&<p className="p-10 text-center text-sm text-slate-500">{entries.length?'没有符合条件的账号':'还没有账号。使用顶部新增或批量导入。'}</p>}</div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-300 px-4 py-3 text-xs dark:border-slate-700"><span className="min-w-0 truncate" title={localSession()?.rootPath}>保存位置：{localSession()?.rootPath||'当前浏览器'} · {persist?'修改自动保存，密钥受 Windows 当前用户保护':'仅当前窗口保留账号'}</span><button className="account-primary" onClick={()=>void close()}>保存并关闭</button></footer>
    </section>
  </div>;
}
