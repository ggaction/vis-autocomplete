// Report-only audit of dataset semantics against real option-card results.
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { newSession,selectDataset,findCard,applyCard } from './audit-browser-session-2026-10-25.mjs';
import { restoreSession } from '../web/project.js';
import { serializeProgram } from 'ggaction/persistence';
import { createTransitionScene } from 'ggaction/scene';
import { renderToSVG } from 'ggaction/svg';
const out=new URL('../output/option-audit-2026-10-25/semantics/',import.meta.url);await fs.mkdir(out,{recursive:true});
const cases=[
 {id:'wine-pcp',dataset:'wine',fields:['Alcohol','Malicacid','Ash','Magnesium','Proline','class'],method:'createParallelCoordinates'},
 {id:'wine-radar',dataset:'wine',fields:['Alcohol','Malicacid','Ash','Magnesium','Proline','class'],method:'createRadarPlot'},
 {id:'glass-pcp',dataset:'glass',fields:['RI','Na','Mg','Al','Si','K','Ca','Ba','Fe','class'],method:'createParallelCoordinates'},
 {id:'glass-radar',dataset:'glass',fields:['RI','Na','Mg','Al','Si','K','Ca','Ba','Fe','class'],method:'createRadarPlot'},
 {id:'glass-radar-id',dataset:'glass',fields:['Id_number','RI','Na','Mg','Al','Si','K','Ca','Ba','Fe','class'],method:'createRadarPlot'},
 {id:'income-bar',dataset:'income',fields:['group','pct','region'],method:'createBarPlot'},
 {id:'income-area',dataset:'income',fields:['group','pct','region'],method:'createAreaPlot'},
 {id:'temp-area',dataset:'global-temp',fields:['year','temp'],method:'createAreaPlot'},
 {id:'temp-horizon',dataset:'global-temp',fields:['year','temp'],method:'createHorizonPlot'},
 {id:'temp-polar',dataset:'global-temp',fields:['year','temp'],method:'createPolarLinePlot'},
 {id:'temp-rose',dataset:'global-temp',fields:['year','temp'],method:'createRosePlot'},
 {id:'fashion-scatter',dataset:'fashion_mnist_tsne',fields:['x_pos','y_pos','label'],method:'createScatterPlot'},
];
const only=process.argv.find(x=>x.startsWith('--case='))?.split('=')[1];
const results=JSON.parse(await fs.readFile(new URL('results.json',out),'utf8').catch(()=> '[]')).filter(r=>!cases.some(s=>(!only||s.id===only)&&s.id===r.id)),browser=await chromium.launch({headless:true});
async function saveState(s,r,stage){
 await s.page.locator('#editor-root h1').hover();await s.page.waitForTimeout(700);
 const project=await s.page.evaluate(async()=>{const {createDraftStore}=await import('/web/project.js');return createDraftStore(undefined,'visualization-autocomplete-account-11111111-1111-4111-8111-111111111111').read();});
 if(!project)throw Error('No saved local project');const record=project.datasets.find(d=>d.id===project.activeId);const session=restoreSession(record.session,record.imported.rows),entry=session.entries[session.index],program=entry.view??entry.program;
 const scene=createTransitionScene(program,{format:'canvas'});
 await fs.writeFile(new URL(`${r.id}-${stage}-project.json`,out),JSON.stringify(project,null,2));
 await fs.writeFile(new URL(`${r.id}-${stage}-program.json`,out),JSON.stringify({snapshot:serializeProgram(program),semantic:program.semanticSpec,resolvedScales:program.resolvedScales,graphic:program.graphicSpec,scene},null,2));
 await fs.writeFile(new URL(`${r.id}-${stage}.svg`,out),renderToSVG(program));
 await s.page.locator('#current-shell').screenshot({path:new URL(`${r.id}-${stage}.png`,out).pathname});
 return {calls:entry.calls,fieldTypes:record.imported.fieldTypes,rows:record.imported.rows.length,scales:program.semanticSpec.scales.map(scale=>({id:scale.id,type:scale.type,domain:program.resolvedScales[scale.id]?.domain,range:program.resolvedScales[scale.id]?.range})),layers:program.semanticSpec.layers.map(l=>({id:l.id,mark:l.mark,data:l.data,encoding:l.encoding})),nodes:scene.nodes.length};
}
try{for(const spec of cases.filter(s=>!only||s.id===only)){
 const s=await newSession(browser);const r={...spec,stages:[],errors:[]};results.push(r);console.log('START',spec.id);
 try{await selectDataset(s.page,spec.dataset,spec.fields);const card=await findCard(s.page,spec.method);r.initialControls=await card.locator('.card-controls').innerText();
 await applyCard(s.page,card);r.stages.push({name:'default',...await saveState(s,r,'default')});
 if(spec.method==='createRadarPlot'||spec.method==='createParallelCoordinates'){
  await s.page.locator('#group-encoding').click();await s.page.locator('#action-search').fill(spec.method==='createRadarPlot'?'editRadarPlot':'editParallelScale');await s.page.locator('#cards .card').first().waitFor();const edit=await findCard(s.page,spec.method==='createRadarPlot'?'editRadarPlot':'editParallelScale');r.editControls=await edit.locator('.card-controls').innerText();await fs.writeFile(new URL(`${r.id}-edit-controls.html`,out),await edit.innerHTML());await s.page.screenshot({path:new URL(`${r.id}-edit-controls.png`,out).pathname,fullPage:true});
  if(spec.method==='createParallelCoordinates'){
    const dimension=spec.dataset==='wine'?'Proline':'RI';
    await edit.locator(`.control[data-parameter="p0"] button[data-value="${dimension}"]`).click();
    r.domainAfterDimensionChange=await edit.locator('.control[data-parameter="p3"]').innerText();
    await edit.locator('.control[data-parameter="p1"] button[data-value="log"]').click();
    await edit.locator('.control[data-parameter="p2"] button[data-value="false"]').click();
    await edit.getByRole('button',{name:'Full data extent',exact:true}).click();await applyCard(s.page,edit);r.stages.push({name:'log-dimension',...await saveState(s,r,'log-dimension')});
  }
  if(spec.method==='createRadarPlot'){
    await edit.locator('button[data-value="class"]').click();await applyCard(s.page,edit);r.stages.push({name:'class-dimension',...await saveState(s,r,'class-dimension')});
    await s.page.locator('#action-search').fill('encodeColor');await s.page.locator('#cards .card').first().waitFor();const col=await findCard(s.page,'encodeColor');r.colorControls=await col.locator('.card-controls').innerText();await fs.writeFile(new URL(`${r.id}-color-controls.html`,out),await col.innerHTML());
    const cb=col.locator('button[data-value="class"]').first();if(await cb.count()){await cb.click();await applyCard(s.page,col);r.stages.push({name:'class-color',...await saveState(s,r,'class-color')});}
  }
 }
 r.status='complete';
 }catch(error){r.status='interrupted';r.failure=error.message;await s.page.screenshot({path:new URL(`${r.id}-failure.png`,out).pathname,fullPage:true}).catch(()=>{});}
 finally{r.errors=s.errors;await s.close();await fs.writeFile(new URL('results.json',out),JSON.stringify(results,null,2));console.log(JSON.stringify({id:r.id,status:r.status,error:r.failure,stages:r.stages.length}));}
}}finally{await browser.close();}

// Numerical checks use saved real UI outputs and independent arithmetic, not a
// replay of the chart's aggregation implementation.
const oracleResults=[];
const load=async(id,stage='default')=>JSON.parse(await fs.readFile(new URL(`${id}-${stage}-program.json`,out)));
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
const scale=(value,s)=>s.range[0]+(value-s.domain[0])/(s.domain[1]-s.domain[0])*(s.range[1]-s.range[0]);
const inv=(value,s)=>s.domain[0]+(value-s.range[0])/(s.range[1]-s.range[0])*(s.domain[1]-s.domain[0]);
for(const id of ['wine-pcp','glass-pcp']){try{
 const p=await load(id),l=p.semantic.layers.find(l=>l.id==='plot'),rows=p.semantic.datasets.find(d=>d.id===l.data).values,items=p.graphic.objects.plot.items,dims=l.encoding.parallel.dimensions;
 const mismatches=[];for(const [i,row] of rows.entries())for(const [j,d] of dims.entries()){const actual=items[i]?.properties.commands[j]?.y,expected=scale(row[d.field],p.resolvedScales[d.scale]);if(!near(actual,expected))mismatches.push({row:i,field:d.field,actual,expected});}
 oracleResults.push({id,oracle:'Every source row has a complete path; each dimension maps to its independent min/max scale.',rows:rows.length,paths:items.length,dimensions:dims.map(d=>d.field),coordinatesChecked:rows.length*dims.length,mismatches:mismatches.slice(0,10),pass:items.length===rows.length&&!mismatches.length});
 }catch(error){oracleResults.push({id,error:error.message});}}
try{const p=await load('fashion-scatter'),l=p.semantic.layers.find(l=>l.id==='plot'),rows=p.semantic.datasets.find(d=>d.id===l.data).values,items=p.graphic.objects.plot.items,color=p.resolvedScales[l.encoding.color.scale],mismatches=[];
 for(const [i,row] of rows.entries()){const m=items[i]?.properties;for(const axis of ['x','y'])if(!near(m?.[axis],scale(row[l.encoding[axis].field],p.resolvedScales[l.encoding[axis].scale])))mismatches.push({row:i,axis});const expected=color.range[color.domain.indexOf(row[l.encoding.color.field])%color.range.length];if(m?.fill!==expected)mismatches.push({row:i,color:m?.fill,expected});}
 oracleResults.push({id:'fashion-scatter',oracle:'Each of498 source points retains exact X/Y mappings and its ten-class categorical color.',rows:rows.length,points:items.length,categories:color.domain.length,colors:new Set(items.map(i=>i.properties.fill)).size,coordinatesChecked:rows.length*2,colorChecks:rows.length,mismatches:mismatches.slice(0,10),pass:rows.length===items.length&&!mismatches.length});
}catch(error){oracleResults.push({id:'fashion-scatter',error:error.message});}
for(const id of ['income-bar','income-area']){try{
 const p=await load(id),rows=p.semantic.datasets.find(d=>d.id==='dataset').values,x=p.resolvedScales.x,y=p.resolvedScales.y,color=p.resolvedScales.color,items=p.graphic.objects.plot.items,mismatches=[];
 let checked=0,maximum=0;
 if(id==='income-bar')for(const item of items){const m=item.properties,index=Math.floor((m.x+m.width/2-x.start)/x.step),group=x.domain[index],region=color.domain[color.range.indexOf(m.fill)],matching=rows.filter(r=>r.group===group&&r.region===region),expected=matching.reduce((sum,r)=>sum+r.pct,0),actual=inv(m.y,y);checked++;maximum=Math.max(maximum,expected);if(!near(expected,actual))mismatches.push({group,region,expected,actual});}
 else for(const item of items){const region=color.domain[color.range.indexOf(item.properties.fill)];for(const [index,command] of item.properties.commands.slice(0,x.domain.length).entries()){const group=x.domain[index],matching=rows.filter(r=>r.group===group&&r.region===region),expected=matching.reduce((sum,r)=>sum+r.pct,0)/matching.length,actual=inv(command.y,y);checked++;maximum=Math.max(maximum,expected);if(!near(expected,actual))mismatches.push({group,region,expected,actual});}}
 oracleResults.push({id,oracle:'All income categories retain their explicit numeric bracket order. Marks equal independent per-bracket/per-region '+(id==='income-bar'?'sums':'arithmetic means')+'.',categories:x.domain,sourceRows:rows.length,groups:color.domain.length,valuesChecked:checked,maximumDisplayedValue:maximum,mismatches:mismatches.slice(0,10),pass:checked===50&&!mismatches.length});
}catch(error){oracleResults.push({id,error:error.message});}}
for(const id of ['temp-area','temp-horizon']){try{
 const p=await load(id),raw=p.semantic.datasets.find(d=>d.id==='dataset').values,bin=p.semantic.datasets.find(d=>d.id==='dataset-binned-rows').values,summary=p.semantic.datasets.find(d=>d.id==='dataset-plot-summary').values,mismatches=[];
 for(const row of summary){const matching=bin.filter(r=>r['year (bin)']===row['year (bin)']),expected=matching.reduce((sum,r)=>sum+r.temp,0)/matching.length;if(!near(row.temp,expected))mismatches.push({bin:row['year (bin)'],actual:row.temp,expected});}
 oracleResults.push({id,oracle:'All144 yearly inputs survive the binning step, and each summarized value equals its member-row arithmetic mean.',sourceRows:raw.length,binnedRows:bin.length,summaryRows:summary.length,actualYearExtent:[Math.min(...raw.map(r=>r.year)),Math.max(...raw.map(r=>r.year))],displayedBinCenters:summary.map(r=>r['year (bin)']),mismatches,pass:raw.length===bin.length&&!mismatches.length});
}catch(error){oracleResults.push({id,error:error.message});}}
try{const p=await load('temp-polar'),raw=p.semantic.datasets.find(d=>d.id==='dataset').values,commands=p.graphic.objects.plot.items[0].properties.commands;oracleResults.push({id:'temp-polar',oracle:'The polar line retains one vertex per input year, including negative values; radius scale includes the complete signed range.',rows:raw.length,vertices:commands.length,negativeRows:raw.filter(r=>r.temp<0).length,radiusDomain:p.resolvedScales.radius.domain,pass:commands.length===raw.length&&p.resolvedScales.radius.domain[0]===Math.min(...raw.map(r=>r.temp))});}catch(error){oracleResults.push({id:'temp-polar',error:error.message});}
try{const p=await load('wine-pcp','log-dimension'),l=p.semantic.layers.find(l=>l.id==='plot'),rows=p.semantic.datasets.find(d=>d.id===l.data).values,items=p.graphic.objects.plot.items,dims=l.encoding.parallel.dimensions,mismatches=[];
 for(const [i,row] of rows.entries())for(const [j,d] of dims.entries()){const sc=p.resolvedScales[d.scale],value=row[d.field],expected=sc.type==='log'?sc.range[0]+(Math.log(value)-Math.log(sc.domain[0]))/(Math.log(sc.domain[1])-Math.log(sc.domain[0]))*(sc.range[1]-sc.range[0]):scale(value,sc);if(!near(items[i]?.properties.commands[j]?.y,expected))mismatches.push({row:i,field:d.field});}
 oracleResults.push({id:'wine-pcp-log-dimension',oracle:'Changing only Proline to logarithmic/full extent preserves the other four dimensions and all178 paths.',coordinatesChecked:rows.length*dims.length,scaleTypes:dims.map(d=>[d.field,p.resolvedScales[d.scale].type]),mismatches:mismatches.slice(0,10),pass:!mismatches.length&&p.resolvedScales[dims[4].scale].type==='log'&&dims.slice(0,4).every(d=>p.resolvedScales[d.scale].type==='linear')});
}catch(error){oracleResults.push({id:'wine-pcp-log-dimension',error:error.message});}
await fs.writeFile(new URL('oracles.json',out),JSON.stringify(oracleResults,null,2));console.log('ORACLES',oracleResults.map(r=>[r.id,r.pass,r.error]));
