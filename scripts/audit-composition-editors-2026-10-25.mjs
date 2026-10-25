// Report-only targeted coverage of real follow-up composition editors.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createCanvas } from '@napi-rs/canvas';
import { serializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { createTransitionScene, renderTransitionScene } from 'ggaction/scene';
import { restoreSession } from '../web/project.js';
import { createCalculationService } from '../web/calculation-service.js';
import { recommendationParameters, valuesFor, activeControls, buildRecommendationCall } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { editableChartTargets } from '../src/composition-context.js';
import { prepareGuidedAction } from '../src/prepare.js';
const root=new URL('../',import.meta.url),out=new URL('output/option-audit-2026-10-25/composition-editors/',root);
await fs.mkdir(out,{recursive:true});
const model=JSON.parse(await fs.readFile(new URL('data/model.json',root)));
const cases=['barley-horizontal','iris-distributions','fashion-point'];
const requested=process.argv.find(x=>x.startsWith('--case='))?.slice(7);
const browserOnly=process.argv.includes('--browser');
const methods={editFacetHeaders:'style',editFacetGuides:'style',editFacetScales:'encoding',editCompositionLayout:'style',editCompositionScales:'encoding',editOverlay:'encoding'};
const hash=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
const nativeMethod=r=>r.method==='editFacetSource'?r.args.action.method:r.method;
for(const id of cases.filter(x=>!browserOnly&&(!requested||x===requested))){
 const result={id,source:`compositions/${id}-nested.visauto.json`,cards:[],availability:[],started:new Date().toISOString()};
 const save=()=>fs.writeFile(new URL(`${id}.json`,out),JSON.stringify(result,null,2)+'\n');
 try{
  const doc=JSON.parse(await fs.readFile(new URL(`output/option-audit-2026-10-25/${result.source}`,root)));
  const record=doc.datasets.find(d=>d.id===doc.activeId),session=restoreSession(record.session,record.imported.rows),entry=session.entries[session.index],base=entry.program,view=entry.view;
  result.targets=editableChartTargets(base);
  const scopes=[{label:'All',scope:'all'},...result.targets.map(t=>({label:t.label,target:t.id,childPath:t.childPath}))];
  const seen=new Set();
  for(const scope of scopes){
   const service=createCalculationService(model);service.execute({type:'state',stateId:1,snapshot:serializeProgram(base),guideCall:entry.guideCall});
   for(const [method,group] of Object.entries(methods)){
    const opts={...FOLLOWUP_RECOMMENDATION_OPTIONS,...scope,fieldTypes:record.imported.fieldTypes,hierarchy:false};delete opts.label;
    let response;for(let page=0;page<15;page++){response=service.execute({type:'recommend',stateId:1,group,page,searchQuery:method,options:opts});if(response.pagination.complete)break;}
    const recs=response.result.recommendations.filter(r=>nativeMethod(r)===method);
    result.availability.push({scope,method,served:recs.length,rejected:response.result.diagnostics.rejected});
    for(const rec of recs){
     const editor=recommendationParameters(rec,response.profile),defaults=valuesFor(editor.controls),call=buildRecommendationCall({...editor,method:rec.method},defaults),key=JSON.stringify(call);
     if(seen.has(key))continue;seen.add(key);
     const controls=activeControls(editor.resolveControls?.(defaults)??editor.controls,defaults);
     const card={scope,method,servedMethod:rec.method,label:rec.label,defaults,defaultCall:call,controls,checks:[]};result.cards.push(card);
     const variants=[{name:'default',values:defaults}],vs=new Set([JSON.stringify(defaults)]);
     for(const c of controls){let values=c.choices?.filter(v=>!v.disabled).map(v=>v.value)??[];
      if(c.type==='number'){const step=c.step??1,mid=c.min+Math.round((c.max-c.min)/2/step)*step;values=[c.min,mid,c.max];}
      for(const value of values){const input={...defaults,[c.key]:value},normalized=editor.normalizeValues?.(input,c.key)??input,k=JSON.stringify(normalized);if(vs.has(k))continue;vs.add(k);variants.push({name:`${c.key}=${JSON.stringify(value)}`,values:normalized});}
     }
     for(const variant of variants){let action;try{action=buildRecommendationCall({...editor,method:rec.method},variant.values);const p=prepareGuidedAction(base,action,view),svg=renderToSVG(p.preview),scene=createTransitionScene(p.preview,{format:'canvas'}),canvas=createCanvas(1,1);renderTransitionScene(scene,canvas.getContext('2d'),{pixelRatio:.25});card.checks.push({...variant,action,status:'ok',svgHash:hash(svg),canvasHash:hash(canvas.toBuffer('image/png')),nodes:scene.nodes.length,width:scene.width,height:scene.height});}
      catch(error){card.checks.push({...variant,action,status:error.reason==='no-change'?'unchanged':'error',message:error.message});}
     }
     console.log(id,scope.label,method,card.checks.length,'errors',card.checks.filter(c=>c.status==='error').length);await save();globalThis.gc?.();
    }
   }
  }
  result.status='complete';
 }catch(error){result.status='harness-interrupted';result.error=error.stack;}
 result.finished=new Date().toISOString();await save();console.log('DONE',id,result.status);
}
if(browserOnly){
 const {openAuditSession,findCard}=await import('./audit-browser-session-2026-10-25.mjs');
 const s=await openAuditSession(),p=s.page,result={steps:[]};
 try{
  const fixture=requested??'barley-horizontal';
  await p.locator('#project-file').setInputFiles(new URL(`output/option-audit-2026-10-25/compositions/${fixture}-nested.visauto.json`,root).pathname);
  await p.locator('#current canvas').waitFor();
  await p.locator('#editing-target').getByRole('button',{name:fixture==='iris-distributions'?'Point 1':'Bar 1',exact:true}).click();
  await p.locator('#group-style').click();await p.locator('#action-search').fill('editFacetGuides');
  await p.locator('#cards .card').first().waitFor();const card=await findCard(p,'editFacetGuides');
  const read=()=>card.evaluate(el=>({state:el.dataset.previewState,error:el.querySelector('.card-error')?.textContent??'',controls:el.querySelector('.card-controls')?.innerText}));
  result.steps.push({name:'before',...await read()});
  for(const name of fixture==='iris-distributions'?['Shared · right','Shared · bottom','Shared · top']:['Shared · bottom','Shared · top']){
   await card.getByRole('button',{name,exact:true}).click();await p.waitForTimeout(500);
   await p.waitForFunction(el=>el.dataset.previewState!=='pending',await card.elementHandle());
   result.steps.push({name,...await read()});
   await p.screenshot({path:new URL(`${fixture}-guides-${name.split(' ').at(-1)}.png`,out).pathname,fullPage:true});
  }
  result.status='complete';
 }catch(error){result.status='harness-interrupted';result.message=error.stack;}
 result.pageErrors=s.errors;await s.close();await fs.writeFile(new URL(`browser-guides-${requested??'barley-horizontal'}.json`,out),JSON.stringify(result,null,2)+'\n');console.log(result);
}
