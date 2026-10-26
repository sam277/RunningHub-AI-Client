import { ApiKeyEntry } from '../types';

export interface AccountImportRow { line: number; apiKey: string; note: string; issue?: string; duplicate?: boolean;enabled?:boolean; }
export function parseAccountImport(text: string, existing: ApiKeyEntry[]): AccountImportRow[] {
  const seen=new Set(existing.map(item=>item.apiKey.trim()).filter(Boolean));
  const rows:AccountImportRow[]=[];
  const add=(apiKey:unknown,note:unknown,line:number,enabled?:boolean)=>{
    const key=typeof apiKey==='string'?apiKey.trim():'',label=typeof note==='string'?note.trim():'';
    const issue=!key?'缺少 API Key':/\s/.test(key)?'API Key 中含空白，请核对分组':!label?'缺少备注 / 邮箱':/[\r\n]/.test(label)?'备注需要保持一行':undefined;
    const duplicate=!!key&&seen.has(key);rows.push({line,apiKey:key,note:label,issue,duplicate,enabled});if(key&&!issue)seen.add(key);
  };
  if(!text.trim())return rows;
  if(text.trimStart().startsWith('[')||text.trimStart().startsWith('{')){
    try { const parsed=JSON.parse(text),items=Array.isArray(parsed)?parsed:parsed.accounts;if(!Array.isArray(items))throw Error();items.forEach((item,i)=>add(item?.apiKey,item?.note,i+1,typeof item?.enabled==='boolean'?item.enabled:undefined)); }
    catch { rows.push({line:1,apiKey:'',note:'',issue:'JSON 格式错误，需要账号数组或 accounts 数组'}); }
    return rows;
  }
  // Blank lines are separators, never a reason to silently pair a key with the next group's key.
  const blocks=text.replace(/\r\n?/g,'\n').split(/\n\s*\n/);let offset=1;
  for(const block of blocks){const lines=block.split('\n'),items=lines.map((value,index)=>({value:value.trim(),line:offset+index})).filter(item=>item.value);for(let i=0;i<items.length;i+=2)add(items[i].value,items[i+1]?.value,items[i].line);offset+=lines.length+1;}
  return rows;
}
export function mergeImportedAccounts(existing:ApiKeyEntry[],rows:AccountImportRow[]):{accounts:ApiKeyEntry[];added:ApiKeyEntry[]} {
  const accounts=[...existing],seen=new Set(existing.map(item=>item.apiKey.trim()).filter(Boolean)),added:ApiKeyEntry[]=[];
  for(const row of rows){if(row.issue||row.duplicate||seen.has(row.apiKey))continue;const entry:ApiKeyEntry={id:crypto.randomUUID(),apiKey:row.apiKey,note:row.note,enabled:false,concurrency:1,accountInfo:null,apiInfo:null};accounts.push(entry);added.push(entry);seen.add(row.apiKey);}
  return {accounts,added};
}
export const exportAccounts=(accounts:ApiKeyEntry[],format:'text'|'json'='text')=>format==='json'?JSON.stringify({version:1,accounts:accounts.filter(a=>a.apiKey.trim()).map(({apiKey,note,enabled})=>({apiKey,note:note||'',enabled:enabled!==false}))},null,2):accounts.filter(a=>a.apiKey.trim()).map(a=>a.apiKey.trim()+'\n'+(a.note?.trim()||'未备注账号')).join('\n\n');
export const maskAccountKey=(key:string)=>key.trim()?key.trim().length>10?key.trim().slice(0,4)+'…'+key.trim().slice(-4):'••••'+key.trim().slice(-2):'未填写';
