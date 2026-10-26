import React,{useEffect,useRef,useState} from 'react';
import { NodeInfo } from '../../types';
import { fieldKey,fieldLabel } from '../../services/workbenchFields';

export default function TextFieldDialog({title,nodes,onClose,onSave,initialKey}:{title:string;nodes:NodeInfo[];onClose:()=>void;onSave?:(node:NodeInfo,value:string)=>void;initialKey?:string}){
  const [key,setKey]=useState(initialKey||fieldKey(nodes[0])),[value,setValue]=useState(()=>(nodes.find(n=>fieldKey(n)===(initialKey||fieldKey(nodes[0])))||nodes[0]).fieldValue),[message,setMessage]=useState('');
  const node=nodes.find(n=>fieldKey(n)===key)||nodes[0],surface=useRef<HTMLElement>(null),input=useRef<HTMLTextAreaElement>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{previous.current=document.activeElement as HTMLElement;input.current?.focus({preventScroll:true});return()=>previous.current?.focus();},[]);
  useEffect(()=>{setValue(node.fieldValue);setMessage('');},[key]);
  return <div className="text-dialog-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget)onClose();}}><section ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title+' · 提示词全文'} className="text-field-dialog" onKeyDown={e=>{if(e.key==='Escape')onClose();}}>
    <header><strong>{title}</strong><button onClick={onClose} aria-label="关闭文字预览">关闭</button></header>
    <nav>{nodes.map(n=><button key={fieldKey(n)}  aria-pressed={fieldKey(n)===key} onClick={()=>setKey(fieldKey(n))}>{fieldLabel(n)}</button>)}</nav>
    <textarea ref={input} aria-label="提示词全文" readOnly={!onSave} value={value} onChange={e=>{const next=e.target.value;setValue(next);onSave?.(node,next);setMessage('已更新配置');}}/>
    <footer><span>{value.length} 字符 {message}</span><button onClick={()=>void navigator.clipboard.writeText(value).then(()=>setMessage('已复制')).catch(()=>setMessage('复制失败，请选中文字手动复制'))}>复制全文</button></footer>
  </section></div>;
}
