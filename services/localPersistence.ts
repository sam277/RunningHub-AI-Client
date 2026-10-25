export interface LocalSession { token: string; rootPath: string; mode: 'local'; version: number; }
export interface LocalSummary { rootPath: string; databaseFile: string; bytes: number; files: number; settings: number; snapshots: number; keyProtection: string; }
const localFlushers=new Set<()=>Promise<void>>();
let workspaceReloading=false;
export const registerLocalFlusher=(fn:()=>Promise<void>)=>{localFlushers.add(fn);return()=>{localFlushers.delete(fn);};};
export const isWorkspaceReloading=()=>workspaceReloading;
export const setWorkspaceReloading=(value:boolean)=>{workspaceReloading=value;};
export async function flushLocalState(){await flushLocalSettings();await Promise.all([...localFlushers].map(fn=>fn()));}
let session: LocalSession | undefined;
let values = new Map<string,string>();
const dirty = new Map<string,string|null>();
let saving: Promise<void> = Promise.resolve();
let scheduled = false;
let errorMessage = '';
export const localSession = () => session;
export const localSaveStatus = () => ({ pending: dirty.size > 0 || scheduled, error: errorMessage, rootPath: session?.rootPath });
const notify = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('rh-local-status')); };
export async function localRequest<T=any>(path: string, options: RequestInit = {}): Promise<T> {
  if (!session) throw new Error('本地数据服务尚未连接，请通过启动工作台入口打开。');
  const response = await fetch('/__rh'+path, { ...options, cache:'no-store', headers:{ ...options.headers, 'X-RH-Token':session.token } });
  if (!response.ok) { const body = await response.json().catch(()=>({})); throw new Error(body.error || '本地保存失败（'+response.status+'）'); }
  if (path.startsWith('/asset/') && options.method !== 'PUT') return await response.blob() as T;
  return response.json();
}
function scheduleSave() {
  if (scheduled || !session || !dirty.size) return;
  scheduled = true; notify();
  saving = Promise.resolve().then(async () => {
    while (dirty.size) {
      const batch = Object.fromEntries(dirty);
      await localRequest('/settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(batch) });
      for (const [key,value] of Object.entries(batch)) if (dirty.get(key) === value) dirty.delete(key);
    }
    errorMessage = '';
  }).catch(error => { errorMessage = error.message || '本地设置保存失败'; throw error; }).finally(()=>{ scheduled=false; notify(); });
  void saving.catch(()=>{});
}
export async function flushLocalSettings() { scheduleSave(); await saving; if (dirty.size) { scheduleSave(); await saving; } }
export const settingsStorage: Pick<Storage,'getItem'|'setItem'|'removeItem'> = {
  getItem(key) { return session ? values.get(key) ?? null : typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; },
  setItem(key,value) { if (!session) { window.localStorage.setItem(key,value); return; } values.set(key,String(value));dirty.set(key,String(value));scheduleSave(); },
  removeItem(key) { if (!session) { window.localStorage.removeItem(key); return; } values.delete(key);dirty.set(key,null);scheduleSave(); },
};
export async function initializeLocalPersistence() {
  const response=await fetch('/__rh/session',{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('当前入口没有本地数据服务。请使用“启动工作台.cmd”，不要使用旧的网页启动脚本。');
  session=await response.json();
  const disk=await localRequest<Record<string,string>>('/settings');
  const imports: Record<string,string> = {};
  for (let i=0;i<window.localStorage.length;i++) { const key=window.localStorage.key(i); if(key?.startsWith('rh_') && disk[key] === undefined) { const value=window.localStorage.getItem(key);if(value!==null)imports[key]=value; } }
  if (disk.rh_save_api_enabled === undefined && imports.rh_save_api_enabled === undefined) imports.rh_save_api_enabled='true';
  if (disk.rh_autosave_config === undefined && imports.rh_autosave_config === undefined) imports.rh_autosave_config=JSON.stringify({enabled:true,directoryName:'results',directoryPath:session!.rootPath+'\\results'});
  if(Object.keys(imports).length) await localRequest('/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(imports)});
  values=new Map(Object.entries({...disk,...imports}));
  // Only remove migrated browser credentials after a successful durable write.
  for(const key of ['rh_api_keys_v2','rh_enterprise_api_v1']) if(values.has(key)) window.localStorage.removeItem(key);
  window.addEventListener('beforeunload',event=>{if(dirty.size){event.preventDefault();event.returnValue='';}});
  notify(); return session;
}
export async function refreshLocalSettings() { values=new Map(Object.entries(await localRequest<Record<string,string>>('/settings')));dirty.clear();errorMessage='';notify(); }
