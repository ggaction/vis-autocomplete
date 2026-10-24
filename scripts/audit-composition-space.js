// Baseline feasibility audit: independent native concat, not shared-axis or UI coverage.
import { chart, hconcat, vconcat } from 'ggaction';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { profileDataset } from '../src/profile.js';
import { getPlotDefinitions, defaultValues } from '../src/plot-catalog.js';
import { adjacentContext, adjacentSpecs, overlayContext, overlaySpecs } from '../web/composition-controls.js';
import { createInitialChartRecommender } from '../src/initial-recommender.js';
import { createTransitionScene } from 'ggaction/scene';
const found=new Map(),attempts=[];
for(const name of ['iris','barley','stocks','tips','weather','gapminder','cars','electricity']){
 const rows=JSON.parse(readFileSync(new URL(`../web/data/${name}.json`,import.meta.url)));
 const clean=rows.filter(row=>Object.values(row).every(v=>v!==null)).slice(0,150);
 const base=chart().createCanvas({plot:{width:380,height:300},margin:100}).createData({id:'dataset',values:clean});
 const profile=profileDataset(base,'dataset');
 for(const spec of getPlotDefinitions(profile)){
  try{const args=spec.build(defaultValues(spec));const p=base[spec.method](args);createTransitionScene(p,{format:'canvas'});
   attempts.push({dataset:name,method:spec.method,status:'constructed'});if(!found.has(spec.method))found.set(spec.method,{name,p,args,base});
  }catch(error){attempts.push({dataset:name,method:spec.method,status:'rejected',reason:error.message});}
 }
}
for (const [method, values, args] of [
 ['createRadarPlot',[{id:'A',a:2,b:5,c:3},{id:'B',a:4,b:2,c:6}],{wide:{fields:['a','b','c']},groupBy:'id'}],
 ['createHorizonPlot',Array.from({length:20},(_,i)=>({time:i,value:Math.sin(i)*10})),{x:'time',y:'value'}]
]) {const base=chart().createCanvas({plot:{width:380,height:300},margin:100}).createData({id:'dataset',values});try{const p=base[method]({id:'plot',data:'dataset',...args});createTransitionScene(p,{format:'canvas'});found.set(method,{name:'deterministic-fixture',p,args,base});}catch(error){console.log(method,error.message)}}
console.log('coverage',found.size);console.log([...found.keys()]);
const engine=createInitialChartRecommender(JSON.parse(readFileSync(new URL('../data/initial-model.json',import.meta.url))));
const ui=[...found].map(([method,{p}])=>{
 const row={method};
 try{const context=overlayContext(p,{target:'plot'});row.followChoices=context?.candidates.length??0;row.overlayChoices=context?overlaySpecs(context,engine).length:0;}catch(error){row.overlayError=error.message;}
 try{const context=adjacentContext(p,{target:'plot'},'right');row.fields=context.selection;
  const specs=adjacentSpecs(engine,context,p);row.adjacentChoices=specs.length;
  row.adjacentRequirements=specs.filter(spec=>spec.requirement).map(spec=>({title:spec.title,reason:spec.requirement}));
 }catch(error){row.adjacentError=error.message;}
 return row;
});
const matrix=[];
for(const [a,A]of found)for(const[b,B]of found)for(const [direction,concat] of [['horizontal',hconcat],['vertical',vconcat]]){
 try{const p=concat({programs:[{id:'left',program:A.p},{id:'right',program:B.p}],gap:12,share:{}});createTransitionScene(p,{format:'canvas'});matrix.push({a,b,direction,status:'constructed'});}catch(error){matrix.push({a,b,direction,status:'rejected',reason:error.message});}
}
mkdirSync(new URL('../output/layer-composition-audit/',import.meta.url),{recursive:true});
writeFileSync(new URL('../output/layer-composition-audit/inventory.json',import.meta.url),JSON.stringify({attempts,ui,matrix,covered:[...found.keys()]},null,2));
console.log('matrix',matrix.length,'errors',matrix.filter(x=>x.status==='rejected'));

console.log('UI gaps',ui.filter(row=>row.overlayError||row.adjacentError));
