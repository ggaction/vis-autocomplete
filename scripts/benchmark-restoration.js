import assert from 'node:assert/strict';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { PROJECT_FORMAT } from '../web/project.js';
import { defaultCanvasOptions } from '../src/prepare.js';
// Fresh contexts: an existing 31-step faceted chart, then its cached reload.
// Keep source rows, native calls and UI features identical across measurements.
const rows=JSON.parse(await readFile(new URL('../web/data/cars.json',import.meta.url))).filter(r=>r.Horsepower!=null&&r.Miles_per_Gallon!=null);
const setupCalls=[{method:'createCanvas',args:defaultCanvasOptions()},{method:'createData',args:{id:'dataset',values:'__LOADED_DATA__'}}];
let calls=[{method:'createScatterPlot',args:{id:'plot',data:'dataset',x:'Horsepower',y:'Miles_per_Gallon',color:'Origin'}},{method:'facet',args:{field:'Origin',data:'dataset',columns:3,spacing:'plot',gap:12,guides:{axes:'outer',legend:'shared'}}}];
const entries=[];
for(let i=0;i<31;i++) {
 if(i) calls=[...calls,{method:'editFacetSource',args:{action:i%3===0?{method:'encodeSize',options:{target:'plot',value:30+i*3}}:i%3===1?{method:'encodeOpacity',options:{target:'plot',value:.3+(i%6)*.1}}:{method:'encodeStroke',options:{target:'plot',value:i%2?'#000000':'#333333'}}}}];
 entries.push({setupCalls,calls,axesCalls:[],steps:i+1,phase:'recommendations',selection:{fields:['Horsepower','Miles_per_Gallon','Origin']},currentNote:'Edit '+i,context:{target:'plot',data:'dataset'},plotData:'dataset',optionGroup:'encoding',guideCall:{method:'createGuides',args:{}}});
}
const project={format:PROJECT_FORMAT,version:1,activeId:'deep-cars',datasets:[{id:'deep-cars',name:'Cars deep session',imported:{rows,rawRows:rows,fieldTypes:{}},session:{entries,index:entries.length-1}}]};

const output = new URL('../output/restoration/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true }), results = [], errors = [];
async function waitForCheckpoint(page) {
  // Explicitly await IndexedDB. This Playwright build treats an async
  // waitForFunction predicate's Promise itself as truthy.
  for (let attempt = 0; attempt < 150; attempt++) {
    const ready = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('visualization-autocomplete');
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      });
      const tx = db.transaction('projects');
      const get = key => new Promise(resolve => { const r = tx.objectStore('projects').get(key); r.onsuccess = () => resolve(r.result); });
      const [project, cache] = await Promise.all([get('draft'), get('checkpoint')]); db.close();
      return Boolean(cache?.snapshot) && project?.checkpointRevision === cache?.revision;
    });
    if (ready) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Compiled draft cache was not saved');
}
try {
  for (let run = 0; run < Number(process.env.RUNS ?? 3); run++) {
    const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
    const page = await context.newPage(); page.setDefaultTimeout(60000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(mode => {
      localStorage.setItem('vis-autocomplete.view-mode', mode);
      window.longTasks = []; window.loadMilestones = {};
      new PerformanceObserver(list => window.longTasks.push(...list.getEntries().map(e =>
        ({ start: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
      new MutationObserver(() => {
        const m = window.loadMilestones, now = performance.now();
        if (!m.chart && document.querySelector('#current canvas')) m.chart = now;
        if (!m.firstCard && document.querySelector('.card[data-preview-state="ready"]')) m.firstCard = now;
      }).observe(document, { childList: true, subtree: true, attributes: true });
    }, process.env.MODE ?? 'preview');
    await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
    await page.waitForFunction(() => !document.querySelector('#dataset').disabled);
    await page.evaluate(async project => {
      const { createDraftStore } = await import('/web/project.js'); await createDraftStore().write(project);
    }, project);
    let chartImage;
    for (const kind of ['calls', 'checkpoint']) {
      const start = performance.now(); await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.card[data-preview-state="ready"]').length >= 5 && !document.querySelector('#dataset').disabled);
      const readyMs = performance.now() - start;
      const metrics = await page.evaluate(() => ({ milestones: window.loadMilestones, longTasks: window.longTasks,
        restoration: document.body.dataset.restoration, history: document.querySelectorAll('.history-item').length,
        canvases: document.querySelectorAll('.history-item canvas').length,
        initialModelLoaded: performance.getEntriesByType('resource').some(r => r.name.includes('initial-model.json')) }));
      assert.equal(metrics.restoration, kind); assert.equal(metrics.history, 31);
      assert.equal(metrics.initialModelLoaded, false); assert.ok(metrics.canvases < 31);
      const image = await page.locator('#current canvas').evaluate(canvas => canvas.toDataURL());
      if (chartImage) assert.equal(image, chartImage, 'checkpoint restore preserves the exact current Canvas pixels');
      chartImage = image;
      results.push({ run, kind, mode: process.env.MODE ?? 'preview', readyMs, ...metrics });
      console.log(JSON.stringify(results.at(-1)));
      await waitForCheckpoint(page);
    }
    // Restored history remains editable, and deferred thumbnails populate on scroll.
    await page.locator('#undo').click();
    await page.waitForFunction(() => document.querySelector('#current').dataset.steps === '30' && !document.querySelector('#redo').disabled);
    await page.locator('#redo').click();
    await page.waitForFunction(() => document.querySelector('#current').dataset.steps === '31' && !document.querySelector('#undo').disabled);
    await page.locator('#history').evaluate(host => { host.scrollLeft = 0; });
    await page.locator('.history-item[data-history-index="0"] canvas').waitFor();
    const next = page.locator('.card[data-preview-state="ready"]').first();
    await next.locator('.card-top').hover();
    await next.locator('.apply-button').click();
    await page.waitForFunction(() => document.querySelector('#current').dataset.steps === '32' && !document.querySelector('#undo').disabled);
    await page.waitForFunction(() => document.querySelectorAll('.card[data-preview-state="ready"]').length >= 5);
    if (run === 0) {
      await page.waitForFunction(() => {
        const row = document.querySelector('#cards .card-row');
        return row?.getAttribute('aria-busy') === 'false' && Number(getComputedStyle(row).opacity) === 1;
      });
      await page.screenshot({ path: new URL(`${process.env.MODE ?? 'preview'}.png`, output).pathname });
      // A damaged optional cache must recover from the public-call draft.
      await waitForCheckpoint(page);
      await page.evaluate(async () => {
        const db = await new Promise(resolve => { const r = indexedDB.open('visualization-autocomplete'); r.onsuccess = () => resolve(r.result); });
        await new Promise((resolve, reject) => {
          const tx = db.transaction('projects', 'readwrite'), store = tx.objectStore('projects'), r = store.get('checkpoint');
          r.onsuccess = () => store.put({ ...r.result, snapshot: 'corrupt' }, 'checkpoint');
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
        }); db.close();
      });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#current').dataset.steps === '32' && !document.querySelector('#dataset').disabled);
      assert.equal(await page.locator('body').getAttribute('data-restoration'), 'calls');
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
  await writeFile(new URL(`${process.env.LABEL ?? process.env.MODE ?? 'preview'}.json`, output), JSON.stringify({ results, errors }, null, 2));
}
