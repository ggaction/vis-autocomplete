// Confirmed audit reproductions. Success means the observed defect reproduced.
// No application fixes, real accounts, or cloud writes.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { openAuditSession, selectDataset, findCard, applyCard } from './audit-browser-session-2026-10-25.mjs';
const out='output/option-audit-2026-10-25/reproductions'; await mkdir(out,{recursive:true});
const records=[];
const recipes=[
  {id:'missing-raincloud-group',dataset:'penguins',fields:['Species','Body Mass (g)'],plot:'createRaincloudPlot',group:'encoding',method:'editRaincloudPlot',choose:'Sex',expected:/nominal value/},
  {id:'parallel-color-none',dataset:'wine',fields:['Alcohol','Malicacid','Ash','Alcalinity_of_ash','Magnesium','class'],plot:'createParallelCoordinates',initial:true,key:'color',choose:'',expected:/exactly one of value or field/},
  {id:'beeswarm-position-type',dataset:'penguins',fields:['Species','Beak Depth (mm)'],plot:'createBeeswarmPlot',group:'encoding',method:'encodeX',choose:'Beak Length (mm)',expected:/categorical position scale/},
  {id:'statistics-internal-field',dataset:'penguins',fields:['Species','Body Mass (g)','Sex'],plot:'createViolinPlot',group:'transform',method:'createStatisticalReference',key:'groupBy',choose:'Body Mass (g)_value',expected:/missing at item/},
];
for(const recipe of recipes){
  const s=await openAuditSession(),{page}=s;const row={...recipe,expected:String(recipe.expected)};
  try{
    await selectDataset(page,recipe.dataset,recipe.fields);let card=await findCard(page,recipe.plot);
    if(!recipe.initial){await applyCard(page,card);await page.locator(`#group-${recipe.group}`).click();await page.locator('#action-search').fill(recipe.method);card=await findCard(page,recipe.method);}
    const key=recipe.key?`[data-parameter=${JSON.stringify(recipe.key)}] `:'';
    const button=card.locator(`${key}button[data-value=${JSON.stringify(recipe.choose)}]`).first();
    row.offered=await button.count()>0;row.disabled=await button.isDisabled();assert.equal(row.disabled,false);
    if(!await button.isVisible()){const details=button.locator('xpath=ancestor::details').first();await details.locator('summary').click();}
    await button.click();await page.waitForTimeout(500);
    await page.waitForFunction(el=>el.dataset.previewState!=='pending',await card.elementHandle());
    row.error=await card.locator('.card-error').textContent();row.state=await card.getAttribute('data-preview-state');
    assert.match(row.error,recipe.expected);row.reproduced=true;
    row.card=await card.innerText();row.projects=[...s.projects.values()];row.pageErrors=s.errors;
    await page.screenshot({path:`${out}/${recipe.id}.png`,fullPage:true});
  }catch(error){row.harnessOrNonReproduction=error.stack;await page.screenshot({path:`${out}/${recipe.id}-unconfirmed.png`,fullPage:true}).catch(()=>{});}
  finally{await s.close();}
  records.push(row);await writeFile(`${out}/${recipe.id}.json`,JSON.stringify(row,null,2));console.log(recipe.id,row.reproduced,row.error??row.harnessOrNonReproduction?.split('\n')[0]);
}
await writeFile(`${out}/results.json`,JSON.stringify(records.map(({projects,...r})=>r),null,2));
