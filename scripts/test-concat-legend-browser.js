import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../vendor/ggaction/node_modules/playwright/index.mjs';
const output=new URL('../output/concat-legend/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try {for(const mode of ['preview','transition']){
 const context=await browser.newContext({viewport:{width:1700,height:1100}});
 await context.addInitScript(mode=>localStorage.setItem('vis-autocomplete.view-mode',mode),mode);
 const page=await context.newPage();page.setDefaultTimeout(45000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function apply(card){const count=await page.locator('.history-item').count();await card.locator('.card-top').hover();await card.locator('.apply-button').click();await page.waitForFunction(n=>document.querySelectorAll('.history-item').length>n&&!document.querySelector('#undo').disabled,count);await page.mouse.move(5,5);}
 async function legendCard(position){await page.locator('#group-style').click();await page.locator('#action-search').fill('editLegend');const card=page.locator('.card[data-method="editLegend"]').first();await page.waitForSelector('.card');for(let i=0;i<8&&!await card.count();i++){await page.locator('#cards-next').click();await page.waitForTimeout(800);}await card.locator('.card-top').hover();await card.locator('[data-parameter="position"] [data-value="'+position+'"]').click();await apply(card);}
 try{
  await page.goto(process.env.APP_URL??'http://127.0.0.1:5173/');await page.waitForLoadState('networkidle');await page.locator('#dataset').selectOption('cars');
  for(const name of ['Origin','Horsepower'])await page.getByRole('button',{name:`Select column ${name}`,exact:true}).click();
  const bar=page.locator('.card[data-method="createBarPlot"]');await bar.locator('.card-top').hover();
  await bar.locator('[data-parameter="mapping_color"] [data-value="Origin"]').click();await apply(bar);
  await legendCard('bottom');
  const add=page.getByRole('button',{name:'Add chart left',exact:true});await page.locator('#current-shell').hover();const box=await add.boundingBox();await page.mouse.move(box.x+13,box.y+13);await add.click();
  const adjacent=page.locator('.card[data-method="createAdjacentPlot"]').filter({has:page.locator('h3',{hasText:/^Add Bar plot$/i})});await apply(adjacent);
  const shared=page.locator('.guide-control[data-guide-key="legend:shared-color"]');await shared.waitFor({state:'attached'});
  async function geometry(){return page.evaluate(async()=>{const {createDraftStore,restoreSession}=await import('/web/project.js');const draft=await createDraftStore().read(),record=draft.datasets.find(d=>d.id===draft.activeId);const session=restoreSession(record.session,record.imported.rows);const p=session.entries[session.index].view??session.entries[session.index].program;const {editableGuides}=await import('/src/guide-manipulation.js');const {compositionPlotBounds}=await import('/vendor/ggaction/src/materialization/composition.js');return {guide:editableGuides(p).find(t=>t.key==='legend:shared-color'),plot:compositionPlotBounds(p)};});}
  async function saved(){await page.waitForFunction(()=>document.querySelector('#draft-status').textContent==='Draft saved on this device');}
  await saved();let g=await geometry();assert.ok(g.guide.bounds.top>g.plot.y+g.plot.height,'bottom position survives adding left');
  await legendCard('top');await saved();g=await geometry();assert.ok(g.guide.bounds.bottom<g.plot.y,'card on new chart edits visible shared legend');
  const oldSize=g.guide.config.labels.fontSize;let b=await shared.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
  const handle=shared.locator('.guide-size');const h=await handle.boundingBox();const count=await page.locator('.history-item').count();await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();await page.mouse.move(h.x+25,h.y+14,{steps:8});await page.mouse.up();
  await page.waitForFunction(n=>document.querySelectorAll('.history-item').length>n&&!document.querySelector('#undo').disabled,count);await saved();g=await geometry();assert.ok(g.guide.config.labels.fontSize>oldSize,'corner drag enlarges shared legend');
  // Move the same shared guide to the bottom of the whole visualization.
  b=await shared.boundingBox();const stage=await page.locator('#current .canvas-stage').boundingBox();const hit=shared.locator('.guide-hit');await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await hit.hover();const before=await page.locator('.history-item').count();await page.mouse.down();await page.mouse.move(stage.x+stage.width/2,stage.y+stage.height-8,{steps:10});await page.mouse.up();
  await page.waitForFunction(n=>document.querySelectorAll('.history-item').length>n&&!document.querySelector('#undo').disabled,before);await saved();g=await geometry();assert.ok(g.guide.bounds.top>g.plot.y+g.plot.height,'drag uses full concat plot union');
  await page.mouse.move(5,5);await page.screenshot({path:new URL(`${mode}.png`,output).pathname});
  await page.reload();await page.locator('.guide-control[data-guide-key="legend:shared-color"]').waitFor({state:'attached'});assert.deepEqual(errors,[]);console.log(`PASS ${mode}: bottom retained after left bar, card move, corner resize, drag move, reload`);
 }catch(e){await page.screenshot({path:new URL(`${mode}-failure.png`,output).pathname});console.error(await page.locator('#notice').innerText());throw e;}finally{await context.close();}
}}finally{await browser.close();}
