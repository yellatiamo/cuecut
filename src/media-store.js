const DB_NAME = 'cuecut-media-v1';
const DB_VERSION = 1;
const STORE = 'blobs';

/** Per-file cap; larger imports stay in-memory for this session only. */
export const MAX_MEDIA_BYTES = 80 * 1024 * 1024;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

export function canStoreBlob(blob) {
  return !!(blob && typeof blob.size === 'number' && blob.size > 0 && blob.size <= MAX_MEDIA_BYTES);
}

export async function putMediaBlob(id, blob) {
  if (!id || !canStoreBlob(blob)) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(blob, id);
    });
    return true;
  } catch (err) {
    console.warn('cuecut idb put', err);
    return false;
  }
}

export async function getMediaBlob(id) {
  if (!id) return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function deleteMediaBlob(id) {
  if (!id) return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(id);
    });
    return true;
  } catch (err) {
    console.warn('cuecut idb delete', err);
    return false;
  }
}
