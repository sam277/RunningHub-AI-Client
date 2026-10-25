// IndexedDB preserves File objects; JSON/localStorage would silently turn them into {}.
const DB_NAME = 'rh-workspaces';
const STORE_NAME = 'snapshots';
let database: Promise<IDBDatabase> | undefined;

const openDatabase = () => {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('本地工作区存储被其他窗口阻塞，请关闭旧窗口后重试。'));
    }).catch(error => { database = undefined; throw error; });
  }
  return database;
};

export const readWorkspaceData = async <T>(key: string): Promise<T | undefined> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    tx.oncomplete = () => resolve(request.result as T | undefined);
    tx.onabort = () => reject(tx.error || new Error('读取本地工作区失败'));
    tx.onerror = () => reject(tx.error);
  });
};

export const writeWorkspaceData = async (key: string, value: unknown): Promise<void> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('保存失败，可能是本地存储空间不足'));
    tx.onerror = () => reject(tx.error);
  });
};
