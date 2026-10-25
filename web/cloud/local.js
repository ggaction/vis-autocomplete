// Account-scoped durable outbox. Keep events and pending projects through reload
// without copying datasets into every event or using a synchronous storage API.
export function createCloudLocal(indexedDB = globalThis.indexedDB) {
  let connection;
  const db = () => connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('vis-autocomplete-cloud', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const run = async (mode, fn) => {
    const database = await db();
    return new Promise((resolve, reject) => {
      const tx = database.transaction('records', mode), request = fn(tx.objectStore('records'));
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  };
  return { get: key => run('readonly', s => s.get(key)), put: (key, value) => run('readwrite', s => s.put(value, key)),
    remove: key => run('readwrite', s => s.delete(key)), keys: () => run('readonly', s => s.getAllKeys()) };
}
