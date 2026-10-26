import React,{useEffect,useRef,useState} from 'react';
import { Maximize2,FolderOpen,X } from 'lucide-react';
import { ProductionAttempt,attemptNumber } from '../../services/production';
import { localRequest,localSession,settingsStorage } from '../../services/localPersistence';
import { resultMediaKind,resultMediaUrl } from '../../services/resultPreview';

export default function ResultPreview({attempt,attempts,taskId,taskName,open,onToggle,onSelect}:{attempt?:ProductionAttempt;attempts:ProductionAttempt[];taskId?:string;taskName?:string;open:boolean;onToggle:()=>void;onSelect:(attempt:ProductionAttempt)=>void}){
  const [index,setIndex]=useState(0),[error,setError]=useState(''),[revealing,setRevealing]=useState(false),[position,setPosition]=useState<{x:number;y:number}|null>(null);
  const [height,setHeight]=useState(()=>Math.max(300,Math.min(700,Number(settingsStorage.getItem('rh_result_preview_height_v2'))||480)));
  const currentAttempt=useRef(attempt?.id),currentTask=useRef(taskId);currentAttempt.current=attempt?.id;currentTask.current=taskId;
  const surface=useRef<HTMLDivElement>(null),move=useRef<{x:number;y:number;left:number;top:number}|null>(null),resize=useRef<{y:number;height:number}|null>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{settingsStorage.setItem('rh_result_preview_height_v2',String(height));},[height]);
  useEffect(()=>{setIndex(0);setError('');},[attempt?.id,taskId]);
  useEffect(()=>{if(open){previous.current=document.activeElement as HTMLElement;surface.current?.focus();}return()=>{if(!open)return;const record=[...document.querySelectorAll<HTMLElement>('.production-record')].find(el=>el.dataset.attemptId===currentAttempt.current);const target=record?.querySelector<HTMLElement>('.record-summary');if(target)target.focus();else if(previous.current?.closest('[data-task-id]')?.getAttribute('data-task-id')===currentTask.current)previous.current?.focus();};},[open]);
  useEffect(()=>{const clamp=()=>setPosition(point=>{if(!point||!surface.current)return point;const rect=surface.current.getBoundingClientRect(),x=Math.max(0,Math.min(innerWidth-rect.width,point.x)),y=Math.max(0,Math.min(innerHeight-rect.height,point.y));return x===point.x&&y===point.y?point:{x,y};});window.addEventListener('resize',clamp);clamp();return()=>window.removeEventListener('resize',clamp);},[height,open]);
  if(!open)return null;
  const output=attempt?.outputs[index],url=attempt?resultMediaUrl(attempt,index,!!localSession()):'',kind=output?resultMediaKind(output):'file';
  const available=attempt?.files.find(file=>file.index===index&&!attempt.missingResultIndexes?.includes(index));
  return <section ref={surface} tabIndex={-1} role="dialog" aria-label="生成结果预览" className="result-preview floating-result-preview" style={{height,...(position?{left:position.x,top:position.y,transform:'none'}:{})}} data-task-id={taskId} data-task-focused={!!taskId} data-attempt-id={attempt?.id} onKeyDown={e=>{if(e.key==='Escape')onToggle();}}>
    <header className="preview-header" onPointerDown={e=>{if((e.target as HTMLElement).closest('button,select,input'))return;const rect=surface.current!.getBoundingClientRect();move.current={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(move.current)setPosition({x:Math.max(0,Math.min(innerWidth-(surface.current?.getBoundingClientRect().width||140),move.current.left+e.clientX-move.current.x)),y:Math.max(0,Math.min(innerHeight-(surface.current?.getBoundingClientRect().height||60),move.current.top+e.clientY-move.current.y))});}} onPointerUp={()=>{move.current=null;}} onPointerCancel={()=>{move.current=null;}}>
      <strong>结果预览</strong><span className="truncate">{taskName||attempt?.name||'当前任务'}</span>
      {attempts.length>0&&<select aria-label="预览生成记录" value={attempt?.id||''} onChange={e=>{const next=attempts.find(a=>a.id===e.target.value);if(next)onSelect(next);}}>{attempts.map(a=><option key={a.id} value={a.id}>#{attemptNumber(a)}{(a.sequenceBatch||1)>1?' B'+String(a.sequenceBatch).padStart(2,'0'):''} · {a.name}</option>)}</select>}
      <span className="ml-auto">{output?index+1:0}/{attempt?.outputs.length||0}</span>
      {available&&<button aria-label="定位预览文件" disabled={revealing} title={revealing?"正在打开文件夹…":"打开文件所在目录"} onClick={()=>{setRevealing(true);void localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:available.path})}).catch(e=>setError(e.message)).finally(()=>setRevealing(false));}}><FolderOpen size={15}/></button>}
      <button aria-label="放大结果预览" title="全屏" onClick={()=>void surface.current?.requestFullscreen().catch(()=>setError('暂时无法全屏，请使用播放器的放大按钮。'))}><Maximize2 size={15}/></button>
      <button aria-label="关闭结果预览" title="关闭" onClick={onToggle}><X size={17}/></button>
    </header>
    {error&&<p role="alert" className="px-3 py-1 text-xs text-amber-500">{error}</p>}
    {output?<div className="preview-body">
      {attempt!.outputs.length>1&&<nav className="preview-files" aria-label="选择结果文件">{attempt!.outputs.map((item,i)=><button key={i} aria-label={'预览结果 '+(i+1)} aria-pressed={index===i} onClick={()=>{setIndex(i);setError('');}}>{resultMediaKind(item)==='image'?<img alt={'结果 '+(i+1)} src={resultMediaUrl(attempt!,i,!!localSession())}/>:<span>{resultMediaKind(item)==='video'?'视频':resultMediaKind(item)==='audio'?'音频':'文件'} {i+1}</span>}</button>)}</nav>}
      <div className="preview-player" key={attempt!.id+':'+index+':'+url}>{!url?<p>暂无结果链接</p>:kind==='video'?<video controls playsInline preload="metadata" src={url} onError={()=>setError('视频暂时无法播放，可补存结果或打开原文件。')}/>:kind==='image'?<img alt={'生成结果 '+(index+1)} src={url} onError={()=>setError('图片无法读取，请检查结果文件。')}/>:kind==='audio'?<audio controls preload="metadata" src={url} onError={()=>setError('音频无法播放，请检查结果文件。')}/>:<a href={url} target="_blank" rel="noreferrer">打开结果文件</a>}</div>
    </div>:<p className="p-4 text-sm">该任务暂无可预览结果。</p>}
    <div role="separator" aria-label="调整预览高度" aria-orientation="horizontal" tabIndex={0} className="preview-resizer" onKeyDown={e=>{if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();setHeight(h=>Math.max(300,Math.min(700,h+(e.key==='ArrowUp'?20:-20))));}}} onPointerDown={e=>{resize.current={y:e.clientY,height};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(resize.current)setHeight(Math.max(300,Math.min(700,resize.current.height+e.clientY-resize.current.y)));}} onPointerUp={()=>{resize.current=null;}} onPointerCancel={()=>{resize.current=null;}}/>
  </section>;
}
