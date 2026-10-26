// Browser evaluator shared by JS and Python audits. Read only: no app hooks or
// private source imports are needed, including against a production build.
(async () => {
  const { supabaseUrl } = await (await fetch('/api/config')).json();
  const authKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
  const owner = JSON.parse(localStorage.getItem(authKey))?.user?.id;
  if (!owner) throw new Error('No signed-in account for the project audit.');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(`visualization-autocomplete-account-${owner}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(['projects', 'datasets'], 'readonly');
      const request = tx.objectStore('projects').get('draft');
      let project;
      request.onsuccess = () => {
        project = request.result;
        if (project?.storageVersion !== 2) return;
        delete project.storageVersion;
        delete project.checkpointRevision;
        for (const record of project.datasets) {
          const data = tx.objectStore('datasets').get(record.id);
          data.onsuccess = () => { record.imported = data.result; delete record.dataRevision; };
        }
      };
      tx.oncomplete = () => project ? resolve(project) : reject(new Error('No saved project.'));
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('Project read aborted.'));
    });
  } finally { database.close(); }
})()
