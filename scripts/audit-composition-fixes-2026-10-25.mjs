// Bounded regression audit: real parameters/Apply/facet/concat/reload, isolated mock accounts.
import { chromium } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
import { newSession,selectDataset,findCard } from './audit-browser-session-2026-10-25.mjs';
const out=new URL(`../output/option-audit-2026-10-25/${process.env.AUDIT_FOLDER??'composition-fixes'}/`,import.meta.url);await mkdir(out,{recursive:true});
const results=[],browser=await chromium.launch({headless:true});
const cases=[
 {id:'barley-horizontal',dataset:'barley',fields:['variety','yield','year'],plot:'createBarPlot',mode:'transition',layer:/Line overlay/i,follow:true},
 {id:'iris-distributions',dataset:'iris',fields:['Species','Sepal.Length'],plot:'createBeeswarmPlot',mode:'transition',layer:/Box plot layer/i},
 {id:'penguins-null-distributions',dataset:'penguins',fields:['Species','Body Mass (g)','Sex'],plot:'createViolinPlot',mode:'preview',layer:/Raincloud plot layer/i},
 {id:'fashion-point',dataset:'fashion_mnist_tsne',fields:['x_pos','y_pos','label_name'],plot:'createScatterPlot',mode:'transition',layer:/Heatmap layer/i},
 {id:'iris-numeric-color',dataset:'iris',fields:['Sepal.Length','Sepal.Width','Petal.Length'],plot:'createScatterPlot',mode:'transition',layer:/Line plot layer/i},
 {id:'wine-multivariate',dataset:'wine',fields:['Alcohol','Malicacid','Ash','Proline','class'],plot:'createScatterPlot',mode:'transition'},
 {id:'bike-time',dataset:'bike-sharing',fields:['dteday','cnt','season'],plot:'createLinePlot',mode:'preview',follow:true,layer:/Line overlay/i},
 {id:'temperature-signed',dataset:'global-temp',fields:['year','temp'],plot:'createAreaPlot',mode:'transition',follow:true,layer:/Line overlay/i},
 {id:'budgets-forecast',dataset:'budgets',fields:['budgetYear','forecastYear','value'],plot:'createLinePlot',mode:'preview'},
 {id:'income-percent',dataset:'income',fields:['region','pct','group'],plot:'createBarPlot',mode:'transition',follow:true},
 {id:'glass-distribution',dataset:'glass',fields:['class','RI','Na'],plot:'createBoxPlot',mode:'preview'},
 {id:'employment-wide',dataset:'us-employment',fields:['month','nonfarm_change','service_providing'],plot:'createLinePlot',mode:'transition'},
 {id:'unemployment-time',dataset:'unemployment',fields:['date','rate','series'],plot:'createLinePlot',mode:'preview'},
];
const only=process.env.AUDIT_CASES?.split(',');
let screenshots=0;
async function applyCard(page,card) {
 const index=Number(await page.locator('.history-item[aria-current]').getAttribute('data-history-index'));
 await card.locator('.card-top').hover();await card.locator('.apply-button').click();
 await page.waitForFunction(before=>Number(document.querySelector('.history-item[aria-current]')?.dataset.historyIndex)>before,index);
 await page.waitForFunction(()=>document.querySelector('#current canvas'));
}
async function settle(card){await card.page().waitForTimeout(100);await card.page().waitForFunction(el=>el?.isConnected&&el.dataset.previewState!=='pending',await card.elementHandle(),{timeout:20000});}
async function readState(card){return card.evaluate(el=>({state:el.dataset.previewState,error:el.querySelector('.card-error')?.textContent??'',thumbnail:el.querySelector('.thumbnail')?.textContent??'',apply:!el.querySelector('.apply-button')?.disabled,canvas:el.querySelectorAll('.thumbnail canvas').length}));}
async function probeCard(page,card,record,stage){
 await card.locator('.card-top').hover();await settle(card);const title=await card.locator('h3').innerText();
 console.log('PROBE',record.id,stage,title);const baseline=await readState(card),entry={stage,title,method:await card.getAttribute('data-method'),baseline,controls:[],probes:[]};record.cards.push(entry);
 const definitions=await card.locator('.control').evaluateAll(els=>els.filter(el=>!el.querySelector('.control')).map(el=>({key:el.dataset.parameter,label:el.querySelector('span')?.textContent,buttons:[...el.querySelectorAll('button[data-value]')].map(b=>({value:b.dataset.value,label:b.textContent,disabled:b.disabled,selected:b.getAttribute('aria-pressed')==='true'})),range:el.querySelector('input[type="range"]')?{min:+el.querySelector('input').min,max:+el.querySelector('input').max,value:+el.querySelector('input').value}:null})));entry.controls=definitions;
 const capture=async(key,value)=>{await settle(card);const state=await readState(card);entry.probes.push({key,value,...state});if(state.error&&!record.errorScreenshots[state.error]){const name=`${record.id}-${++screenshots}.png`;await page.screenshot({path:new URL(name,out).pathname,fullPage:true});record.errorScreenshots[state.error]=name;}};
 if(baseline.error)await capture('__default','default');
 for(const def of definitions.filter(d=>d.buttons.length||d.range).slice(0,2)){
  for(const choice of def.buttons.filter(b=>!b.disabled&&!b.selected).slice(0,1)){
   try{const control=card.locator(`.control[data-parameter=${JSON.stringify(def.key)}]`);const button=control.locator(`button[data-value=${JSON.stringify(choice.value)}]`).first();if(!await button.count())continue;if(await button.isDisabled()){entry.probes.push({key:def.key,value:choice.value,skipped:'became-disabled'});continue;}
    const details=button.locator('xpath=ancestor::details');if(await details.count())await details.evaluate(el=>el.open=true);
    await button.click({timeout:7000});await capture(def.key,choice.value);
   }catch(error){entry.probes.push({key:def.key,value:choice.value,harnessError:error.message.slice(0,300)});}
  }
  const restore=def.buttons.find(b=>b.selected&&!b.disabled);if(restore){const b=card.locator(`.control[data-parameter=${JSON.stringify(def.key)}] button[data-value=${JSON.stringify(restore.value)}]`).first();if(await b.count())await b.click({timeout:7000}).catch(()=>{});}
  if(def.range){
   for(const value of [(def.range.min+def.range.max)/2]){
    try{const range=card.locator(`.control[data-parameter=${JSON.stringify(def.key)}] input[type="range"]`);if(!await range.count())continue;await range.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},value);await capture(def.key,value);}catch(error){entry.probes.push({key:def.key,value,harnessError:error.message.slice(0,300)});}
   }
   const range=card.locator(`.control[data-parameter=${JSON.stringify(def.key)}] input[type="range"]`);if(await range.count())await range.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},def.range.value);
  }
 }
 await card.locator('.card-top').hover();await settle(card);return entry;
}
async function sweep(page,record,stage,maxPages=1){
 await page.waitForTimeout(250);await page.locator(`#cards .card[data-method="${stage==='layer'?'createLayerPlot':stage==='follow'?'createOverlay':'createAdjacentPlot'}"]`).first().waitFor();
 const seen=new Set();for(let k=0;k<maxPages;k++){
  const n=Number((await page.locator('#cards-page').innerText()).split('/')[0])||1;await page.locator(`.card-row[data-page="${n}"][aria-busy="false"]`).waitFor();
  const cards=page.locator(`.card-row[data-page="${n}"] .card`);const count=await cards.count();record.pages.push({stage,page:n,count});
  for(let i=0;i<count;i++){const card=cards.nth(i),title=await card.locator('h3').innerText();if(seen.has(title))continue;seen.add(title);await probeCard(page,card,record,stage);await writeFile(new URL('results.json',out),JSON.stringify(results,null,2));}
  if(await page.locator('#cards-next').isDisabled())break;await page.locator('#cards-next').click();await page.waitForFunction(n=>Number(document.querySelector('#cards-page').textContent.split('/')[0])!==n,n);
 }
}
async function resetPage(page){for(let i=0;i<30;i++){const n=Number((await page.locator('#cards-page').innerText()).split('/')[0]);if(n<=1)return;await page.locator('#cards-prev').click();await page.waitForFunction(n=>Number(document.querySelector('#cards-page').textContent.split('/')[0])<n,n);await page.waitForTimeout(100);}}
async function saveSnapshot(s,record,name){
 await s.page.locator('#editor-root h1').hover();await s.page.waitForTimeout(500);const project=[...s.projects.values()].at(-1);if(project)await writeFile(new URL(`${record.id}-${name}.json`,out),JSON.stringify(project.snapshot,null,2));
}
try{for(const c of cases.filter(c=>!only||only.includes(c.id))){
 const s=await newSession(browser,{mode:c.mode});const p=s.page;const r={...c,layer:String(c.layer??''),cards:[],pages:[],events:[],errorScreenshots:{},errors:[]};results.push(r);
 try{
  await selectDataset(p,c.dataset,c.fields);await p.locator('#cards .card').first().waitFor();const initial=await findCard(p,c.plot);await initial.locator('.card-top').hover();await settle(initial);r.initial={title:await initial.locator('h3').innerText(),controls:await initial.locator('.card-controls').innerText()};await applyCard(p,initial);r.events.push('source-created');await saveSnapshot(s,r,'source');
  await p.getByRole('button',{name:'Add overlay',exact:true}).click();await sweep(p,r,'layer');
  const followButton=p.getByRole('button',{name:'Follow results',exact:true});if(await followButton.isEnabled()){await followButton.click();await sweep(p,r,'follow');}else r.events.push('follow-not-supported');
  if(c.layer){await p.getByRole('button',{name:c.follow?'Follow results':'Layer chart',exact:true}).click();await p.locator('#cards .card').first().waitFor();await resetPage(p);const layer=await findCard(p,c.follow?'createOverlay':'createLayerPlot',c.layer);await settle(layer);if((await readState(layer)).state==='ready'){await applyCard(p,layer);r.events.push('overlay-applied');}else{r.events.push('preferred-layer-invalid');await p.keyboard.press('Escape');}}
  else await p.keyboard.press('Escape');
  await p.locator('#editing-target .target-chart-group button').first().click();await p.locator('#action-search').fill('facet');await p.locator('#cards .card').first().waitFor();const f=await findCard(p,'facet').catch(()=>null);if(f){await probeCard(p,f,r,'facet');const fields=f.locator('.control[data-parameter="field"] button:enabled');if(await fields.count())await fields.first().click();const columns=f.locator('.control[data-parameter="columns"] input');if(await columns.count())await columns.evaluate(el=>{el.value=2;el.dispatchEvent(new Event('input',{bubbles:true}));});await settle(f);if((await readState(f)).state==='ready'){await applyCard(p,f);r.events.push('facet-applied');}}
  await p.locator('#action-search').fill('');await p.locator('#editor-root h1').hover();await p.locator('#current-shell').hover();const add=p.locator('.add-adjacent[data-position="right"]').first();const box=await add.boundingBox();if(box){await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await add.click();await sweep(p,r,'adjacent',Number(process.env.ADJACENT_PAGES??1));await resetPage(p);let chosen=p.locator('.card-row[data-page="1"] .card[data-preview-state="ready"]').first();if(await chosen.count()){await applyCard(p,chosen);r.events.push('adjacent-applied');}}
  if(await p.locator('#editing-target button').filter({hasText:/^All$/}).count()) {
   await p.locator('#editing-target button').filter({hasText:/^All$/}).click();
   await p.locator('#action-search').fill('opacity');
   await p.locator('#cards .card[data-method="encodeOpacity"]').first().waitFor({timeout:30000}).catch(()=>{});
   const all=await findCard(p,'encodeOpacity').catch(()=>null);
   if(all){await probeCard(p,all,r,'all');await settle(all);if((await readState(all)).state==='ready'){await applyCard(p,all);r.events.push('all-opacity-applied');}else r.events.push('all-opacity-invalid');}else r.events.push('all-opacity-not-offered');
   await p.locator('#action-search').fill('');
  }
  await saveSnapshot(s,r,'composed');await p.locator('#editor-root h1').hover();await p.screenshot({path:new URL(`${r.id}-final.png`,out).pathname,fullPage:true});r.targets=await p.locator('#editing-target button').allTextContents();
  if(!await p.locator('#undo').isDisabled()){await p.locator('#undo').click();await p.waitForFunction(()=>!document.querySelector('#redo').disabled);await p.locator('#redo').click();await p.waitForFunction(()=>document.querySelector('#current canvas'));r.events.push('undo-redo');}
  await p.reload();await p.locator('#current canvas').waitFor();r.events.push('reload');r.errors=s.errors;r.status='complete';
 }catch(error){r.status='interrupted';r.failure=error.message;r.errors=s.errors;await p.screenshot({path:new URL(`${r.id}-interrupted.png`,out).pathname,fullPage:true}).catch(()=>{});await saveSnapshot(s,r,'interrupted').catch(()=>{});}
 finally{await writeFile(new URL('results.json',out),JSON.stringify(results,null,2));console.log(JSON.stringify({id:r.id,status:r.status,events:r.events,cards:r.cards.length,probes:r.cards.reduce((n,c)=>n+c.probes.length,0),errors:Object.keys(r.errorScreenshots),failure:r.failure?.slice(0,250)}));await s.close();}
}}finally{await browser.close();}
