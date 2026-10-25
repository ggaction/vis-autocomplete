import test from 'node:test';
import assert from 'node:assert/strict';
import { deployTaggedCommit, releaseTag, checkedCommit } from '../scripts/release.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = 'a'.repeat(40), hook = 'https://api.render.com/deploy/srv-test?key=private', health = 'https://example.org/healthz';
const response = (release, ok = true) => ({ ok: true, json: async () => ({ ok, release }) });
test('only explicit stable version tags are releases', () => {
  assert.equal(releaseTag('refs/tags/v1.5.0'), 'v1.5.0');
  for (const ref of ['refs/heads/main', 'refs/heads/v1.5.0', 'v1.5.0', 'refs/tags/v1.05.0', 'refs/tags/vnext', 'refs/tags/v1.5.0-rc.1', 'refs/tags/v1.5.0\n']) assert.throws(() => releaseTag(ref));
});
test('deploy pins the exact commit; stale health and a queued response are not success', async () => {
  const requests = []; let polls = 0;
  const result = await deployTaggedCommit({ sha, hook, health, pause: async () => {}, fetcher: async (url, options) => {
    requests.push([String(url), options.method ?? 'GET']);
    if (options.method === 'POST') return { status: 202 };
    return response(++polls < 3 ? 'b'.repeat(40) : sha);
  } });
  assert.equal(result.alreadyLive, false);
  const posts = requests.filter(([, method]) => method === 'POST');
  assert.equal(posts.length, 1); assert.equal(new URL(posts[0][0]).searchParams.get('ref'), sha);
  assert.equal(polls, 3);
});
test('a healthy exact commit makes retries idempotent', async () => {
  const result = await deployTaggedCommit({ sha, hook, health, fetcher: async (_, options) => {
    assert.notEqual(options.method, 'POST'); return response(sha);
  } });
  assert.equal(result.alreadyLive, true);
});
test('bad configuration and provider errors fail without leaking the hook', async () => {
  for (const invalid of ['', 'http://api.render.com/deploy/srv-test?key=private', 'https://evil.org/deploy/srv-test?key=private']) {
    await assert.rejects(deployTaggedCommit({ sha, hook: invalid, health, fetcher: () => { throw Error('must not fetch'); } }));
  }
  await assert.rejects(deployTaggedCommit({ sha, hook, health, fetcher: async (_, opts) => opts.method === 'POST' ? { status: 401 } : response('old') }), { message: 'Render rejected deployment (HTTP 401).' });
  await assert.rejects(deployTaggedCommit({ sha, hook, health, fetcher: async (_, opts) => {
    if (opts.method === 'POST') throw Error(hook); return response('old');
  } }), error => !error.message.includes('private') && error.message.includes('unknown'));
});
test('a timeout or unhealthy matching SHA cannot publish a release', async () => {
  let now = 0;
  await assert.rejects(deployTaggedCommit({ sha, hook, health, now: () => now, timeoutMs: 30,
    intervalMs: 10, pause: async ms => { now += ms; },
    fetcher: async (_, opts) => opts.method === 'POST' ? { status: 200 } : response(sha, false),
  }), /No GitHub release was published/);
});
test('tag validation peels annotated tags, rejects non-release ancestry and a deleted remote tag', async () => {
  // All refs in this test are isolated fixtures, never application release tags.
  const root = await mkdtemp(join(tmpdir(), 'vis-release-test-'));
  const cwd = join(root, 'work'), origin = join(root, 'remote.git'); await mkdir(cwd);
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init', '--bare', origin); git('init', '-b', 'codex/cloud-deployment');
    git('config', 'user.email', 'test@example.invalid'); git('config', 'user.name', 'Fixture');
    git('remote', 'add', 'origin', origin);
    await writeFile(join(cwd, 'fixture'), 'fixture'); git('add', 'fixture'); git('commit', '-m', 'fixture');
    git('push', '-u', 'origin', 'codex/cloud-deployment');
    git('tag', '-a', 'v0.0.1', '-m', 'fixture'); git('push', 'origin', 'refs/tags/v0.0.1');
    const commit = git('rev-parse', 'HEAD');
    assert.deepEqual(checkedCommit('refs/tags/v0.0.1', { cwd }), { tag: 'v0.0.1', sha: commit });
    git('switch', '-c', 'unreleased'); git('commit', '--allow-empty', '-m', 'unreleased fixture');
    git('tag', 'v0.0.2'); git('push', 'origin', 'refs/tags/v0.0.2');
    assert.throws(() => checkedCommit('refs/tags/v0.0.2', { cwd }));
    assert.throws(() => checkedCommit('refs/tags/v0.0.1', { cwd }), /checkout/);
    git('switch', 'codex/cloud-deployment'); git('push', 'origin', ':refs/tags/v0.0.1');
    assert.throws(() => checkedCommit('refs/tags/v0.0.1', { cwd }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
