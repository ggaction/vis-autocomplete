// Live option-card audit, not a product change. All cloud writes are mocked.
import { chromium } from '@playwright/test';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { newSession, selectDataset, findCard, applyCard } from './audit-browser-session-2026-10-25.mjs';

const out = resolve('output/option-audit-2026-10-25/live'); await mkdir(out, { recursive: true });
const cases = [
  ['fashion_mnist_tsne', ['x_pos','y_pos','label_name'], 'createScatterPlot'],
  ['global-temp', ['year','temp'], 'createLinePlot'],
  ['income', ['group','pct','region'], 'createBarPlot'],
  ['unemployment', ['date','rate','series'], 'createAreaPlot'],
  ['wine', ['Alcohol','class'], 'createHistogram'],
  ['bike-sharing', ['weekday','mnth','cnt'], 'createHeatmap'],
  ['penguins', ['Species','Body Mass (g)','Sex'], 'createBoxPlot'],
  ['glass', ['class','RI'], 'createViolinPlot'],
  ['glass', ['RI','class'], 'createDensityPlot'],
  ['penguins', ['Species','Flipper Length (mm)'], 'createGradientPlot'],
  ['bike-sharing', ['temp','cnt','workingday'], 'createRegressionPlot'],
  ['penguins', ['Species','Body Mass (g)'], 'createIntervalPlot'],
  ['income', ['region','pct'], 'createDotPlot'],
  ['income', ['group','pct','region'], 'createLollipopPlot'],
  ['wine', ['class','Alcohol','Malicacid'], 'createDumbbellPlot'],
  ['wine', ['Alcohol','class'], 'createECDFPlot'],
  ['penguins', ['Species','Beak Length (mm)','Sex'], 'createStripPlot'],
  ['glass', ['class','RI'], 'createBeeswarmPlot'],
  ['penguins', ['Species','Body Mass (g)'], 'createRaincloudPlot'],
  ['fashion_mnist_tsne', ['x_pos','label_name'], 'createRugPlot'],
  ['income', ['region','total'], 'createPiePlot'],
  ['bike-sharing', ['season','cnt'], 'createRosePlot'],
  ['wine', ['class','Alcohol'], 'createRadialBarPlot'],
  ['fashion_mnist_tsne', ['x_pos','y_pos','label_name'], 'createPolarScatterPlot'],
  ['wine', ['Alcohol','Hue','class'], 'createPolarLinePlot'],
  ['wine', ['Alcohol','Ash','Malicacid','Hue','Proline','class'], 'createRadarPlot'],
  ['budgets', ['forecastYear','value'], 'createHorizonPlot'],
  ['us-employment', ['nonfarm','private','goods_producing','service_providing','government'], 'createParallelCoordinates'],
  ['wine', ['Alcohol','Hue','class'], 'createTextPlot'],
];
const only = process.env.CASE_FILTER ? new RegExp(process.env.CASE_FILTER) : null;
const browser = await chromium.launch({ headless: true });
const results = [];
const css = value => JSON.stringify(String(value));
async function settle(card) {
  await card.page().waitForTimeout(90);
  await card.page().waitForFunction(el => el?.isConnected && el.dataset.previewState !== 'pending', await card.elementHandle(), { timeout: 20000 });
  return { state: await card.getAttribute('data-preview-state'), error: await card.locator('.card-error').textContent() };
}
async function inventory(card) {
  return card.locator('[data-parameter]').evaluateAll(els => els.filter(el => !el.querySelector('[data-parameter]') && !el.hidden).map(el => ({
    key: el.dataset.parameter, label: el.querySelector(':scope > span')?.textContent,
    choices: [...el.querySelectorAll('button[data-value]')].map(b => ({ value: b.dataset.value, label: b.textContent, disabled: b.disabled, pressed: b.getAttribute('aria-pressed') === 'true' })),
    input: [...el.querySelectorAll('input')].map(i => ({ type: i.type, value: i.value, min: i.min, max: i.max })),
  })));
}
async function sweep(card, record, { mapping = false } = {}) {
  await card.locator('.card-top').hover(); await settle(card);
  const initial = await inventory(card); record.controls = initial; record.probes = [];
  for (const control of initial) {
    if (!mapping && /^(mapping_|dimensions|category|group|color|start|end)/.test(control.key)) continue;
    const target = () => card.locator(`[data-parameter=${css(control.key)}]`);
    for (const choice of control.choices.filter(c => !c.disabled)) {
      const button = target().locator(`button[data-value=${css(choice.value)}]`);
      if (!await button.count() || await button.isDisabled()) continue;
      try {
        const more = target().locator('details');
        if (!await button.isVisible() && await more.count()) await more.locator('summary').click();
        await button.click({ timeout: 5000 });
        const state = await settle(card); record.probes.push({ key: control.key, value: choice.value, via: 'click', ...state });
      } catch (error) { record.probes.push({ key: control.key, value: choice.value, harnessError: error.message.slice(0,400) }); }
    }
    const original = control.choices.find(c => c.pressed);
    if (original) {
      const button = target().locator(`button[data-value=${css(original.value)}]`);
      if (await button.count() && await button.isEnabled()) {
        if (!await button.isVisible() && await target().locator('details').count()) await target().locator('details summary').click();
        await button.click({ timeout:5000 }); await settle(card);
      }
    }
    for (const input of control.input) {
      const field = target().locator(`input[type=${css(input.type)}]`).first();
      if (!await field.count() || !await field.isVisible()) continue;
      if (input.type === 'range') {
        for (const key of ['Home','End']) {
          await field.press(key); record.probes.push({ key: control.key, value: await field.inputValue(), via: `keyboard:${key}`, ...await settle(card) });
        }
        await field.evaluate((el,value) => { el.value=value; el.dispatchEvent(new Event('input',{bubbles:true})); }, input.value); await settle(card);
      } else if (input.type === 'text') {
        for (const value of ['', 'Audit — 한글 Δ & <test>', input.value]) { await field.fill(value); await field.press('Tab'); record.probes.push({key:control.key,value,via:'text',...await settle(card)}); }
      }
    }
  }
}
try {
  for (let index=0; index<cases.length; index++) {
    const [dataset, fields, method] = cases[index]; if (only && !only.test(`${dataset}/${method}`)) continue;
    const id = `${String(index+1).padStart(2,'0')}-${method}-${dataset}`;
    const mode = index % 2 ? 'preview' : 'transition', session = await newSession(browser,{mode}), {page} = session;
    const row = {id,dataset,fields,method,mode,steps:[],started:new Date().toISOString()};
    try {
      if (index === 0) {
        await page.locator('#upload').click(); await page.locator('#file').setInputFiles(resolve('web/data/fashion_mnist_tsne.csv'));
        await page.locator('.dataset-import-dialog').getByRole('button',{name:'Use dataset',exact:true}).click();
        await page.getByLabel('Project name',{exact:true}).waitFor(); await page.getByLabel('Project name',{exact:true}).press('Enter');
        for (const field of fields) await page.getByRole('button',{name:`Select column ${field}`,exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#cards .card-row[aria-busy="false"]'));
        row.loadedVia='upload CSV';
      } else { await selectDataset(page,dataset,fields); row.loadedVia='example picker'; }
      row.initialPages=await page.locator('#cards-page').textContent();
      let card = await findCard(page,method); const creation={method,kind:'initial'}; row.steps.push(creation);
      await sweep(card,creation,{mapping:index<4});
      await applyCard(page,card); creation.applied=true;
      await page.locator('#editor-root h1').hover(); await page.waitForTimeout(300);
      await page.locator('#current').screenshot({path:`${out}/${id}-chart.png`});
      const sequence = index%5===0 ? [['style','createTitle'],['style','editAxes'],['style','editGrid'],['encoding','editColorScale'],['transform','createStatisticalReference']]
        : index%5===1 ? [['encoding','encodeOpacity'],['encoding','createMarkLabels'],['style','editMarkLabelPlacement']]
        : index%5===2 ? [['style','editLegend'],['encoding','encodeStroke'],['transform','filterMarks']]
        : index%5===3 ? [['encoding','editXScale'],['transform','createRegression']]
        : [['encoding','encodeStrokeWidth'],['style','editAxes']];
      for (const [group,next] of sequence) {
        const step={method:next,group,kind:'followup'}; row.steps.push(step);
        try {
          await page.locator(`#group-${group}`).click(); await page.locator('#action-search').fill(next);
          card = await findCard(page,next); await sweep(card,step);
          const state = await settle(card);
          if(state.state!=='invalid' && state.state!=='unchanged') {await applyCard(page,card);step.applied=true;}
          else step.finalState=state;
        } catch(error) {step.error=error.message.slice(0,800);}
      }
      await page.locator('#editor-root h1').hover(); await page.waitForTimeout(500);
      await page.screenshot({path:`${out}/${id}-final.png`,fullPage:true});
      const before=await page.locator('.history-item').count();
      await page.keyboard.press('Control+z'); await page.waitForTimeout(200); await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(400);
      row.undoRedoHistoryCount={before,after:await page.locator('.history-item').count()};
      await page.waitForFunction(()=>document.querySelector('#cloud-status')?.textContent==='Saved',{},{timeout:20000});
      row.project=[...session.projects.values()].at(-1);
      await page.reload(); await page.waitForFunction(()=>document.querySelector('#current canvas'));
      row.reload=true;row.status='completed';
    } catch(error) {row.status='incomplete';row.error=error.stack;await page.screenshot({path:`${out}/${id}-failure.png`,fullPage:true}).catch(()=>{});}
    row.pageErrors=session.errors;row.finished=new Date().toISOString();results.push(row);
    await writeFile(`${out}/${id}.json`,JSON.stringify(row,null,2));
    const saved=await Promise.all((await readdir(out)).filter(f=>/^\d\d-.*\.json$/.test(f)).sort().map(async f=>JSON.parse(await readFile(`${out}/${f}`,'utf8'))));
    const summary=saved.map(({project,...r})=>r);await writeFile(`${out}/results.json`,JSON.stringify(summary,null,2));
    console.log(id,row.status,'probes',row.steps.reduce((n,s)=>n+(s.probes?.length??0),0),'invalid',row.steps.flatMap(s=>s.probes??[]).filter(p=>p.state==='invalid').length,row.error?.split('\n')[0]??'');
    await session.close();
  }
}finally{await browser.close();}
