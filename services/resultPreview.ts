import { TaskOutput } from '../types';
import type { ProductionAttempt } from './production';
export function resultMediaKind(output:TaskOutput):'video'|'image'|'audio'|'file'{
  const type=String(output.fileType||'').toLowerCase();let extension='';try{extension=new URL(output.fileUrl||output.downloadUrl||'').pathname.toLowerCase().split('.').pop()||'';}catch{}
  if(/image|png|jpe?g|webp|gif|avif|bmp/.test(type)||/^(png|jpe?g|webp|gif|avif|bmp)$/.test(extension))return 'image';
  if(/audio|mp3|wav|flac|aac|m4a|ogg/.test(type)||/^(mp3|wav|flac|aac|m4a|ogg)$/.test(extension))return 'audio';
  if(/video|mp4|webm|mov|mkv/.test(type)||/^(mp4|webm|mov|mkv)$/.test(extension))return 'video';
  return 'file';
}
export function resultMediaUrl(attempt:ProductionAttempt,index:number,local:boolean):string{
  const file=attempt.files.find(file=>file.index===index);
  if(local&&file&&!attempt.missingResultIndexes?.includes(index))return '/__rh/result/'+encodeURIComponent(file.filename);
  return attempt.outputs[index]?.fileUrl||attempt.outputs[index]?.downloadUrl||'';
}
