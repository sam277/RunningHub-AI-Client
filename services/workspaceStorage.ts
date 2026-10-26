import { localRequest, localSession, settingsStorage, flushLocalSettings } from './localPersistence';
// Files are content-addressed once; workspaces, templates and attempts retain references.
const STORE = 'snapshots';
let database: Promise<IDBDatabase> | undefined;
const hashes = new WeakMap<File, Promise<string>>();
const writes = new Map<string, Promise<void>>();
const storedAssets = new Set<string>();
const openDatabase = () => {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('rh-workspaces', 2);
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('本地数据库打开超时，请换用支持 IndexedDB 的浏览器后重试。')), 10000);
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains('assets')) request.result.createObjectStore('assets');
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      clearTimeout(timer);
      request.result.onversionchange = () => { request.result.close(); database = undefined; };
      resolve(request.result);
    };
    request.onerror = () => fail(request.error);
    request.onblocked = () => fail(new Error('请关闭旧窗口后重试本地存储。'));
  }).catch(error => { database = undefined; throw error; });
  return database;
};
async function encode(value: any, assets: Map<string, Blob>): Promise<any> {
  if (value instanceof File) {
    let digest = hashes.get(value);
    if (!digest) {
      digest = value.arrayBuffer().then(buffer => crypto.subtle.digest('SHA-256', buffer))
        .then(buffer => Array.from(new Uint8Array(buffer), n => n.toString(16).padStart(2, '0')).join(''));
      hashes.set(value, digest);
    }
    const hash = await digest;
    assets.set(hash, value);
    return { $rhFile: hash, name: value.name, type: value.type, lastModified: value.lastModified };
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => encode(item, assets)));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await encode(item, assets)])));
  return value;
}
async function decode(value: any, db?: IDBDatabase): Promise<any> {
  const refs = new Set<string>();
  const visit = (item: any) => {
    if (!item || typeof item !== 'object' || item instanceof Blob) return;
    if (item.$rhFile) refs.add(item.$rhFile); else Object.values(item).forEach(visit);
  };
  visit(value);
  const assets = new Map<string, Blob>();
  if (refs.size && !db) await Promise.all([...refs].map(async hash => {
    assets.set(hash, await localRequest<Blob>('/asset/'+hash)); storedAssets.add(hash);
  }));
  if (refs.size && db) await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('assets');
    refs.forEach(hash => { const request = tx.objectStore('assets').get(hash); request.onsuccess = () => assets.set(hash, request.result); });
    tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
  });
  const restore = (item: any): any => {
    if (!item || typeof item !== 'object' || item instanceof Blob) return item;
    if (item.$rhFile) {
      const blob = assets.get(item.$rhFile);
      if (!blob) throw new Error('本地素材缺失，请重新选择：' + item.name);
      const file = new File([blob], item.name, { type: item.type, lastModified: item.lastModified });
      hashes.set(file, Promise.resolve(item.$rhFile));
      return file;
    }
    return Array.isArray(item) ? item.map(restore) : Object.fromEntries(Object.entries(item).map(([key, val]) => [key, restore(val)]));
  };
  return restore(value);
}
export async function readWorkspaceData<T>(key: string): Promise<T | undefined> {
  if (localSession()) return decode((await localRequest<{value?:T}>('/snapshot/'+encodeURIComponent(key))).value);
  const db = await openDatabase();
  const value = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction(STORE); const request = tx.objectStore(STORE).get(key);
    tx.oncomplete = () => resolve(request.result); tx.onabort = tx.onerror = () => reject(tx.error);
  });
  return decode(value, db);
}
const snapshotValue = (value: any): any => {
  if (!value || typeof value !== 'object' || value instanceof Blob) return value;
  return Array.isArray(value) ? value.map(snapshotValue) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotValue(item)]));
};
export function writeWorkspaceData(key: string, value: unknown): Promise<void> {
  const snapshot = snapshotValue(value);
  const operation = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const assets = new Map<string, Blob>();
    const payload = await encode(snapshot, assets);
    if (localSession()) {
      for (const [hash,blob] of assets) if (!storedAssets.has(hash)) { await localRequest('/asset/'+hash,{method:'PUT',body:blob}); storedAssets.add(hash); }
      await localRequest('/snapshot/'+encodeURIComponent(key),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:payload})});
      return;
    }
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, 'assets'], 'readwrite');
      assets.forEach((blob, hash) => {
        const exists = tx.objectStore('assets').getKey(hash);
        exists.onsuccess = () => { if (exists.result === undefined) tx.objectStore('assets').put(blob, hash); };
      });
      tx.objectStore(STORE).put(payload, key);
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error || new Error('本地保存失败'));
    });
  });
  writes.set(key, operation);
  void operation.finally(() => { if (writes.get(key) === operation) writes.delete(key); }).catch(() => {});
  return operation;
}
export async function listWorkspaceData<T>(prefix: string): Promise<T[]> {
  if (localSession()) return Promise.all((await localRequest<T[]>('/snapshots?prefix='+encodeURIComponent(prefix))).map(item=>decode(item)));
  const db = await openDatabase();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(STORE); const request = tx.objectStore(STORE).getAllKeys();
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
  });
  return (await Promise.all(keys.filter(key => typeof key === 'string' && key.startsWith(prefix)).map(key => readWorkspaceData<T>(String(key))))).filter(item => item !== undefined) as T[];
}
export async function readWorkspaceMetadata<T>(key:string):Promise<T|undefined> {
  return localSession() ? (await localRequest<{value?:T}>('/snapshot/'+encodeURIComponent(key))).value : readWorkspaceData<T>(key);
}
export async function listWorkspaceMetadata<T>(prefix:string):Promise<T[]> {
  return localSession() ? localRequest<T[]>('/snapshots?prefix='+encodeURIComponent(prefix)) : listWorkspaceData<T>(prefix);
}
export function patchWorkspaceFields(key: string, fields: Record<string, unknown>): Promise<boolean> {
  let found = false;
  const operation = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    if (localSession()) { found=(await localRequest<{found:boolean}>('/snapshot/'+encodeURIComponent(key),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({fields})})).found; return; }
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => {
        if (request.result !== undefined) { found = true; tx.objectStore(STORE).put({ ...request.result, ...fields }, key); }
      };
      tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
    });
  });
  writes.set(key, operation);
  void operation.finally(() => { if (writes.get(key) === operation) writes.delete(key); }).catch(() => {});
  return operation.then(() => found);
}

export async function allocateGenerationSequence(id: string): Promise<number> {
  if(localSession()) return (await localRequest<{sequence:number}>('/sequence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'attempt:'+id})})).sequence;
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE);let number=0;const previous=store.get('attempt:'+id);previous.onsuccess=()=>{if(previous.result?.sequence){number=previous.result.sequence;return;}const counter=store.get('__sequence');counter.onsuccess=()=>{number=Number(counter.result||0)+1;store.put(number,'__sequence');if(previous.result)store.put({...previous.result,sequence:number},'attempt:'+id);};};tx.oncomplete=()=>resolve(number);tx.onerror=tx.onabort=()=>reject(tx.error);});
}

export async function migrateLegacyWorkspace(force=false): Promise<number> {
  if(!localSession()||(!force&&settingsStorage.getItem('rh_legacy_workspace_migrated')==='true'))return 0;
  if(!indexedDB.databases)return 0;
  const names=await Promise.race([indexedDB.databases(),new Promise<IDBDatabaseInfo[]>((_,reject)=>setTimeout(()=>reject(new Error('浏览器旧数据库检查超时；旧数据未删除，请重试迁移。')),5000))]);
  if(!names.some(item=>item.name==='rh-workspaces'))return 0;
  const db=await openDatabase();
  const entries=await new Promise<{key:string;value:any}[]>((resolve,reject)=>{const tx=db.transaction(STORE),store=tx.objectStore(STORE),keys=store.getAllKeys(),values=store.getAll();tx.oncomplete=()=>resolve(keys.result.map((key,i)=>({key:String(key),value:values.result[i]})).filter(item=>item.key!=='__sequence'));tx.onerror=tx.onabort=()=>reject(tx.error);});
  const packed=[];
  for(const item of entries){const assets=new Map<string,Blob>();const value=await encode(await decode(item.value,db),assets);for(const [hash,blob]of assets)if(!storedAssets.has(hash)){await localRequest('/asset/'+hash,{method:'PUT',body:blob});storedAssets.add(hash);}packed.push({key:item.key,value});}
  const result=await localRequest<{imported:number}>('/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({entries:packed})});
  if(packed.length) { try { await localRequest('/backups',{method:'POST'}); } catch(error:any) { settingsStorage.setItem('rh_legacy_backup_warning',error.message||'旧数据迁移后的完整备份未完成，请检查缺失文件。'); } }
  settingsStorage.setItem('rh_legacy_workspace_migrated','true');await flushLocalSettings();
  return result.imported;
}



export interface GenerationNumber {sequence:number;displaySequence:number;sequenceBatch:number;}
export async function allocateGenerationNumber(id:string):Promise<GenerationNumber>{
  if(localSession())return localRequest<GenerationNumber>('/sequence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'attempt:'+id})});
  const sequence=await allocateGenerationSequence(id);return {sequence,displaySequence:sequence,sequenceBatch:1};
}
