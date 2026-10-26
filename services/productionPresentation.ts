import type { ProductionAttempt } from './production';
export function formatDuration(seconds:number):string {
  const value=Math.max(0,Math.round(seconds));if(value<60)return value+'秒';
  const hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),rest=value%60;
  return (hours?hours+'小时':'')+(minutes?minutes+'分':'')+(rest?rest+'秒':'');
}
export function attemptDuration(attempt:ProductionAttempt,now=Date.now()):{label:string;value:string;source:string} {
  if(attempt.usage&&(attempt.usage.taskTimeReported||attempt.usage.taskTime>0))return {label:'用时',value:formatDuration(attempt.usage.taskTime),source:'平台返回的任务耗时，不包含本地上传与下载'};
  const end=attempt.timings?.generationObservedAt||attempt.timings?.failedAt;
  if(end&&end>=attempt.createdAt)return {label:'总等待',value:formatDuration((end-attempt.createdAt)/1000),source:'从准备素材到本地观察到结果，包含上传、排队和离线期间等待；不是平台精确生成耗时'};
  if(['preparing','submitting','queued','running','query_failed','unknown'].includes(attempt.status))return {label:'已等待',value:formatDuration((now-attempt.createdAt)/1000),source:'从本次任务建立起计算，包含排队和暂停查询的时间'};
  return {label:'用时',value:'未记录',source:'旧记录或接口缺少可确认的时间数据'};
}
export function timingDetails(attempt:ProductionAttempt):[string,string][] {
  const t=attempt.timings;if(!t)return [];
  const rows:[string,string][]=[];
  const add=(label:string,start?:number,end?:number)=>{if(start&&end&&end>=start)rows.push([label,formatDuration((end-start)/1000)]);};
  add('素材准备',attempt.createdAt,t.submissionStartedAt);add('提交响应',t.submissionStartedAt,t.acceptedAt);
  add('排队观察',t.acceptedAt,t.runningObservedAt);add('运行观察',t.runningObservedAt,t.generationObservedAt);
  add('归档',t.archiveStartedAt,t.archivedAt);add('总等待',attempt.createdAt,t.generationObservedAt||t.failedAt);
  return rows;
}
