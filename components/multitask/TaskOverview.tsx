import {queueDescription} from '../../services/productionPresentation';
import React,{useEffect,useState} from 'react';
import { MultiTaskCardData } from './MultiTaskCard';
import { StepEditorSnapshot } from '../StepEditor';
import { ATTEMPT_LABELS,ProductionAttempt,attemptNumber,cancellationPending,isCancellableAttempt } from '../../services/production';
import { fieldKey,fieldLabel,isMediaField,isTextField,pendingKey,schemaKey,taskConfigurationDigest,defaultPinnedFields,hasFieldValue } from '../../services/workbenchFields';
import { useFieldTokens,fileRevision } from './useFieldTokens';
import TextFieldDialog from './TextFieldDialog';
import { settingsStorage } from '../../services/localPersistence';
import {Trash2} from 'lucide-react';
import FieldInput from './FieldInput';
import RunLog from './RunLog';
import MediaField from './MediaField';

export const taskState=(card:MultiTaskCardData,attempt?:ProductionAttempt)=>cancellationPending(attempt)?'cancelling':attempt&&isCancellableAttempt(attempt)?attempt.status:['queued','running'].includes(card.run.status)?card.run.status:attempt?.status||card.run.status;
export const taskStatus=(card:MultiTaskCardData,attempt?:ProductionAttempt)=>{
  const state=taskState(card,attempt);
  return state==='cancelling'?'取消确认中':state==='running'?'运行中':state==='queued'?(attempt?.status==='queued'?'排队中 · '+queueDescription(attempt):'等待账号空位'):state==='cancelled'?'已取消':ATTEMPT_LABELS[state as keyof typeof ATTEMPT_LABELS]||'待运行';
};
interface Props {editing:boolean;card:MultiTaskCardData;snapshot:StepEditorSnapshot;attempt?:ProductionAttempt;appName:string;ordinal:number;busy:boolean;selected:boolean;onSelect:(selected:boolean)=>void;onName:(name:string)=>void;onRun:()=>void;onStop:()=>void;onEdit:()=>void;onDuplicate:()=>void;onRemove:()=>void;onPreview:()=>void;onChange:(node:any,value:string,file?:File|null)=>void;onPlus:()=>void;}
const TaskOverview:React.FC<Props>=({editing,card,snapshot,attempt,appName,ordinal,busy,selected,onSelect,onName,onRun,onStop,onEdit,onDuplicate,onRemove,onPreview,onChange,onPlus})=>{
  const [text,setText]=useState(false);
  const latestComparable=attempt&&snapshot.batchList.length===0&&schemaKey(card.webappId,snapshot.nodes)===schemaKey(attempt.webappId,attempt.originalNodes);
  const tokenItems=[{id:card.id,nodes:snapshot.nodes,files:snapshot.pendingFiles},...(latestComparable?[{id:'latest',nodes:attempt!.originalNodes,files:attempt!.pendingFiles}]:[])];
  const {tokens,ready}=useFieldTokens(tokenItems);
  const revision=JSON.stringify([snapshot.nodes,snapshot.batchList,fileRevision(snapshot.pendingFiles),snapshot.instanceType,card.runOptions]);
  const [digest,setDigest]=useState({revision:'',value:''});
  useEffect(()=>{if(!attempt?.sourceDigest)return;let active=true;void taskConfigurationDigest({...snapshot,runOptions:card.runOptions},card.loadedAppId||card.webappId).then(value=>{if(active)setDigest({revision,value});}).catch(()=>{});return()=>{active=false;};},[revision,attempt?.sourceDigest]);
  const modified=attempt?.sourceDigest?digest.revision===revision&&digest.value!==attempt.sourceDigest:latestComparable&&ready&&(snapshot.nodes.some(n=>tokens[card.id]?.[fieldKey(n)]!==tokens.latest?.[fieldKey(n)])||snapshot.instanceType!==attempt.instanceType||card.runOptions?.retainSeconds!==attempt.runOptions?.retainSeconds);
  const media=snapshot.nodes.filter(isMediaField),filled=media.filter(n=>snapshot.pendingFiles[pendingKey(n)]||hasFieldValue(n.fieldValue)),textNodes=snapshot.nodes.filter(isTextField);
  let pins:string[];try{pins=JSON.parse(settingsStorage.getItem('rh_editor_pins_'+(card.loadedAppId||card.webappId))||'null')||defaultPinnedFields(snapshot.nodes);}catch{pins=defaultPinnedFields(snapshot.nodes);}
  const previewMedia=[...filled,...media.filter(node=>!filled.includes(node))].slice(0,3).sort((a,b)=>media.indexOf(a)-media.indexOf(b));
  const short=snapshot.nodes.filter(n=>pins.includes(fieldKey(n))).slice(0,5);
  return <article className="task-overview">
    <header><input type="checkbox" aria-label={'选择总览任务 '+(card.name||card.webappId)} checked={selected} onChange={e=>onSelect(e.target.checked)}/><span className="task-ordinal" aria-label="当前任务顺序">{ordinal}.</span><input aria-label={'总览任务名称 '+card.id} disabled={busy} value={card.name||''} onChange={e=>onName(e.target.value)}/><span className="overview-state" data-status={taskState(card,attempt)}>{taskStatus(card,attempt)}</span></header>
    <strong className="overview-app" title={card.webAppInfo?.webappName||card.webappId}>{appName}</strong>
    <div className="overview-parameters">{short.map(node=><label key={fieldKey(node)} title={fieldLabel(node)}><span>{fieldLabel(node)}</span><FieldInput node={node} label={'总览参数 '+ordinal+' '+fieldLabel(node)} disabled={busy} onChange={value=>onChange(node,value)}/></label>)}{snapshot.batchList.length>0&&<span>批量 <b>{snapshot.batchList.length} 组</b></span>}</div>
    <div className="overview-media">{previewMedia.map(node=><MediaField key={fieldKey(node)} label={fieldLabel(node)} type={node.fieldType} file={snapshot.pendingFiles[pendingKey(node)]} value={node.fieldValue} disabled={busy} onFile={file=>onChange(node,file.name,file)} onClear={()=>onChange(node,'',null)}/>)}{media.length>3&&<button className="overview-all-media" onClick={onEdit}>全部素材 · {media.length}</button>}</div>
    <div className="overview-result">{modified?<span className="key-data">已修改，待生成</span>:attempt?<span>最近 #{attemptNumber(attempt)}</span>:<span/>}{attempt?.outputs.length>0&&<button onClick={onPreview}>结果预览</button>}</div>
    <footer><div className="task-run-actions"><button className="run-task" disabled={busy||!card.isConnected||snapshot.hasUploadingFiles} onClick={onRun}>运行</button><button className="plus-toggle" aria-label={'PLUS 任务 '+ordinal} aria-pressed={snapshot.instanceType==='plus'} disabled={busy} onClick={onPlus} title="PLUS 实例，可能消耗更多积分">PLUS</button><button className="stop-task" disabled={!busy||cancellationPending(attempt)} onClick={onStop}>{cancellationPending(attempt)?'取消中':'取消'}</button></div><div className="task-edit-actions"><button onClick={onEdit} aria-expanded={editing}>{editing?'收起编辑':'编辑'}</button>{textNodes.length>0&&<button onClick={()=>setText(true)}>提示词</button>}<button onClick={onDuplicate}>复制</button><button className="overview-delete" disabled={busy} onClick={onRemove} title="删除任务配置" aria-label={'删除总览任务 '+ordinal}><Trash2 size={13}/></button></div></footer>
    {(busy||card.run.logs.length>0)&&<details className="overview-log" open={busy||undefined}><summary>日志</summary>{attempt?.accountNote&&<div className="key-data overview-log-account" title={attempt.accountNote}>{attempt.accountNote}</div>}<RunLog entries={card.run.logs.slice(-5)}/></details>}
    {text&&<TextFieldDialog title={card.name||'任务'} nodes={textNodes} onClose={()=>setText(false)} onSave={busy?undefined:onChange}/>}
  </article>;
};
export default TaskOverview;
