import { authorizationHeaders } from './cloud/session.js';

const filename = name => `${(name || 'visualization').normalize('NFKC')
  .replace(/\.(csv|json)$/i, '').replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'visualization'}-chart`;

export function initializeChartDownloads({ host, getCurrent, isBusy, onError }) {
  let downloading = false;
  const exports = new WeakMap();
  const buttons = [...host.querySelectorAll('button[data-format]')];
  const refresh = () => {
    host.hidden = !getCurrent()?.program?.graphicSpec;
    for (const button of buttons) button.disabled = downloading || isBusy();
  };
  for (const button of buttons) button.addEventListener('click', async () => {
    const current = getCurrent();
    if (!current?.program?.graphicSpec || isBusy() || downloading) return;
    const { program, name } = current, format = button.dataset.format;
    downloading = true; host.setAttribute('aria-busy', 'true'); refresh();
    try {
      if (!exports.has(program)) exports.set(program, new Map());
      const cache = exports.get(program);
      if (!cache.has(format)) cache.set(format, (async () => {
        const response = await fetch(`/api/export/${format}`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...await authorizationHeaders() }, body: JSON.stringify({ graphicSpec: program.graphicSpec }) });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || `Could not export ${format.toUpperCase()}.`);
        }
        return response.blob();
      })().catch(error => { cache.delete(format); throw error; }));
      const blob = await cache.get(format), url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${filename(name)}.${format}`;
      link.hidden = true; document.body.append(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch (error) { onError?.(error.message); }
    finally { downloading = false; host.removeAttribute('aria-busy'); refresh(); }
  });
  refresh();
  return { refresh };
}
