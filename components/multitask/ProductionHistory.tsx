import { attemptDuration, timingDetails } from '../../services/productionPresentation';
import React, { useEffect, useState, useRef } from 'react';
import { ChevronDown, ChevronRight, Eye, RotateCcw, FolderOpen, Download } from 'lucide-react';
import { ApiKeyEntry } from '../../types';
import { ATTEMPT_LABELS, isCancellableAttempt, cancellationPending, archiveAttempt, loadAttemptInputs, attemptNumber, ProductionAttempt, recoverAttempt, saveAttempt, setAttemptDecision } from '../../services/production';
import { localRequest, localSession } from '../../services/localPersistence';

interface Props {onCancel:(cardId:string)=>Promise<void>;accounts:ApiKeyEntry[];autoSave:boolean;attempts:ProductionAttempt[];activeTaskId?:string;selectedAttemptId?:string;readError?:string;onRefresh:()=>Promise<void>;onSelect:(attempt:ProductionAttempt)=>void;onPreview:(attempt:ProductionAttempt)=>void;onPrepare:(attempt:ProductionAttempt)=>void;}
export default function ProductionHistory({onCancel,accounts,autoSave,attempts,activeTaskId,selectedAttemptId,readError,onRefresh,onSelect,onPreview,onPrepare}:Props){
  const [now,setNow]=useState(Date.now),[error,setError]=useState(''),[busy,setBusy]=useState<string|null>(null),[taskId,setTaskId]=useState(''),[expanded,setExpanded]=useState<string|null>(null);
  const attemptsRef=useRef(attempts);attemptsRef.current=attempts;
  useEffect(()=>{if(!attempts.some(a=>['preparing','submitting','queued','running','query_failed','unknown'].includes(a.status)))return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[attempts]);
  useEffect(()=>{
    let stopped=false;
    const recover=async()=>{try{for(const attempt of attemptsRef.current){if(stopped)return;await recoverAttempt(attempt.id,accounts,autoSave);}}catch{if(!stopped)setError('接续查询暂不可用，请稍后重试。');}};
    const timer=window.setInterval(()=>void recover(),10000);void recover();
    return()=>{stopped=true;window.clearInterval(timer);};
  },[accounts,autoSave,attempts.length]);
  const act=async(id:string,operation:()=>Promise<unknown>)=>{setBusy(id);setError('');try{await operation();}catch(e:any){setError(e.message||'操作失败');}finally{setBusy(null);await onRefresh();}};
  const reveal=(attempt:ProductionAttempt,path:string)=>act(attempt.id,()=>localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})}));
  return <section className="h-full overflow-auto p-2" aria-label="生成记录">
    <div className="mb-2 flex items-center justify-between text-xs"><h3 className="font-semibold">生成记录 · {attempts.length}</h3><button title="刷新记录" onClick={()=>void onRefresh()}>刷新记录</button></div>
    {(error||readError)&&<p role="alert" className="mb-2 text-xs text-red-500">{error||readError}</p>}
    {!attempts.length&&<p className="p-2 text-xs text-slate-500">暂无生成记录</p>}
    {attempts.map(attempt=>{
      const duration=attemptDuration(attempt,now),availableFile=attempt.files.find(file=>!attempt.missingResultIndexes?.includes(file.index));
      const status=attempt.status==='saved'&&attempt.localResultsMissing?'文件缺失':attempt.status==='unknown'?'提交待确认':cancellationPending(attempt)?'取消确认中':ATTEMPT_LABELS[attempt.status];
      const statusColor=attempt.localResultsMissing||['unknown','query_failed','download_failed'].includes(attempt.status)?'text-amber-600 dark:text-amber-400':['generation_failed','rejected'].includes(attempt.status)?'text-red-500':attempt.status==='saved'?'text-emerald-600 dark:text-emerald-400':'text-slate-500';
      const related=attempt.cardId===activeTaskId,isExact=attempt.id===selectedAttemptId;
      return <article key={attempt.id} className="production-record" data-status={cancellationPending(attempt)?'cancelling':attempt.status} data-task-id={attempt.cardId} data-attempt-id={attempt.id} data-task-focused={related} data-attempt-selected={isExact} onPointerDownCapture={()=>onSelect(attempt)} onFocusCapture={()=>onSelect(attempt)}>
        <button className="record-summary" aria-pressed={isExact} onClick={()=>onPreview(attempt)} title="选择这次生成并在中间预览">
          <div className="flex items-baseline gap-2"><strong className="text-brand-600">#{attemptNumber(attempt)}{(attempt.sequenceBatch||1)>1&&<span className="ml-1 text-[10px] text-slate-500">B{String(attempt.sequenceBatch).padStart(2,'0')}</span>}</strong><span className={'ml-auto text-[11px] '+statusColor}>{status}</span><span className="key-data whitespace-nowrap">{attempt.usage&&(attempt.usage.coinsReported||attempt.usage.coins>0)?attempt.usage.coins.toLocaleString(undefined,{maximumFractionDigits:2})+' RH':'积分未知'}</span></div>
          <div className="my-1 truncate font-medium" title={attempt.name}>{attempt.name}</div>
          <div className="record-metrics"><span title={duration.source}>{duration.label}：<span className="key-data" data-record-duration>{duration.value}</span></span><time title={new Date(attempt.createdAt).toLocaleString()}>{new Date(attempt.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})}</time></div>
          <div className="key-data mt-1 truncate text-[11px]" data-record-account title={attempt.accountNote}>{attempt.accountNote}</div>
        </button>
        <div className="record-actions">
          {attempt.outputs.length>0&&<button title="预览这次生成" onClick={()=>onPreview(attempt)}><Eye size={13}/>预览</button>}
          {['completed','saved','download_failed','generation_failed','interrupted','rejected','cancelled'].includes(attempt.status)&&<button title="按此输入准备新任务，不自动运行" aria-label="按此输入准备新任务" disabled={busy===attempt.id} onClick={()=>void act(attempt.id,async()=>{const full=await loadAttemptInputs(attempt.id);if(full)onPrepare(full);})}><RotateCcw size={13}/>重做</button>}
          {isCancellableAttempt(attempt)&&<button disabled={busy===attempt.id||cancellationPending(attempt)} onClick={()=>void act(attempt.id,()=>onCancel(attempt.cardId))}>{cancellationPending(attempt)?'取消中':attempt.cancelError?'重试取消':'取消'}</button>}
          {attempt.taskId&&['query_failed'].includes(attempt.status)&&<button disabled={busy===attempt.id} onClick={()=>void act(attempt.id,()=>recoverAttempt(attempt.id,accounts,autoSave))}>继续查询</button>}
          {attempt.outputs.length>0&&(attempt.status!=='saved'||attempt.localResultsMissing)&&<button title="只保存结果文件，不重新生成" aria-label="保存结果 / 重试下载" disabled={busy===attempt.id} onClick={()=>void act(attempt.id,()=>archiveAttempt(attempt.id))}><Download size={13}/>{attempt.localResultsMissing?'补存':'保存'}</button>}
          {availableFile&&localSession()&&<button title="打开文件夹并选中结果" aria-label="定位文件" disabled={busy===attempt.id} onClick={()=>void reveal(attempt,availableFile.path)}><FolderOpen size={13}/>{busy===attempt.id?'打开中…':'定位'}</button>}
          <button className="ml-auto" aria-expanded={expanded===attempt.id} title="参数、文件位置与执行详情" onClick={()=>{setExpanded(expanded===attempt.id?null:attempt.id);setTaskId('');}}>{expanded===attempt.id?<ChevronDown size={13}/>:<ChevronRight size={13}/>}详情</button>
        </div>
        {attempt.cancelError&&isCancellableAttempt(attempt)&&<p role="alert" className="mt-1 text-[11px] text-red-500">取消未确认：{attempt.cancelError}</p>}
        {attempt.error&&<p className="mt-1 truncate text-[11px] text-amber-600" title={attempt.error}>{attempt.error}</p>}
        {expanded===attempt.id&&<div className="record-details">
          {attempt.status==='saved'&&<p>已保存到本地</p>}
          {timingDetails(attempt).length>0&&<div className="flex flex-wrap gap-2 text-xs" aria-label="时间明细">{timingDetails(attempt).map(([label,value])=><span key={label}>{label}：<span className="key-data">{value}</span></span>)}</div>}
          <p>应用：{attempt.webappId}<br/>平台编号：{attempt.taskId||'未返回'}<br/>本地记录：{attempt.id}{attempt.parentAttemptId&&<><br/>来源记录：{attempt.parentAttemptId}</>}</p>
          {attempt.outputs.length>0&&<div className="flex gap-3"><button onClick={()=>void act(attempt.id,()=>setAttemptDecision(attempt.id,'adopted'))}>{attempt.decision==='adopted'?'✓ 已采用':'标记采用'}</button><button onClick={()=>void act(attempt.id,()=>setAttemptDecision(attempt.id,'redo'))}>{attempt.decision==='redo'?'✓ 待重做':'标记待重做'}</button></div>}
          <div className="max-h-48 overflow-auto">{attempt.originalNodes.map((node,index)=><p key={index} className="mb-2 whitespace-pre-wrap"><strong>{node.description||node.nodeName||node.fieldName}：</strong>{node.fieldValue}</p>)}</div>
          <p>原始素材：{Object.values(attempt.pendingFiles).map((file:File)=>file.name).join('、')||'无本地原件'}</p>
          {attempt.files.map(file=><p key={file.index}>{attempt.missingResultIndexes?.includes(file.index)?'本地缺失：':'文件：'}{file.path}{localSession()&&!attempt.missingResultIndexes?.includes(file.index)&&<button className="ml-2 text-brand-600" onClick={()=>void reveal(attempt,file.path)}>定位此文件</button>}</p>)}
          {attempt.status==='unknown'&&<div className="rounded border border-amber-600 p-2"><p>先在 RunningHub 核对原账号记录。找到任务时绑定编号，只查询；确认未提交才能解除阻止。</p><input aria-label="核对后的平台任务编号" value={taskId} onChange={e=>setTaskId(e.target.value)} className="my-2 w-full rounded border border-slate-500 bg-transparent p-2"/><div className="flex flex-wrap gap-3"><button disabled={!taskId.trim()||busy===attempt.id} onClick={()=>void act(attempt.id,async()=>{await saveAttempt({...attempt,taskId:taskId.trim(),status:'query_failed',error:undefined});await recoverAttempt(attempt.id,accounts,autoSave);})}>绑定编号并查询</button><button disabled={busy===attempt.id} onClick={()=>void act(attempt.id,()=>saveAttempt({...attempt,status:'rejected',error:'用户已在平台核对并确认本次未提交；允许手动发起新生成。'}))}>我已在平台确认本次未提交</button></div></div>}
        </div>}
      </article>;
    })}
  </section>;
}
