import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
import { createProject } from '../web/project.js';
import { importDataset } from '../src/data-import.js';

const out = new URL('../output/direct-deletion/', import.meta.url);
await mkdir(out, {recursive:true});
const c = (method,args) => ({method,args});
const imported=importDataset(JSON.stringify(Array.from({length:18},(_,i)=>({X:i+1,Y:i*2+5,Group:['A','B','C'][i%3]}))),{format:'json',name:'Deletion'});
for(const kind of ['unit','facet','concat']) {
  const setupCalls=[c('createCanvas',{plot:{width:314,height:314},margin:120}),c('createData',{id:'dataset',values:'__LOADED_DATA__'})];
  const calls=[c('createScatterPlot',{id:'plot',data:'dataset',x:'X',y:'Y',color:{field:'Group',fieldType:'nominal'}}),c('createTitle',{text:'Overview',subtitle:'Three groups'})];
  if(kind==='facet')calls.push(c('facet',{field:'Group',columns:3,guides:{axes:'outer',legend:'shared'}}));
  if(kind==='concat')calls.push(c('createLegend',{target:'plot',channels:['color']}),c('createAdjacentPlot',{id:'chart2',source:'plot',position:'right',plot:{action:'createScatterPlot',options:{x:'X',y:'Y'}}}),c('createTitle',{text:'Shared heading'}));
  const guideArgs=kind==='concat'?{target:[{childPath:['plot']},{childPath:['chart2']}]}:{legend:{target:'plot',channels:['color']}};
  const snapshot={setupCalls,calls,guideCall:c('createGuides',guideArgs),steps:calls.length,phase:'recommendations',selection:{x:'X',y:'Y',color:'Group'},currentNote:'Overview',context:{target:'plot',...(kind==='concat'?{childPath:['plot']}:{})},plotData:'dataset',optionGroup:'encoding'};
  await writeFile(new URL(`${kind}.json`,out),JSON.stringify(createProject([{id:'deletion',name:'Deletion',imported,session:{entries:[snapshot],index:0}}],'deletion')));
}
const browser=await chromium.launch({headless:true}), errors=[];
const ready=page=>page.waitForFunction(()=>!document.querySelector('#reset').disabled);
const steps=(page,n)=>page.waitForFunction(n=>document.querySelector('#current').dataset.steps===String(n),n);
async function hover(page,locator) {
  await page.locator('h1').hover();
  const r=await locator.boundingBox(); assert.ok(r);
  await page.mouse.move(r.x+r.width/2,r.y+r.height/2);
}
async function key(page,shortcut,n) {await page.keyboard.press(shortcut);await steps(page,n);await ready(page);}
try {
  for(const mode of ['preview','transition'])for(const kind of ['unit','facet','concat']) {
    const context=await browser.newContext({viewport:{width:1800,height:1100}}),page=await context.newPage();page.setDefaultTimeout(45000);
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(process.env.APP_URL??'http://127.0.0.1:5173');await page.waitForLoadState('networkidle');
    await page.locator('#project-file').setInputFiles(new URL(`${kind}.json`,out).pathname);
    const initial={unit:2,facet:3,concat:5}[kind];await steps(page,initial);await ready(page);
    await page.locator(`#view-mode [data-mode=${mode}]`).click();await page.locator('h1').hover();
    const axis=page.locator('.guide-hit[aria-label="Select X axis title"]').first();
    const axisKey=await axis.getAttribute('data-guide');
    await hover(page,axis);
    assert.equal(await page.locator('.guide-label').count(),0);
    await page.locator('.guide-control.active .guide-delete').click();await steps(page,initial+1);await ready(page);
    assert.equal(await page.locator('.guide-hit').evaluateAll((ns,key)=>ns.filter(n=>n.dataset.guide===key).length,axisKey),0);
    await key(page,'Control+z',initial);assert.ok(await axis.count());
    await key(page,'Control+Shift+z',initial+1);
    await key(page,'Meta+z',initial);
    await key(page,'Control+y',initial+1);
    await key(page,'Meta+z',initial);
    // An input's native undo must not remove a chart action.
    await page.locator('#action-search').fill('title');await page.keyboard.press('Control+z');await steps(page,initial);
    await page.locator('#action-search').fill('');await page.locator('h1').hover();
    const subtitle=page.locator('.guide-hit[aria-label="Move Subtitle"]').first();
    await hover(page,subtitle);await page.locator('.guide-control.active .guide-delete').click();await steps(page,initial+1);await ready(page);
    assert.equal(await page.locator('.guide-hit[aria-label="Move Subtitle"]').count(),0);
    assert.ok(await page.locator('.guide-hit[aria-label="Move Title"]').count());
    await key(page,'Control+z',initial);
    if(kind!=='concat') {
      const legendTitle=page.locator('.guide-hit[data-guide="legend-title:color"]');
      await hover(page,legendTitle);await page.locator('.guide-control.active .guide-delete').click();
      await steps(page,initial+1);await ready(page);
      assert.equal(await legendTitle.count(),0);
      assert.equal(await page.locator('.guide-hit[data-guide="legend:color"]').count(),1);
      await key(page,'Control+z',initial);
    }
    // Whole legend deletion persists through the automatic suffix, real edits,
    // reload, and both directions of history.
    const legendKey=await page.locator('.guide-hit').evaluateAll(ns=>ns.find(n=>/(^|\/)legend:/.test(n.dataset.guide))?.dataset.guide);
    assert.ok(legendKey, `Whole legend is editable in ${kind}`);
    const legendHit=page.locator(`.guide-hit[data-guide="${legendKey}"]`);
    await hover(page,legendHit);await page.locator('.guide-control.active .guide-delete').click();
    await steps(page,initial+1);await ready(page);assert.equal(await legendHit.count(),0);
    if(kind==='unit') {
      await page.locator('#group-encoding').click();await page.locator('#action-search').fill('opacity');
      await page.locator('#action-search').press('Enter');
      await page.waitForFunction(()=>document.querySelector('#cards .card-row')?.getAttribute('aria-busy')==='false');
      const opacity=page.locator('.card[data-method="encodeOpacity"]').first();
      await opacity.hover();await opacity.locator('.apply-button').click();await steps(page,initial+2);await ready(page);
      assert.equal(await legendHit.count(),0,'Applying another option must not restore a deleted legend');
      await key(page,'Control+z',initial+1);await page.locator('#action-search').fill('');
    }
    await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved');
    await page.reload();await page.waitForLoadState('networkidle');await steps(page,initial+1);await ready(page);
    assert.equal(await legendHit.count(),0);
    await key(page,'Control+z',initial);assert.ok(await legendHit.count());
    await key(page,'Control+y',initial+1);assert.equal(await legendHit.count(),0);
    await page.screenshot({path:new URL(`${mode}-${kind}-legend-deleted.png`,out).pathname});
    await key(page,'Control+z',initial);
    if(kind==='concat') {
      const panel=page.locator('[data-guide-key="panel:chart2"]'),r=await panel.boundingBox();
      await page.locator('h1').hover();await page.mouse.move(r.x+r.width/2,r.y+2);
      await panel.locator('.guide-delete').click();await steps(page,initial+1);await ready(page);
      assert.equal(await page.locator('.panel-control').count(),0);
      assert.equal(await page.locator('#editing-target button').count(),2,'All plus the remaining chart');
      await key(page,'Control+z',initial);assert.equal(await page.locator('.panel-control').count(),2);
      await key(page,'Control+y',initial+1);
    } else {
      const title=page.locator('.guide-hit[aria-label="Move Title"]').first();
      await hover(page,title);await page.locator('.guide-control.active .guide-delete').click();await steps(page,initial+1);await ready(page);
      assert.equal(await page.locator('.guide-hit[aria-label="Move Title"]').count(),0);
      await key(page,'Control+z',initial);
      const handle=page.locator('[data-resize="plot-se"]');await handle.focus();await page.keyboard.press('ArrowRight');
      await steps(page,initial+1);await ready(page);await key(page,'Control+z',initial);await key(page,'Control+y',initial+1);
      await key(page,'Control+z',initial);
      const r=await handle.boundingBox();
      await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+35,r.y+20,{steps:8});await page.mouse.up();
      await steps(page,initial+1);await ready(page);
      await key(page,'Control+z',initial);await key(page,'Control+y',initial+1);
    }
    if(kind==='unit') {
      await page.locator('#group-encoding').click();
      await page.locator('#action-search').fill('opacity');
      await page.locator('#action-search').press('Enter');
      await page.waitForFunction(()=>document.querySelector('#cards .card-row')?.getAttribute('aria-busy')==='false');
      const card=page.locator('.card[data-method="encodeOpacity"]').first();
      await card.hover();await card.locator('.apply-button').click();
      // Ctrl+Z issued while Apply is still completing must undo that action.
      await page.keyboard.press('Control+z');await ready(page);await steps(page,initial+1);
      await page.waitForFunction(()=>!document.querySelector('#redo').disabled);
      await key(page,'Control+y',initial+2);
      // Two rapid requests are serialized; neither disappears during rendering.
      await page.keyboard.press('Control+z');await page.keyboard.press('Control+z');
      await steps(page,initial);await ready(page);
      await key(page,'Control+y',initial+1);
    }
    await page.waitForFunction(()=>document.querySelector('#cloud-status').textContent==='Saved');
    await page.reload();await page.waitForLoadState('networkidle');await steps(page,initial+1);await ready(page);
    await key(page,'Control+z',initial);await key(page,'Control+y',initial+1);
    await page.screenshot({path:new URL(`${mode}-${kind}.png`,out).pathname});
    console.log(`PASS ${mode}/${kind}: delete, native replay, shortcuts, resize/panel layout, persistence`);
    await context.close();
  }
  assert.deepEqual(errors,[]);
} finally {await browser.close();}
