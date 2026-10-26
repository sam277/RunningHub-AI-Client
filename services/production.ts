import { ApiKeyEntry, NodeInfo, PendingFilesMap, TaskOutput, WorkflowRunOptions } from '../types';
import { executeWorkflowTask, ExecuteTaskRequest, TaskExecutionError, TaskCancelledError, TaskUsageStats, selectPendingFilesForTask, parseTaskUsage } from './taskExecutor';
import { isCapacityLimitedError, queryTaskResult } from './api';
import { getResolvedRunningHubRegion } from './runningHubRegion';
import { saveFileFromUrl } from './autoSaveService';
import { listWorkspaceData, readWorkspaceData, writeWorkspaceData, patchWorkspaceFields, allocateGenerationNumber, listWorkspaceMetadata, readWorkspaceMetadata } from './workspaceStorage';
import { flushLocalSettings } from './localPersistence';

export type AttemptStatus = 'preparing' | 'submitting' | 'unknown' | 'queued' | 'running' | 'query_failed' | 'generation_failed' | 'rejected' | 'interrupted' | 'completed' | 'downloading' | 'download_failed' | 'saved';
export interface ProductionAttempt {
  parentAttemptId?: string;
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
  preparing: '准备素材', submitting: '提交中', unknown: '提交待确认，禁止自动重发', queued: '平台排队',
  running: '生成中', query_failed: '查询中断，可继续查询', generation_failed: '生成失败', rejected: '提交未接受',
  interrupted: '未提交，准备已中断', completed: '生成完成，待保存', downloading: '正在归档', download_failed: '下载失败，可单独重试', saved: '已归档',
};
const signature = async (key: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key.trim()))), n => n.toString(16).padStart(2,'0')).join('');
const active = new Set<string>();
const recovering = new Set<string>();
const downloading = new Set<string>();
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('rh-production-change')); };
export const listAttempts = async () => (await listWorkspaceData<ProductionAttempt>('attempt:')).sort((a,b) => b.createdAt-a.createdAt);
export const listAttemptSummaries = async () => (await listWorkspaceMetadata<ProductionAttempt>('attempt:')).sort((a,b)=>b.createdAt-a.createdAt);
export const loadAttemptInputs = (id:string) => readWorkspaceData<ProductionAttempt>('attempt:'+id);
export const attemptNumber = (attempt:ProductionAttempt) => attempt.sequence ? String(attempt.displaySequence??attempt.sequence).padStart(4,'0') : '旧记录';
export const saveAttempt = async (attempt: ProductionAttempt) => {
  const next = { ...attempt, updatedAt: Date.now() };
  const mutable = { timings:next.timings,status: next.status, updatedAt: next.updatedAt, taskId: next.taskId, submittedNodes: next.submittedNodes, outputs: next.outputs, files: next.files, error: next.error, usage: next.usage };
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

export async function runProductionTask(request: ExecuteTaskRequest, context: { cardId: string; name: string; account: ApiKeyEntry; parentAttemptId?: string }) {
  await flushLocalSettings();
  const id=crypto.randomUUID();
  let attempt: ProductionAttempt = {
    parentAttemptId: context.parentAttemptId,
    id, ...await allocateGenerationNumber(id), cardId: context.cardId, name: context.name || '任务', webappId: request.webappId,
    accountSignature: await signature(request.apiKey), accountId: context.account.id, accountNote: context.account.note || '未备注账号',
    region: getResolvedRunningHubRegion(request.apiKey), createdAt: Date.now(), updatedAt: Date.now(), status: 'preparing',
    originalNodes: structuredClone(request.taskNodes), pendingFiles: selectPendingFilesForTask(request.taskNodes, request.pendingFiles, request.taskIndex), unitIndex: request.taskIndex || 0,
    instanceType: request.instanceType, runOptions: { retainSeconds: request.runOptions?.retainSeconds }, outputs: [], files: [],
  };
  // If this fails, nothing has been submitted remotely.
  attempt = await saveAttempt(attempt);
  active.add(attempt.id);
  try {
    const result = await executeWorkflowTask({
      ...request, autoSaveEnabled: false,
      callbacks: {
        ...request.callbacks,
        onStatusChange: async status => {
          request.callbacks?.onStatusChange?.(status);
          if (attempt.taskId && (status === 'RUNNING' || status === 'QUEUED') && attempt.status !== (status === 'RUNNING' ? 'running' : 'queued')) {
            attempt = await saveAttempt({ ...attempt, status: status === 'RUNNING' ? 'running' : 'queued',timings:{...attempt.timings,runningObservedAt:status==='RUNNING'?(attempt.timings?.runningObservedAt||Date.now()):attempt.timings?.runningObservedAt} });
          }
        },
        beforeSubmit: async nodes => {
          attempt = { ...attempt, submittedNodes: structuredClone(nodes),timings:{...attempt.timings,submissionStartedAt:Date.now()}, status: 'submitting' };
          attempt = await saveAttempt(attempt);
        },
        onAccepted: async taskId => {
          attempt = { ...attempt, taskId,timings:{...attempt.timings,acceptedAt:Date.now()}, status: 'queued' };
          attempt = await saveAttempt(attempt);
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
    const status: AttemptStatus = error instanceof TaskCancelledError ? (attempt.taskId ? 'query_failed' : attempt.status === 'submitting' ? 'unknown' : 'interrupted') :
      attempt.taskId ? (error instanceof TaskExecutionError && error.phase === 'generation' ? 'generation_failed' : 'query_failed') :
      attempt.status === 'submitting' ? (isCapacityLimitedError(error) || isAccountUnavailableError(error) || (/^4\d\d$/.test(String(error?.code))) ? 'rejected' : 'unknown') : 'interrupted';
    await saveAttempt({ ...attempt, status,timings:{...attempt.timings,failedAt:['generation_failed','rejected','interrupted'].includes(status)?Date.now():undefined}, error: error?.message || '执行中断' }).catch(() => {});
    if (attempt.taskId && !(error instanceof TaskExecutionError)) throw new TaskExecutionError(attempt.taskId, error);
    throw error;
  } finally { active.delete(attempt.id); }
}

// Query only. This path cannot call a submit endpoint.
export async function recoverAttempt(id: string, accounts: ApiKeyEntry[], autoSave: boolean) {
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
      const result = await queryTaskResult(account.apiKey, attempt.taskId, attempt.region === 'cn' ? 'cn' : 'global');
      attempt = await saveAttempt({ ...attempt, status: result.status === 'SUCCESS' ? 'completed' : result.status === 'FAILED' ? 'generation_failed' : result.status === 'RUNNING' ? 'running' : 'queued',
        outputs: result.status === 'SUCCESS' ? result.results : attempt.outputs,
        timings:{...attempt.timings,generationObservedAt:result.status==='SUCCESS'?(attempt.timings?.generationObservedAt||Date.now()):attempt.timings?.generationObservedAt,failedAt:result.status==='FAILED'?Date.now():attempt.timings?.failedAt},
        usage: result.status === 'SUCCESS' ? parseTaskUsage(result.usage) || attempt.usage : attempt.usage,
        error: result.status === 'FAILED' ? result.errorMessage || result.failedReason?.exception_message || '生成失败' : undefined });
      if (attempt.status === 'completed' && autoSave) return archiveAttempt(id);
      return attempt;
    } catch (error: any) { return saveAttempt({ ...attempt, status: 'query_failed', error: error?.message || '查询失败' }); }
  } finally { recovering.delete(id); }
}

export async function archiveOutputUrl(url:string) {
  for(const attempt of await listAttemptSummaries()) { const index=attempt.outputs.findIndex(output=>(output.fileUrl||output.downloadUrl)===url);if(index>=0){await archiveAttempt(attempt.id,index);return true;} }
  return false;
}
