// Report-only audit. Real initial/follow-up editors, native replay and both renderers.
// node --expose-gc scripts/audit-parameters-2026-10-25.mjs --case <id>
// --list lists deterministic cases. Output is ignored; no source/library mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { createTransitionScene, renderTransitionScene } from 'ggaction/scene';
import { createCanvas } from '@napi-rs/canvas';
import { importDataset } from '../src/data-import.js';
import { profileDataset } from '../src/profile.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { prepareGuidedAction, defaultCanvasOptions } from '../src/prepare.js';
import { createCalculationService } from '../web/calculation-service.js';
import { initialParameters, recommendationParameters, valuesFor, activeControls, buildRecommendationCall } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
import { exampleDatasets, loadExampleDataset } from '../web/example-datasets.js';

const ROOT = new URL('../', import.meta.url), OUT = new URL('../output/option-audit-2026-10-25/parameters/', import.meta.url);
const specs = [
 ['fashion-scatter','fashion_mnist_tsne','createScatterPlot',['x_pos','y_pos','label_name']],
 ['fashion-heatmap','fashion_mnist_tsne','createHeatmap',['x_pos','y_pos']],
 ['penguins-box','penguins','createBoxPlot',['Species','Beak Length (mm)','Sex']],
 ['penguins-violin','penguins','createViolinPlot',['Species','Body Mass (g)','Sex']],
 ['penguins-raincloud','penguins','createRaincloudPlot',['Species','Body Mass (g)']],
 ['penguins-gradient','penguins','createGradientPlot',['Island','Flipper Length (mm)']],
 ['penguins-interval','penguins','createIntervalPlot',['Island','Body Mass (g)','Species']],
 ['penguins-beeswarm','penguins','createBeeswarmPlot',['Species','Beak Depth (mm)']],
 ['penguins-strip','penguins','createStripPlot',['Sex','Beak Length (mm)','Species']],
 ['penguins-dot','penguins','createDotPlot',['Island','Body Mass (g)']],
 ['penguins-lollipop','penguins','createLollipopPlot',['Species','Flipper Length (mm)']],
 ['wine-pcp','wine','createParallelCoordinates',['Alcohol','Malicacid','Ash','Alcalinity_of_ash','Magnesium','class']],
 ['wine-radar','wine','createRadarPlot',['Alcohol','Malicacid','Ash','class']],
 ['glass-radar','glass','createRadarPlot',['Id_number','RI','Na','Mg']],
 ['wine-dumbbell','wine','createDumbbellPlot',['class','Alcohol','Malicacid']],
 ['wine-polar-scatter','wine','createPolarScatterPlot',['Alcohol','Malicacid','class']],
 ['wine-polar-line','wine','createPolarLinePlot',['Alcohol','Malicacid','class']],
 ['wine-regression','wine','createRegressionPlot',['Alcohol','Color_intensity','class']],
 ['glass-histogram','glass','createHistogram',['RI']],
 ['glass-density','glass','createDensityPlot',['RI']],
 ['glass-ecdf','glass','createECDFPlot',['Na']],
 ['glass-rug','glass','createRugPlot',['Mg']],
 ['bike-line','bike-sharing','createLinePlot',['dteday','cnt','season']],
 ['bike-area','bike-sharing','createAreaPlot',['dteday','casual','workingday']],
 ['bike-bar','bike-sharing','createBarPlot',['weekday','cnt','season']],
 ['bike-pie','bike-sharing','createPiePlot',['season','cnt']],
 ['bike-rose','bike-sharing','createRosePlot',['weathersit','cnt']],
 ['bike-radial','bike-sharing','createRadialBarPlot',['season','casual']],
 ['temperature-horizon','global-temp','createHorizonPlot',['year','temp']],
 ['temperature-text','global-temp','createTextPlot',['year','temp']],
 ['budget-area','budgets','createAreaPlot',['forecastYear','value','budgetYear']],
 ['income-bar','income','createBarPlot',['region','pct','group']],
 ['unemployment-line','unemployment','createLinePlot',['date','rate','series']],
 ['employment-horizon','us-employment','createHorizonPlot',['month','nonfarm_change']],
 ['cars-scatter','cars','createScatterPlot',['Miles_per_Gallon','Horsepower','Origin']],
].map(([id,dataset,method,fields])=>({id,dataset,method,fields}));
if (process.argv.includes('--list')) { console.log(JSON.stringify(specs,null,2)); process.exit(0); }
const arg = key => process.argv[process.argv.indexOf(key)+1];
const only = process.argv.includes('--case') ? arg('--case') : undefined;
const methodOnly = process.argv.includes('--action') ? arg('--action') : undefined;
const selectedMethods = methodOnly ? new Set(methodOnly.split(',')) : null;
const seed = process.argv.includes('--seed') ? arg('--seed') : '';
const targetOverride = process.argv.includes('--target') ? arg('--target') : '';
const outputSuffix = `${seed ? '-seeded' : ''}${targetOverride ? `-${targetOverride}` : ''}${methodOnly ? `-${methodOnly}` : ''}`;
const seedValueOverrides=process.argv.includes('--seed-values-file')?JSON.parse(await fs.readFile(arg('--seed-values-file'))):{};
const mode = process.argv.includes('--mode') ? arg('--mode') : 'full';
const maxTrials = Number(process.env.AUDIT_MAX_TRIALS ?? 400);
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0,16);
const flat = controls => controls.flatMap(c => c.type==='group' ? flat(c.controls) : [c]);
const json = value => JSON.parse(JSON.stringify(value));
const equal = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const safe = s => String(s).replace(/[^a-zA-Z0-9_-]/g,'-').slice(0,120);
await fs.mkdir(OUT,{recursive:true});
const model = JSON.parse(await fs.readFile(new URL('data/model.json',ROOT)));
const initialModel = JSON.parse(await fs.readFile(new URL('data/initial-model.json',ROOT)));
const initialEngine = createInitialChartRecommender(initialModel);
// Exercise the exact built-in loader and its schema overrides, using local assets.
globalThis.fetch = async url => {try {const body = await fs.readFile(new URL(String(url).replace(/^\//,''),ROOT)); return {ok:true,json:async()=>JSON.parse(body),text:async()=>body.toString()};}catch {return {ok:false};}};
function controlValues(c, values) {
 if(c.type==='number') {const mid=c.min+(c.max-c.min)/2, step=c.step??1; return [...new Set([values[c.key],c.min,c.max,Math.min(c.max,c.min+Math.round((mid-c.min)/step)*step)].filter(Number.isFinite))];}
 if(c.type==='multiselect') {const all=(c.choices??[]).filter(c=>!c.disabled).map(c=>c.value), minimum=c.minimum??1;
  const variants=[values[c.key],all,all.slice(0,minimum),[...all].reverse()]; for(const option of all)variants.push([...new Set([option,...all.filter(x=>x!==option).slice(0,Math.max(0,minimum-1))])]); return variants.filter(Boolean); }
 if(c.choices) return c.choices.filter(x=>!x.disabled).map(x=>x.value);
 if(c.type==='text') return [values[c.key],'Audit: Å β 한글','A title long enough to wrap across the available chart width 0123456789',''];
 if(c.type==='boolean'||c.type==='checkbox') return [true,false];
 if(c.type==='color') return [values[c.key],'#000000','#ffffff','#e45756'];
 return [values[c.key]];
}
function variants(editor, defaults) {
 const out=[], seen=new Set(), inventory=new Map(); let skipped=0;
 const add=(values,name,changed=[],depth=0)=>{let normalized;try{normalized=editor.normalizeValues?.(values,changed.at(-1))??values;}catch(error){out.push({values,name,changed,normalizeError:error.message});return;}
  const key=JSON.stringify(normalized); if(seen.has(key))return;seen.add(key);if(out.length>=maxTrials){skipped++;return;}out.push({values:normalized,name,changed,depth});};
 add(defaults,'default');
 const controlSchema=c=>JSON.stringify({key:c.key,type:c.type,min:c.min,max:c.max,choices:c.choices?.map(v=>[v.value,Boolean(v.disabled)])});
 const walk=(values,prefix='',depth=0,parentSchemas=new Set())=>{
  const allControls=activeControls(editor.resolveControls?.(values)??editor.controls,values);
  const cs=depth?allControls.filter(c=>!parentSchemas.has(controlSchema(c))):allControls;
  for(const c of cs){const signature=`${c.key}:${c.type}:${c.label}`; const record=inventory.get(signature)??{key:c.key,type:c.type,label:c.label,choices:[],testedValues:[],disabled:[],min:c.min,max:c.max,conditional:Boolean(c.when)};
   record.choices=[...new Map([...record.choices,...(c.choices??[]).map(choice=>({value:choice.value,label:choice.label}))].map(x=>[JSON.stringify(x.value),x])).values()];
   record.disabled.push(...(c.choices??[]).filter(v=>v.disabled).map(v=>({value:v.value,reason:v.reason})));
   inventory.set(signature,record);
   for(const value of controlValues(c,values)){record.testedValues.push(value);if(equal(value,values[c.key]))continue;
    const next={...values,[c.key]:value,...(c.key.startsWith('mapping_')?{__previousMapping:values}:{})};add(next,`${prefix}${c.key}=${JSON.stringify(value)}`,[...(prefix?[prefix]:[]),c.key],depth);
    if(depth<1&&c.choices) {
      try {walk(editor.normalizeValues?.(next,c.key)??next,`${c.key}=${JSON.stringify(value)}/`,depth+1,new Set(allControls.map(controlSchema)));}catch{}
    }
   }
  }
 };
 walk(defaults);
 for(const c of activeControls(editor.resolveControls?.(defaults)??editor.controls,defaults))if(c.type==='swap')add({...defaults,mapping_x:defaults.mapping_y,mapping_y:defaults.mapping_x},'Swap X / Y',['mapping_x','mapping_y']);
 if(mode==='full') {const cs=activeControls(editor.resolveControls?.(defaults)??editor.controls,defaults);
  for(let i=0;i<cs.length;i++)for(let j=i+1;j<cs.length;j++){
   const av=controlValues(cs[i],defaults).filter(v=>!equal(v,defaults[cs[i].key]));
   const bv=controlValues(cs[j],defaults).filter(v=>!equal(v,defaults[cs[j].key]));
   for(const [a,b] of [[av[0],bv[0]],[av.at(-1),bv.at(-1)]])if(a!==undefined&&b!==undefined){
    const first={...defaults,[cs[i].key]:a,...(cs[i].key.startsWith('mapping_')?{__previousMapping:defaults}:{})};
    let state;try{state=editor.normalizeValues?.(first,cs[i].key)??first;}catch{continue;}
    const currentControl=activeControls(editor.resolveControls?.(state)??editor.controls,state).find(c=>c.key===cs[j].key);
    if(!currentControl||currentControl.choices?.some(c=>equal(c.value,b)&&c.disabled))continue;
    add({...state,[cs[j].key]:b,...(cs[j].key.startsWith('mapping_')?{__previousMapping:state}:{})},`pair:${cs[i].key}+${cs[j].key}`,[cs[i].key,cs[j].key]);
   }
  }
 }
 for(const c of inventory.values()){c.testedValues=[...new Map(c.testedValues.map(v=>[JSON.stringify(v),v])).values()];c.disabled=[...new Map(c.disabled.map(v=>[JSON.stringify(v),v])).values()];}
 return {variants:out,controls:[...inventory.values()],skipped};
}
function checkRender(program) {
 const svg=renderToSVG(program); if(/(?:NaN|Infinity)(?:[ ,"<]|$)/.test(svg))throw new Error('Non-finite coordinate serialized in SVG.');
 const scene=createTransitionScene(program,{format:'canvas'});
 const canvas=createCanvas(1,1); renderTransitionScene(scene,canvas.getContext('2d'),{pixelRatio:0.4});
 return {svgHash:hash(svg),canvasHash:hash(canvas.toBuffer('image/png')),svgBytes:svg.length,nodes:scene.nodes.length,width:scene.width,height:scene.height,
  layers:program.semanticSpec.layers.map(l=>({id:l.id,mark:l.mark?.type,data:l.data,encoding:l.encoding})), scales:program.semanticSpec.scales.map(s=>({id:s.id,type:s.type,domain:program.resolvedScales[s.id]?.domain})),svg};
}
async function run(spec) {
 const started=performance.now();console.log('START',spec.id);
 const rec=exampleDatasets().find(r=>r.id===spec.dataset);if(!rec)throw new Error(`Dataset ${spec.dataset} not registered.`);
 const imported=(await loadExampleDataset(rec)).imported,rows=imported.rows;
 const base=chart().createCanvas(defaultCanvasOptions()).createData({id:'dataset',values:rows}),profile=profileDataset(base,'dataset',imported.fieldTypes);
 const selected=spec.fields.filter(f=>profile.fields.some(v=>v.name===f));
 const result={id:spec.id,dataset:spec.dataset,method:spec.method,sourceRows:rows.length,selected,requested:spec.fields,fieldTypes:imported.fieldTypes,started:new Date().toISOString(),cards:[],groups:{},initialErrors:[],status:'running'};
 const save=()=>fs.writeFile(new URL(`${spec.id}${outputSuffix}.json`,OUT),JSON.stringify(result,null,2)+'\n');
 const recommendations=initialEngine.recommend(rows,profile,{selection:{fields:selected}});
 result.initialAvailable=recommendations.recommendations.map(r=>r.method);result.eligibility=recommendations.diagnostics.chartEligibility;
 const definition=recommendations.recommendations.find(r=>r.method===spec.method);if(!definition){result.status='initial-unavailable';await save();return result;}
 const initial=initialParameters(definition), initialValues=initial.values??valuesFor(initial.controls);
 let prepared;
 try{prepared=prepareGuidedAction(base,{method:definition.method,args:initial.build(initialValues)},base,initial.setup?.(initialValues)??[]);}
 catch(error){result.status='initial-error';result.initialErrors.push({message:error.message,values:initialValues,args:initial.build(initialValues)});await save();return result;}
 let current=prepared.authoringPreview,view=prepared.preview;
 result.seedCalls=[];
 if(seed) {
   for(const method of seed.split(',')) {
     const seeds=createCalculationService(model),target=current.semanticSpec.layers.find(l=>l.id===targetOverride)?.id??current.semanticSpec.layers.find(l=>l.id==='plot')?.id??current.semanticSpec.layers[0]?.id;
     seeds.execute({type:'state',stateId:1,snapshot:serializeProgram(current),guideCall:prepared.guideCall});
     let selected;
     for(const group of ['encoding','transform','style']) {
       let response;for(let page=0;page<80;page++){response=seeds.execute({type:'recommend',stateId:1,group,page,options:{...FOLLOWUP_RECOMMENDATION_OPTIONS,target,fieldTypes:imported.fieldTypes,hierarchy:false},searchQuery:method});if(response.pagination.complete)break;}
       const candidate=response.result.recommendations.find(r=>r.method===method);
       if(candidate) {const editor=recommendationParameters(candidate,response.profile);let values={...valuesFor(editor.controls),...(seedValueOverrides[method]??{})};values=editor.normalizeValues?.(values)??values;selected=buildRecommendationCall({...editor,method},values);break;}
     }
     if(!selected) {result.seedCalls.push({method,status:'unavailable'});continue;}
     try {prepared=prepareGuidedAction(current,selected,view);current=prepared.authoringPreview;view=prepared.preview;result.seedCalls.push({...selected,status:'applied'});}
     catch(error){result.seedCalls.push({...selected,status:'error',message:error.message});}
   }
 }
 result.initial={values:initialValues,args:initial.build(initialValues),setup:initial.setup?.(initialValues)??[],render:checkRender(view)};delete result.initial.render.svg;
 await fs.writeFile(new URL(`${spec.id}${outputSuffix}-base.json`,OUT),JSON.stringify({snapshot:serializeProgram(current),guideCall:prepared.guideCall}));
 await fs.writeFile(new URL(`${spec.id}${outputSuffix}-base.svg`,OUT),renderToSVG(view));
 const auditEditor=async({editor,defaults,method,group,label,recordArgs,baseProgram=current,baseView=view,setup=()=>[]})=>{
  const plan=variants(editor,defaults),record={method,group,label,args:recordArgs,defaults,controls:plan.controls,plannedVariants:plan.variants.length,skippedByBudget:plan.skipped,checks:[],errors:[]};result.cards.push(record);
  const seenCalls=new Set(),baseSvg=renderToSVG(baseView),byAction=new Map();let index=0;
  for(const variant of plan.variants){let action,activeKeys=[];const t=performance.now();try{
   activeKeys=activeControls(editor.resolveControls?.(variant.values)??editor.controls,variant.values).map(c=>c.key);
   if(variant.normalizeError)throw new Error(variant.normalizeError);
   action=group==='initial'?{method,args:editor.build(variant.values)}:buildRecommendationCall({...editor,method},variant.values);
   const setupCalls=setup(variant.values),key=hash([action,setupCalls]);
   if(index%20===0)await fs.writeFile(new URL(`${spec.id}${outputSuffix}-progress.json`,OUT),JSON.stringify({method,group,variant:variant.name,values:variant.values,action,time:new Date().toISOString()}));
   if(seenCalls.has(key)){record.checks.push({name:variant.name,changed:variant.changed,activeKeys,values:variant.values,status:'same-call',actionHash:key});continue;}seenCalls.add(key);
   const p=prepareGuidedAction(baseProgram,action,baseView,setupCalls),render=checkRender(p.preview),summary={name:variant.name,changed:variant.changed,activeKeys,values:variant.values,status:'ok',actionHash:key,svgHash:render.svgHash,canvasHash:render.canvasHash,nodes:render.nodes,ms:Math.round(performance.now()-t)};
   if(render.svg===baseSvg)summary.sameAsBase=true;
   if(variant.name==='default') {const round=deserializeProgram(serializeProgram(p.preview));summary.roundtrip=hash(renderToSVG(round))===render.svgHash;if(!summary.roundtrip)record.errors.push({kind:'roundtrip-diff',...summary,action});}
   record.checks.push(summary);byAction.set(key,render.svgHash);
  }catch(error){const item={name:variant.name,changed:variant.changed,activeKeys,values:variant.values,action,kind:error.reason??'execution',message:error.message,ms:Math.round(performance.now()-t)};
   if(error.reason==='no-change')record.checks.push({...item,status:'unchanged'});else record.errors.push(item);
  }
  if(++index%40===0){globalThis.gc?.();}
 }
 record.durationMs=Math.round(record.checks.reduce((n,c)=>n+(c.ms??0),0));await save();console.log('CARD',spec.id,group,method,'checks',record.checks.length,'errors',record.errors.length);globalThis.gc?.();
 };
 if(!seed&&(!selectedMethods||selectedMethods.has(spec.method)))await auditEditor({editor:initial,defaults:initialValues,method:spec.method,group:'initial',label:definition.title,recordArgs:result.initial.args,baseProgram:base,baseView:base,setup:v=>initial.setup?.(v)??[]});
 const service=createCalculationService(model);service.execute({type:'state',stateId:1,snapshot:serializeProgram(current),guideCall:prepared.guideCall});
 const requestedTarget=targetOverride==='regression' ? current.semanticSpec.layers.find(l=>current.markConfigs[l.id]?.regression)?.id : targetOverride;
 const target=requestedTarget || current.semanticSpec.layers.find(l=>l.id==='plot')?.id||current.semanticSpec.layers[0]?.id;
 for(const group of ['encoding','transform','style']){
  let response;for(let page=0;page<80;page++){response=service.execute({type:'recommend',stateId:1,group,page,options:{...FOLLOWUP_RECOMMENDATION_OPTIONS,target,fieldTypes:imported.fieldTypes,hierarchy:false}});if(response.pagination.complete)break;}
  const recommendations=[...response.result.recommendations];
  if(selectedMethods)for(const method of selectedMethods){
    if(recommendations.some(r=>r.method===method))continue;
    let searched;for(let page=0;page<80;page++){searched=service.execute({type:'recommend',stateId:1,group,page,searchQuery:method,options:{...FOLLOWUP_RECOMMENDATION_OPTIONS,target,fieldTypes:imported.fieldTypes,hierarchy:false}});if(searched.pagination.complete)break;}
    recommendations.push(...searched.result.recommendations.filter(r=>r.method===method));
  }
  result.groups[group]={methods:recommendations.map(r=>r.method),count:recommendations.length,pagination:response.pagination,rejected:response.result.diagnostics.rejected};
  for(const recommendation of recommendations){if(selectedMethods&&!selectedMethods.has(recommendation.method))continue;
   try {const editor=recommendationParameters(recommendation,response.profile);await auditEditor({editor,defaults:valuesFor(editor.controls),method:recommendation.method,group,label:recommendation.label,recordArgs:recommendation.args});}
   catch(error){result.cards.push({group,method:recommendation.method,label:recommendation.label,errors:[{kind:'editor',message:error.message}]});await save();}
  }
 }
 result.requestedMethods=selectedMethods?[...selectedMethods]:null;result.requestedMethodsNotServed=selectedMethods?[...selectedMethods].filter(m=>!result.cards.some(c=>c.method===m)):[];result.status='complete';result.durationMs=Math.round(performance.now()-started);result.finished=new Date().toISOString();
 result.totals={cards:result.cards.length,controls:result.cards.reduce((n,c)=>n+(c.controls?.length??0),0),checks:result.cards.reduce((n,c)=>n+(c.checks?.length??0),0),errors:result.cards.reduce((n,c)=>n+(c.errors?.length??0),0),budgetSkipped:result.cards.reduce((n,c)=>n+(c.skippedByBudget??0),0)};
 await save();console.log('DONE',spec.id,JSON.stringify(result.totals),result.durationMs);return result;
}
for(const spec of specs.filter(s=>!only||s.id===only))try{await run(spec);}catch(error){console.error('FAILED',spec.id,error.stack);await fs.writeFile(new URL(`${spec.id}${outputSuffix}-fatal.json`,OUT),JSON.stringify({id:spec.id,message:error.message,stack:error.stack}));process.exitCode=1;}
