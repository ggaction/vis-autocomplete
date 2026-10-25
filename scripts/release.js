import { execFileSync } from 'node:child_process';
import { appendFile, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseTag(ref) {
  if (!/^refs\/tags\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(ref ?? '')) {
    throw new Error('Release requires a user-chosen vMAJOR.MINOR.PATCH tag. Branches and other tag names cannot deploy.');
  }
  return ref.slice('refs/tags/'.length);
}
export function checkedCommit(ref, { cwd } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const tag = releaseTag(ref);
  const sha = git('rev-parse', `${ref}^{commit}`);
  if (git('rev-parse', 'HEAD') !== sha) throw new Error('The checkout does not match the release tag.');
  git('merge-base', '--is-ancestor', sha, 'origin/codex/cloud-deployment');
  const remote = git('ls-remote', '--exit-code', '--tags', 'origin', ref, `${ref}^{}`)
    .split('\n').map(line => line.split(/\s+/));
  const published = remote.find(([, name]) => name === `${ref}^{}`) ?? remote.find(([, name]) => name === ref);
  if (published?.[0] !== sha) throw new Error('The remote tag was removed or changed. Refusing release.');
  return { tag, sha };
}

export async function deployTaggedCommit({ sha, hook, health, fetcher = fetch,
  pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now,
  timeoutMs = 30 * 60_000, intervalMs = 15_000 }) {
  if (!/^[a-f\d]{40}$/.test(sha ?? '')) throw new Error('A full commit SHA is required.');
  let target, endpoint;
  try { target = new URL(hook); endpoint = new URL(health); } catch { throw new Error('Configure the Render deploy hook and HTTPS health URL.'); }
  if (target.origin !== 'https://api.render.com' || !/^\/deploy\/srv-[a-z\d]+$/.test(target.pathname) || !target.searchParams.get('key') || target.username || target.password) {
    throw new Error('Invalid Render deploy hook.');
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Health checks require HTTPS.');
  target.searchParams.set('ref', sha);
  const live = async () => {
    try {
      const response = await fetcher(endpoint, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return false;
      const body = await response.json();
      return body.ok === true && body.release === sha;
    } catch { return false; }
  };
  // Retrying a workflow after a successful deploy does not deploy it again.
  if (await live()) return { alreadyLive: true };
  let response;
  try { response = await fetcher(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Render deploy request was interrupted. Check Render before retrying; its outcome is unknown.'); }
  if (![200, 202].includes(response.status)) throw new Error(`Render rejected deployment (HTTP ${response.status}).`);
  // Never print the secret URL or provider response body, even on failure.
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await pause(intervalMs);
    if (await live()) return { alreadyLive: false };
  }
  throw new Error('The tagged commit did not become healthy before the timeout. No GitHub release was published. Check Render logs.');
}

async function main() {
  if (!['check', 'deploy'].includes(process.argv[2])) throw new Error('Use release.js check or deploy.');
  if (process.env.GITHUB_EVENT_NAME !== 'push') throw new Error('Only a tag push can release.');
  const { tag, sha } = checkedCommit(process.env.GITHUB_REF);
  if (process.argv[2] === 'check') {
    console.log(`Verified ${tag} at ${sha}`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${tag}\nsha=${sha}\n`);
    return;
  }
  await deployTaggedCommit({ sha, hook: process.env.RENDER_DEPLOY_HOOK_URL, health: process.env.PRODUCTION_HEALTH_URL });
  checkedCommit(process.env.GITHUB_REF);
  await writeFile('release-manifest.json', JSON.stringify({ tag, commit: sha,
    dependencies: JSON.parse(await readFile('deployment-sources.json', 'utf8')),
    verifiedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log(`Verified production is serving ${tag} (${sha}).`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
