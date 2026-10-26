import React, { useEffect, useState } from 'react';
import { Favorite } from '../types';
import { parseRunningHubAppInput } from '../services/runningHubRegion';

export default function AppLibraryEditor({ initial, favorites, onSave, onClose, createOnly=false }: {
  createOnly?:boolean;initial: Favorite; favorites: Favorite[]; onSave: (favorites: Favorite[]) => void; onClose: () => void;
}) {
  const [input, setInput] = useState(initial.webappId);
  const [name, setName] = useState(initial.name);
  const [error, setError] = useState('');
  const save = () => {
    const id = parseRunningHubAppInput(input.trim()).appId;
    if (!/^\d+$/.test(id) || !name.trim()) { setError('请填写有效的应用 ID / 详情页链接，以及收藏名称。'); return; }
    const existing = favorites.find(item => parseRunningHubAppInput(item.webappId).appId === id);
    if(existing&&createOnly){setError('此应用已经收藏；请到首页“我的收藏”修改名称。');return;}
    const next = { ...existing, ...initial, webappId: id, name: name.trim() };
    try {
      onSave(existing ? favorites.map(item => item === existing ? next : item) : [...favorites, next]);
      onClose();
    } catch { setError('收藏保存失败，请检查本地存储空间后重试。'); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div role="dialog" aria-label="收藏应用" className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-white p-6 dark:bg-[#161920]">
      <h3 className="text-lg font-bold">{createOnly?'收藏新应用':'收藏应用 / 修改名称'}</h3>
      <label className="block text-sm">应用 ID 或详情页链接<input aria-label="收藏应用 ID" value={input} onChange={e => setInput(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-500 bg-transparent p-2" /></label>
      <label className="block text-sm">我的名称<input aria-label="收藏名称" value={name} onChange={e => setName(e.target.value)} placeholder="例如：H3 分镜生成" className="mt-1 w-full rounded-lg border border-slate-500 bg-transparent p-2" /></label>
      <p className="text-xs text-slate-500">收藏用于找到应用；包含参数和素材的配置请另存为模板。</p>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end gap-3">{favorites.some(item=>parseRunningHubAppInput(item.webappId).appId===parseRunningHubAppInput(initial.webappId).appId)&&<button className="mr-auto text-red-500" onClick={()=>{onSave(favorites.filter(item=>parseRunningHubAppInput(item.webappId).appId!==parseRunningHubAppInput(initial.webappId).appId));onClose();}}>取消收藏</button>}<button onClick={onClose}>取消</button><button onClick={save} className="rounded-lg bg-brand-600 px-4 py-2 text-white">保存收藏</button></div>
    </div>
  </div>;
}
