// Files are content-addressed once; workspaces, templates and attempts retain references.
const STORE = 'snapshots';
let database: Promise<IDBDatabase> | undefined;
const hashes = new WeakMap<File, Promise<string>>();
const writes = new Map<string, Promise<void>>();
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
async function decode(value: any, db: IDBDatabase): Promise<any> {
  const refs = new Set<string>();
  const visit = (item: any) => {
    if (!item || typeof item !== 'object' || item instanceof Blob) return;
    if (item.$rhFile) refs.add(item.$rhFile); else Object.values(item).forEach(visit);
  };
  visit(value);
  const assets = new Map<string, Blob>();
  if (refs.size) await new Promise<void>((resolve, reject) => {
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
  const db = await openDatabase();
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const tx = db.transaction(STORE); const request = tx.objectStore(STORE).getAllKeys();
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
  });
  return (await Promise.all(keys.filter(key => typeof key === 'string' && key.startsWith(prefix)).map(key => readWorkspaceData<T>(String(key))))).filter(item => item !== undefined) as T[];
}
export function patchWorkspaceFields(key: string, fields: Record<string, unknown>): Promise<boolean> {
  let found = false;
  const operation = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
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


