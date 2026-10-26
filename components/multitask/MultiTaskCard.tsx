import RunLog, { RunLogEntry } from './RunLog';
import { archiveOutputUrl } from '../../services/production';
import { localSession } from '../../services/localPersistence';
import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Expand,
  FileIcon,
  Loader2,
  Play,
  RefreshCw,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import StepEditor, { StepEditorRef } from '../StepEditor';
import { InstanceType, NodeInfo, PendingFilesMap, TaskOutput, WebAppInfo, WorkflowRunOptions } from '../../types';

export type MultiTaskCardStatus = 'idle' | 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface MultiTaskUsageStats {
  coins: number;
  thirdParty: number;
  taskTime: number;
}

export interface MultiTaskCardRunState {
  mode: 'single' | 'batch';
  status: MultiTaskCardStatus;
  totalUnits: number;
  completedUnits: number;
  failedUnits: number;
  activeUnits: number;
  progressPercent: number;
  progressText: string;
  currentTaskId: string | null;
  taskIds: string[];
  logs: RunLogEntry[];
  outputs: TaskOutput[];
  error: string | null;
  failedBatchIndices: Set<number>;
  usage: MultiTaskUsageStats;
}

export interface MultiTaskCardData {
  id: string;
  name?: string;
  webappId: string;
  loadedAppId?: string;
  sourceAttemptId?: string;
  webAppInfo: WebAppInfo | null;
  nodes: NodeInfo[];
  isConnected: boolean;
  loading: boolean;
  editorRevision: number;
  loadError: string | null;
  instanceType: InstanceType;
  runOptions?: WorkflowRunOptions;
  initialBatchList?: NodeInfo[][];
  initialBatchTaskName?: string;
  initialPendingFiles?: PendingFilesMap;
  run: MultiTaskCardRunState;
}

interface MultiTaskCardProps {
  ordinal?: number;
  card: MultiTaskCardData;
  apiKeys: string[];
  editorRef: React.Ref<StepEditorRef>;
  onSnapshotChange?: () => void;
  onNameChange: (name: string) => void;
  onFavorite: () => void;
  onSaveTemplate: () => void;
  onVariants: () => void;
  detailView?: boolean;
  appName?:string;executionStatus?:string;hasResult?:boolean;onPreview?:()=>void;
  isBusy: boolean;
  onRunOptionsChange: (cardId: string, options: WorkflowRunOptions) => void;
  onWebappIdChange: (cardId: string, value: string) => void;
  onLoad: (cardId: string) => void;
  onRemove: (cardId: string) => void;
  onDuplicate: (cardId: string) => void;
  onRun: (cardId: string, updatedNodes: NodeInfo[], batchList?: NodeInfo[][], pendingFiles?: PendingFilesMap, batchTaskName?: string, instanceType?: InstanceType) => void;
  onCancel: (cardId: string) => void;
  onInstanceTypeChange: (cardId: string, nextType: InstanceType) => void;
}

type OutputKind = 'image' | 'video' | 'audio' | 'unknown';

const WEBAPP_ID_PLACEHOLDER = '请输入 WebApp ID，或粘贴应用详情页链接';

const statusMap: Record<MultiTaskCardStatus, { label: string; className: string }> = {
  idle: { label: '\u5f85\u8fd0\u884c', className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  queued: { label: '\u6392\u961f\u4e2d', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  running: { label: '\u8fd0\u884c\u4e2d', className: 'bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300' },
  success: { label: '\u5df2\u5b8c\u6210', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
  failed: { label: '\u5931\u8d25', className: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
  cancelled: { label: '\u5df2\u505c\u6b62', className: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200' },
};

const getOutputUrl = (output: TaskOutput) => output.fileUrl || output.downloadUrl || '';

const inferOutputKind = (output: TaskOutput): OutputKind => {
  const url = getOutputUrl(output);
  const fileType = output.fileType?.toLowerCase();

  if (fileType && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg'].includes(fileType)) {
    return 'image';
  }
  if (fileType && ['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(fileType)) {
    return 'video';
  }
  if (fileType && ['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(fileType)) {
    return 'audio';
  }
  if (/^data:image/i.test(url) || /\.(jpg|jpeg|png|webp|gif|bmp|svg)(\?.*)?$/i.test(url)) {
    return 'image';
  }
  if (/^(blob:|data:video)/i.test(url) || /\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(url)) {
    return 'video';
  }
  if (/^(data:audio)/i.test(url) || /\.(mp3|wav|ogg|flac|aac)(\?.*)?$/i.test(url)) {
    return 'audio';
  }

  return 'unknown';
};

const buildDownloadName = (url: string, fileType?: string) => {
  if (!url.startsWith('blob:')) {
    const clean = url.split('?')[0];
    return clean.split('/').pop() || 'download';
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `result_${timestamp}.${fileType || 'bin'}`;
};

const renderOutputPreview = (output: TaskOutput, mode: 'card' | 'modal') => {
  const url = getOutputUrl(output);
  const kind = inferOutputKind(output);
  const mediaClass = mode === 'card' ? 'h-full w-full object-contain' : 'max-h-[78vh] max-w-full object-contain';

  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
        {'\u6682\u65e0\u53ef\u9884\u89c8\u7ed3\u679c'}
      </div>
    );
  }

  if (kind === 'image') {
    return <img src={url} alt="Task Output" className={mediaClass} />;
  }

  if (kind === 'video') {
    return <video src={url} controls className={mediaClass} />;
  }

  if (kind === 'audio') {
    return (
      <div className="flex h-full w-full items-center justify-center px-6">
        <audio src={url} controls className="w-full max-w-md" />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center text-slate-500 dark:text-slate-400">
      <FileIcon className="h-10 w-10" />
      <div className="max-w-full break-all text-xs">{url}</div>
    </div>
  );
};

const renderOutputThumb = (output: TaskOutput) => {
  const url = getOutputUrl(output);
  const kind = inferOutputKind(output);

  if (kind === 'image') {
    return <img src={url} alt="Result Thumbnail" className="h-full w-full object-cover" />;
  }

  if (kind === 'video') {
    return <video src={url} className="h-full w-full object-cover" muted preload="metadata" />;
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500 dark:bg-slate-900/60 dark:text-slate-400">
      {kind}
    </div>
  );
};

const MultiTaskCard: React.FC<MultiTaskCardProps> = ({
  card,
  ordinal,
  apiKeys,
  editorRef,
  isBusy,
  onRunOptionsChange,
  onWebappIdChange,
  onLoad,
  onRemove,
  onDuplicate,
  onRun,
  onCancel,
  onInstanceTypeChange,
  onSnapshotChange,
  detailView,
  appName,executionStatus,hasResult,onPreview,
  onNameChange,
  onFavorite,
  onSaveTemplate,
  onVariants,
}) => {
  const [inputValue, setInputValue] = useState(card.webappId);
  const [activeOutputIndex, setActiveOutputIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    setInputValue(card.webappId);
  }, [card.webappId]);

  const isRunning = isBusy;
  const statusMeta = statusMap[card.run.status];
  const batchPercent = card.run.totalUnits > 0 ? Math.round(((card.run.completedUnits + card.run.failedUnits) / card.run.totalUnits) * 100) : 0;
  const displayOutputs = useMemo(() => card.run.outputs.slice(-4), [card.run.outputs]);
  const displayLogs = useMemo(() => card.run.logs.slice(-12), [card.run.logs]);
  const hasMultipleOutputs = displayOutputs.length > 1;
  const selectedOutput = displayOutputs[activeOutputIndex] || null;

  useEffect(() => {
    if (displayOutputs.length === 0) {
      setActiveOutputIndex(0);
      setPreviewOpen(false);
      return;
    }

    setActiveOutputIndex(current => (current >= displayOutputs.length ? 0 : current));
  }, [displayOutputs]);

  const handleDownload = async (output: TaskOutput | null) => {
    if (!output) return;

    const url = getOutputUrl(output);
    if (!url) return;

    try {
      if (localSession() && await archiveOutputUrl(url)) return;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('download failed');
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = buildDownloadName(url, output.fileType || blob.type.split('/')[1]?.replace('jpeg', 'jpg'));
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const shiftOutput = (direction: -1 | 1) => {
    if (displayOutputs.length <= 1) return;
    setActiveOutputIndex(current => (current + direction + displayOutputs.length) % displayOutputs.length);
  };

  return (
    <div className={detailView ? 'production-task bg-white dark:bg-[#161920]' : 'relative flex min-h-[600px] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-[#161920] h-[calc(100vh-180px)]'}>
      <div className="production-task-header xl:col-span-2 border-b border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <label className="flex min-w-0 items-center gap-2">{ordinal&&<span className="task-ordinal" aria-label="当前任务顺序">{ordinal}.</span>}<span className="shrink-0 text-xs text-slate-500">任务名称</span><input aria-label="任务名称" value={card.name || ''} placeholder="自定义任务名称，便于区分相同应用"
          disabled={isBusy} onChange={event => onNameChange(event.target.value)}
          className="min-w-0 w-full max-w-xl rounded border border-slate-300 bg-transparent px-2 py-1 text-sm dark:border-slate-600" /></label>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>
                {executionStatus||statusMeta.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onDuplicate(card.id)}
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-500 dark:text-slate-400 dark:hover:bg-slate-800"
              title="复制卡片"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={() => onRemove(card.id)}
              disabled={isBusy}
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-slate-400 dark:hover:bg-red-900/20"
              title="删除卡片"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="task-app-line"><strong title={card.webAppInfo?.webappName||card.webappId}>{appName||card.webAppInfo?.webappName||card.webappId||"尚未加载应用"}</strong>{hasResult&&<button onClick={onPreview}>结果预览</button>}<details className="task-more"><summary>更多</summary><div>
          <button disabled={!card.webappId} onClick={onFavorite}>收藏应用</button>
          <button disabled={!card.isConnected} onClick={onSaveTemplate}>保存为模板</button>
          <button disabled={!card.isConnected || isBusy} onClick={onVariants}>生成提示词变体</button>

        </div></details></div>

        <details className="task-load-app mt-2 text-xs" open={!card.isConnected}><summary>应用 ID / 加载</summary><div className="mt-2 flex gap-2">
          <input
            type="text"
            value={inputValue}
            disabled={isBusy || card.loading}
            onChange={event => {
              const value = event.target.value;
              setInputValue(value);
              onWebappIdChange(card.id, value);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                onLoad(card.id);
              }
            }}
            placeholder={WEBAPP_ID_PLACEHOLDER}
            className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-[#0F1115] dark:text-slate-200"
          />
          <button
            onClick={() => onLoad(card.id)}
            disabled={card.loading || isBusy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {card.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {'\u52a0\u8f7d'}
          </button>
        </div></details>

        {!card.isConnected && card.nodes.length > 0 && <p className="mt-2 text-xs text-amber-600">已保留原配置，加载成功后才切换应用。输回原应用 ID 可继续使用。</p>}
        <details className="task-run-options mt-3 text-xs text-slate-500 dark:text-slate-400">
          <summary className="cursor-pointer">应用运行选项</summary>
          <div className="mt-2 grid gap-2">
            <label className="grid gap-1">
              <span>应用访问密码（可选）</span>
              <input
                type="password"
                autoComplete="off"
                disabled={isBusy}
                value={card.runOptions?.accessPassword || ''}
                onChange={event => onRunOptionsChange(card.id, { ...card.runOptions, accessPassword: event.target.value })}
                placeholder="仅加密应用需要"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700 dark:border-slate-700 dark:bg-[#0F1115] dark:text-slate-200"
              />
            </label>

          </div>
        </details>

        {card.loadError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{card.loadError}</span>
          </div>
        )}
      </div>

      <div className="relative flex-1 min-h-0">
        <StepEditor
          productionLayout={detailView}
          applicationId={card.loadedAppId||card.webappId}
          runLabel={['success','failed','cancelled'].includes(card.run.status) ? '再生成一次' : '运行'}
          onSnapshotChange={onSnapshotChange}
          key={card.editorRevision}
          initialPendingFiles={card.initialPendingFiles}
          ref={editorRef}
          nodes={card.nodes}
          apiKeys={apiKeys}
          isConnected={card.isConnected}
          runType={isRunning ? card.run.mode : 'none'}
          webAppInfo={card.webAppInfo}
          onBack={() => {}}
          onRun={(updatedNodes, batchList, pendingFiles, batchTaskName, nextInstanceType) => onRun(card.id, updatedNodes, batchList, pendingFiles, batchTaskName, nextInstanceType)}
          onCancel={() => onCancel(card.id)}
          failedBatchIndices={card.run.failedBatchIndices}
          instanceType={card.instanceType}
          onInstanceTypeChange={nextType => onInstanceTypeChange(card.id, nextType)}
          initialBatchList={card.initialBatchList}
          initialBatchTaskName={card.initialBatchTaskName}
        />
      </div>

      <div className={detailView ? "hidden" : "min-h-0 overflow-y-auto border-t border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-[#161920]"}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            {card.run.status === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            ) : card.run.status === 'failed' ? (
              <AlertCircle className="h-4 w-4 text-red-500" />
            ) : (
              <Play className="h-4 w-4 text-slate-400" />
            )}
            <span>{card.run.progressText || '\u7b49\u5f85\u8fd0\u884c'}</span>
          </div>
          {isRunning && (
            <button
              onClick={() => onCancel(card.id)}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-red-300 hover:text-red-500 dark:border-slate-700 dark:text-slate-300"
            >
              <Square className="h-3.5 w-3.5" />
              {'\u505c\u6b62'}
            </button>
          )}
        </div>

        {card.run.totalUnits > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{'\u5361\u7247\u8fdb\u5ea6'}</span>
              <span>{batchPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${batchPercent}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
              <span>{'\u5df2\u5b8c\u6210'} {card.run.completedUnits} / {card.run.totalUnits}</span>
              <span>{'\u5931\u8d25'} {card.run.failedUnits}</span>
            </div>
          </div>
        )}

        {card.run.progressPercent > 0 && isRunning && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span>{'\u5f53\u524d\u4efb\u52a1\u8fdb\u5ea6'}</span>
              <span>{card.run.progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
              <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${card.run.progressPercent}%` }} />
            </div>
          </div>
        )}

        {(card.run.usage.coins > 0 || card.run.usage.thirdParty > 0 || card.run.usage.taskTime > 0) && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              RH {'\u5e01'} {card.run.usage.coins.toFixed(2)}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              {'\u7b2c\u4e09\u65b9'} {card.run.usage.thirdParty.toFixed(2)}
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
              {'\u7528\u65f6'} {card.run.usage.taskTime}s
            </div>
          </div>
        )}

        {card.run.error && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs whitespace-pre-wrap text-red-600 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
            {card.run.error}
          </div>
        )}

        {displayOutputs.length > 0 && selectedOutput && (
          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                {'\u6700\u65b0\u7ed3\u679c'}
              </div>
              {hasMultipleOutputs && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {activeOutputIndex + 1} / {displayOutputs.length}
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/40">
              <div className="relative flex h-64 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-3 dark:from-slate-900 dark:to-slate-950">
                {hasMultipleOutputs && (
                  <>
                    <button
                      type="button"
                      onClick={() => shiftOutput(-1)}
                      className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65"
                      aria-label="Previous output"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => shiftOutput(1)}
                      className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-2 text-white transition hover:bg-black/65"
                      aria-label="Next output"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </>
                )}

                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="group h-full w-full cursor-zoom-in"
                  title="\u67e5\u770b\u5927\u56fe"
                >
                  {renderOutputPreview(selectedOutput, 'card')}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center bg-gradient-to-t from-black/60 via-black/10 to-transparent px-4 py-4 opacity-0 transition group-hover:opacity-100">
                    <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-xs text-white backdrop-blur">
                      <Expand className="h-3.5 w-3.5" />
                      {'\u67e5\u770b\u5927\u56fe'}
                    </span>
                  </div>
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {inferOutputKind(selectedOutput) === 'image'
                    ? '\u56fe\u7247'
                    : inferOutputKind(selectedOutput) === 'video'
                      ? '\u89c6\u9891'
                      : inferOutputKind(selectedOutput) === 'audio'
                        ? '\u97f3\u9891'
                        : '\u6587\u4ef6'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreviewOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300"
                  >
                    <Expand className="h-3.5 w-3.5" />
                    {'\u9884\u89c8\u5927\u56fe'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDownload(selectedOutput)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                  >
                    <Download className="h-3.5 w-3.5" />
                    {'\u4e0b\u8f7d'}
                  </button>
                </div>
              </div>

              {hasMultipleOutputs && (
                <div className="border-t border-slate-200 px-3 py-3 dark:border-slate-700">
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {displayOutputs.map((output, index) => {
                      const isActive = index === activeOutputIndex;
                      return (
                        <button
                          key={`${getOutputUrl(output)}-${index}`}
                          type="button"
                          onClick={() => setActiveOutputIndex(index)}
                          className={`h-16 w-16 shrink-0 overflow-hidden rounded-xl border transition ${
                            isActive
                              ? 'border-brand-500 ring-2 ring-brand-200 dark:ring-brand-900/50'
                              : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-500'
                          }`}
                          title={`Result ${index + 1}`}
                        >
                          {renderOutputThumb(output)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {'\u8fd0\u884c\u65e5\u5fd7'}
          </div>
          <div className="max-h-40 overflow-y-auto rounded-xl bg-slate-950 px-3 py-2 font-mono text-[11px] text-slate-300">
            <RunLog entries={displayLogs}/>
          </div>
        </div>
      </div>

      {previewOpen && selectedOutput && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-2xl"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="absolute right-4 top-4 z-20 rounded-full bg-white/10 p-2 text-white transition hover:bg-white/20"
              aria-label="Close preview"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="relative flex min-h-[420px] flex-1 items-center justify-center bg-black px-6 py-8">
              {hasMultipleOutputs && (
                <>
                  <button
                    type="button"
                    onClick={() => shiftOutput(-1)}
                    className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
                    aria-label="Previous output"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => shiftOutput(1)}
                    className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20"
                    aria-label="Next output"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}

              {renderOutputPreview(selectedOutput, 'modal')}
            </div>

            <div className="border-t border-white/10 bg-slate-950/95 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-300">
                  {hasMultipleOutputs
                    ? `\u7ed3\u679c ${activeOutputIndex + 1} / ${displayOutputs.length}`
                    : '\u7ed3\u679c\u9884\u89c8'}
                </div>
                <button
                  type="button"
                  onClick={() => void handleDownload(selectedOutput)}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-200"
                >
                  <Download className="h-4 w-4" />
                  {'\u4e0b\u8f7d\u5f53\u524d\u7ed3\u679c'}
                </button>
              </div>

              {hasMultipleOutputs && (
                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {displayOutputs.map((output, index) => {
                    const isActive = index === activeOutputIndex;
                    return (
                      <button
                        key={`preview-${getOutputUrl(output)}-${index}`}
                        type="button"
                        onClick={() => setActiveOutputIndex(index)}
                        className={`h-20 w-20 shrink-0 overflow-hidden rounded-2xl border transition ${
                          isActive
                            ? 'border-brand-400 ring-2 ring-brand-500/40'
                            : 'border-white/10 hover:border-white/25'
                        }`}
                        title={`Preview ${index + 1}`}
                      >
                        {renderOutputThumb(output)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiTaskCard;
