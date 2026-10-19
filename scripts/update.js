import { execFileSync } from 'node:child_process';
import { ROOT } from './train-corpus.js';

const run = (command, args, cwd = ROOT) => execFileSync(command, args, { cwd, stdio: 'inherit' });
const library = new URL('../vendor/ggaction/', import.meta.url);
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: library, encoding: 'utf8' });
if (dirty.trim()) throw new Error('Commit ggaction source changes before updating; local features must be preserved.');
// Merge upstream into the feature branch. Never replace the source dependency
// with an npm release that would silently remove locally implemented actions.
run('git', ['fetch', 'origin'], library);
const upstream = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'],
  { cwd: library, encoding: 'utf8' }).trim();
run('git', ['merge', '--no-edit', upstream], library);
run('npm', ['ci'], library);
run('npm', ['install', '--ignore-scripts']);
run('npm', ['run', 'test:unit'], library);
run('npm', ['run', 'test:contracts'], library);
for (const script of ['catalog:check', 'corpus:update', 'build:workers', 'test', 'demo', 'demo:initial', 'validate:corpus', 'validate:initial']) run('npm', ['run', script]);
