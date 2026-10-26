import React,{useEffect,useRef,useState} from 'react';
import { NodeInfo } from '../../types';
import { fieldKey,fieldLabel } from '../../services/workbenchFields';

export default function TextFieldDialog({title,nodes,onClose,onSave,initialKey}:{title:string;nodes:NodeInfo[];onClose:()=>void;onSave?:(node:NodeInfo,value:string)=>void;initialKey?:string}){
  const [key,setKey]=useState(initialKey||fieldKey(nodes[0])),[value,setValue]=useState(()=>(nodes.find(n=>fieldKey(n)===(initialKey||fieldKey(nodes[0])))||nodes[0]).fieldValue),[editing,setEditing]=useState(false),[message,setMessage]=useState('');
  const node=nodes.find(n=>fieldKey(n)===key)||nodes[0],surface=useRef<HTMLElement>(null),previous=useRef<HTMLElement|null>(null);
  useEffect(()=>{previous.current=document.activeElement as HTMLElement;surface.current?.focus();return()=>previous.current?.focus();},[]);
  useEffect(()=>{setValue(node.fieldValue);setEditing(false);setMessage('');},[key]);
  return <div className="text-dialog-backdrop" onPointerDown={e=>{if(e.target===e.currentTarget&&!editing)onClose();}}><section ref={surface} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title+' · 提示词全文'} className="text-field-dialog" onKeyDown={e=>{if(e.key==='Escape'&&!editing)onClose();}}>
    <header><strong>{title}</strong><button disabled={editing} onClick={onClose} aria-label="关闭文字预览">关闭</button></header>
    <nav>{nodes.map(n=><button key={fieldKey(n)} disabled={editing} aria-pressed={fieldKey(n)===key} onClick={()=>setKey(fieldKey(n))}>{fieldLabel(n)}</button>)}</nav>
    <textarea aria-label={editing?'编辑全文':'提示词全文'} readOnly={!editing} value={value} onChange={e=>setValue(e.target.value)}/>
    <footer><span>{value.length} 字符 {message}</span>{editing?<><button onClick={()=>{setValue(node.fieldValue);setEditing(false);}}>取消修改</button><button onClick={()=>{onSave?.(node,value);setEditing(false);setMessage('已应用');}}>应用修改</button></>:<>{onSave&&<button onClick={()=>setEditing(true)}>编辑全文</button>}<button onClick={()=>void navigator.clipboard.writeText(value).then(()=>setMessage('已复制')).catch(()=>setMessage('复制失败，请选中文字手动复制'))}>复制全文</button></>}</footer>
  </section></div>;
}
