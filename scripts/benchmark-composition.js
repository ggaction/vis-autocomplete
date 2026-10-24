import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { createTransitionScene } from 'ggaction/scene';
import { createCalculationService } from '../web/calculation-service.js';
import { unpackProgramUpdate } from '../web/program-transfer.js';
import { ggactionSource } from './ggaction-source.js';

const rows = JSON.parse(await readFile(new URL('../web/data/iris.json', import.meta.url)));
const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url)));
let program = chart().createCanvas({plot:{width:280,height:280},margin:80})
  .createData({id:'data',values:rows}).createScatterPlot({id:'points',x:'Sepal.Width',y:'Petal.Width',color:'Species'})
  .createOverlay({id:'line',source:'points',orderBy:'x'})
  .createAdjacentPlot({id:'neighbor',source:'points',share:{y:true},plot:{action:'createScatterPlot',options:{x:'Sepal.Width',y:'Petal.Width',color:'Species'}}});
const service = createCalculationService(model), samples=[];
service.execute({type:'state',stateId:1,snapshot:serializeProgram(program)});
const targets=[{childPath:['points'],id:'points'},{childPath:['points'],id:'line'},{childPath:['neighbor'],id:'neighbor'}];
const checkpoints=new Set([1,20,50,100]);
for(let step=1;step<=100;step++) {
  const start=performance.now();
  const action={method:'encodeOpacity',args:{target:targets,value:step%2?.4:.7}};
  const result=service.execute({type:'materialize',stateId:step,nextStateId:step+1,action});
  program=unpackProgramUpdate(program,result.update);
  const view=unpackProgramUpdate(program,result.viewUpdate);
  const materializeMs=performance.now()-start;
  if(checkpoints.has(step)) {
    const t=performance.now();
    const recommendations=service.execute({type:'recommend',stateId:step+1,group:'encoding',options:{scope:'all',childPath:['points'],target:'points',includeRevisions:true,deprioritizeAppliedActions:true,hierarchy:true}});
    const recommendMs=performance.now()-t;
    const sceneStart=performance.now();createTransitionScene(view,{format:'canvas'});
    samples.push({step,materializeMs,recommendMs,sceneMs:performance.now()-sceneStart,cards:recommendations.result.recommendations.length,transferBytes:Buffer.byteLength(JSON.stringify(result))});
    console.log(JSON.stringify(samples.at(-1)));
  }
}
assert.equal(program.children.points.markConfigs.points.opacity,.7);
assert.equal(program.children.points.markConfigs.line.opacity,.7);
assert.equal(program.children.neighbor.markConfigs.neighbor.opacity,.7);
const report={node:process.version,library:ggactionSource(),modelGeneration:model.provenance?.generation,
  scope:'100 atomic appearance edits across two panels and an overlay. Includes retained worker materialization, lossless transfer, active Encoding recommendations and Canvas scene construction. Excludes browser IPC, DOM, paint and animations.',samples};
await mkdir(new URL('../output/composition-v025/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/composition-v025/session-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
