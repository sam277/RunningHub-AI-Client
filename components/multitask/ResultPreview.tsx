import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Maximize2, FolderOpen } from 'lucide-react';
import { ProductionAttempt, attemptNumber } from '../../services/production';
import { localRequest, localSession, settingsStorage } from '../../services/localPersistence';
import { resultMediaKind, resultMediaUrl } from '../../services/resultPreview';

export default function ResultPreview({attempt,attempts,taskId,taskName,open,onToggle,onSelect}:{attempt?:ProductionAttempt;attempts:ProductionAttempt[];taskId?:string;taskName?:string;open:boolean;onToggle:()=>void;onSelect:(attempt:ProductionAttempt)=>void}){
  const [index,setIndex]=useState(0),[error,setError]=useState('');const surface=useRef<HTMLDivElement>(null),drag=useRef<{y:number;height:number}|null>(null);
  const [height,setHeight]=useState(()=>Math.max(150,Math.min(500,Number(settingsStorage.getItem('rh_result_preview_height'))||220)));
  useEffect(()=>{settingsStorage.setItem('rh_result_preview_height',String(height));},[height]);
  useEffect(()=>{setIndex(0);setError('');},[attempt?.id,taskId]);
  const output=attempt?.outputs[index],url=attempt?resultMediaUrl(attempt,index,!!localSession()):'',kind=output?resultMediaKind(output):'file';
  const available=attempt?.files.find(file=>file.index===index&&!attempt.missingResultIndexes?.includes(index));
  return <section ref={surface} className={'result-preview '+(open&&output?'preview-expanded':'')} style={{'--result-preview-height':height+'px'} as React.CSSProperties} aria-label="生成结果预览" data-task-id={taskId} data-task-focused={!!taskId} data-attempt-id={attempt?.id}>
    {open&&output&&<div role="separator" aria-label="调整预览高度" aria-orientation="horizontal" tabIndex={0} className="preview-resizer" onDoubleClick={()=>setHeight(220)} onKeyDown={e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setHeight(value=>Math.max(150,Math.min(500,value+(e.key==='ArrowUp'?20:-20))));}}} onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drag.current={y:e.clientY,height};}} onPointerMove={e=>{if(drag.current)setHeight(Math.max(150,Math.min(500,drag.current.height+drag.current.y-e.clientY)));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>}
    <header className="preview-header"><button onClick={onToggle} className="flex min-w-0 items-center gap-1" aria-expanded={open}>{open?<ChevronDown size={14}/>:<ChevronUp size={14}/>}<strong>结果预览</strong><span className="truncate text-slate-500">{taskName||attempt?.name||'当前任务'}</span></button>
      {attempts.length>0&&<select aria-label="预览生成记录" value={attempt?.id||''} onChange={e=>{const item=attempts.find(a=>a.id===e.target.value);if(item)onSelect(item);}} className="preview-record-picker"><option value="" disabled>选择一次生成</option>{attempts.map(a=><option key={a.id} value={a.id}>#{attemptNumber(a)}{(a.sequenceBatch||1)>1?' B'+String(a.sequenceBatch).padStart(2,'0'):''} · {a.name}{!a.outputs.length?' · 尚无结果':''}</option>)}</select>}
      {output&&<><span className="ml-auto shrink-0 text-slate-500">{index+1}/{attempt!.outputs.length}</span>{available&&<button title="在文件夹中选中结果" aria-label="定位预览文件" onClick={()=>void localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:available.path})}).catch(e=>setError(e.message))}><FolderOpen size={15}/></button>}<button title="放大预览" aria-label="放大结果预览" onClick={()=>void surface.current?.requestFullscreen().catch(()=>setError('请使用播放器自带的全屏按钮。'))}><Maximize2 size={15}/></button></>}
    </header>
    {open&&<>{error&&<p role="alert" className="px-3 py-1 text-xs text-amber-600">{error}</p>}{output?<div className="preview-body">
      {attempt!.outputs.length>1&&<nav className="preview-files" aria-label="选择结果文件">{attempt!.outputs.map((item,i)=><button key={i} aria-label={'预览结果 '+(i+1)} aria-pressed={index===i} className={index===i?'active-preview-file':''} onClick={()=>{setIndex(i);setError('');}}>{resultMediaKind(item)==='image'?<img alt={'结果 '+(i+1)} loading="lazy" src={resultMediaUrl(attempt!,i,!!localSession())}/>:<span>{resultMediaKind(item)==='video'?'视频':resultMediaKind(item)==='audio'?'音频':'文件'} {i+1}</span>}</button>)}</nav>}
      <div className="preview-player" key={attempt!.id+':'+index+':'+url}>{!url?<p>结果链接尚未返回</p>:kind==='video'?<video controls playsInline preload="metadata" src={url} onError={()=>setError('视频暂时无法播放；可尝试补存结果或打开原文件。')}/>:kind==='image'?<img alt={'生成结果 '+(index+1)} src={url} onError={()=>setError('图片暂时无法读取，请检查本地文件或结果链接。')}/>:kind==='audio'?<audio controls preload="metadata" src={url} onError={()=>setError('音频暂时无法播放，请检查结果文件。')}/>:<a href={url} target="_blank" rel="noreferrer">打开结果文件</a>}</div>
    </div>:<p className="px-3 py-2 text-xs text-slate-500">{attempt?'这次生成尚无可预览结果':'该任务暂无生成结果。完成后会显示在这里。'}</p>}</>}
  </section>;
}
