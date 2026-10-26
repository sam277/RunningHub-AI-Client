import React from 'react';
export interface StructuredLog { at:number;message:string;account?:string;balance?:string;balanceAt?:number; }
export type RunLogEntry=string|StructuredLog;
export default function RunLog({entries}:{entries:RunLogEntry[]}){
  return <div className="run-log min-h-0 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs" aria-label="运行日志内容">{!entries.length?'暂无日志':entries.map((entry,index)=><p key={index} className="mb-2 break-words">{typeof entry==='string'?entry:<><span className="text-slate-500">[{new Date(entry.at).toLocaleTimeString()}] </span>{entry.account!==undefined?<>调度到 <span className="key-data" data-log-account>{entry.account}</span>，查询时剩余 RH 积分 <span className="key-data" data-log-balance>{entry.balance}</span><span className="text-slate-500">（{new Date(entry.balanceAt||entry.at).toLocaleTimeString()}）</span></>:entry.message}</>}</p>)}</div>;
}
