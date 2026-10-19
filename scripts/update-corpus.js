import { access, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { ROOT, CORPUS_ROOT, trainCorpus } from './train-corpus.js';

const repository = 'https://github.com/ggaction/chart-datasets.git';
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
let exists = false;
try { await access(CORPUS_ROOT); exists = true; } catch {}
if (!exists) {
  await mkdir(dirname(CORPUS_ROOT), { recursive: true });
  git(['clone', '--depth', '1', '--filter=blob:none', '--sparse', repository, CORPUS_ROOT]);
} else {
  const remote = git(['-C', CORPUS_ROOT, 'remote', 'get-url', 'origin']);
  if (remote.replace(/\.git$/, '') !== repository.replace(/\.git$/, '')) throw new Error('Unexpected corpus remote.');
  if (git(['-C', CORPUS_ROOT, 'status', '--porcelain'])) throw new Error('Corpus checkout has local edits; preserving them.');
  git(['-C', CORPUS_ROOT, 'fetch', '--depth', '1', 'origin', 'main']);
  git(['-C', CORPUS_ROOT, 'checkout', '--detach', 'FETCH_HEAD']);
}
// Use Git, not the GitHub Contents API (which stops listing after 1,000 entries).
git(['-C', CORPUS_ROOT, 'sparse-checkout', 'set', '--no-cone',
  '/charts/*/*.gg.mjs', '/charts/*/metadata.json', '/charts/*/data.json',
  '/charts/*/source.vl.json', '/charts/*/resolved-source.vl.json',
  '/README.md', '/LICENSE', '/DATA_SOURCES.md']);
await trainCorpus();
