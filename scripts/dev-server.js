import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { serveChartDownload } from './chart-download.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT ?? 5173);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const compress = promisify(gzip);
export const createDevServer = () => {
  // Stat on every request so editing source/models cannot leave stale responses.
  // Bound retained buffers; compress each file revision once, including workers.
  const files = new Map();
  let retainedBytes = 0;
  const limit = 32 * 1024 * 1024;
  const trim = () => {
    while (retainedBytes > limit && files.size) {
      const key = files.keys().next().value;
      retainedBytes -= files.get(key).bytes; files.delete(key);
    }
  };
  return http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (pathname.startsWith('/api/export/')) {
      await serveChartDownload(request, response, pathname.slice('/api/export/'.length)); return;
    }
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!path.startsWith(`${resolve(root)}${sep}`) || pathname.startsWith('/.')) {
      response.writeHead(403); response.end(); return;
    }
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file');
    const revision = `${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
    let file = files.get(path);
    if (!file || file.revision !== revision) {
      if (file) { retainedBytes -= file.bytes; files.delete(path); }
      file = { revision, bytes: 0 };
      const entry = file;
      files.set(path, entry);
      entry.ready = readFile(path).then(body => {
        entry.body = body;
        entry.etag = `W/"${createHash('sha256').update(body).digest('hex')}"`;
        if (files.get(path) === entry) { entry.bytes = body.length; retainedBytes += entry.bytes; }
      }).catch(error => { if (files.get(path) === entry) files.delete(path); throw error; });
    } else { files.delete(path); files.set(path, file); }
    await file.ready;
    trim();
    const headers = { 'Content-Type': `${types[extname(path)] ?? 'application/octet-stream'}; charset=utf-8`,
      'Cache-Control': pathname === '/data/model-manifest.json' ? 'no-store' : 'no-cache',
      'ETag': file.etag, 'Vary': 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff' };
    if (request.headers['if-none-match']?.split(/\s*,\s*/).includes(file.etag)) {
      response.writeHead(304, headers); response.end(); return;
    }
    let body = file.body;
    const acceptsGzip = (request.headers['accept-encoding'] ?? '').split(',').some(value => {
      const [coding, ...params] = value.trim().split(';');
      return coding === 'gzip' && !params.some(param => /^\s*q=0(?:\.0*)?\s*$/.test(param));
    });
    if (body.length > 1024 && types[extname(path)] && acceptsGzip) {
      if (!file.compressed) file.compressed = compress(body, { level: 1 }).then(buffer => {
        if (files.get(path) === file) { file.bytes += buffer.length; retainedBytes += buffer.length; }
        return buffer;
      });
      body = await file.compressed;
      headers['Content-Encoding'] = 'gzip';
    }
    trim();
    headers['Content-Length'] = body.length;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
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
