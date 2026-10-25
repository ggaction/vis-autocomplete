import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

test('CI shards cover every test process once and reject invalid or empty partitions', () => {
  const list = overrides => JSON.parse(execFileSync(process.execPath, ['scripts/test-suite.js', '--list'], {
    encoding: 'utf8', env: { ...process.env, TEST_SHARD_INDEX: '0', TEST_SHARD_COUNT: '1', TEST_CONCURRENCY: '2', ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
  const full = list({});
  assert.deepEqual(new Set(full.map(job => job.file)), new Set(readdirSync('test').filter(name => name.endsWith('.test.js')).map(name => `test/${name}`)));
  const shards = Array.from({ length: 4 }, (_, index) => list({ TEST_SHARD_INDEX: String(index), TEST_SHARD_COUNT: '4' }));
  assert.ok(shards.every(jobs => jobs.length > 0));
  const combined = shards.flat().map(job => JSON.stringify(job));
  assert.equal(new Set(combined).size, full.length);
  assert.deepEqual(combined.sort(), full.map(job => JSON.stringify(job)).sort());
  for (const config of [{ TEST_SHARD_INDEX: '-1' }, { TEST_SHARD_INDEX: '4', TEST_SHARD_COUNT: '4' },
    { TEST_SHARD_COUNT: '0' }, { TEST_CONCURRENCY: '0' }, { TEST_SHARD_INDEX: '9999', TEST_SHARD_COUNT: '10000' }]) {
    assert.throws(() => list(config), /Invalid test shard|test shard is empty/);
  }
});
