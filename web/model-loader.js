// The manifest is committed last by training. Never mix two model generations.
export async function loadModel(name) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const manifestResponse = await fetch('/data/model-manifest.json', { cache: 'no-store' });
    if (!manifestResponse.ok) throw new Error('The model bundle is missing. Run npm run update.');
    const manifest = await manifestResponse.json();
    const response = await fetch(`/data/${name}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`The ${name} model is missing.`);
    const bytes = await response.arrayBuffer();
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest === manifest.files[name]?.sha256) {
      const model = JSON.parse(new TextDecoder().decode(bytes));
      if (model.provenance?.generation === manifest.generation) return model;
    }
  }
  throw new Error('The recommendation models are updating. Reload after training finishes.');
}
