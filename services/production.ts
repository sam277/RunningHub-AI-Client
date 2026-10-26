import { ApiKeyEntry, NodeInfo, PendingFilesMap, TaskOutput, WorkflowRunOptions } from '../types';
import { executeWorkflowTask, ExecuteTaskRequest, TaskExecutionError, TaskCancelledError, RemoteTaskCancelledError, TaskUsageStats, selectPendingFilesForTask, parseTaskUsage } from './taskExecutor';
import { cancelTask, getApiQueueStatus, isTaskNotFoundError, isCapacityLimitedError, queryTaskResult } from './api';
import { getResolvedRunningHubRegion } from './runningHubRegion';
import { saveFileFromUrl } from './autoSaveService';
import { listWorkspaceData, readWorkspaceData, writeWorkspaceData, patchWorkspaceFields, allocateGenerationNumber, listWorkspaceMetadata, readWorkspaceMetadata } from './workspaceStorage';
import { flushLocalSettings } from './localPersistence';

export type AttemptStatus = 'preparing' | 'submitting' | 'unknown' | 'queued' | 'running' | 'query_failed' | 'generation_failed' | 'rejected' | 'interrupted' | 'completed' | 'downloading' | 'download_failed' | 'saved' | 'cancelled';
export interface ProductionAttempt {
  queueInfo?:{queued?:number;running?:number;checkedAt:number};
  cancelRequestedAt?:number;
  cancelSentAt?:number|null;
  cancelAcceptedAt?:number;
  cancelError?:string|null;
  parentAttemptId?: string;
  sourceDigest?:string;
  sequence?: number;
  displaySequence?:number;
  sequenceBatch?:number;
  timings?:{submissionStartedAt?:number;acceptedAt?:number;runningObservedAt?:number;generationObservedAt?:number;failedAt?:number;archiveStartedAt?:number;archivedAt?:number};
  localResultsMissing?: boolean;
  missingResultIndexes?: number[];
  id: string; cardId: string; name: string; webappId: string; createdAt: number; updatedAt: number;
  accountId: string; accountNote: string; accountSignature?: string; region: string; status: AttemptStatus;
  originalNodes: NodeInfo[]; submittedNodes?: NodeInfo[]; pendingFiles: PendingFilesMap;
  instanceType: ExecuteTaskRequest['instanceType']; runOptions?: WorkflowRunOptions;
  usage?: TaskUsageStats;
  taskId?: string; outputs: TaskOutput[]; files: { index: number; filename: string; path: string }[];
  error?: string; decision?: 'adopted' | 'redo'; unitIndex: number;
}
export const ATTEMPT_LABELS: Record<AttemptStatus, string> = {
  preparing: '准备素材', submitting: '提交中', unknown: '提交待确认，禁止自动重发', queued: '排队中',
  running: '运行中', query_failed: '查询中断，可继续查询', generation_failed: '生成失败', rejected: '提交未接受',
  interrupted: '未提交，准备已中断', completed: '已生成 · 待保存', downloading: '保存中', download_failed: '已生成 · 保存失败', saved: '已完成', cancelled:'已取消',
};
const signature = async (key: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()))), n => n.toString(16).padStart(2,'0')).join('');
export const isCancellableAttempt = (attempt:ProductionAttempt) => ['preparing','submitting','unknown','queued','running','query_failed'].includes(attempt.status);
export const CANCELLATION_CONFIRM_MS=30000;
export const cancellationPending = (attempt?:ProductionAttempt) => !!attempt?.cancelRequestedAt && !!attempt && isCancellableAttempt(attempt) && attempt.status!=='unknown' && !attempt.cancelError && Date.now()-(attempt.cancelSentAt||attempt.cancelRequestedAt)<CANCELLATION_CONFIRM_MS;
export const expireCancellation=async(id:string)=>{
  const current=await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
  if(current?.cancelRequestedAt&&isCancellableAttempt(current)&&!current.cancelError&&Date.now()-(current.cancelSentAt||current.cancelRequestedAt)>=CANCELLATION_CONFIRM_MS){
    await patchCancellation(id,{cancelError:'平台暂未确认取消，请刷新状态或重试取消；当前任务不会自动重发。'});
  }
};
const queueChecks=new Map<string,{at:number;result:ReturnType<typeof getApiQueueStatus>}>();
const observeQueue=(attempt:ProductionAttempt,apiKey:string)=>{
  if(attempt.status!=='queued')return;
  const key=attempt.region+':'+attempt.accountId;
  let check=queueChecks.get(key);
  if(!check||Date.now()-check.at>15000){check={at:Date.now(),result:getApiQueueStatus(apiKey,attempt.region==='cn'?'cn':'global')};queueChecks.set(key,check);}
  const at=check.at;
  const count=(value:unknown)=>String(value??'').trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):undefined;
  void check.result.then(async queue=>{
    await patchWorkspaceFields('attempt:'+attempt.id,{queueInfo:{queued:count(queue.queuedCount),running:count(queue.runningCount),checkedAt:at}});notify();
  }).catch(()=>{});
};
const cancelling = new Map<string,Promise<void>>();
const patchCancellation = async (id:string,fields:Record<string,unknown>) => { await patchWorkspaceFields('attempt:'+id,{...fields,updatedAt:Date.now()});notify(); };
const sendCancellation = (id:string,accounts:ApiKeyEntry[]):Promise<void> => {
  const pending=cancelling.get(id);if(pending)return pending;
  const operation=(async()=>{
    const attempt=await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
    if(!attempt||!isCancellableAttempt(attempt)||!attempt.cancelRequestedAt||!attempt.taskId||attempt.cancelSentAt||attempt.cancelError)return;
    try{
      const account=accounts.find(a=>a.id===attempt.accountId);
      if(!account?.apiKey.trim() || (attempt.accountSignature && await signature(account.apiKey)!==attempt.accountSignature))throw new Error('请恢复本次任务原账号的 API，才能取消平台任务');
      await cancelTask(account.apiKey,attempt.taskId,attempt.region==='cn'?'cn':'global');
      await patchCancellation(id,{cancelSentAt:Date.now(),cancelAcceptedAt:Date.now(),cancelError:null});
    }catch(error:any){await patchCancellation(id,{cancelError:error?.message||'取消请求失败，任务仍会继续查询'});throw error;}
  })();
  cancelling.set(id,operation);void operation.finally(()=>cancelling.delete(id)).catch(()=>{});return operation;
};
export async function requestAttemptCancellation(id:string,accounts:ApiKeyEntry[]){
  const attempt=await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
  if(!attempt||!isCancellableAttempt(attempt))return;
  // Keep intent outside saveAttempt's mutable fields: an older query must never erase it.
  await patchCancellation(id,{cancelRequestedAt:Date.now(),cancelError:null,...(attempt.cancelError?{cancelAcceptedAt:attempt.cancelAcceptedAt||attempt.cancelSentAt||undefined,cancelSentAt:null}:{})});
  if(!attempt.taskId)uploadControllers.get(id)?.abort();
  if(!attempt.taskId && !active.has(id) && attempt.status==='preparing'){
    await saveAttempt({...attempt,status:'cancelled',timings:{...attempt.timings,failedAt:Date.now()},error:undefined});return;
  }
  if(!attempt.taskId && !active.has(id) && ['unknown','submitting'].includes(attempt.status)){
    const message='平台编号尚未确认，请先核对并绑定编号，再取消平台任务';await patchCancellation(id,{cancelError:message});throw new Error(message);
  }
  await sendCancellation(id,accounts);
}
const active = new Set<string>();
const uploadControllers=new Map<string,AbortController>();
const recovering = new Set<string>();
const downloading = new Set<string>();
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('rh-production-change')); };
export const listAttempts = async () => (await listWorkspaceData<ProductionAttempt>('attempt:')).sort((a,b) => b.createdAt-a.createdAt);
export const listAttemptSummaries = async () => (await listWorkspaceMetadata<ProductionAttempt>('attempt:')).sort((a,b)=>b.createdAt-a.createdAt);
export const loadAttemptInputs = (id:string) => readWorkspaceData<ProductionAttempt>('attempt:'+id);
export const attemptNumber = (attempt:ProductionAttempt) => attempt.sequence ? String(attempt.displaySequence??attempt.sequence).padStart(4,'0') : '旧记录';
export const saveAttempt = async (attempt: ProductionAttempt) => {
  const next = { ...attempt, updatedAt: Date.now() };
  const mutable = { timings:next.timings,status: next.status, updatedAt: next.updatedAt, taskId: next.taskId, submittedNodes: next.submittedNodes, outputs: next.outputs, files: next.files, error: next.error??null, usage: next.usage };
  if (!await patchWorkspaceFields('attempt:'+attempt.id, mutable)) await writeWorkspaceData('attempt:'+attempt.id, next);
  notify(); return next;
};
export const setAttemptDecision = async (id: string, decision: 'adopted' | 'redo') => {
  await patchWorkspaceFields('attempt:'+id, { decision, updatedAt: Date.now() }); notify();
};
export const hasUnresolvedAttempt = async (cardId: string) => (await listAttemptSummaries()).some(item => item.cardId === cardId && ['unknown','submitting','query_failed','queued','running'].includes(item.status));
export const isAccountUnavailableError = (error: any) => !error?.taskSubmitted && (
  ['401','403'].includes(String(error?.code)) || /HTTP Error: (401|403)/.test(String(error?.message)) ||
  /insufficient|invalid.*(key|token)|unauthori[sz]ed|余额不足|API Key 校验失败|密钥.*(无效|错误)|权限不足/i.test(String(error?.message)));

export const outputFileExtension = (output: TaskOutput) => {
  const raw = (output.fileType || '').toLowerCase().split(';')[0];
  const type = raw.includes('/') ? raw.split('/').pop()! : raw;
  if (type && !['video','image','audio','file','application','octet-stream'].includes(type) && /^[a-z0-9]{1,10}$/.test(type)) return type === 'jpeg' ? 'jpg' : type;
  try { const ext = new URL(output.fileUrl || output.downloadUrl || '').pathname.match(/\.([a-z0-9]{1,10})$/i)?.[1]; if (ext) return ext; } catch {}
  return 'bin';
};
export async function archiveAttempt(id: string, onlyIndex?: number): Promise<ProductionAttempt | undefined> {
  if (downloading.has(id)) return;
  downloading.add(id);
  try {
    let attempt = await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
    if (!attempt) throw new Error('找不到生成记录');
    if (attempt.localResultsMissing) attempt={...attempt,files:attempt.files.filter(file=>!attempt!.missingResultIndexes?.includes(file.index))};
    if (!attempt.outputs.length) return saveAttempt({ ...attempt, status: 'completed', error: '接口未返回可保存的结果文件。' });
    attempt = await saveAttempt({ ...attempt, status: 'downloading', timings:{...attempt.timings,archiveStartedAt:Date.now()}, error: undefined });
    for (let index=0; index<attempt.outputs.length; index++) {
      if (onlyIndex !== undefined && onlyIndex !== index) continue;
      if (attempt.files.some(file => file.index === index)) continue;
      const output = attempt.outputs[index];
      let receipt: { filename: string; path: string } | undefined;
      try {
        const extension = outputFileExtension(output);
        const prefix=attempt.sequence ? attemptNumber(attempt)+'_'+((attempt.sequenceBatch||1)>1?'B'+String(attempt.sequenceBatch).padStart(2,'0')+'_':'') : '';
        await saveFileFromUrl(output.fileUrl || output.downloadUrl || '', prefix+attempt.name.slice(0,60)+'_'+attempt.id+'_'+(index+1)+'.'+extension, extension, false, saved => { receipt = saved; });
        if (!receipt) throw new Error('保存没有返回文件位置，不能确认归档成功');
        attempt = await saveAttempt({ ...attempt, files: [...attempt.files, { index, ...receipt }], error: undefined });
      } catch (error: any) {
        return saveAttempt({ ...attempt, status: 'download_failed', error: error?.message || '下载失败' });
      }
    }
    return saveAttempt({ ...attempt, status: attempt.files.length === attempt.outputs.length ? 'saved' : 'completed', timings:{...attempt.timings,archivedAt:attempt.files.length===attempt.outputs.length?Date.now():undefined},error: undefined });
  } finally { downloading.delete(id); }
}

export async function runProductionTask(request: ExecuteTaskRequest, context: { cardId: string; name: string; account: ApiKeyEntry; parentAttemptId?: string;sourceDigest?:string }) {
  await flushLocalSettings();
  const id=crypto.randomUUID();
  let attempt: ProductionAttempt = {
    parentAttemptId: context.parentAttemptId,
    sourceDigest:context.sourceDigest,
    id, ...await allocateGenerationNumber(id), cardId: context.cardId, name: context.name || '任务', webappId: request.webappId,
    accountSignature: await signature(request.apiKey), accountId: context.account.id, accountNote: context.account.note || '未备注账号',
    region: getResolvedRunningHubRegion(request.apiKey), createdAt: Date.now(), updatedAt: Date.now(), status: 'preparing',
    originalNodes: structuredClone(request.taskNodes), pendingFiles: selectPendingFilesForTask(request.taskNodes, request.pendingFiles, request.taskIndex), unitIndex: request.taskIndex || 0,
    instanceType: request.instanceType, runOptions: { retainSeconds: request.runOptions?.retainSeconds }, outputs: [], files: [],
  };
  // If this fails, nothing has been submitted remotely.
  attempt = await saveAttempt(attempt);
  active.add(attempt.id);
  const uploadController=new AbortController();uploadControllers.set(id,uploadController);
  try {
    const result = await executeWorkflowTask({
      ...request, autoSaveEnabled: false,
      control:{...request.control,uploadSignal:uploadController.signal},
      callbacks: {
        ...request.callbacks,
        onStatusChange: async status => {
          await expireCancellation(id);
          await request.callbacks?.onStatusChange?.(status);
          if (attempt.taskId && (status === 'RUNNING' || status === 'QUEUED') && attempt.status !== (status === 'RUNNING' ? 'running' : 'queued')) {
            attempt = await saveAttempt({ ...attempt, status: status === 'RUNNING' ? 'running' : 'queued',timings:{...attempt.timings,runningObservedAt:status==='RUNNING'?(attempt.timings?.runningObservedAt||Date.now()):attempt.timings?.runningObservedAt} });
          }
          if(status==='QUEUED')observeQueue(attempt,request.apiKey);
        },
        onQueryMissing:async()=>{await cancelling.get(id)?.catch(()=>{});const current=await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);return !!(current?.cancelAcceptedAt||current?.cancelSentAt);},
        beforeSubmit: async nodes => {
          await request.callbacks?.beforeSubmit?.(nodes);
          if((await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id))?.cancelRequestedAt)throw new TaskCancelledError();
          attempt = { ...attempt, submittedNodes: structuredClone(nodes),timings:{...attempt.timings,submissionStartedAt:Date.now()}, status: 'submitting' };
          attempt = await saveAttempt(attempt);
        },
        onAccepted: async taskId => {
          attempt = { ...attempt, taskId,timings:{...attempt.timings,acceptedAt:Date.now()}, status: 'queued' };
          attempt = await saveAttempt(attempt);
          await request.callbacks?.onAccepted?.(taskId,attempt.submittedNodes||[]);
          await sendCancellation(id,[context.account]).catch(()=>{});
        },
        onGenerationResult: async outputs => {
          attempt = { ...attempt, status: 'completed',timings:{...attempt.timings,generationObservedAt:Date.now()}, outputs };
          attempt = await saveAttempt(attempt);
        },
      },
    });
    attempt = await saveAttempt({ ...attempt, usage: result.usage });
    if (request.autoSaveEnabled) await archiveAttempt(attempt.id);
    return result;
  } catch (error: any) {
    const status: AttemptStatus = error instanceof RemoteTaskCancelledError ? 'cancelled' : error instanceof TaskCancelledError ? (attempt.taskId ? 'query_failed' : attempt.status === 'submitting' ? 'unknown' : 'cancelled') :
      attempt.taskId ? (error instanceof TaskExecutionError && error.phase === 'generation' ? 'generation_failed' : 'query_failed') :
      attempt.status === 'submitting' ? (isCapacityLimitedError(error) || isAccountUnavailableError(error) || (/^4\d\d$/.test(String(error?.code))) ? 'rejected' : 'unknown') : 'interrupted';
    if(attempt.taskId&&status==='query_failed'&&(await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id))?.cancelRequestedAt)await patchCancellation(id,{cancelError:'状态查询中断，取消尚未确认；可刷新状态或重试取消。'}).catch(()=>{});
    await saveAttempt({ ...attempt, status,timings:{...attempt.timings,failedAt:['generation_failed','rejected','interrupted','cancelled'].includes(status)?Date.now():undefined}, error: status==='cancelled'?undefined:error?.message || '执行中断' }).catch(() => {});
    if (attempt.taskId && !(error instanceof TaskExecutionError) && !(error instanceof TaskCancelledError)) throw new TaskExecutionError(attempt.taskId, error);
    throw error;
  } finally { active.delete(attempt.id);uploadControllers.delete(id); }
}

// Query only. This path cannot call a submit endpoint.
export async function recoverAttempt(id: string, accounts: ApiKeyEntry[], autoSave: boolean) {
  await expireCancellation(id);
  if (active.has(id) || recovering.has(id)) return;
  recovering.add(id);
  try {
    let attempt = await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
    if (!attempt) return;
    if (attempt.status === 'downloading' && !downloading.has(id)) {
      await saveAttempt({ ...attempt, status: 'download_failed', error: '上次保存过程已中断，可单独重试下载。' });
      if (autoSave) return archiveAttempt(id);
      return;
    }
    if (!attempt.taskId) {
      if (attempt.status === 'submitting') return saveAttempt({ ...attempt, status: 'unknown', error: '上次提交结果不确定，请先在 RunningHub 核对，勿直接重发。' });
      if (attempt.status === 'preparing') return saveAttempt({ ...attempt, status: 'interrupted' });
      return;
    }
    if (!['query_failed','queued','running'].includes(attempt.status)) return;
    const account = accounts.find(item => item.id === attempt!.accountId);
    if (!account?.apiKey.trim()) return saveAttempt({ ...attempt, status: 'query_failed', error: '原账号不可用，请恢复原账号密钥后继续查询。' });
    if (attempt.accountSignature && await signature(account.apiKey) !== attempt.accountSignature) return saveAttempt({ ...attempt, status: 'query_failed', error: '原账号密钥已被替换；请恢复原密钥，不能将远端任务转交其他账号。' });
    try {
      await sendCancellation(id,accounts).catch(()=>{});
      const result = await queryTaskResult(account.apiKey, attempt.taskId, attempt.region === 'cn' ? 'cn' : 'global');
      attempt = await saveAttempt({ ...attempt, status: result.status === 'SUCCESS' ? 'completed' : result.status === 'FAILED' ? 'generation_failed' : result.status === 'CANCELLED' ? 'cancelled' : result.status === 'RUNNING' ? 'running' : 'queued',
        outputs: result.status === 'SUCCESS' ? result.results : attempt.outputs,
        timings:{...attempt.timings,generationObservedAt:result.status==='SUCCESS'?(attempt.timings?.generationObservedAt||Date.now()):attempt.timings?.generationObservedAt,failedAt:['FAILED','CANCELLED'].includes(result.status)?Date.now():attempt.timings?.failedAt},
        usage: result.status === 'SUCCESS' ? parseTaskUsage(result.usage) || attempt.usage : attempt.usage,
        error: result.status === 'FAILED' ? result.errorMessage || result.failedReason?.exception_message || '生成失败' : undefined });
      if(attempt.status==='queued')observeQueue(attempt,account.apiKey);
      if (attempt.status === 'completed' && autoSave) return archiveAttempt(id);
      return attempt;
    } catch (error: any) {
      const latest=await readWorkspaceMetadata<ProductionAttempt>('attempt:'+id);
      if(isTaskNotFoundError(error)&&(latest?.cancelAcceptedAt||latest?.cancelSentAt))return saveAttempt({...attempt,status:'cancelled',timings:{...attempt.timings,failedAt:Date.now()},error:undefined});
      if(latest?.cancelRequestedAt)await patchCancellation(id,{cancelError:'取消尚未确认：'+(error?.message||'查询失败')});
      return saveAttempt({ ...attempt, status: 'query_failed', error: error?.message || '查询失败' });
    }
  } finally { recovering.delete(id); }
}

export async function archiveOutputUrl(url:string) {
  for(const attempt of await listAttemptSummaries()) { const index=attempt.outputs.findIndex(output=>(output.fileUrl||output.downloadUrl)===url);if(index>=0){await archiveAttempt(attempt.id,index);return true;} }
  return false;
}
