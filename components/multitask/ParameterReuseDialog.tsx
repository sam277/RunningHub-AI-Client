import React, { useState } from 'react';
import { getSwitchFieldConfig, parseListOptions } from '../../utils/nodeUtils';
import { NodeInfo } from '../../types';

export interface ParameterChange { node: NodeInfo; values: string[]; file?: File; }
export default function ParameterReuseDialog({ nodes, count, variant, onApply, onClose }: {
  nodes: NodeInfo[]; count: number; variant: boolean; onApply: (change: ParameterChange) => void; onClose: () => void;
}) {
  const eligible = nodes.filter(node => !variant || node.fieldType === 'STRING');
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState(eligible[0]?.fieldValue || '');
  const [file, setFile] = useState<File>();
  const node = eligible[index];
  const options = node ? parseListOptions(node) : [];
  const toggle = node ? getSwitchFieldConfig(node) : null;
  const invalidNumber = node && ['INT','FLOAT'].includes(node.fieldType) && (!value.trim() || !Number.isFinite(Number(value)) || (node.fieldType === 'INT' && !Number.isInteger(Number(value))));

  const values = variant ? value.split(/\n\s*---\s*\n/).map(item => item.trim()).filter(Boolean) : [value];
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div role="dialog" aria-label={variant ? '生成参数变体' : '批量修改参数'} className="w-full max-w-2xl space-y-4 rounded-2xl border border-slate-700 bg-white p-6 dark:bg-[#161920]">
      <h3 className="text-lg font-bold">{variant ? '从当前配置生成变体' : '批量修改所选任务'}</h3>
      <p className="text-sm text-slate-500">{variant ? '其他参数和全部素材保持当前配置。不同提示词之间用单独一行 --- 分隔。' : '仅修改选定字段，同时应用到这些任务已有的批量行。其他参数与素材保留。'}</p>
      <select aria-label="要修改的参数" value={index} onChange={e => { const i = Number(e.target.value); setIndex(i); setValue(eligible[i].fieldValue); setFile(undefined); }} className="w-full rounded-lg border border-slate-500 bg-white p-2 dark:bg-slate-900">
        {eligible.map((item, i) => <option key={i} value={i}>{item.description || item.nodeName || item.fieldName} · {item.fieldName}</option>)}
      </select>
      {node && ['IMAGE','AUDIO','VIDEO'].includes(node.fieldType) ? <input aria-label="批量替换素材" type="file" accept={node.fieldType.toLowerCase()+'/*'} onChange={e => { setFile(e.target.files?.[0]); setValue(e.target.files?.[0]?.name || ''); }} /> :
        !variant && toggle ? <select aria-label="统一参数值" value={value} onChange={e => setValue(e.target.value)} className="w-full rounded border border-slate-500 bg-slate-900 p-2"><option value={toggle.checkedValue}>{toggle.checkedLabel}</option><option value={toggle.uncheckedValue}>{toggle.uncheckedLabel}</option></select> :
        !variant && options.length ? <select aria-label="统一参数值" value={value} onChange={e => setValue(e.target.value)} className="w-full rounded border border-slate-500 bg-slate-900 p-2">{options.map(option => <option key={option.index} value={option.index}>{option.name}</option>)}</select> :
        <textarea aria-label={variant ? '变体提示词' : '统一参数值'} rows={8} value={value} onChange={e => setValue(e.target.value)} className="w-full rounded-lg border border-slate-500 bg-transparent p-3" />}
      <p className="text-sm">预览：{variant ? '将新增 '+values.length+' 个任务' : '将修改 '+count+' 个任务'}，不会自动提交生成。</p>
      <div className="flex justify-end gap-3"><button onClick={onClose}>取消</button><button disabled={!node || !!invalidNumber || !values.length || (variant && values.length > 100)} onClick={() => onApply({ node, values, file })} className="rounded-lg bg-brand-600 px-4 py-2 text-white disabled:opacity-50">{variant ? '创建变体' : '应用修改'}</button></div>
      {invalidNumber && <p className="text-red-500">请输入有效的{node.fieldType === 'INT' ? '整数' : '数值'}。</p>}
      {variant && values.length > 100 && <p className="text-red-500">每次最多创建 100 个变体，请分批准备。</p>}
    </div>
  </div>;
}
