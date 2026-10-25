import { readdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';

const root = fileURLToPath(new URL('../', import.meta.url));
const exhaustive = new Set(['action-availability.test.js', 'facet-action-availability.test.js',
  'recommendation-coverage.test.js', 'encoding-suppression-coverage.test.js']);
const jobs = [];
for (const name of (await readdir(new URL('../test/', import.meta.url))).filter(name => name.endsWith('.test.js')).sort()) {
  const file = `test/${name}`;
  if (!exhaustive.has(name)) { jobs.push({ file }); continue; }
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
    jobs.push({ file, name });
  }
}
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
await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
  while (cursor < jobs.length) await run(jobs[cursor++]);
}));
console.log(`${passed} tests passed; ${failed} test processes failed.`);
process.exitCode = failed ? 1 : 0;
