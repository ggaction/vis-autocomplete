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
  const range = prefix => prefix === undefined ? undefined : IDBKeyRange.bound(prefix, prefix + '\uffff');
  return { get: key => run('readonly', s => s.get(key)), put: (key, value) => run('readwrite', s => s.put(value, key)),
    has: async key => (await run('readonly', s => s.count(key))) > 0,
    remove: key => run('readwrite', s => s.delete(key)), keys: prefix => run('readonly', s => s.getAllKeys(range(prefix))),
    async update(key, transform) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('records', 'readwrite'), store = tx.objectStore('records');
        const request = store.get(key); let value;
        request.onsuccess = () => {
          try { value = transform(request.result); if (value !== undefined) store.put(value, key); }
          catch (error) { tx.abort(); reject(error); }
        };
        tx.oncomplete = () => resolve(value); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
    },
    async entries(prefix, limit = 256) {
      const database = await db();
      return new Promise((resolve, reject) => {
        const tx = database.transaction('records', 'readonly'), result = [];
        const request = tx.objectStore('records').openCursor(range(prefix));
        request.onsuccess = () => { const cursor = request.result; if (!cursor || result.length >= limit) return;
          result.push([cursor.key, cursor.value]); cursor.continue(); };
        tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error);
      });
    } };
}
