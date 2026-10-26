import React,{useEffect,useId,useRef,useState} from 'react';
import { pastedMedia,hasFieldValue } from '../../services/workbenchFields';

interface MediaFieldProps {compact?:boolean;id?:string;label:string;type:string;file?:File;value?:string;remoteUrl?:string;disabled?:boolean;uploading?:boolean;error?:string;onFile:(file:File)=>void;onClear:()=>void;}
const MediaField:React.FC<MediaFieldProps>=({compact=false,id:fieldId,label,type,file,value:providedValue,remoteUrl,disabled=false,uploading=false,error,onFile,onClear})=>{
  const [url,setUrl]=useState(''),[message,setMessage]=useState(''),[problem,setProblem]=useState(''),[broken,setBroken]=useState(false);
  const field=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null),id=useId();
  useEffect(()=>{if(!file){setUrl('');return;}const next=URL.createObjectURL(file);setUrl(next);return()=>URL.revokeObjectURL(next);},[file]);
  const accept=(next:File,pasted=false)=>{const result=pastedMedia({files:[next] as unknown as FileList,items:[] as unknown as DataTransferItemList},type);if(result.error){setProblem(result.error);return;}setProblem('');setMessage(pasted?'已粘贴，素材已替换':'素材已更新');onFile(next);};
  const value=hasFieldValue(providedValue||'')?providedValue:'',src=url||remoteUrl,kind=type.toLowerCase();
  useEffect(()=>{setBroken(false);},[src]);
  return <div id={fieldId} ref={field} tabIndex={disabled?-1:0} role="group" aria-label={label+'素材框'} aria-disabled={disabled} className={compact?"media-field media-compact":"media-field"} onPointerDown={e=>{if(!(e.target as HTMLElement).closest('button,input,a,video,audio'))field.current?.focus();}}
    onPaste={e=>{if((e.target as HTMLElement).closest('input,textarea,[contenteditable=true]'))return;if(disabled)return;e.preventDefault();e.stopPropagation();const result=pastedMedia(e.clipboardData,type);if(result.file)accept(result.file,true);else{setMessage('');setProblem(result.error||'无法读取剪贴板文件');}}}
    onDragOver={e=>{e.preventDefault();}} onDrop={e=>{e.preventDefault();if(!disabled){field.current?.focus();const result=pastedMedia(e.dataTransfer,type);if(result.file)accept(result.file);else setProblem(result.error||'无法读取文件');}}}>
    <header><strong>{label}</strong><span>{uploading?'上传中…':file?'本地原件':value?'已有素材':'未添加'}</span></header>
    <div className="media-field-preview">{src&&!broken&&kind==='image'?<img onError={()=>setBroken(true)} src={src} alt={label+'预览'}/>:src&&!broken&&kind==='video'?<video onError={()=>setBroken(true)} src={src} controls preload="metadata"/>:src&&!broken&&kind==='audio'?<audio onError={()=>setBroken(true)} src={src} controls preload="metadata"/>:<span>{broken?'预览不可用，可选择原件或替换素材':value||'点击此框后粘贴，或拖入文件'}</span>}</div>
    <footer><span title={file?.name||value}>{file?.name||value||'支持 Ctrl+V'}</span>{src&&<button className="media-enlarge" type="button" onClick={()=>void field.current?.requestFullscreen()}>放大</button>}<button type="button" disabled={disabled} onClick={()=>input.current?.click()}>{file||value?'替换':'选择文件'}</button>{(file||value)&&<button type="button" disabled={disabled} onClick={()=>{onClear();setMessage('');setProblem('');}}>清除</button>}</footer>
    <input ref={input} id={id} aria-label={label+'素材文件'} type="file" accept={type==='FILE'?undefined:kind+'/*'} hidden disabled={disabled} onChange={e=>{if(e.target.files?.[0])accept(e.target.files[0]);e.target.value='';}}/>
    {(problem||error)?<p role="alert" className="media-message text-amber-500">{problem||error}</p>:message&&<p role="status" className="media-message text-brand-500">{message}</p>}
  </div>;
};
export default MediaField;
