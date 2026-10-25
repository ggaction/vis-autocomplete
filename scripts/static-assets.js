import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { createHash } from 'node:crypto';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
const compress = promisify(gzip);

// Shared by development and production so release builds retain the same
// bounded compression cache, conditional requests and manifest freshness.
export function createStaticSender(types) {
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
  return async (request, response, path, pathname) => {
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
  };
}
