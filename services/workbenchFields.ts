import { NodeInfo, PendingFilesMap } from '../types';
import { getSwitchFieldConfig, parseListOptions } from '../utils/nodeUtils';

export const fieldKey=(node:NodeInfo)=>JSON.stringify([node.nodeId,node.fieldName]);
export const fieldLabel=(node:NodeInfo)=>node.description||node.nodeName||node.fieldName;
export const fieldType=(node:NodeInfo)=>getSwitchFieldConfig(node)?'SWITCH':parseListOptions(node).length?'LIST':node.fieldType.toUpperCase();
export const isMediaField=(node:NodeInfo)=>['IMAGE','AUDIO','VIDEO','FILE'].includes(fieldType(node));
export const isTextField=(node:NodeInfo)=>!isMediaField(node)&&!['SWITCH','BOOLEAN','LIST','INT','INTEGER','FLOAT','DOUBLE','NUMBER'].includes(fieldType(node));
export const schemaKey=(appId:string,nodes:NodeInfo[])=>JSON.stringify([appId,nodes.map(node=>{const toggle=getSwitchFieldConfig(node),domain=toggle?[toggle.checkedValue,toggle.uncheckedValue]:parseListOptions(node).map(option=>option.index).sort();return [node.nodeId,node.fieldName,fieldType(node),domain,!!node.required];}).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]);
export const pendingKey=(node:NodeInfo)=>`single|${node.nodeId}|${node.fieldName}`;
export const hasFieldValue=(value:string)=>!['','none','null','undefined'].includes(String(value??'').trim().toLowerCase());
export const defaultPinnedFields=(nodes:NodeInfo[])=>nodes.filter(n=>!isMediaField(n)&&!isTextField(n)).slice(0,6).map(fieldKey);
export const mediaFileKind=(file:Pick<File,'type'|'name'>)=>{
  if(/^(image|video|audio)\//i.test(file.type))return file.type.split('/')[0].toLowerCase();
  if(file.type&&file.type!=='application/octet-stream')return 'file';
  const ext=file.name.split('.').pop()?.toLowerCase()||'';
  return /^(png|jpe?g|webp|gif|bmp|avif|heic|tiff?)$/.test(ext)?'image':/^(mp4|webm|mov|mkv|m4v|avi)$/.test(ext)?'video':/^(wav|mp3|m4a|aac|ogg|flac|opus)$/.test(ext)?'audio':'file';
};
export function pastedMedia(data:Pick<DataTransfer,'files'|'items'>,type:string):{file?:File;error?:string}{
  const files=Array.from(data.files||[]);
  if(!files.length)for(const item of Array.from(data.items||[])){if(item.kind==='file'){const file=item.getAsFile();if(file)files.push(file);}}
  if(!files.length)return {error:'剪贴板未提供媒体文件。网页地址或播放器链接请另行处理，也可直接拖入本地文件。'};
  const matches=files.filter(file=>file.size>0&&(type==='FILE'||mediaFileKind(file)===type.toLowerCase()));
  if(matches.length!==1||files.length!==1)return {error:files.length>1?'一次向一个素材框粘贴一个文件。':'文件类型与当前素材框不匹配，原素材已保留。'};
  return {file:matches[0]};
}

const hashes=new WeakMap<Blob,Promise<string>>();
export const fileDigest=(file:Blob)=>{let value=hashes.get(file);if(!value){value=file.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,'0')).join(''));hashes.set(file,value);}return value;};
export async function fieldTokens(nodes:NodeInfo[],files:PendingFilesMap){
  return Object.fromEntries(await Promise.all(nodes.map(async node=>{const file=files[pendingKey(node)],stored=file as unknown as {$rhFile?:string}|undefined;return [fieldKey(node),file instanceof Blob?'file:'+await fileDigest(file):stored?.$rhFile?'file:'+stored.$rhFile:String(node.fieldValue??'')];})).then(items=>items.sort(([a],[b])=>a.localeCompare(b))));
}
export async function configurationFingerprint(nodes:NodeInfo[],files:PendingFilesMap,options:unknown={}){
  const tokens=await fieldTokens(nodes,files);
  return JSON.stringify([Object.entries(tokens).sort(([a],[b])=>a.localeCompare(b)),options]);
}

export const preferenceGroup=(appId:string,nodes:NodeInfo[])=>{let hash=2166136261;for(const char of schemaKey(appId,nodes))hash=Math.imul(hash^char.charCodeAt(0),16777619);return (hash>>>0).toString(16);};
export async function taskConfigurationDigest(input:{nodes:NodeInfo[];pendingFiles:PendingFilesMap;batchList?:NodeInfo[][];instanceType?:string;runOptions?:{accessPassword?:string;retainSeconds?:number}},appId:string){
  const rows=input.batchList||[];
  const effective=(nodes:NodeInfo[],index:number)=>{
    const result:PendingFilesMap={};
    for(const owner of ['single',nodes[0]?._taskId||'task-'+index,'task-'+index])for(const [key,file] of Object.entries(input.pendingFiles)){
      const [scope,id,name]=key.split('|');if(scope===owner){const node=nodes.find(n=>n.nodeId===id&&n.fieldName===name);if(node)result[pendingKey(node)]=file;}
    }
    return result;
  };
  const value=JSON.stringify([schemaKey(appId,input.nodes),await fieldTokens(input.nodes,input.pendingFiles),await Promise.all(rows.map((nodes,index)=>fieldTokens(nodes,effective(nodes,index)))),input.instanceType||'default',input.runOptions?.retainSeconds??null,input.runOptions?.accessPassword||'']);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
}
