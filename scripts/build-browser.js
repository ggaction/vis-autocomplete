import { context } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ggactionSource } from './ggaction-source.js';

// Resolve package symlinks to the same vendor source used by Node. Shipping a
// bundle also avoids evaluating ggaction twice under vendor/ and node_modules/.
export async function buildBrowser({ watch = false } = {}) {
  const builds = [];
  let complete = false;
  try {
    for (const [entry, output] of [['web/app.js', 'output/app.js'], ['web/calculation-worker.js', 'output/workers/calculation.js'], ['web/import-worker.js', 'output/workers/import.js']]) {
      builds.push(await context({
        entryPoints: [fileURLToPath(new URL(`../${entry}`, import.meta.url))],
        outfile: fileURLToPath(new URL(`../${output}`, import.meta.url)),
        bundle: true, platform: 'browser', format: 'esm', target: 'es2022',
        minify: true, keepNames: true, sourcemap: true,
        plugins: entry === 'web/calculation-worker.js' ? [{ name: 'source-version', setup(build) {
          build.onEnd(async result => {
            if (!result.errors.length) await writeFile(new URL('../output/workers/source.json', import.meta.url), JSON.stringify(ggactionSource()) + '\n');
          });
        } }] : [],
      }));
    }
    await Promise.all(builds.map(build => build.rebuild()));
    if (watch) await Promise.all(builds.map(build => build.watch()));
    complete = true;
  } finally {
    if (!watch || !complete) await Promise.all(builds.map(build => build.dispose()));
  }
  return { dispose: () => Promise.all(builds.map(build => build.dispose())) };
}
