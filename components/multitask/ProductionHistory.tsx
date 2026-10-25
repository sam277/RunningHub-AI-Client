import React, { useEffect, useState } from 'react';
import { ApiKeyEntry } from '../../types';
import { ATTEMPT_LABELS, archiveAttempt, listAttemptSummaries, loadAttemptInputs, attemptNumber, ProductionAttempt, recoverAttempt, saveAttempt, setAttemptDecision } from '../../services/production';
import { localRequest, localSession } from '../../services/localPersistence';

export default function ProductionHistory({ accounts, autoSave, onPrepare }: { accounts: ApiKeyEntry[]; autoSave: boolean; onPrepare: (attempt: ProductionAttempt) => void }) {
  const [attempts, setAttempts] = useState<ProductionAttempt[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [taskId, setTaskId] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const refresh = () => { void listAttemptSummaries().then(setAttempts).catch(() => setError('生成记录读取失败，请重新打开后重试。')); };
  useEffect(() => {
    refresh();
    window.addEventListener('rh-production-change', refresh);
    return () => window.removeEventListener('rh-production-change', refresh);
  }, []);
  useEffect(() => {
    let stopped = false;
    const recover = async () => {
      try {
        for (const attempt of await listAttemptSummaries()) {
          if (stopped) return;
          await recoverAttempt(attempt.id, accounts, autoSave);
        }
      } catch { if (!stopped) setError('接续查询暂不可用，可手动继续查询。'); }
    };
    void recover();
    const timer = window.setInterval(recover, 10000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [accounts, autoSave]);
  const act = async (id: string, operation: () => Promise<unknown>) => {
    setBusy(id); setError('');
    try { await operation(); } catch (e: any) { setError(e.message || '操作失败'); } finally { setBusy(null); refresh(); }
  };
  return <section className="h-full overflow-auto p-3" aria-label="生成记录">
    <div className="mb-4 flex items-center justify-between"><h3 className="font-bold">生成记录 · {attempts.length} 次</h3><button onClick={refresh}>刷新记录</button></div>
    <p className="mb-3 text-xs text-slate-500">编号与输出文件前缀对应。恢复只接续查询，下载重试不重新生成。</p>
    {error && <p role="alert" className="text-red-500">{error}</p>}
    {attempts.length === 0 && <p className="text-slate-500">尚无生成记录。准备好的任务不会自动执行。</p>}
    {attempts.map(attempt => <article key={attempt.id} className="mb-2 rounded-lg border border-slate-300 bg-white p-3 dark:border-slate-700 dark:bg-[#161920]">
      <button className="w-full text-left" onClick={() => { setSelected(selected === attempt.id ? null : attempt.id); setTaskId(''); }}>
        <div className="flex items-baseline justify-between gap-2"><strong className="text-brand-600">#{attemptNumber(attempt)}</strong><span className="whitespace-nowrap text-sm">{attempt.usage && (attempt.usage.coinsReported || attempt.usage.coins>0) ? attempt.usage.coins.toLocaleString(undefined,{maximumFractionDigits:2})+' RH' : '积分未返回'}</span></div>
        <div className="mt-1 break-words text-sm font-medium">{attempt.name}</div><span className="text-xs text-brand-600">{attempt.status==='saved'&&attempt.localResultsMissing?'归档文件缺失，可补存':ATTEMPT_LABELS[attempt.status]}</span>
        <p className="mt-1 break-all text-xs text-slate-500">{new Date(attempt.createdAt).toLocaleString()} · {attempt.accountNote} {attempt.decision === 'adopted' ? '· 已采用' : attempt.decision === 'redo' ? '· 待重做' : ''}</p>
      </button>
      {attempt.error && <p className="mt-2 whitespace-pre-wrap text-sm text-amber-600">{attempt.error}</p>}
      <div className="mt-3 flex flex-wrap gap-3 text-sm">
        {['completed','saved','download_failed','generation_failed','interrupted','rejected'].includes(attempt.status) && <button disabled={busy===attempt.id} onClick={() => act(attempt.id,async()=>{const full=await loadAttemptInputs(attempt.id);if(full)onPrepare(full);})}>按此输入准备新任务</button>}
        {attempt.taskId && ['queued','running','query_failed'].includes(attempt.status) && <button disabled={busy === attempt.id} onClick={() => act(attempt.id, () => recoverAttempt(attempt.id, accounts, autoSave))}>继续查询</button>}
        {attempt.outputs.length > 0 && <button disabled={busy === attempt.id || (attempt.status === 'saved' && !attempt.localResultsMissing)} onClick={() => act(attempt.id, () => archiveAttempt(attempt.id))}>{attempt.status === 'saved' && !attempt.localResultsMissing ? '文件已归档' : '保存结果 / 重试下载'}</button>}
        {attempt.files.length>0 && localSession() && <button onClick={()=>act(attempt.id,()=>localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:attempt.files[0].path})}))}>定位文件</button>}
      </div>
      {selected === attempt.id && <div className="mt-4 space-y-3 border-t border-slate-700 pt-3 text-sm">
        <p className="break-all">应用：{attempt.webappId} · 平台编号：{attempt.taskId||'未返回'} · 本地记录：{attempt.id}{attempt.parentAttemptId && ' · 来源记录：'+attempt.parentAttemptId}</p>
        {attempt.outputs.length > 0 && <div className="flex gap-3"><button onClick={() => act(attempt.id, () => setAttemptDecision(attempt.id, 'adopted'))}>标记采用</button><button onClick={() => act(attempt.id, () => setAttemptDecision(attempt.id, 'redo'))}>标记待重做</button></div>}
        <div className="max-h-64 overflow-auto">{attempt.originalNodes.map((node, index) => <p key={index} className="mb-2 whitespace-pre-wrap break-all"><strong>{node.description || node.nodeName || node.fieldName}：</strong>{node.fieldValue}</p>)}</div>
        <p>原始素材：{Object.values(attempt.pendingFiles).map((file: File) => file.name).join('、') || '无本地原件，仅有参数中的远端引用'}</p>
        {attempt.files.map(file => <div key={file.index} className="break-all text-brand-600">已保存：{file.path}{localSession()&&<button className="ml-2" onClick={()=>act(attempt.id,()=>localRequest('/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:file.path})}))}>定位此文件</button>}</div>)}
        {attempt.outputs.map((output, index) => { const saved=attempt.files.find(file=>file.index===index);const mediaUrl=localSession()&&saved&&!attempt.missingResultIndexes?.includes(index) ? '/__rh/result/'+encodeURIComponent(saved.filename) : output.fileUrl;return <div key={index} className="max-w-xl">
          {/image|png|jpg|webp/i.test(output.fileType || '') ? <img src={mediaUrl} className="max-h-72" /> : <video controls preload="none" src={mediaUrl} className="max-h-72 w-full" />}
          <a href={mediaUrl || output.downloadUrl} target="_blank" rel="noreferrer" className="text-brand-600">打开结果 {index+1}</a>
        </div>;})}
        {attempt.status === 'unknown' && <div className="rounded-lg border border-amber-600 p-3">
          <p>先在 RunningHub 核对原账号的任务记录。找到任务时绑定编号，只查询；确认没有提交时才能解除阻止。</p>
          <input aria-label="核对后的平台任务编号" value={taskId} onChange={e => setTaskId(e.target.value)} className="my-2 w-full rounded border border-slate-500 bg-transparent p-2" />
          <div className="flex flex-wrap gap-3"><button disabled={!taskId.trim() || busy === attempt.id} onClick={() => act(attempt.id, async () => { await saveAttempt({ ...attempt, taskId: taskId.trim(), status: 'query_failed', error: undefined }); await recoverAttempt(attempt.id, accounts, autoSave); })}>绑定编号并查询</button>
            <button disabled={busy === attempt.id} onClick={() => act(attempt.id, () => saveAttempt({ ...attempt, status: 'rejected', error: '用户已在平台核对并确认本次未提交；允许手动发起新生成。' }))}>我已在平台确认本次未提交</button></div>
        </div>}
      </div>}
    </article>)}
  </section>;
}
