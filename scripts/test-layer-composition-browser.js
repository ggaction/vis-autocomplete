import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '../vendor/ggaction/node_modules/playwright/index.mjs';
const output=new URL('../output/layer-composition-audit/browser/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});const results=[];
async function visibleCard(page,method,title){
 await page.locator('#cards .card').first().waitFor();
 for(let i=0;i<9;i++){
  let card=page.locator(`#cards .card[data-method="${method}"]`);
  if(title)card=card.filter({has:page.locator('h3',{hasText:title})});
  card=card.first();if(await card.isVisible() && await card.evaluate(el=>{const a=el.getBoundingClientRect(),b=document.querySelector('#cards').getBoundingClientRect();return a.left+a.width/2>b.left&&a.left+a.width/2<b.right;}))return card;
  const next=page.locator('#cards-next');if(await next.isDisabled())break;const before=await page.locator('#cards-page').innerText();await next.click();await page.waitForFunction(before=>document.querySelector('#cards-page').textContent!==before,before);await page.waitForTimeout(400);const number=Number((await page.locator('#cards-page').innerText()).split('/')[0]);await page.locator(`.card-row[data-page="${number}"][aria-busy="false"]`).waitFor();
 }
 throw new Error(`Missing visible card ${method} ${title??''}: ${await page.locator('#cards').innerText()}`);
}
async function apply(page,card,method){const n=await page.locator('.history-item').count();await card.hover();await card.locator('.apply-button').click();await page.waitForFunction(n=>document.querySelectorAll('.history-item').length>n,n);console.log('Applied',method);}
try{
 for(const c of [
  {id:'iris-box',dataset:'iris',fields:['Species','Sepal.Length'],plot:'createBeeswarmPlot',layer:/Box plot layer/i,mode:'transition'},
  {id:'tips-raincloud',dataset:'tips',fields:['day','tip'],plot:'createViolinPlot',layer:/Raincloud plot layer/i,mode:'preview'},
  {id:'barley-follow',dataset:'barley',fields:['variety','yield','year'],plot:'createBarPlot',layer:/Line overlay/i,mode:'preview',follow:true},
  {id:'cars-heatmap',dataset:'cars',fields:['Miles_per_Gallon','Horsepower'],plot:'createScatterPlot',layer:/Heatmap layer/i,mode:'transition'},
 ]){
  const page=await browser.newPage({viewport:{width:1700,height:1100}});page.setDefaultTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto('http://127.0.0.1:5173/');await page.waitForLoadState('networkidle');
   await page.locator('#dataset').selectOption(c.dataset);await page.locator(`#view-mode [data-mode="${c.mode}"]`).click();
   for(const name of c.fields)await page.getByRole('button',{name:`Select column ${name}`,exact:true}).click();
   await apply(page,await visibleCard(page,c.plot),c.plot);
   await page.getByRole('button',{name:'Add overlay',exact:true}).click();
   await page.getByRole('button',{name:'Layer chart',exact:true}).waitFor();
   if(c.follow) await page.getByRole('button',{name:'Follow results',exact:true}).click();
   const card=await visibleCard(page,c.follow?'createOverlay':'createLayerPlot',c.layer);await card.hover();
   const behind=card.getByRole('button',{name:'Behind',exact:true});if(await behind.count())await behind.click();
   await apply(page,card,c.follow?'createOverlay':'createLayerPlot');
   await page.locator('#cards .card').first().waitFor();
   const labels=await page.locator('#editing-target button').allTextContents();assert.ok(labels.length>=3);
   await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('.history-item[aria-current="step"]')?.dataset.historyIndex==='1');
   await page.locator('#redo').click();await page.waitForFunction(()=>document.querySelector('.history-item[aria-current="step"]')?.dataset.historyIndex==='2');
   await page.getByRole('button',{name:'Add overlay',exact:true}).click();
   const cards=page.locator('#cards .card:visible');await cards.first().waitFor();
   for(let i=0;i<30;i++){const box=await cards.nth(i%await cards.count()).boundingBox();if(box)await page.mouse.move(box.x+box.width/2,box.y+45);}
   await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('h1').hover();await page.locator('.card-row[data-page="1"][aria-busy="false"]').waitFor();await page.waitForTimeout(600);
   await page.screenshot({path:new URL(`${c.id}.png`,output).pathname,fullPage:true});
   await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(()=>document.querySelector('.history-item[aria-current="step"]')?.dataset.historyIndex==='2');
   assert.deepEqual(errors,[]);results.push({...c,layer:String(c.layer),status:'passed',targets:labels});console.log('PASS',c.id);
  }catch(error){await page.screenshot({path:new URL(`${c.id}-failed.png`,output).pathname,fullPage:true});results.push({id:c.id,status:'failed',error:error.message,errors});console.log('FAIL',c.id,error.message.slice(0,800));}
  finally{await page.close();}
 }
}finally{await browser.close();await writeFile(new URL('results.json',output),JSON.stringify(results,null,2));}
assert.ok(results.every(r=>r.status==='passed'),JSON.stringify(results));
