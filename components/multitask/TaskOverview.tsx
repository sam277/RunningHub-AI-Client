import React,{useEffect,useState} from 'react';
import { MultiTaskCardData } from './MultiTaskCard';
import { StepEditorSnapshot } from '../StepEditor';
import { ATTEMPT_LABELS,ProductionAttempt,attemptNumber } from '../../services/production';
import { fieldKey,fieldLabel,isMediaField,isTextField,pendingKey,schemaKey,taskConfigurationDigest,defaultPinnedFields,hasFieldValue } from '../../services/workbenchFields';
import { useFieldTokens,fileRevision } from './useFieldTokens';
import TextFieldDialog from './TextFieldDialog';
import { settingsStorage } from '../../services/localPersistence';
import MediaField from './MediaField';

export const taskStatus=(card:MultiTaskCardData,attempt?:ProductionAttempt)=>['queued','running'].includes(card.run.status)?card.run.status==='running'?'运行中':'排队中':attempt?ATTEMPT_LABELS[attempt.status]:card.run.status==='cancelled'?'已停止后续':'待运行';
interface Props {card:MultiTaskCardData;snapshot:StepEditorSnapshot;baseline?:{card:MultiTaskCardData;snapshot:StepEditorSnapshot};attempt?:ProductionAttempt;appName:string;ordinal:number;busy:boolean;selected:boolean;onSelect:(selected:boolean)=>void;onName:(name:string)=>void;onRun:()=>void;onStop:()=>void;onEdit:()=>void;onDuplicate:()=>void;onRemove:()=>void;onPreview:()=>void;onChange:(node:any,value:string)=>void;}
const TaskOverview:React.FC<Props>=({card,snapshot,baseline,attempt,appName,ordinal,busy,selected,onSelect,onName,onRun,onStop,onEdit,onDuplicate,onRemove,onPreview,onChange})=>{
  const [text,setText]=useState(false);
  const latestComparable=attempt&&snapshot.batchList.length===0&&schemaKey(card.webappId,snapshot.nodes)===schemaKey(attempt.webappId,attempt.originalNodes);
  const tokenItems=[{id:card.id,nodes:snapshot.nodes,files:snapshot.pendingFiles},...(baseline&&baseline.card.id!==card.id?[{id:baseline.card.id,nodes:baseline.snapshot.nodes,files:baseline.snapshot.pendingFiles}]:[]),...(latestComparable?[{id:'latest',nodes:attempt!.originalNodes,files:attempt!.pendingFiles}]:[])];
  const {tokens,ready}=useFieldTokens(tokenItems);
  const differences=baseline&&ready?snapshot.nodes.filter(n=>tokens[card.id]?.[fieldKey(n)]!==tokens[baseline.card.id]?.[fieldKey(n)]):[];
  const revision=JSON.stringify([snapshot.nodes,snapshot.batchList,fileRevision(snapshot.pendingFiles),snapshot.instanceType,card.runOptions]);
  const [digest,setDigest]=useState({revision:'',value:''});
  useEffect(()=>{if(!attempt?.sourceDigest)return;let active=true;void taskConfigurationDigest({...snapshot,runOptions:card.runOptions},card.loadedAppId||card.webappId).then(value=>{if(active)setDigest({revision,value});}).catch(()=>{});return()=>{active=false;};},[revision,attempt?.sourceDigest]);
  const modified=attempt?.sourceDigest?digest.revision===revision&&digest.value!==attempt.sourceDigest:latestComparable&&ready&&(snapshot.nodes.some(n=>tokens[card.id]?.[fieldKey(n)]!==tokens.latest?.[fieldKey(n)])||snapshot.instanceType!==attempt.instanceType||card.runOptions?.retainSeconds!==attempt.runOptions?.retainSeconds);
  const media=snapshot.nodes.filter(isMediaField),filled=media.filter(n=>snapshot.pendingFiles[pendingKey(n)]||hasFieldValue(n.fieldValue)),textNodes=snapshot.nodes.filter(isTextField);
  let pins:string[];try{pins=JSON.parse(settingsStorage.getItem('rh_editor_pins_'+(card.loadedAppId||card.webappId))||'null')||defaultPinnedFields(snapshot.nodes);}catch{pins=defaultPinnedFields(snapshot.nodes);}
  const short=snapshot.nodes.filter(n=>pins.includes(fieldKey(n))).slice(0,5);
  return <article className="task-overview">
    <header><input type="checkbox" aria-label={'选择总览任务 '+(card.name||card.webappId)} checked={selected} onChange={e=>onSelect(e.target.checked)}/><span className="task-ordinal" aria-label="当前任务顺序">{ordinal}.</span><input aria-label={'总览任务名称 '+card.id} disabled={busy} value={card.name||''} onChange={e=>onName(e.target.value)}/><span className="overview-state" data-status={attempt?.status||card.run.status}>{taskStatus(card,attempt)}</span></header>
    <strong className="overview-app" title={card.webAppInfo?.webappName||card.webappId}>{appName}</strong>
    <div className="overview-parameters">{short.map(node=><span key={fieldKey(node)} title={fieldLabel(node)}>{fieldLabel(node)} <b>{node.fieldValue||'未设'}</b></span>)}{snapshot.batchList.length>0&&<span>批量 <b>{snapshot.batchList.length} 组</b></span>}</div>
    <div className="overview-media">{filled.slice(0,3).map(node=><MediaField key={fieldKey(node)} label={fieldLabel(node)} type={node.fieldType} file={snapshot.pendingFiles[pendingKey(node)]} value={node.fieldValue} disabled onFile={()=>{}} onClear={()=>{}}/>)}{filled.length>3&&<button onClick={onEdit}>另有 {filled.length-3} 项素材</button>}{filled.length===0&&<span className="text-xs text-slate-500">未添加参考素材</span>}</div>
    <p className="overview-differences">{!ready?'正在核对素材…':baseline?.card.id===card.id?'当前基准任务':baseline?differences.length?'差异：'+differences.map(fieldLabel).join('、'):'与基准参数相同':'可在批量对照中指定基准'}</p>
    <div className="overview-result">{modified?<span className="key-data">已修改，待生成</span>:attempt?<span>最近 #{attemptNumber(attempt)}</span>:<span>尚未生成</span>}{attempt?.outputs.length>0&&<button onClick={onPreview}>结果预览</button>}</div>
    <footer>{busy?<button className="stop-task" onClick={onStop}>停止后续</button>:<button className="run-task" disabled={!card.isConnected||snapshot.hasUploadingFiles} onClick={onRun}>运行</button>}<button onClick={onEdit}>编辑</button>{textNodes.length>0&&<button onClick={()=>setText(true)}>提示词</button>}<button onClick={onDuplicate}>复制</button><button disabled={busy} onClick={onRemove} aria-label={'删除总览任务 '+ordinal}>删除</button></footer>
    {text&&<TextFieldDialog title={card.name||'任务'} nodes={textNodes} onClose={()=>setText(false)} onSave={busy?undefined:onChange}/>}
  </article>;
};
export default TaskOverview;
