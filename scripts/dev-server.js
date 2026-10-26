import { createResearchIngest } from './research-ingest.js';
import http from 'node:http';
import { publicConfig } from './cloud-config.js';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticSender } from './static-assets.js';
import { serveChartDownload } from './chart-download.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
export const createDevServer = () => {
  const sendStatic = createStaticSender(types);
  const ingestResearch = createResearchIngest(publicConfig());
  return http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname === '/api/research') { await ingestResearch(request,response); return; }
    if (pathname === '/api/config') { response.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'}); response.end(JSON.stringify(publicConfig())); return; }
    if (pathname.startsWith('/api/export/')) {
      await serveChartDownload(request, response, pathname.slice('/api/export/'.length)); return;
    }
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${resolve(root)}${sep}`) || pathname.startsWith('/.')) {
      response.writeHead(403); response.end(); return;
    }
    await sendStatic(request, response, path, pathname);
  } catch { response.writeHead(404); response.end('Not found'); }
  });
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { buildBrowser } = await import('./build-browser.js');
  const build = await buildBrowser({ watch: true });
  const server = createDevServer();
  server.listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}`));
  const stop = async () => { server.closeAllConnections(); server.close(); await build.dispose(); process.exit(); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
