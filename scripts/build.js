import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ggactionSource } from './ggaction-source.js';
import { execFileSync } from 'node:child_process';
const out = 'output/deploy';
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/public/assets`, { recursive: true });
await build({entryPoints:['web/entry.js'],outdir:`${out}/public/assets`,entryNames:'entry',chunkNames:'[name]-[hash]',bundle:true,splitting:true,platform:'browser',format:'esm',target:'es2022',minify:true,keepNames:true});
for (const [entry, outfile] of [['web/import-worker.js','output/workers/import.js'],['web/calculation-worker.js','output/workers/calculation.js'],['web/workbook-worker.js','output/workers/workbook.js']]) {
  await build({entryPoints:[entry],outfile:`${out}/public/${outfile}`,bundle:true,platform:'browser',format:'esm',target:'es2022',minify:true,keepNames:true});
}
for (const file of ['web/style.css','web/data-table.css','web/import-dialog.css','web/cloud/menu.css']) {
  await mkdir(`${out}/public/${file.slice(0,file.lastIndexOf('/'))}`, {recursive:true});
  await cp(file, `${out}/public/${file}`);
}
await cp('web/data', `${out}/public/web/data`, {recursive:true});
await cp('web/icons', `${out}/public/web/icons`, {recursive:true});
await cp('web/social', `${out}/public/web/social`, {recursive:true});
await mkdir(`${out}/public/data`,{recursive:true});
for(const name of ['model-manifest.json','model.json','initial-model.json']) await cp(`data/${name}`,`${out}/public/data/${name}`);
let html = await readFile('index.html','utf8');
html = html.replace(/\s*<script type="importmap">[\s\S]*?<\/script>/,'').replace('src="/output/entry.js"','src="/assets/entry.js"');
await writeFile(`${out}/public/index.html`,html);
await cp('privacy.html', `${out}/public/privacy.html`);
const scriptHashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
const pins = JSON.parse(await readFile('deployment-sources.json','utf8'));
let source, commit='source-archive';
try { source = ggactionSource(); commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  for (const [name, pin] of Object.entries(pins)) {
    const actual=execFileSync('git',['-C',`vendor/${name}`,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
    if(actual!==pin) throw new Error(`Update deployment-sources.json for ${name} before building.`);
  }
} catch(error) {
  // Render's Docker build context excludes Git metadata. These pins are checked
  // against the real submodules by CI before a deploy is allowed.
  if(error.message.startsWith('Update deployment')) throw error;
  source={repository:'https://github.com/ggaction/ggaction',directory:'vendor/ggaction',branch:'',commit:pins.ggaction,modified:false};
}
const runtimeHash = createHash('sha256').update(await readFile(`${out}/public/output/workers/calculation.js`)).digest('hex');
source = { ...source, runtimeHash };
await writeFile(`${out}/public/output/workers/source.json`,JSON.stringify(source));
await writeFile(`${out}/build.json`,JSON.stringify({scriptHashes,ggaction:source,commit}));
console.log(`Built production assets in ${out}`);
