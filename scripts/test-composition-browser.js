import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
import { parseProject, restoreSession } from '../web/project.js';
import { editableChartTargets } from '../src/composition-context.js';

const output = new URL('../output/composition-v025/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const cases = [
  {dataset:'cars',fields:['Origin','Horsepower'],plot:'createBarPlot',direction:'right',next:'line',mode:'preview'},
  {dataset:'barley',fields:['variety','yield','site'],plot:'createBarPlot',direction:'left',next:'line',mode:'transition'},
  {dataset:'iris',fields:['Sepal.Width','Petal.Width','Species'],plot:'createScatterPlot',direction:'bottom',next:'scatter',mode:'transition'},
  {dataset:'stocks',fields:['date','price','symbol'],plot:'createLinePlot',direction:'top',next:'area',mode:'preview',appearance:'encodeStroke'},
];
const results = [];
try {
 for (const c of cases) {
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  page.setDefaultTimeout(60000); const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const applied = async card => { await card.hover(); await card.locator('button').filter({hasText:/^Apply$/}).click(); await page.waitForFunction(()=>!document.querySelector('#undo').disabled); };
  const cardFor = async selector => {
   await page.locator('#cards .card').first().waitFor();
   for(let i=0;i<9;i++) {
    const card=page.locator(selector).first();
    if(await card.isVisible())return card;
    const next=page.locator('#cards-next');if(await next.isDisabled())break;await next.click();
   }
   return page.locator(selector).first();
  };
  try {
   await page.goto(process.env.APP_URL ?? 'http://127.0.0.1:5173/');
   await page.locator('#dataset').selectOption(c.dataset);
   await page.locator(`#view-mode [data-mode="${c.mode}"]`).click();
   for(const name of c.fields) await page.getByRole('button',{name:`Select column ${name}`,exact:true}).click();
   await applied(await cardFor(`.card[data-method="${c.plot}"]`)); console.log('STEP',c.dataset,'chart');
   await page.waitForFunction(()=>document.body.dataset.phase==='recommendations');
   await page.getByRole('button',{name:'Add overlay',exact:true}).click();
   await applied(page.locator('.card[data-method="createOverlay"]').first());
   await page.waitForFunction(()=>document.querySelector('#current').dataset.lastMethod==='createOverlay'); console.log('STEP',c.dataset,'overlay');
   await page.locator('#current-shell').hover();
   await page.getByRole('button',{name:`Add chart ${c.direction}`,exact:true}).click();
   const adjacent=page.locator('.card[data-method="createAdjacentPlot"]').filter({has:page.locator('h3',{hasText:new RegExp(c.next,'i')})}).first();
   await applied(adjacent); console.log('STEP',c.dataset,'adjacent');
   await page.waitForFunction(()=>document.querySelectorAll('#editing-target button').length===4);
   await page.locator('#editing-target').getByRole('button',{name:'All',exact:true}).click();
   const appearance=c.appearance ?? 'encodeOpacity';
   await page.locator('#action-search').fill(appearance === 'encodeStroke' ? 'stroke color' : 'opacity');
   await applied(page.locator(`.card[data-method="${appearance}"]`).first());
   await page.waitForFunction(method=>document.querySelector('#current').dataset.lastMethod===method,appearance);
   await page.locator('#action-search').fill('');
   await page.locator('#cards .card').first().waitFor();
   for(let i=0;i<40;i++) {
    const visible=page.locator('#cards .card:visible'); const count=await visible.count();
    if(count) { const box=await visible.nth(i%count).boundingBox(); if(box)await page.mouse.move(box.x+box.width/2,box.y+Math.min(45,box.height/2)); }
    await page.waitForTimeout(25);
   }
   await page.locator('h1').hover();
   await page.locator('.project-menu > summary').click();
   const pending=page.waitForEvent('download');await page.locator('#save-project').click();
   const download=await pending, project=parseProject(await readFile(await download.path(),'utf8'));
   const record=project.datasets.find(d=>d.id===project.activeId), session=restoreSession(record.session,record.imported.rows);
   const snapshot=session.entries[session.index], targets=editableChartTargets(snapshot.program);
   assert.equal(targets.length,3); assert.equal(targets.filter(t=>t.overlay).length,1);
   const opacity=snapshot.calls.findLast(call=>call.method===appearance);
   assert.equal(opacity.args.target.length,3);
   assert.equal(snapshot.guideCall.method,'createGuides');
   assert.equal(snapshot.calls.filter(call=>call.method==='createAdjacentPlot').length,1);
   const restoredLastMethod=snapshot.calls.at(-1).method;
   await page.locator('.project-menu > summary').click();
   await page.locator('#undo').click();await page.waitForFunction(()=>!document.querySelector('#redo').disabled);
   await page.locator('#redo').click();await page.waitForFunction(method=>document.querySelector('#current').dataset.lastMethod===method && !document.querySelector('#undo').disabled,restoredLastMethod);
   await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#editing-target button').length===4);
   await page.locator('#cards .card:visible').first().waitFor();
   await page.waitForFunction(()=>!document.querySelector('#undo').disabled);
   await page.waitForFunction(method=>document.querySelector('#current').dataset.lastMethod===method,restoredLastMethod);
   assert.equal(await page.locator(`#view-mode [data-mode="${c.mode}"]`).getAttribute('aria-pressed'),'true');
   await page.screenshot({path:new URL(`${c.dataset}-${c.direction}.png`,output).pathname});
   assert.deepEqual(errors,[]);results.push({...c,targets:targets.length,history:session.entries.length,errors});console.log('PASS',JSON.stringify(results.at(-1)));
  } catch(error) { await page.screenshot({path:new URL(`${c.dataset}-failure.png`,output).pathname});console.error('FAIL',c.dataset,error.message,'notice:',await page.locator('#notice').innerText());throw error; }
  finally { await page.close(); }
 }
} finally { await browser.close(); }
console.log(JSON.stringify({passed:results.length,results},null,2));
