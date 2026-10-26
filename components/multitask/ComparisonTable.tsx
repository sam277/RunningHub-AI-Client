import React,{useState,useRef,useLayoutEffect,useEffect} from 'react';
import { NodeInfo } from '../../types';
import { StepEditorSnapshot } from '../StepEditor';
import { MultiTaskCardData } from './MultiTaskCard';
import { fieldKey,fieldLabel,fieldType,isMediaField,isTextField,schemaKey,pendingKey,defaultPinnedFields,preferenceGroup } from '../../services/workbenchFields';
import { settingsStorage } from '../../services/localPersistence';
import FieldInput from './FieldInput';
import MediaField from './MediaField';
import TextFieldDialog from './TextFieldDialog';

export interface ComparisonItem {card:MultiTaskCardData;snapshot:StepEditorSnapshot;ordinal:number;busy:boolean;status:string;state:string;}
interface Props {items:ComparisonItem[];activeTaskId?:string;selection:Set<string>;onFocus:(id:string)=>void;onSelect:(id:string,selected:boolean)=>void;onName:(id:string,name:string)=>void;onChange:(id:string,node:NodeInfo,value:string,file?:File|null)=>void;onBulk:(source:string,ids:string[],node:NodeInfo)=>void;onEdit:(id:string)=>void;onDuplicate:(id:string)=>void;onDelete:(id:string)=>void;onRun:(id:string)=>void;onStop:(id:string)=>void;onPlus:(id:string)=>void;}
const ComparisonGroup:React.FC<Props&{viewportRef:(element:HTMLDivElement|null)=>void}>=props=>{
  const {items,onFocus,onChange,selection}=props,first=items[0],nodes=first.snapshot.nodes;
  const preference='rh_compare_columns_v2_'+preferenceGroup(first.card.loadedAppId||first.card.webappId,nodes);
  const [columns,setColumns]=useState<string[]>(()=>{try{return JSON.parse(settingsStorage.getItem(preference)||'null')||[...nodes.filter(isMediaField).map(fieldKey),...nodes.filter(isTextField).slice(0,1).map(fieldKey),...defaultPinnedFields(nodes).slice(0,4)];}catch{return nodes.slice(0,5).map(fieldKey);}});
  const [choose,setChoose]=useState(false),[text,setText]=useState<{id:string;key:string}|null>(null);
  const visible=nodes.filter(node=>columns.includes(fieldKey(node)));
  const toggle=(node:NodeInfo)=>setColumns(previous=>{const key=fieldKey(node),next=previous.includes(key)?previous.filter(k=>k!==key):[...previous,key];settingsStorage.setItem(preference,JSON.stringify(next));return next;});
  const textItem=items.find(item=>item.card.id===text?.id);
  return <section className="comparison-group" aria-label={'参数对照 '+(first.card.webAppInfo?.webappName||first.card.webappId)}>
    <header><strong>{first.card.webAppInfo?.webappName||first.card.webappId||'尚未加载应用'}</strong><span>{items.length} 个任务</span><button onClick={()=>setChoose(!choose)}>选择参数列</button></header>
    {choose&&<div className="comparison-columns">{nodes.map(node=><label key={fieldKey(node)}><input type="checkbox" checked={columns.includes(fieldKey(node))} onChange={()=>toggle(node)}/>{fieldLabel(node)}</label>)}</div>}
    <div className="comparison-scroll" ref={props.viewportRef}><table><thead><tr><th className="comparison-identity">任务 / 应用</th>{visible.map(node=><th key={fieldKey(node)}>{fieldLabel(node)}{node.required?' *':''}</th>)}<th>操作</th></tr></thead><tbody>{items.map(item=><tr key={item.card.id} data-task-id={item.card.id} data-task-focused={props.activeTaskId===item.card.id} onPointerDownCapture={()=>onFocus(item.card.id)} onFocusCapture={()=>onFocus(item.card.id)}>
      <td className="comparison-identity"><div><input aria-label={'选择对照任务 '+item.ordinal} type="checkbox" checked={selection.has(item.card.id)} onChange={e=>props.onSelect(item.card.id,e.target.checked)}/><span className="task-ordinal">{item.ordinal}.</span><input aria-label={'批量任务名称 '+item.ordinal} value={item.card.name||''} disabled={item.busy} onChange={e=>props.onName(item.card.id,e.target.value)}/></div><strong>{item.card.webAppInfo?.webappName||item.card.webappId}</strong><span className="comparison-status" data-status={item.state}>{item.status}</span>{item.snapshot.batchList.length>0&&<small className="block text-[10px] text-amber-500">批量 {item.snapshot.batchList.length} 组 · 改列将应用各组</small>}</td>
      {visible.map(column=>{const node=item.snapshot.nodes.find(n=>fieldKey(n)===fieldKey(column))!,key=fieldKey(node);return <td key={key}><div className="comparison-cell">{isMediaField(node)?<MediaField compact label={fieldLabel(node)+' · 任务'+item.ordinal} type={fieldType(node)} file={item.snapshot.pendingFiles[pendingKey(node)]} value={node.fieldValue} disabled={item.busy||item.snapshot.hasUploadingFiles} onFile={file=>onChange(item.card.id,node,file.name,file)} onClear={()=>onChange(item.card.id,node,'',null)}/>:isTextField(node)?<button aria-label={'对照文字参数 '+item.ordinal+' '+fieldLabel(node)} className="comparison-text-preview" onClick={()=>setText({id:item.card.id,key})}>{node.fieldValue?'查看 / 编辑全文':'填写文字'}<span>{node.fieldValue.length} 字符</span></button>:<FieldInput node={node} label={'对照参数 '+item.ordinal+' '+fieldLabel(node)} disabled={item.busy||item.snapshot.hasUploadingFiles} onChange={value=>onChange(item.card.id,node,value)}/>}<button className="apply-column" disabled={item.busy||item.snapshot.hasUploadingFiles||!items.some(other=>selection.has(other.card.id)&&other.card.id!==item.card.id&&!other.busy)} onClick={()=>props.onBulk(item.card.id,items.filter(other=>selection.has(other.card.id)&&other.card.id!==item.card.id&&!other.busy).map(other=>other.card.id),node)}>应用到所选</button></div></td>;})}
      <td><div className="comparison-actions"><button className="run-task" disabled={item.busy||!item.card.isConnected||item.snapshot.hasUploadingFiles} onClick={()=>props.onRun(item.card.id)}>运行</button><button className="plus-toggle" aria-label={'PLUS 任务 '+item.ordinal} aria-pressed={item.snapshot.instanceType==='plus'} disabled={item.busy} onClick={()=>props.onPlus(item.card.id)}>PLUS</button><button className="stop-task" disabled={!item.busy||item.state==='cancelling'} onClick={()=>props.onStop(item.card.id)}>{item.state==='cancelling'?'取消中':'取消'}</button><button onClick={()=>props.onEdit(item.card.id)}>编辑</button><button onClick={()=>props.onDuplicate(item.card.id)}>复制</button><button disabled={item.busy} aria-label={'删除对照任务 '+item.ordinal} onClick={()=>props.onDelete(item.card.id)}>删除</button></div></td>
    </tr>)}</tbody></table></div>
    {text&&textItem&&<TextFieldDialog title={textItem.card.name||'任务'} nodes={textItem.snapshot.nodes.filter(isTextField)} initialKey={text.key} onClose={()=>setText(null)} onSave={textItem.busy?undefined:(node,value)=>onChange(textItem.card.id,node,value)}/>}
  </section>;
};
export default function ComparisonTable(props:Props){
  const groups=new Map<string,ComparisonItem[]>();for(const item of props.items){const key=schemaKey(item.card.loadedAppId||item.card.webappId,item.snapshot.nodes);groups.set(key,[...(groups.get(key)||[]),item]);}
  const entries=[...groups],viewports=useRef(new Map<string,HTMLDivElement>()),sections=useRef(new Map<string,HTMLDivElement>());
  const [target,setTarget]=useState(''),[metrics,setMetrics]=useState({left:0,max:0});
  const current=groups.has(target)?target:entries[0]?.[0]||'';
  useEffect(()=>{const selected=entries.find(([,items])=>items.some(item=>item.card.id===props.activeTaskId));if(selected)setTarget(selected[0]);},[props.activeTaskId]);
  useLayoutEffect(()=>{
    const viewport=viewports.current.get(current),table=viewport?.querySelector('table');if(!viewport||!table)return;
    const update=()=>setMetrics({left:viewport.scrollLeft,max:Math.max(0,viewport.scrollWidth-viewport.clientWidth)});
    const observer=new ResizeObserver(update);observer.observe(viewport);observer.observe(table);viewport.addEventListener('scroll',update);update();
    return()=>{observer.disconnect();viewport.removeEventListener('scroll',update);};
  },[current,props.items.length]);
  const move=(left:number)=>{const viewport=viewports.current.get(current);if(viewport){viewport.scrollLeft=left;setMetrics(value=>({...value,left:viewport.scrollLeft}));}};
  return <div className="comparison-workspace" aria-label="批量对照编辑">
    <div className="comparison-scroll-tools comparison-toolbar" aria-label="固定参数横向导航">
      <label>应用组 <select aria-label="横向滚动的应用组" value={current} onChange={e=>{setTarget(e.target.value);sections.current.get(e.target.value)?.scrollIntoView({block:'start'});}}>{entries.map(([key,items])=><option key={key} value={key}>{items[0].card.webAppInfo?.webappName||items[0].card.webappId} · {items.length} 项</option>)}</select></label>
      <button aria-label="参数向左滚动" disabled={!metrics.max} onClick={()=>move(metrics.left-360)}>←</button>
      <input type="range" className="comparison-horizontal-scroll" aria-label="横向滚动参数" min={0} max={Math.max(1,metrics.max)} value={metrics.left} disabled={!metrics.max} onChange={e=>move(Number(e.target.value))}/>
      <button aria-label="参数向右滚动" disabled={!metrics.max} onClick={()=>move(metrics.left+360)}>→</button>
    </div>
    <div className="comparison-groups-scroll" onScroll={event=>{
      const area=event.currentTarget.getBoundingClientRect();let best=current,most=0;
      for(const [key,section] of sections.current){const rect=section.getBoundingClientRect(),visible=Math.max(0,Math.min(rect.bottom,area.bottom)-Math.max(rect.top,area.top));if(visible>most){most=visible;best=key;}}
      if(best!==current)setTarget(best);
    }}>
      {entries.map(([key,items])=><div key={key} ref={element=>{if(element)sections.current.set(key,element);else sections.current.delete(key);}} onPointerDownCapture={()=>setTarget(key)}><ComparisonGroup {...props} items={items} viewportRef={element=>{if(element)viewports.current.set(key,element);else viewports.current.delete(key);}}/></div>)}
    </div>
  </div>;
}
