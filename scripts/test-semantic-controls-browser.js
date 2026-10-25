// Local authenticated fixture: uses public UI and captures only mock-account state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openAuditSession, selectDataset, findCard, applyCard } from './audit-browser-session-2026-10-25.mjs';
import { restoreSession } from '../web/project.js';
const out=new URL('../output/semantic-fixes-2026-10-25/',import.meta.url);await fs.mkdir(out,{recursive:true});
const results=[];
async function state(s,name){
 await s.page.locator('#editor-root h1').hover();await s.page.waitForTimeout(900);
 const project=await s.page.evaluate(async()=>{const {createDraftStore}=await import('/web/project.js');return createDraftStore(undefined,'visualization-autocomplete-account-11111111-1111-4111-8111-111111111111').read();});
 const record=project.datasets.find(d=>d.id===project.activeId), session=restoreSession(record.session,record.imported.rows),entry=session.entries[session.index],p=entry.view??entry.program;
 await fs.writeFile(new URL(`${name}-project.json`,out),JSON.stringify(project,null,2));await s.page.locator('#current-shell').screenshot({path:new URL(`${name}.png`,out).pathname});
 return {p,record,entry};
}
for(const spec of [
 {id:'glass-radar',dataset:'glass',fields:['Id_number','RI','Na','Mg','Al','Si','K','Ca','Ba','Fe','class'],method:'createRadarPlot'},
 {id:'wine-pcp-none',dataset:'wine',fields:['Alcohol','Malicacid','Ash','Magnesium','Proline','class'],method:'createParallelCoordinates'},
 {id:'iris-ecdf-color',dataset:'iris',fields:['Sepal.Length','Species'],method:'createECDFPlot'}]) {
 const s=await openAuditSession();const result={id:spec.id};results.push(result);
 try {
  await selectDataset(s.page,spec.dataset,spec.fields);let card=await findCard(s.page,spec.method);
  if(spec.method==='createRadarPlot'){
   await card.getByRole('button',{name:'Normalize each dimension (0–1)',exact:true}).click();
   await card.getByRole('button',{name:'Median by group',exact:true}).click();
  }else if(spec.method==='createParallelCoordinates')await card.locator('.control[data-parameter="color"] button[data-value=""]').click();
  else await card.locator('.control[data-parameter="mapping_color"] button[data-value="Species"]').click();
  await applyCard(s.page,card);const {p}=await state(s,spec.id),layer=p.semanticSpec.layers.find(l=>l.id==='plot');
  if(spec.method==='createRadarPlot'){
   assert.equal(p.graphicSpec.objects.plot.items.length,6);assert.deepEqual(p.resolvedScales.radius.domain,[0,1]);assert.equal(p.markConfigs.plot.radarPlot.wide.summary,'median');
   await s.page.locator('#group-encoding').click();await s.page.locator('#action-search').fill('editRadarPlot');card=await findCard(s.page,'editRadarPlot');
   const controls=await card.locator('.card-controls').innerText();assert.ok(!controls.includes('Id_number'));assert.ok(!controls.includes('\nclass\n'));
   assert.ok(await card.locator('.dimension-order').count());
   await s.page.screenshot({path:new URL('glass-radar-edit-controls.png',out).pathname,fullPage:true});
   await s.page.locator('#editor-root h1').hover();await s.page.waitForTimeout(900);await s.page.reload();await s.page.waitForLoadState('networkidle');
   await s.page.locator('#current-shell canvas').first().waitFor();const restored=await state(s,'glass-radar-reloaded');
   assert.equal(restored.p.graphicSpec.objects.plot.items.length,6);assert.deepEqual(restored.p.resolvedScales.radius.domain,[0,1]);
   result.details={series:6,summary:'median',normalize:'minmax',reload:true,sourceTypes:true,orderedEditor:true};
  } else if(spec.method==='createParallelCoordinates') {assert.equal(layer.encoding.color,undefined);result.details={color:'none',series:p.graphicSpec.objects.plot.items.length};}
  else {assert.equal(layer.encoding.color.field,'Species');assert.equal(p.graphicSpec.objects.plot.items.length,3);result.details={series:3,color:'Species'};}
  assert.deepEqual(s.errors,[]);result.status='pass';
 }catch(error){result.status='fail';result.error=error.stack;await s.page.screenshot({path:new URL(`${spec.id}-failure.png`,out).pathname,fullPage:true});process.exitCode=1;}
 finally{result.browserErrors=s.errors;await s.close();await fs.writeFile(new URL('results.json',out),JSON.stringify(results,null,2));console.log(JSON.stringify(result));}
}
