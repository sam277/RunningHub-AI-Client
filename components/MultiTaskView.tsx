import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Loader2, Play, Plus, Save, Square, Trash2, X } from 'lucide-react';
import { getNodeList, isCapacityLimitedError } from '../services/api';
import { createApiCapacityManagers, normalizeApiConfigs } from '../services/apiCapacity';
import { TaskCancelledError, TaskUsageStats } from '../services/taskExecutor';
import MultiTaskCard, { MultiTaskCardData, MultiTaskCardRunState } from './multitask/MultiTaskCard';
import { StepEditorRef, StepEditorSnapshot } from './StepEditor';
import { ApiKeyEntry, AutoSaveConfig, Favorite, InstanceType, NodeInfo, PendingFilesMap, RecentApp, WebAppInfo, WorkflowRunOptions } from '../types';
import { parseRunningHubAppInput } from '../services/runningHubRegion';
import { readWorkspaceData, writeWorkspaceData } from '../services/workspaceStorage';
import { runProductionTask, hasUnresolvedAttempt, isAccountUnavailableError } from '../services/production';
import ProductionHistory from './multitask/ProductionHistory';
import ParameterReuseDialog, { ParameterChange } from './multitask/ParameterReuseDialog';
import AppLibraryEditor from './AppLibraryEditor';
import { playBatchReminder } from '../services/taskReminder';

export interface MultiTaskAppRequest {
  requestId: string;
  webappId: string;
  nodes?: NodeInfo[];
  appInfo?: WebAppInfo | null;
}

interface MultiTaskViewProps {
  apiKeys: ApiKeyEntry[];
  autoSaveConfig: AutoSaveConfig;
  recentApps: RecentApp[];
  favorites: Favorite[];
  onUpdateFavorites: (favorites: Favorite[]) => void;
  appToOpen?: MultiTaskAppRequest | null;
}

interface RunUnit {
  cardId: string;
  unitIndex: number;
  totalUnits: number;
  webappId: string;
  nodes: NodeInfo[];
  pendingFiles: PendingFilesMap;
  batchTaskName: string;
  instanceType: InstanceType;
  runOptions?: WorkflowRunOptions;
}

interface SessionState {
  id: string;
  runningCardIds: Set<string>;
  cancelled: boolean;
  cancelledCards: Set<string>;
  connections: Map<string, Set<() => void>>;
  pendingUnits: RunUnit[];
  remainingUnits: Map<string, number>;
  completedBatch?: boolean;
  wake?: () => void;
}

interface MultiTaskDraftCard {
  id?: string;
  name?: string;
  initialPendingFiles?: PendingFilesMap;
  webappId: string;
  loadedAppId?: string;
  sourceAttemptId?: string;
  webAppInfo: WebAppInfo | null;
  nodes: NodeInfo[];
  isConnected: boolean;
  instanceType: InstanceType;
  runOptions?: WorkflowRunOptions;
  initialBatchList: NodeInfo[][];
  initialBatchTaskName: string;
}

interface MultiTaskDraft {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  cards: MultiTaskDraftCard[];
}

const MAX_LOG_LINES = 200;
const MULTITASK_DRAFTS_STORAGE_KEY = 'rh_multitask_drafts_v1';
const DRAFT_NAME_PLACEHOLDER = '请输入草稿名称，例如：批量头像生成';

const createEmptyRunState = (): MultiTaskCardRunState => ({
  mode: 'single',
  status: 'idle',
  totalUnits: 0,
  completedUnits: 0,
  failedUnits: 0,
  activeUnits: 0,
  progressPercent: 0,
  progressText: '等待运行',
  currentTaskId: null,
  taskIds: [],
  logs: [],
  outputs: [],
  error: null,
  failedBatchIndices: new Set<number>(),
  usage: {
    coins: 0,
    thirdParty: 0,
    taskTime: 0,
  },
});

const cloneNodes = (nodes: NodeInfo[]) => structuredClone(nodes);
const cloneNodeRows = (rows?: NodeInfo[][]) => (rows || []).map(row => cloneNodes(row));

const normalizeDraftCard = (card?: Partial<MultiTaskDraftCard> | null): MultiTaskDraftCard => ({
  id: card?.id,
  sourceAttemptId: card?.sourceAttemptId,
  name: card?.name || '',
  initialPendingFiles: { ...card?.initialPendingFiles },
  webappId: card?.webappId || '',
  loadedAppId: card?.loadedAppId || (card?.isConnected ? parseRunningHubAppInput(card.webappId || '').appId : ''),
  webAppInfo: card?.webAppInfo || null,
  nodes: Array.isArray(card?.nodes) ? cloneNodes(card!.nodes as NodeInfo[]) : [],
  isConnected: !!card?.isConnected,
  instanceType: card?.instanceType || 'default',
  runOptions: { retainSeconds: card?.runOptions?.retainSeconds },
  initialBatchList: Array.isArray(card?.initialBatchList) ? cloneNodeRows(card!.initialBatchList as NodeInfo[][]) : [],
  initialBatchTaskName: card?.initialBatchTaskName || '',
});

const normalizeDraft = (draft?: Partial<MultiTaskDraft> | null): MultiTaskDraft | null => {
  if (!draft?.id || !draft?.name) {
    return null;
  }

  return {
    id: draft.id,
    name: draft.name,
    createdAt: Number(draft.createdAt) || Date.now(),
    updatedAt: Number(draft.updatedAt) || Date.now(),
    cards: Array.isArray(draft.cards) ? draft.cards.map(card => normalizeDraftCard(card)) : [],
  };
};

const createCard = (partial?: Partial<MultiTaskCardData>): MultiTaskCardData => ({
  id: partial?.id || crypto.randomUUID(),
  sourceAttemptId: partial?.sourceAttemptId,
  name: partial?.name || '',
  webappId: partial?.webappId || '',
  loadedAppId: partial?.loadedAppId || (partial?.isConnected ? parseRunningHubAppInput(partial.webappId || '').appId : ''),
  webAppInfo: partial?.webAppInfo || null,
  nodes: partial?.nodes ? cloneNodes(partial.nodes) : [],
  isConnected: partial?.isConnected || false,
  loading: partial?.loading || false,
  editorRevision: partial?.editorRevision || 0,
  loadError: partial?.loadError || null,
  instanceType: partial?.instanceType || 'default',
  runOptions: { ...partial?.runOptions },
  initialBatchList: partial?.initialBatchList ? cloneNodeRows(partial.initialBatchList) : [],
  initialBatchTaskName: partial?.initialBatchTaskName || '',
  initialPendingFiles: { ...partial?.initialPendingFiles },
  run: partial?.run ? {
    ...partial.run,
    logs: [...partial.run.logs],
    outputs: [...partial.run.outputs],
    taskIds: [...partial.run.taskIds],
    failedBatchIndices: new Set(partial.run.failedBatchIndices),
    usage: { ...partial.run.usage },
  } : createEmptyRunState(),
});

const timestampLog = (message: string) => `[${new Date().toLocaleTimeString()}] ${message}`;

const mergeUsage = (left: TaskUsageStats, right?: TaskUsageStats) => ({
  coins: left.coins + (right?.coins || 0),
  thirdParty: left.thirdParty + (right?.thirdParty || 0),
  taskTime: left.taskTime + (right?.taskTime || 0),
});

const MultiTaskView: React.FC<MultiTaskViewProps> = ({
  apiKeys,
  autoSaveConfig,
  recentApps,
  favorites,
  onUpdateFavorites,
  appToOpen,
}) => {
  const [cards, setCards] = useState<MultiTaskCardData[]>(() => [createCard()]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [saveStatus, setSaveStatus] = useState('正在读取上次工作区…');
  const [editorChanges, setEditorChanges] = useState(0);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>(() => {
    try { return localStorage.getItem('rh_multitask_view') === 'cards' ? 'cards' : 'list'; } catch { return 'list'; }
  });
  const [templates, setTemplates] = useState<MultiTaskDraft[]>([]);
  const [templateCardId, setTemplateCardId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [editingFavorite, setEditingFavorite] = useState<Favorite | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [reuse, setReuse] = useState<{ ids: string[]; variant: boolean } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const undoCreatedIdsRef = useRef<string[]>([]);
  const schedulerPreparingRef = useRef(false);
  const undoCardsRef = useRef<MultiTaskCardData[] | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<MultiTaskDraft[]>(() => {
    try {
      const raw = localStorage.getItem(MULTITASK_DRAFTS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed)
        ? parsed
            .map(item => normalizeDraft(item))
            .filter((item): item is MultiTaskDraft => !!item)
            .sort((left, right) => right.updatedAt - left.updatedAt)
        : [];
    } catch {
      return [];
    }
  });
  const [isSaveDraftModalOpen, setIsSaveDraftModalOpen] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState('');
  const [draftModalError, setDraftModalError] = useState<string | null>(null);
  const [confirmOverwriteDraftId, setConfirmOverwriteDraftId] = useState<string | null>(null);
  const [draftPendingDelete, setDraftPendingDelete] = useState<MultiTaskDraft | null>(null);

  const editorRefs = useRef<Record<string, StepEditorRef | null>>({});
  const manualSnapshotsRef = useRef<Record<string, StepEditorSnapshot | undefined>>({});
  const sessionRef = useRef<SessionState | null>(null);
  const lastAppRequestIdRef = useRef<string | null>(null);

  useEffect(() => () => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    session.wake?.();
    session.connections.forEach(closers => closers.forEach(close => close()));
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      readWorkspaceData<{ cards: MultiTaskDraftCard[] }>('current'),
      readWorkspaceData<MultiTaskDraft[]>('drafts'),
      readWorkspaceData<MultiTaskDraft[]>('templates'),
    ]).then(([workspace, savedDrafts, savedTemplates]) => {
      if (!active) return;
      if (Array.isArray(savedTemplates)) setTemplates(savedTemplates);
      if (Array.isArray(savedDrafts)) setDrafts(savedDrafts.map(normalizeDraft).filter((item): item is MultiTaskDraft => !!item));
      if (workspace) {
        if (!Array.isArray(workspace.cards)) throw new Error('本地工作区格式不正确');
        setCards(workspace.cards.map(item => createCard(normalizeDraftCard(item))));
      }
      setStorageReady(true);
      setSaveStatus(workspace ? '已恢复上次工作区，任务需手动运行' : '工作区自动保存已就绪');
    }).catch(() => {
      if (!active) return;
      setStorageFailed(true);
      setStorageReady(true);
      setSaveStatus('本地读取失败，自动保存已暂停。请重新打开应用重试，避免覆盖旧工作区。');
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!sessionNotice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setSessionNotice(current => (current === sessionNotice ? null : current));
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [sessionNotice]);

  const apiConfigs = useMemo(
    () =>
      normalizeApiConfigs(apiKeys.filter(entry => entry.enabled !== false).map(entry => ({
        apiKey: entry.apiKey,
        concurrency: entry.concurrency || 1,
      }))),
    [apiKeys],
  );

  const totalConfiguredSlots = useMemo(
    () => apiConfigs.reduce((sum, config) => sum + config.concurrency, 0),
    [apiConfigs],
  );

  const validApiKeys = useMemo(() => apiKeys.filter(entry => entry.enabled !== false).map(entry => entry.apiKey).filter(key => key.trim()), [apiKeys]);

  const isPlaceholderCard = (card: MultiTaskCardData) =>
    !card.webappId.trim()
    && !card.isConnected
    && card.nodes.length === 0
    && card.run.status === 'idle'
    && card.run.logs.length === 0
    && card.run.outputs.length === 0;

  const buildSnapshotForCard = (card: MultiTaskCardData): StepEditorSnapshot => {
    const snapshot = editorRefs.current[card.id]?.getSnapshot() || manualSnapshotsRef.current[card.id];
    if (snapshot) {
      return {
        ...snapshot,
        nodes: cloneNodes(snapshot.nodes),
        batchList: cloneNodeRows(snapshot.batchList),
        pendingFiles: { ...snapshot.pendingFiles },
      };
    }

    return {
      nodes: cloneNodes(card.nodes),
      batchList: cloneNodeRows(card.initialBatchList),
      pendingFiles: { ...card.initialPendingFiles },
      batchTaskName: card.initialBatchTaskName || '',
      instanceType: card.instanceType,
      hasUploadingFiles: false,
      isConnected: card.isConnected,
    };
  };

  const createDraftCardFromCard = (card: MultiTaskCardData): MultiTaskDraftCard => {
    const snapshot = buildSnapshotForCard(card);
    return {
      id: card.id,
      sourceAttemptId: card.sourceAttemptId,
      name: card.name,
      initialPendingFiles: { ...snapshot.pendingFiles },
      webappId: card.webappId,
      loadedAppId: card.loadedAppId,
      webAppInfo: card.webAppInfo,
      nodes: cloneNodes(snapshot.nodes),
      isConnected: card.isConnected,
      instanceType: snapshot.instanceType,
      runOptions: { retainSeconds: card.runOptions?.retainSeconds },
      initialBatchList: cloneNodeRows(snapshot.batchList),
      initialBatchTaskName: snapshot.batchTaskName,
    };
  };

  // The editor owns live parameters; persist its snapshot rather than stale card props.
  const saveCurrentRef = useRef<() => void>(() => {});
  const saveVersionRef = useRef(0);
  saveCurrentRef.current = () => {
    if (!storageReady || storageFailed) return;
    const snapshots = cards.map(card => ({ card, snapshot: buildSnapshotForCard(card) }));
    if (snapshots.some(item => item.snapshot.hasUploadingFiles)) {
      setSaveStatus('素材上传中，完成后自动保存；此时请勿关闭应用');
      return;
    }
    const version = ++saveVersionRef.current;
    setSaveStatus('正在保存工作区…');
    void writeWorkspaceData('current', { version: 1, updatedAt: Date.now(), cards: cards.map(createDraftCardFromCard) })
      .then(() => {
        if (version === saveVersionRef.current) setSaveStatus('工作区已自动保存 · ' + new Date().toLocaleTimeString());
      }).catch(() => {
        if (version === saveVersionRef.current) setSaveStatus('工作区保存失败，请检查存储空间后点击重试保存');
      });
  };
  useEffect(() => {
    if (!storageReady || storageFailed) return;
    // Invalidate any older write completion as soon as the user changes parameters.
    saveVersionRef.current += 1;
    setSaveStatus('有修改，准备自动保存…');
    const timer = window.setTimeout(() => saveCurrentRef.current(), 500);
    return () => window.clearTimeout(timer);
  }, [cards, editorChanges, storageReady, storageFailed]);
  useEffect(() => {
    const flush = () => saveCurrentRef.current();
    const handleVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const updateCard = (cardId: string, updater: (card: MultiTaskCardData) => MultiTaskCardData) => {
    setCards(prev => prev.map(card => (card.id === cardId ? updater(card) : card)));
  };

  const appendCardLog = (cardId: string, message: string) => {
    updateCard(cardId, card => ({
      ...card,
      run: {
        ...card.run,
        logs: [...card.run.logs, timestampLog(message)].slice(-MAX_LOG_LINES),
      },
    }));
  };

  const openSaveDraftModal = () => {
    const draftSourceCards = cards.filter(card => !isPlaceholderCard(card) || card.webappId.trim() || card.nodes.length > 0);

    if (draftSourceCards.length === 0) {
      setSessionNotice('\u5f53\u524d\u6ca1\u6709\u53ef\u4fdd\u5b58\u7684\u5361\u7247\u8349\u7a3f\u3002');
      return;
    }

    if (draftSourceCards.some(card => {
      const snapshot = buildSnapshotForCard(card);
      return snapshot.hasUploadingFiles;
    })) {
      setSessionNotice('素材正在上传，请等上传完成后保存草稿。批量待上传文件会随草稿保存在本机。');
      return;
    }

    setDraftNameInput('');
    setDraftModalError(null);
    setConfirmOverwriteDraftId(null);
    setIsSaveDraftModalOpen(true);
  };

  const handleSaveDraft = async () => {
    if (!storageReady || storageFailed) { setDraftModalError('本地存储尚未就绪，请重新打开应用后重试。'); return; }
    if (cards.some(card => buildSnapshotForCard(card).hasUploadingFiles)) { setDraftModalError('素材正在上传，请稍后保存。'); return; }
    const draftSourceCards = cards.filter(card => !isPlaceholderCard(card) || card.webappId.trim() || card.nodes.length > 0);
    const normalizedName = draftNameInput.trim();
    if (!normalizedName) {
      setDraftModalError('\u8bf7\u8f93\u5165\u8349\u7a3f\u540d\u79f0');
      return;
    }

    const existingDraft = drafts.find(item => item.name === normalizedName);
    if (existingDraft && confirmOverwriteDraftId !== existingDraft.id) {
      setConfirmOverwriteDraftId(existingDraft.id);
      setDraftModalError(`\u8349\u7a3f\u300c${normalizedName}\u300d\u5df2\u5b58\u5728\uff0c\u518d\u70b9\u4e00\u6b21\u5c06\u8986\u76d6\u3002`);
      return;
    }

    const nextDraft: MultiTaskDraft = {
      id: existingDraft?.id || crypto.randomUUID(),
      name: normalizedName,
      createdAt: existingDraft?.createdAt || Date.now(),
      updatedAt: Date.now(),
      cards: draftSourceCards.map(card => createDraftCardFromCard(card)),
    };

    const nextDrafts = [nextDraft, ...drafts.filter(item => item.id !== nextDraft.id)].sort((left, right) => right.updatedAt - left.updatedAt);
    try { await writeWorkspaceData('drafts', nextDrafts); }
    catch { setDraftModalError('草稿保存失败，请检查本地存储空间后重试。'); return; }
    setDrafts(nextDrafts);
    setIsSaveDraftModalOpen(false);
    setDraftNameInput('');
    setDraftModalError(null);
    setConfirmOverwriteDraftId(null);
    setSessionNotice(`\u5df2\u4fdd\u5b58\u8349\u7a3f\u300c${normalizedName}\u300d`);
  };

  const handleLoadDraft = (draft: MultiTaskDraft) => {
    if (sessionRef.current) {
      setSessionNotice('\u5f53\u524d\u6709\u4efb\u52a1\u6b63\u5728\u8c03\u5ea6\uff0c\u8bf7\u7b49\u5f85\u7ed3\u675f\u540e\u518d\u52a0\u8f7d\u8349\u7a3f\u3002');
      return;
    }

    const draftCards = draft.cards.map(item => createCard({
      name: item.name,
      initialPendingFiles: item.initialPendingFiles,
      webappId: item.webappId,
      loadedAppId: item.loadedAppId,
      webAppInfo: item.webAppInfo,
      nodes: item.nodes,
      isConnected: item.isConnected,
      instanceType: item.instanceType,
      runOptions: { ...item.runOptions },
      initialBatchList: item.initialBatchList,
      initialBatchTaskName: item.initialBatchTaskName,
    }));

    if (draftCards.length === 0) {
      setSessionNotice(`\u8349\u7a3f\u300c${draft.name}\u300d\u6ca1\u6709\u53ef\u6062\u590d\u7684\u5361\u7247\u3002`);
      return;
    }

    editorRefs.current = {};
    manualSnapshotsRef.current = {};
    setCards(draftCards);
    setShowAppPicker(false);
    setSessionNotice(`\u5df2\u52a0\u8f7d\u8349\u7a3f\u300c${draft.name}\u300d`);
  };

  const openDeleteDraftModal = (draftId: string) => {
    const targetDraft = drafts.find(item => item.id === draftId);
    if (!targetDraft) {
      return;
    }

    setDraftPendingDelete(targetDraft);
  };

  const handleConfirmDeleteDraft = async () => {
    const targetDraft = draftPendingDelete;
    if (!targetDraft) {
      return;
    }

    try {
      const nextDrafts = drafts.filter(item => item.id !== targetDraft.id);
      await writeWorkspaceData('drafts', nextDrafts);
      setDrafts(nextDrafts);
    } catch { setSessionNotice('删除失败，草稿仍保留，请重试。'); return; }
    setDraftPendingDelete(null);
    setSessionNotice(`\u5df2\u5220\u9664\u8349\u7a3f\u300c${targetDraft.name}\u300d`);
  };

  const handleCreateCard = (partial?: Partial<MultiTaskCardData>, replacePlaceholder = false) => {
    const nextCard = createCard(partial);
    setCards(prev => replacePlaceholder && prev.length === 1 && isPlaceholderCard(prev[0])
      ? [nextCard]
      : [...prev, nextCard]);
    setShowAppPicker(false);
    setSelectedCardId(nextCard.id);
    return nextCard.id;
  };

  const handleCreateCardFromPreset = async (preset: { webappId: string; nodes?: NodeInfo[]; appInfo?: WebAppInfo | null; name?: string }, replacePlaceholder = false) => {
    const cardId = handleCreateCard({
      name: preset.name || '',
      webappId: preset.webappId,
      webAppInfo: preset.appInfo || null,
      nodes: preset.nodes || [],
      isConnected: !!preset.nodes?.length,
    }, replacePlaceholder);

    if (!preset.nodes?.length && preset.webappId) {
      await handleLoadCard(cardId, preset.webappId);
    }
  };

  const handleRemoveCard = (cardId: string) => {
    if (sessionRef.current?.runningCardIds.has(cardId)) return;
    if (cards.length === 1) {
      setCards([createCard()]);
      return;
    }

    delete editorRefs.current[cardId];
    delete manualSnapshotsRef.current[cardId];
    setCards(prev => prev.filter(card => card.id !== cardId));
  };

  const handleDuplicateCard = (cardId: string) => {
    const sourceCard = cards.find(card => card.id === cardId);
    if (!sourceCard) return;

    const snapshot = editorRefs.current[cardId]?.getSnapshot();
    handleCreateCard({
      name: sourceCard.name ? sourceCard.name + ' 副本' : '',
      webappId: sourceCard.webappId,
      loadedAppId: sourceCard.loadedAppId,
      webAppInfo: sourceCard.webAppInfo,
      nodes: snapshot?.nodes || sourceCard.nodes,
      isConnected: sourceCard.isConnected,
      instanceType: snapshot?.instanceType || sourceCard.instanceType,
      runOptions: { ...sourceCard.runOptions },
      initialBatchList: snapshot?.batchList || sourceCard.initialBatchList,
      initialBatchTaskName: snapshot?.batchTaskName || sourceCard.initialBatchTaskName,
      initialPendingFiles: snapshot?.pendingFiles || sourceCard.initialPendingFiles,
    });
  };

  const saveTemplate = async () => {
    const card = cards.find(item => item.id === templateCardId);
    if (!card || !templateName.trim()) { setTemplateError('请输入模板名称。'); return; }
    try {
      const template: MultiTaskDraft = { id: crypto.randomUUID(), name: templateName.trim(), createdAt: Date.now(), updatedAt: Date.now(), cards: [createDraftCardFromCard(card)] };
      const next = [template, ...templates];
      await writeWorkspaceData('templates', next);
      setTemplates(next); setTemplateCardId(null); setSessionNotice('已保存完整参数和原始素材，可从新建任务中选择模板。');
    } catch { setTemplateError('模板保存失败，请检查存储空间后重试。'); }
  };
  const openReuse = (ids: string[], variant = false) => {
    const targets = cards.filter(card => ids.includes(card.id));
    if (!targets.length || targets.some(card => !card.isConnected || sessionRef.current?.runningCardIds.has(card.id))) {
      setSessionNotice('请先加载应用，并等待所选任务结束后再修改。'); return;
    }
    if (new Set(targets.map(card => card.webappId)).size > 1) { setSessionNotice('统一修改仅适用于同一应用；不同应用请分别选择。'); return; }
    setReuse({ ids, variant });
  };
  const applyReuse = ({ node, values, file }: ParameterChange) => {
    if (!reuse) return;
    if (reuse.ids.some(id => sessionRef.current?.runningCardIds.has(id))) { setSessionNotice('任务正在运行，未修改参数。'); return; }
    const targets = cards.filter(card => reuse.ids.includes(card.id));
    const transform = (card: MultiTaskCardData, value: string): MultiTaskCardData => {
      const snapshot = buildSnapshotForCard(card);
      const changeNodes = (nodes: NodeInfo[]) => cloneNodes(nodes).map(item => item.nodeId === node.nodeId && item.fieldName === node.fieldName ? { ...item, fieldValue: value } : item);
      const files = { ...snapshot.pendingFiles };
      Object.keys(files).forEach(key => { const [,id,field] = key.split('|'); if (id === node.nodeId && field === node.fieldName) delete files[key]; });
      if (file) files[`single|${node.nodeId}|${node.fieldName}`] = file;
      return createCard({ ...card, nodes: changeNodes(snapshot.nodes), initialBatchList: snapshot.batchList.map(changeNodes),
        initialPendingFiles: files, initialBatchTaskName: snapshot.batchTaskName, instanceType: snapshot.instanceType, editorRevision: card.editorRevision+1 });
    };
    undoCreatedIdsRef.current = [];
    undoCardsRef.current = targets.map(card => {
      const snapshot = buildSnapshotForCard(card);
      return createCard({ ...card, nodes: snapshot.nodes, initialBatchList: snapshot.batchList, initialPendingFiles: snapshot.pendingFiles, initialBatchTaskName: snapshot.batchTaskName });
    });
    setCanUndo(true);
    if (reuse.variant) {
      const source = targets[0];
      values.forEach((value, index) => {
        const next = transform(source, value);
        const createdId = handleCreateCard({ ...next, id: crypto.randomUUID(), name: (source.name || source.webAppInfo?.webappName || '任务')+' · 变体 '+(index+1), run: createEmptyRunState() });
        undoCreatedIdsRef.current.push(createdId);
      });
    } else {
      const updates = new Map(targets.map(card => [card.id, transform(card, values[0])]));
      targets.forEach(card => delete manualSnapshotsRef.current[card.id]);
      setCards(previous => previous.map(card => updates.get(card.id) || card));
    }
    setReuse(null);
  };
  const undoReuse = () => {
    if (sessionRef.current) { setSessionNotice('请等任务结束后再撤销。'); return; }
    if (undoCardsRef.current) {
      const prior = new Map<string, MultiTaskCardData>(undoCardsRef.current.map(card => [card.id, card]));
      manualSnapshotsRef.current = {};
      setCards(previous => previous.filter(card => !undoCreatedIdsRef.current.includes(card.id)).map(card => prior.has(card.id) ? createCard({ ...prior.get(card.id)!, editorRevision: card.editorRevision+1 }) : card));
      setCanUndo(false);
    }
  };

  const handleWebappIdChange = (cardId: string, value: string) => {
    delete manualSnapshotsRef.current[cardId];
    updateCard(cardId, card => ({ ...card, webappId: value,
      isConnected: !!card.loadedAppId && parseRunningHubAppInput(value).appId === card.loadedAppId,
      loadError: null }));
  };

  const handleLoadCard = async (cardId: string, forcedId?: string) => {
    if (sessionRef.current?.runningCardIds.has(cardId)) return;
    const targetCard = cards.find(card => card.id === cardId);
    const rawWebappId = (forcedId ?? targetCard?.webappId ?? '').trim();
    const normalizedWebappId = parseRunningHubAppInput(rawWebappId).appId;
    const primaryApiKey = validApiKeys[0] || '';

    if (!primaryApiKey || !normalizedWebappId) {
      updateCard(cardId, card => ({
        ...card,
        loading: false,
        loadError: '请先配置 API Key 并填写 WebApp ID',
      }));
      return;
    }

    updateCard(cardId, card => ({
      ...card,
      loading: true,
      loadError: null,
      webappId: normalizedWebappId,
    }));

    try {
      const result = await getNodeList(primaryApiKey, rawWebappId);
      const snapshot = targetCard ? buildSnapshotForCard(targetCard) : undefined;
      const preserve = targetCard?.loadedAppId === normalizedWebappId && !!snapshot;
      const merge = (previous: NodeInfo[]) => result.nodes.map(node => {
        const prior = previous.find(item => item.nodeId === node.nodeId && item.fieldName === node.fieldName && item.fieldType === node.fieldType);
        return { ...node, ...(prior ? { fieldValue: prior.fieldValue } : {}), ...(previous[0]?._taskId ? { _taskId: previous[0]._taskId } : {}) };
      });
      const pending = preserve ? Object.fromEntries(Object.entries(snapshot!.pendingFiles).filter(([key]) => {
        const [,id,field] = key.split('|');
        return result.nodes.some(node => node.nodeId === id && node.fieldName === field && ['IMAGE','AUDIO','VIDEO'].includes(node.fieldType));
      })) : {};
      if (preserve && JSON.stringify(result.nodes.map(node => [node.nodeId,node.fieldName,node.fieldType])) !== JSON.stringify(snapshot!.nodes.map(node => [node.nodeId,node.fieldName,node.fieldType]))) setSessionNotice('应用参数结构已更新，已保留匹配的输入，请核对新增或变化的字段后再运行。');
      delete manualSnapshotsRef.current[cardId];
      updateCard(cardId, card => ({
        ...card,
        webappId: normalizedWebappId,
        webAppInfo: result.appInfo,
        nodes: preserve ? merge(snapshot!.nodes) : result.nodes,
        loadedAppId: normalizedWebappId,
        editorRevision: card.editorRevision + 1,
        isConnected: true,
        loading: false,
        loadError: null,
        initialBatchList: preserve ? snapshot!.batchList.map(merge) : [],
        initialBatchTaskName: preserve ? snapshot!.batchTaskName : '',
        initialPendingFiles: pending,
        run: preserve ? card.run : createEmptyRunState(),
      }));
    } catch (error: any) {
      updateCard(cardId, card => ({
        ...card,
        loading: false,
        loadError: error.message || '加载应用失败',
      }));
    }
  };

  useEffect(() => {
    if (!storageReady || !appToOpen || lastAppRequestIdRef.current === appToOpen.requestId) return;
    // Consume each click once; changing views or API settings must not add another card.
    lastAppRequestIdRef.current = appToOpen.requestId;
    void handleCreateCardFromPreset(appToOpen, true);
  }, [appToOpen, storageReady]);

  const finishUnit = (session: SessionState, cardId: string) => {
    const remaining = Math.max(0, (session.remainingUnits.get(cardId) || 1) - 1);
    session.remainingUnits.set(cardId, remaining);
    if (remaining === 0) {
      session.runningCardIds.delete(cardId);
      session.connections.delete(cardId);
      setCards(prev => [...prev]);
    }
  };

  const isCardCancelled = (session: SessionState, cardId: string) => session.cancelled || session.cancelledCards.has(cardId);

  const registerCardConnection = (session: SessionState, cardId: string, connection: { close: () => void } | null) => {
    if (!connection) return () => {};

    let closers = session.connections.get(cardId);
    if (!closers) {
      closers = new Set();
      session.connections.set(cardId, closers);
    }

    const closer = () => connection.close();
    closers.add(closer);

    return () => {
      closer();
      closers?.delete(closer);
    };
  };

  const stopTrackingCard = (cardId: string) => {
    const session = sessionRef.current;
    if (!session) return;

    session.cancelledCards.add(cardId);
    // Remove unsent units even when every API slot is occupied elsewhere.
    for (let i = session.pendingUnits.length - 1; i >= 0; i -= 1) {
      if (session.pendingUnits[i].cardId === cardId) {
        session.pendingUnits.splice(i, 1);
        finishUnit(session, cardId);
      }
    }
    session.wake?.();
    session.connections.get(cardId)?.forEach(close => close());

    updateCard(cardId, card => ({
      ...card,
      run: {
        ...card.run,
        status: 'cancelled',
        progressText: '已停止追踪，服务端已提交的任务可能仍在运行',
        activeUnits: 0,
      },
    }));
  };

  const stopAllTracking = () => {
    const session = sessionRef.current;
    if (!session) return;

    session.cancelled = true;
    session.wake?.();
    session.connections.forEach(closers => closers.forEach(close => close()));
    setSessionNotice('已停止当前调度的追踪，服务端已提交的任务可能仍在运行。');

    setCards(prev =>
      prev.map(card =>
        session.runningCardIds.has(card.id)
          ? {
              ...card,
              run: {
                ...card.run,
                status: 'cancelled',
                progressText: '已停止追踪，服务端已提交的任务可能仍在运行',
                activeUnits: 0,
              },
            }
          : card,
      ),
    );
  };

  const buildUnitsFromSnapshot = (card: MultiTaskCardData, snapshot: StepEditorSnapshot): RunUnit[] => {
    const batchList = snapshot.batchList.length > 0 ? snapshot.batchList.map(cloneNodes) : [];
    const nodes = cloneNodes(snapshot.nodes);
    const totalUnits = batchList.length > 0 ? batchList.length : 1;
    const taskGroups = batchList.length > 0 ? batchList : [nodes];

    return taskGroups.map((group, index) => ({
      cardId: card.id,
      unitIndex: index,
      totalUnits,
      webappId: card.webappId,
      nodes: cloneNodes(group),
      pendingFiles: { ...snapshot.pendingFiles },
      batchTaskName: snapshot.batchTaskName,
      instanceType: snapshot.instanceType,
      runOptions: { ...card.runOptions },
    }));
  };

  const collectRunnableCards = (cardIds?: string[]) => {
    const targetIds = new Set(cardIds ?? cards.map(card => card.id));
    const runnable: { card: MultiTaskCardData; snapshot: StepEditorSnapshot }[] = [];

    cards.forEach(card => {
      if (!targetIds.has(card.id) || sessionRef.current?.runningCardIds.has(card.id) || card.loading) return;

      const snapshot = manualSnapshotsRef.current[card.id] || editorRefs.current[card.id]?.getSnapshot();
      if (!snapshot) return;
      if (!card.isConnected || !card.webappId.trim() || snapshot.nodes.length === 0) return;
      if (snapshot.hasUploadingFiles) {
        appendCardLog(card.id, '仍有文件上传中，已跳过本次调度');
        return;
      }

      runnable.push({ card, snapshot });
    });

    return runnable;
  };

  const startScheduler = async (targetCardIds?: string[]) => {
    if (sessionRef.current?.cancelled) {
      setSessionNotice('正在停止当前调度，请稍后再提交。');
      return;
    }

    if (apiConfigs.length === 0) {
      setSessionNotice('当前没有可用的 API Key，无法启动多任务调度。');
      return;
    }

    if (schedulerPreparingRef.current) return;
    schedulerPreparingRef.current = true;
    let runnableCards: ReturnType<typeof collectRunnableCards>;
    try {
    runnableCards = collectRunnableCards(targetCardIds);
    if (runnableCards.length === 0) {
      setSessionNotice('没有可运行的卡片，请先加载应用并确认参数。');
      return;
    }

    for (const { card } of runnableCards) {
      if (await hasUnresolvedAttempt(card.id)) {
        setSessionNotice('存在尚未确认完成的生成，请在生成记录中继续查询或核对提交结果，再发起新生成。');
        setShowHistory(true); return;
      }
    }
    } catch {
      setSessionNotice('无法读取执行记录，已阻止提交，请检查本地存储后重试。'); return;
    } finally { schedulerPreparingRef.current = false; }
    const units = runnableCards.flatMap(({ card, snapshot }) => buildUnitsFromSnapshot(card, snapshot));
    if (units.length === 0) {
      setSessionNotice('当前卡片没有可执行的任务单元。');
      return;
    }

    runnableCards.forEach(({ card }) => {
      delete manualSnapshotsRef.current[card.id];
    });

    const existingSession = sessionRef.current;
    const session: SessionState = existingSession || {
      id: crypto.randomUUID(),
      runningCardIds: new Set(),
      cancelled: false,
      cancelledCards: new Set(),
      connections: new Map(),
      pendingUnits: [],
      remainingUnits: new Map(),
    };

    units.forEach(unit => {
      session.runningCardIds.add(unit.cardId);
      session.cancelledCards.delete(unit.cardId);
      session.remainingUnits.set(unit.cardId, (session.remainingUnits.get(unit.cardId) || 0) + 1);
    });
    session.pendingUnits.push(...units);
    sessionRef.current = session;
    setSessionActive(true);
    setSessionNotice(null);

    const cardRunConfig = new Map(
      runnableCards.map(({ card, snapshot }) => [
        card.id,
        {
          snapshot,
          totalUnits: snapshot.batchList.length > 0 ? snapshot.batchList.length : 1,
        },
      ]),
    );

    setCards(prev =>
      prev.map(card => {
        const config = cardRunConfig.get(card.id);
        if (!config) return card;

        return {
          ...card,
          nodes: cloneNodes(config.snapshot.nodes),
          instanceType: config.snapshot.instanceType,
          run: {
            ...createEmptyRunState(),
            mode: config.totalUnits > 1 ? 'batch' : 'single',
            status: 'queued',
            totalUnits: config.totalUnits,
            progressText: config.totalUnits > 1 ? '等待批量调度' : '等待调度',
            logs: [timestampLog(`已加入调度队列，并发槽位 ${totalConfiguredSlots}`)],
          },
        };
      }),
    );

    if (existingSession) {
      session.wake?.();
      return;
    }

    const capacityManagers = createApiCapacityManagers(apiConfigs);
    const pendingUnits = session.pendingUnits;
    const runningTasks = new Set<Promise<void>>();
    const unavailableKeys = new Set<string>();
    let hasLoggedCapacityWait = false;

    try {
      while (!session.cancelled && (pendingUnits.length > 0 || runningTasks.size > 0)) {
        let launchedCount = 0;

        for (const manager of capacityManagers) {
          if (unavailableKeys.has(manager.apiKey)) continue;
          if (session.cancelled || pendingUnits.length === 0) {
            break;
          }

          let availableSlots: number;
          try {
            availableSlots = (await manager.probe()).availableSlots;
          } catch (error: any) {
            if (isAccountUnavailableError(error)) unavailableKeys.add(manager.apiKey);
            setSessionNotice(`${apiKeys.find(entry => entry.apiKey.trim() === manager.apiKey)?.note || `账号 ${manager.index + 1}`} 队列查询失败，其他账号继续调度：${error.message || error}`);
            continue;
          }

          while (!session.cancelled && availableSlots > 0 && pendingUnits.length > 0) {
            const unit = pendingUnits.shift();
            if (!unit) {
              break;
            }

            if (isCardCancelled(session, unit.cardId)) {
              finishUnit(session, unit.cardId);
              continue;
            }

            if (!manager.reserveSlot()) {
              pendingUnits.unshift(unit);
              break;
            }

            availableSlots -= 1;
            launchedCount += 1;
            hasLoggedCapacityWait = false;

            updateCard(unit.cardId, card => ({
              ...card,
              run: {
                ...card.run,
                status: 'running',
                activeUnits: card.run.activeUnits + 1,
                progressText: unit.totalUnits > 1 ? `批量任务 ${unit.unitIndex + 1}/${unit.totalUnits} 执行中` : '任务执行中',
              },
            }));

            appendCardLog(unit.cardId, `调度到 ${apiKeys.find(entry => entry.apiKey.trim() === manager.apiKey)?.note || `账号 ${manager.index + 1}`}，当前可用槽位 ${availableSlots}`);

            let retry = false;
            let taskPromise: Promise<void>;
            taskPromise = (async () => {
              try {
                const result = await runProductionTask({
                  apiKey: manager.apiKey,
                  webappId: unit.webappId,
                  taskNodes: unit.nodes,
                  pendingFiles: unit.pendingFiles,
                  taskIndex: unit.unitIndex,
                  instanceType: unit.instanceType,
                  runOptions: unit.runOptions,
                  autoSaveEnabled: autoSaveConfig.enabled,
                  batchTaskName: unit.batchTaskName,
                  taskLabel: unit.totalUnits > 1 ? `任务 ${unit.unitIndex + 1}/${unit.totalUnits}` : `卡片 ${unit.cardId.slice(0, 6)}`,
                  callbacks: {
                    onLog: message => appendCardLog(unit.cardId, message),
                    onProgress: snapshot => {
                      if (isCardCancelled(session, unit.cardId)) return;
                      updateCard(unit.cardId, card => ({
                        ...card,
                        run: {
                          ...card.run,
                          status: 'running',
                          progressPercent: Math.round(snapshot.overallPercent),
                          progressText: snapshot.currentNodeName
                            ? `当前节点: ${snapshot.currentNodeName}`
                            : card.run.progressText,
                        },
                      }));
                    },
                    onStatusChange: status => {
                      if (isCardCancelled(session, unit.cardId)) return;
                      updateCard(unit.cardId, card => ({
                        ...card,
                        run: {
                          ...card.run,
                          status: status === 'RUNNING' ? 'running' : 'queued',
                          progressText:
                            status === 'SUBMITTING'
                              ? '正在提交任务'
                              : status === 'RUNNING'
                                ? '任务运行中'
                                : '任务排队中',
                        },
                      }));
                    },
                  },
                  control: {
                    isCancelled: () => isCardCancelled(session, unit.cardId),
                    registerConnection: connection => registerCardConnection(session, unit.cardId, connection),
                    pollOffsetMs: manager.index * 250,
                  },
                }, {
                  cardId: unit.cardId,
                  parentAttemptId: cards.find(card => card.id === unit.cardId)?.sourceAttemptId,
                  name: (cards.find(card => card.id === unit.cardId)?.name || cards.find(card => card.id === unit.cardId)?.webAppInfo?.webappName || '任务') + (unit.totalUnits > 1 ? ' · '+(unit.unitIndex+1) : ''),
                  account: apiKeys.find(entry => entry.apiKey.trim() === manager.apiKey)!,
                });

                if (isCardCancelled(session, unit.cardId)) throw new TaskCancelledError();
                updateCard(unit.cardId, card => {
                  const completedUnits = card.run.completedUnits + 1;
                  const activeUnits = Math.max(0, card.run.activeUnits - 1);
                  const totalProcessed = completedUnits + card.run.failedUnits;
                  const isFinished = totalProcessed >= card.run.totalUnits;

                  return {
                    ...card,
                    run: {
                      ...card.run,
                      status: isFinished ? (card.run.failedUnits > 0 ? 'failed' : 'success') : 'running',
                      completedUnits,
                      activeUnits,
                      currentTaskId: result.taskId,
                      taskIds: [...card.run.taskIds, result.taskId],
                      outputs: [...card.run.outputs, ...result.outputs],
                      usage: mergeUsage(card.run.usage, result.usage),
                      progressPercent: isFinished ? 100 : card.run.progressPercent,
                      progressText: isFinished
                        ? (card.run.failedUnits > 0 ? '部分任务失败' : '全部任务完成')
                        : `已完成 ${completedUnits}/${card.run.totalUnits}`,
                    },
                  };
                });
              } catch (error: any) {
                if (error instanceof TaskCancelledError || isCardCancelled(session, unit.cardId)) {
                  updateCard(unit.cardId, card => ({
                    ...card,
                    run: {
                      ...card.run,
                      status: 'cancelled',
                      activeUnits: Math.max(0, card.run.activeUnits - 1),
                      progressText: '已停止追踪，服务端已提交的任务可能仍在运行',
                    },
                  }));
                  return;
                }

                if (isAccountUnavailableError(error)) {
                  unavailableKeys.add(manager.apiKey);
                  retry = true; pendingUnits.unshift(unit);
                  updateCard(unit.cardId, card => ({ ...card, run: { ...card.run, activeUnits: Math.max(0, card.run.activeUnits-1), status: 'queued', progressText: '当前账号不可用，等待其他账号' } }));
                  appendCardLog(unit.cardId, '当前账号不可用，已隔离本轮调度，改用其他可用账号');
                  return;
                }
                if (isCapacityLimitedError(error) && !error?.taskSubmitted) {
                  retry = true;
                  pendingUnits.push(unit);
                  manager.markCapacityLimited();
                  updateCard(unit.cardId, card => ({
                    ...card,
                    run: {
                      ...card.run,
                      status: 'queued',
                      activeUnits: Math.max(0, card.run.activeUnits - 1),
                      progressText: '等待 API 空闲槽位后自动继续',
                    },
                  }));
                  appendCardLog(unit.cardId, '当前 API 并发暂时已满，已回到队列等待自动重试');
                  return;
                }

                updateCard(unit.cardId, card => {
                  const failedUnits = card.run.failedUnits + 1;
                  const activeUnits = Math.max(0, card.run.activeUnits - 1);
                  const totalProcessed = failedUnits + card.run.completedUnits;
                  const isFinished = totalProcessed >= card.run.totalUnits;
                  const failedBatchIndices = new Set(card.run.failedBatchIndices);
                  failedBatchIndices.add(unit.unitIndex);

                  return {
                    ...card,
                    run: {
                      ...card.run,
                      status: isFinished ? 'failed' : 'running',
                      failedUnits,
                      activeUnits,
                      error: error.message || '任务执行失败',
                      failedBatchIndices,
                      progressText: isFinished ? '任务执行结束，存在失败项' : `存在失败项，已完成 ${totalProcessed}/${card.run.totalUnits}`,
                    },
                  };
                });

                appendCardLog(unit.cardId, `失败: ${error.message || error}`);
              } finally {
                manager.releaseSlot();
                if (!retry) {
                  if (unit.totalUnits > 1 && !isCardCancelled(session, unit.cardId) && session.remainingUnits.get(unit.cardId) === 1) {
                    session.completedBatch = true;
                  }
                  finishUnit(session, unit.cardId);
                }
              }
            })().finally(() => {
              runningTasks.delete(taskPromise);
              session.wake?.();
            });

            runningTasks.add(taskPromise);
          }
        }

        if (session.cancelled) {
          break;
        }

        if (capacityManagers.every(manager => unavailableKeys.has(manager.apiKey)) && runningTasks.size === 0) {
          setSessionNotice('本轮所有账号均不可用，已停止提交。配置保留，请修复账号后手动运行。'); break;
        }
        if (launchedCount > 0) {
          continue;
        }

        if (pendingUnits.length > 0 && runningTasks.size === 0 && !hasLoggedCapacityWait) {
          setSessionNotice('当前 API 并发已被网页或其他任务占用，系统会在有空位时自动继续。');
          hasLoggedCapacityWait = true;
        }

        if (pendingUnits.length === 0 && runningTasks.size === 0) break;

        // Wake on appended cards, task completion or remote capacity becoming free.
        await new Promise<void>(resolve => {
          const wake = () => {
            clearTimeout(timer);
            if (session.wake === wake) session.wake = undefined;
            resolve();
          };
          const timer = setTimeout(wake, 3000);
          session.wake = wake;
        });
      }
    } finally {
      await Promise.all(runningTasks);
      session.connections.forEach(closers => closers.forEach(close => close()));
      sessionRef.current = null;
      setSessionActive(false);
      if (!session.cancelled && session.completedBatch) playBatchReminder();
    }

  };

  const handleRunCard = async (
    cardId: string,
    updatedNodes: NodeInfo[],
    batchList?: NodeInfo[][],
    pendingFiles?: PendingFilesMap,
    batchTaskName?: string,
    instanceType?: InstanceType,
  ) => {
    if (sessionRef.current?.cancelled || sessionRef.current?.runningCardIds.has(cardId)) {
      setSessionNotice('当前卡片仍在执行或停止中，请稍后再提交。');
      return;
    }

    const targetCard = cards.find(card => card.id === cardId);
    const nextInstanceType = instanceType || targetCard?.instanceType || 'default';

    updateCard(cardId, card => ({
      ...card,
      nodes: cloneNodes(updatedNodes),
      instanceType: nextInstanceType,
      initialBatchList: batchList ? cloneNodeRows(batchList) : [],
      initialBatchTaskName: batchTaskName || '',
      initialPendingFiles: { ...pendingFiles },
    }));

    const snapshot: StepEditorSnapshot = {
      nodes: cloneNodes(updatedNodes),
      batchList: batchList ? batchList.map(cloneNodes) : [],
      pendingFiles: { ...(pendingFiles || {}) },
      batchTaskName: batchTaskName || '',
      instanceType: nextInstanceType,
      hasUploadingFiles: false,
      isConnected: true,
    };

    manualSnapshotsRef.current[cardId] = snapshot;

    await startScheduler([cardId]);
  };

  const handleRunAll = async () => {
    await startScheduler(selection.size ? [...selection] : undefined);
  };

  if (!storageReady) return <div className="flex h-full w-full items-center justify-center text-sm text-slate-500">正在读取上次工作区…</div>;
  const activeCardId = cards.some(card => card.id === selectedCardId) ? selectedCardId : cards[0]?.id;

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-[#0F1115]">
      {editingFavorite && <AppLibraryEditor initial={editingFavorite} favorites={favorites} onSave={onUpdateFavorites} onClose={() => setEditingFavorite(null)} />}
      {reuse && <ParameterReuseDialog nodes={buildSnapshotForCard(cards.find(card => card.id === reuse.ids[0])!).nodes.filter(node => reuse.ids.every(id => buildSnapshotForCard(cards.find(card => card.id === id)!).nodes.some(other => other.nodeId === node.nodeId && other.fieldName === node.fieldName && other.fieldType === node.fieldType)))} count={reuse.ids.length} variant={reuse.variant} onApply={applyReuse} onClose={() => setReuse(null)} />}
      {templateCardId && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"><div role="dialog" aria-label="保存任务模板" className="w-full max-w-lg space-y-4 rounded-xl bg-white p-6 dark:bg-[#161920]">
        <h3 className="font-bold">保存完整配置为模板</h3><input aria-label="模板名称" value={templateName} onChange={e => setTemplateName(e.target.value)} className="w-full rounded border border-slate-500 bg-transparent p-2" />
        <p className="text-xs text-slate-500">包含当前参数、批量配置和原始素材，不包含执行状态。应用访问密码需重新填写。</p>
        {templateError && <p className="text-red-500">{templateError}</p>}
        <div className="flex justify-end gap-4"><button onClick={() => setTemplateCardId(null)}>取消</button><button onClick={saveTemplate}>保存模板</button></div>
      </div></div>}
      <div className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-[#161920]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-brand-500" />
              <h2 className="text-lg font-bold text-slate-800 dark:text-white">多任务模式</h2>
            </div>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              同一应用用批量设置换图、换提示词；不同应用分别编辑，统一并发运行。当前并发槽位 {totalConfiguredSlots}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowHistory(value => !value)} className="rounded-lg border border-slate-500 px-3 py-2 text-sm">{showHistory ? '返回编辑' : '生成记录'}</button>
            <div className="flex rounded-lg border border-slate-200 p-1 dark:border-slate-700" aria-label="任务视图">
              {(['list', 'cards'] as const).map(mode => <button key={mode} aria-pressed={viewMode === mode}
                onClick={() => { setViewMode(mode); try { localStorage.setItem('rh_multitask_view', mode); } catch {} }}
                className={`rounded px-3 py-1 text-xs ${viewMode === mode ? 'bg-brand-600 text-white' : 'text-slate-500'}`}>{mode === 'list' ? '列表编辑' : '卡片总览'}</button>)}
            </div>
            <button
              onClick={() => setShowAppPicker(prev => !prev)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-500 dark:border-slate-700 dark:bg-[#1a1d24] dark:text-slate-300"
            >
              <Plus className="h-4 w-4" />
              新建任务
            </button>

            <button
              onClick={openSaveDraftModal}
              disabled={cards.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-300 hover:text-brand-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#1a1d24] dark:text-slate-300"
            >
              <Save className="h-4 w-4" />
              {'\u4fdd\u5b58\u8349\u7a3f'}
            </button>

            {sessionActive ? (
              <button
                onClick={stopAllTracking}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
              >
                <Square className="h-4 w-4" />
                停止追踪
              </button>
            ) : (
              <button
                onClick={handleRunAll}
                disabled={cards.length === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                {selection.size ? `运行所选 (${selection.size})` : '全部运行'}
              </button>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500" role="status">
          <span>{saveStatus}</span>
          {!storageFailed && <button className="text-brand-600" onClick={() => saveCurrentRef.current()}>立即保存 / 重试</button>}
          <span>恢复配置与素材，不自动重新提交任务。</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span>已选 {selection.size} 个任务</span>
          <button disabled={!selection.size} onClick={() => [...selection].forEach(handleDuplicateCard)}>复制所选配置</button>
          <button disabled={!selection.size} onClick={() => openReuse([...selection])}>批量修改参数</button>
          <button disabled={!canUndo} onClick={undoReuse}>撤销上次批量操作</button>
          <button onClick={() => setSelection(new Set())}>清空选择</button>
        </div>
        {showAppPicker && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-slate-800 dark:bg-[#0F1115]">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">快速创建卡片</h3>
              <button
                onClick={() => setShowAppPicker(false)}
                className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4"><div className="mb-2 text-sm font-bold">我的参数模板</div><div className="flex flex-wrap gap-2">
              {!templates.length && <span className="text-xs text-slate-500">在任务中点“保存为模板”，以后连素材一起复用。</span>}
              {templates.map(template => <button key={template.id} className="rounded-lg border border-slate-500 px-3 py-2 text-sm" onClick={() => { const config = template.cards[0]; handleCreateCard({ ...config, id: crypto.randomUUID(), name: template.name, runOptions: { ...config.runOptions } }, true); }}>{template.name}</button>)}
            </div></div>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">空白卡片</div>
                <button
                  onClick={() => handleCreateCard()}
                  className="w-full rounded-xl border border-dashed border-brand-300 bg-white px-4 py-3 text-sm font-medium text-brand-600 transition hover:bg-brand-50 dark:border-brand-800 dark:bg-[#161920] dark:text-brand-300"
                >
                  创建空白卡片
                </button>
                <div className="mt-3 max-h-44 space-y-2 overflow-y-auto">
                  {drafts.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-400 dark:border-slate-800 dark:bg-[#161920]">
                      {'\u6682\u65e0\u8349\u7a3f'}
                    </div>
                  ) : (
                    drafts.map(draft => (
                      <div
                        key={draft.id}
                        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 dark:border-slate-800 dark:bg-[#161920]"
                      >
                        <button
                          onClick={() => handleLoadDraft(draft)}
                          className="min-w-0 flex-1 text-left text-sm text-slate-700 transition hover:text-brand-500 dark:text-slate-200"
                        >
                          <div className="truncate font-medium">{draft.name}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {draft.cards.length} {'\u5f20\u5361\u7247'}
                          </div>
                        </button>
                        <button
                          onClick={() => openDeleteDraftModal(draft.id)}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                          title="\u5220\u9664\u8349\u7a3f"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">收藏应用</div>
                <div className="max-h-44 space-y-2 overflow-y-auto">
                  {favorites.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-400 dark:border-slate-800 dark:bg-[#161920]">
                      暂无收藏
                    </div>
                  ) : (
                    favorites.map(item => (
                      <button
                        key={`fav-${item.webappId}`}
                        onClick={() => handleCreateCardFromPreset({ webappId: item.webappId, nodes: item.nodes, appInfo: item.appInfo, name: item.name })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:text-brand-500 dark:border-slate-800 dark:bg-[#161920] dark:text-slate-200"
                      >
                        {item.appInfo?.webappName || item.name || item.webappId}
                      </button>
                    ))
                  )}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">最近使用</div>
                <div className="max-h-44 space-y-2 overflow-y-auto">
                  {recentApps.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-400 dark:border-slate-800 dark:bg-[#161920]">
                      暂无记录
                    </div>
                  ) : (
                    recentApps.map(item => (
                      <button
                        key={`recent-${item.id}`}
                        onClick={() => handleCreateCardFromPreset({ webappId: item.id, name: item.name })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-left text-sm text-slate-700 transition hover:border-brand-300 hover:text-brand-500 dark:border-slate-800 dark:bg-[#161920] dark:text-slate-200"
                      >
                        {item.name || item.id}
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {sessionNotice && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
            {sessionNotice}
          </div>
        )}
      </div>

      <div className={showHistory ? 'min-h-0 flex-1 overflow-auto' : 'hidden'}><ProductionHistory onPrepare={attempt => {
        const nextId = handleCreateCard({ name: attempt.name+' · 重做', webappId: attempt.webappId, loadedAppId: parseRunningHubAppInput(attempt.webappId).appId, sourceAttemptId: attempt.id,
          nodes: attempt.originalNodes, initialPendingFiles: attempt.pendingFiles, instanceType: attempt.instanceType || 'default', runOptions: attempt.runOptions, isConnected: true });
        setSelectedCardId(nextId); setShowHistory(false); setSessionNotice('已按此条记录恢复输入，请核对后手动运行，将新增一次生成。');
      }} accounts={apiKeys} autoSave={autoSaveConfig.enabled} /></div>
      <div className={showHistory ? 'hidden' : 'flex min-h-0 flex-1'}>
        {viewMode === 'list' && <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-200 p-3 dark:border-slate-800" aria-label="任务列表">
          {cards.map((card, index) => <div key={card.id} className="mb-2 flex items-start gap-2">
            <input type="checkbox" aria-label={`选择任务 ${index+1}`} checked={selection.has(card.id)} onChange={e => setSelection(previous => { const next = new Set(previous); e.target.checked ? next.add(card.id) : next.delete(card.id); return next; })} className="mt-4" />
            <button onClick={() => setSelectedCardId(card.id)} aria-pressed={activeCardId === card.id}
              className={`min-w-0 flex-1 rounded-xl border p-3 text-left ${activeCardId === card.id ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-[#161920]'}`}>
              <div className="truncate text-sm font-medium">{index+1}. {card.name || card.webAppInfo?.webappName || card.webappId || '新任务'}</div>
              <div className="mt-1 truncate text-xs text-slate-500">{card.run.progressText} · {card.run.completedUnits}/{card.run.totalUnits}</div>
            </button>
          </div>)}
          <p className="mt-3 text-xs leading-5 text-slate-500">同应用多素材：打开任务内的批量设置，一次导入多张图片。不同应用：新建任务后分别配置。</p>
        </aside>}
      <div className="min-w-0 flex-1 overflow-auto p-4">
        {cards.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-8 py-12 text-center dark:border-slate-700 dark:bg-[#161920]">
              <Layers className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
              <p className="mt-4 text-base font-medium text-slate-600 dark:text-slate-300">还没有任务卡片</p>
              <p className="mt-2 text-sm text-slate-400">先创建一个卡片，多任务调度会根据 API 并发能力自动并行。</p>
            </div>
          </div>
        ) : (
          <div className={viewMode === 'cards' ? 'grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'h-full'}>
            {cards.map(card => (
              <div key={card.id} className={viewMode === 'list' ? (card.id === activeCardId ? 'h-full' : 'hidden') : ''}>
              <MultiTaskCard
                onFavorite={() => setEditingFavorite({ webappId: card.webappId, name: favorites.find(item => item.webappId === card.webappId)?.name || card.webAppInfo?.webappName || card.name || '', appInfo: card.webAppInfo || undefined })}
                onSaveTemplate={() => { setTemplateCardId(card.id); setTemplateName(card.name || card.webAppInfo?.webappName || ''); setTemplateError(''); }}
                onVariants={() => openReuse([card.id], true)}
                detailView={viewMode === 'list'}
                onSnapshotChange={() => setEditorChanges(value => value + 1)}
                onNameChange={name => updateCard(card.id, current => ({ ...current, name }))}

                card={card}
                apiKeys={validApiKeys}
                editorRef={ref => {
                  editorRefs.current[card.id] = ref;
                }}
                isBusy={!!sessionRef.current?.runningCardIds.has(card.id)}
                onRunOptionsChange={(cardId, runOptions) => {
                  if (sessionRef.current?.runningCardIds.has(cardId)) return;
                  updateCard(cardId, current => ({ ...current, runOptions }));
                }}
                onWebappIdChange={handleWebappIdChange}
                onLoad={handleLoadCard}
                onRemove={handleRemoveCard}
                onDuplicate={handleDuplicateCard}
                onRun={handleRunCard}
                onCancel={stopTrackingCard}
                onInstanceTypeChange={(cardId, nextType) => {
                  updateCard(cardId, current => ({
                    ...current,
                    instanceType: nextType,
                  }));
                }}
              />
              </div>
            ))}
          </div>
        )}
      </div>

      </div>

      {isSaveDraftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#161920]">
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-800 dark:text-white">
                {'\u4fdd\u5b58\u591a\u4efb\u52a1\u8349\u7a3f'}
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {'\u7ed9\u5f53\u524d\u5361\u7247\u7ec4\u5408\u8d77\u4e2a\u540d\u5b57\uff0c\u65b9\u4fbf\u540e\u7eed\u5feb\u901f\u6062\u590d\u3002'}
              </p>
            </div>

            <div className="px-5 py-4">
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
                {'\u8349\u7a3f\u540d\u79f0'}
              </label>
              <input
                autoFocus
                value={draftNameInput}
                onChange={event => {
                  setDraftNameInput(event.target.value);
                  setDraftModalError(null);
                  setConfirmOverwriteDraftId(null);
                }}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    handleSaveDraft();
                  }
                }}
                placeholder={DRAFT_NAME_PLACEHOLDER}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-brand-500 dark:border-slate-700 dark:bg-[#0F1115] dark:text-slate-200"
              />

              {draftModalError && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
                  {draftModalError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              <button
                onClick={() => {
                  setIsSaveDraftModalOpen(false);
                  setDraftNameInput('');
                  setDraftModalError(null);
                  setConfirmOverwriteDraftId(null);
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
              >
                {'\u53d6\u6d88'}
              </button>
              <button
                onClick={handleSaveDraft}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-600"
              >
                {confirmOverwriteDraftId ? '\u8986\u76d6\u4fdd\u5b58' : '\u4fdd\u5b58\u8349\u7a3f'}
              </button>
            </div>
          </div>
        </div>
      )}

      {draftPendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm"
          onClick={() => setDraftPendingDelete(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#161920]"
            onClick={event => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <h3 className="text-base font-semibold text-slate-800 dark:text-white">
                确认删除草稿
              </h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                草稿“{draftPendingDelete.name}”删除后将无法恢复，确定要继续吗？
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              <button
                onClick={() => setDraftPendingDelete(null)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:text-white"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDeleteDraft}
                className="rounded-xl bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-600"
              >
                删除草稿
              </button>
            </div>
          </div>
        </div>
      )}

      {sessionActive && (
        <div className="border-t border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-[#161920]">
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
            调度进行中，按并发槽位 {totalConfiguredSlots} 自动分配卡片任务与轮询。
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiTaskView;
