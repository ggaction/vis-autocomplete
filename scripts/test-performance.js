// Hardware-independent work/retention/correctness guards. Wall-clock benchmark
// results are recorded separately so a noisy shared CI runner cannot hide bugs
// behind inflated timing thresholds or fail an otherwise identical workload.
import { spawnSync } from 'node:child_process';
const files = [
  'profile-performance', 'recommendation-group-reuse', 'performance-reuse', 'program-transfer', 'scene-renderer',
  'history', 'history-graph', 'history-runtime', 'history-sharing',
  'cloud-documents', 'cloud-local', 'cloud-client', 'draft-store',
  'preview-raster-cache', 'cloud-thumbnails', 'thumbnail-client',
];
const result = spawnSync(process.execPath, ['--max-old-space-size=512', '--test', '--test-concurrency=1',
  ...files.map(name => `test/${name}.test.js`)], { stdio: 'inherit', cwd: new URL('../', import.meta.url) });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
