import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = fileURLToPath(new URL('../', import.meta.url));
const exhaustive = new Set(['action-availability.test.js', 'facet-action-availability.test.js',
  'recommendation-coverage.test.js', 'encoding-suppression-coverage.test.js']);
const discovered = [];
for (const name of (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.js')).sort()) {
  const file = `test/${name}`;
  if (!exhaustive.has(name)) { discovered.push({ file }); continue; }
  // These cases materialize every candidate, unlike the lazy UI. Give each
  // audit its own process so millions of temporary immutable chart objects and
  // their weak ownership tables are reclaimed between cases on every platform.
  const tree = parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const calls = tree.body.filter(node => node.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' && node.expression.callee.name === 'test');
  let registered = 0;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CallExpression' && (node.callee.name === 'test' || node.callee.object?.name === 'test')) registered++;
    for (const child of Object.values(node)) if (Array.isArray(child)) child.forEach(visit); else visit(child);
  };
  visit(tree);
  if (registered !== calls.length) throw new Error(`Exhaustive cases must be top-level test() calls: ${file}`);
  if (!calls.length) throw new Error(`No exhaustive cases found in ${file}`);
  for (const { expression } of calls) {
    const name = expression.arguments[0]?.value;
    if (typeof name !== 'string') throw new Error(`Exhaustive cases need literal names: ${file}`);
    discovered.push({ file, name });
  }
}
const shards = Number(process.env.TEST_SHARD_COUNT ?? 1), shard = Number(process.env.TEST_SHARD_INDEX ?? 0);
const concurrency = Number(process.env.TEST_CONCURRENCY ?? 4);
if (!Number.isInteger(shards) || shards < 1 || !Number.isInteger(shard) || shard < 0 || shard >= shards ||
  !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid test shard or concurrency configuration.');
const jobs = discovered.filter((_, index) => index % shards === shard);
if (!jobs.length) throw new Error('The test shard is empty.');
if (process.argv.includes('--list')) {
  // A growing test list can exceed the pipe buffer. Flush it before exiting so
  // CI shard discovery always receives the complete JSON document.
  await new Promise((resolve, reject) => process.stdout.write(`${JSON.stringify(jobs)}\n`, error => error ? reject(error) : resolve()));
  process.exit(0);
}
console.log(`Test shard ${shard + 1}/${shards}: ${jobs.length}/${discovered.length} processes, concurrency ${concurrency}`);
let cursor = 0, completed = 0, passed = 0, failed = 0;
const run = job => new Promise(resolve => {
  const pattern = job.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const child = spawn(process.execPath, ['--max-old-space-size=512', '--test', '--test-reporter=tap',
    ...(pattern ? [`--test-name-pattern=^${pattern}$`] : []), job.file], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let output = '', timedOut = false;
  child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === 'win32') child.kill('SIGKILL');
    else try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
  }, 10 * 60_000);
  child.on('error', error => { output += error.stack; });
  child.on('close', code => {
    clearTimeout(timer);
    const count = Number(output.match(/^# pass (\d+)$/m)?.[1] ?? 0);
    const ok = code === 0 && count > 0 && !timedOut;
    passed += count; if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${++completed}/${jobs.length} ${job.file}${job.name ? ` — ${job.name}` : ''} (${count} passed)`);
    if (!ok) console.error(`${timedOut ? 'Test process exceeded 10 minutes.\n' : ''}${output}`);
    resolve();
  });
});
await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
  while (cursor < jobs.length) await run(jobs[cursor++]);
}));
console.log(`${passed} tests passed; ${failed} test processes failed.`);
process.exitCode = failed ? 1 : 0;
