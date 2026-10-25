import {mkdir,writeFile} from 'node:fs/promises';
import {openAuditSession,selectDataset,findCard} from './audit-browser-session-2026-10-25.mjs';
const out='output/option-audit-2026-10-25/area-readiness';await mkdir(out,{recursive:true});
const s=await openAuditSession(),p=s.page,result={dataset:'unemployment',fields:['date','rate','series'],defaults:true,observations:[],started:new Date().toISOString()};
try{
await selectDataset(p,'unemployment',result.fields);const card=await findCard(p,'createAreaPlot');await p.waitForFunction(el=>el.dataset.previewState==='ready',await card.elementHandle());result.initialControls=await card.locator('.params').allTextContents();
const cdp=await s.context.newCDPSession(p);await cdp.send('Performance.enable');const global=await s.browser.newBrowserCDPSession();
const oldHistory=await p.locator('.history-item').count();result.beforeApply={metrics:(await cdp.send('Performance.getMetrics')).metrics,processes:(await global.send('SystemInfo.getProcessInfo')).processInfo};const start=Date.now();await card.locator('.apply-button').click();await p.locator('#editor-root h1').hover();
for(let i=0;i<=120;i++){
const state=await p.evaluate(()=>({phase:document.body.dataset.phase,history:document.querySelectorAll('.history-item').length,currentCanvas:!!document.querySelector('#current canvas'),pages:document.querySelector('#cards-page')?.textContent,rows:[...document.querySelectorAll('#cards .card-row')].map(e=>({page:e.dataset.page,busy:e.getAttribute('aria-busy'),visible:!!e.getClientRects().length,cards:[...e.querySelectorAll('.card')].map(c=>({method:c.dataset.method,state:c.dataset.previewState,title:c.querySelector('h3')?.textContent,error:c.querySelector('.preview-error')?.textContent}))})),preparing:document.querySelector('#cards')?.innerText.includes('Preparing options')}));
const metrics=(await cdp.send('Performance.getMetrics')).metrics,processes=(await global.send('SystemInfo.getProcessInfo')).processInfo,elapsed=Date.now()-start;result.observations.push({elapsed,state,metrics,processes});await writeFile(out+'/default-results.json',JSON.stringify(result,null,2));
const first=state.rows.find(x=>x.visible);if(state.history>oldHistory&&first?.busy==='false'&&first.cards.length>=5){result.readyMs=elapsed;result.status='five-options-ready';break;}
if(i%30===0){console.log(JSON.stringify({elapsed,state}));await p.screenshot({path:`${out}/default-${i}s.png`,fullPage:true});}
if(elapsed>=120000){result.status='not-ready-after-120s';break;}await p.waitForTimeout(1000);
}
result.errors=s.errors;await p.screenshot({path:out+'/default-final.png',fullPage:true});
}catch(e){result.status='harness-error';result.error=e.stack;result.errors=s.errors;}finally{await s.close();result.finished=new Date().toISOString();await writeFile(out+'/default-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify({status:result.status,readyMs:result.readyMs,observations:result.observations.length,error:result.error,errors:result.errors}));}
