import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { ggactionSource } from './ggaction-source.js';
import { fileURLToPath } from 'node:url';
await build({ entryPoints: [fileURLToPath(new URL('../web/calculation-worker.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../output/workers/calculation.js', import.meta.url)),
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', sourcemap: true });
await writeFile(new URL('../output/workers/source.json', import.meta.url), JSON.stringify(ggactionSource(), null, 2) + '\n');
await build({ entryPoints: ['web/workbook-worker.js'], outfile: 'output/workers/workbook.js',
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', minify: true });

await build({ stdin: { contents: "export { createClient } from '@supabase/supabase-js';", resolveDir: process.cwd() },
  outfile: 'output/cloud/supabase.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
