import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { register } from 'node:module';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { CORPUS_ROOT } from './train-corpus.js';
import { ggactionSource } from './ggaction-source.js';

if (!isMainThread) {
  register('./corpus-json-loader.js',import.meta.url);
  const results=[];
  for(const entry of workerData) {
    const start=performance.now();
    try {
      const module=await import(pathToFileURL(entry.file));
      const program=await (module.buildChart?.() ?? (typeof module.default==='function' ? module.default() : module.default));
      if(!program?.graphicSpec?.objects?.canvas)throw new Error('Program did not return a materialized Canvas.');
      const {width,height}=program.graphicSpec.objects.canvas.properties;
      if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Invalid Canvas extent.');
      results.push({chart:entry.chart,stage:entry.stage,passed:true,milliseconds:performance.now()-start});
    }catch(error){results.push({chart:entry.chart,stage:entry.stage,passed:false,error:error.message,milliseconds:performance.now()-start});}
  }
  parentPort.postMessage(results);
} else {
  const report=JSON.parse(await readFile(new URL('../data/corpus-report.json',import.meta.url)));
  const entries=[];
  for(const chart of report.charts) {
    const metadata=JSON.parse(await readFile(join(CORPUS_ROOT,'charts',chart.id,'metadata.json')));
    for(const stage of metadata.stages)entries.push({chart:chart.id,stage:stage.code,file:join(CORPUS_ROOT,'charts',chart.id,stage.code)});
  }
  const batches=[]; for(let i=0;i<entries.length;i+=40)batches.push(entries.slice(i,i+40));
  const results=[];let cursor=0;
  async function run(){while(cursor<batches.length){const batch=batches[cursor++];const values=await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL(import.meta.url),{workerData:batch,resourceLimits:{maxOldGenerationSizeMb:1024}});
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error(`Corpus batch timed out at ${batch[0].chart}/${batch[0].stage}`));},180000);
    worker.once('message',v=>{clearTimeout(timeout);resolve(v);});worker.once('error',e=>{clearTimeout(timeout);reject(e);});
  });results.push(...values);if(results.length%400===0)console.log(`${results.length}/${entries.length} programs; ${results.filter(r=>!r.passed).length} failures`);}}
  await Promise.all([run(),run()]);
  const output={library:ggactionSource(),corpus:{repository:report.repository,commit:report.commit,runtime:report.corpusRuntime},programCount:entries.length,passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed),results};
  await mkdir(new URL('../output/composition-v025/',import.meta.url),{recursive:true});
  await writeFile(new URL('../output/composition-v025/corpus-program-validation.json',import.meta.url),JSON.stringify(output,null,2));
  console.log(JSON.stringify({programCount:output.programCount,passed:output.passed,failed:output.failed.length},null,2));
  if(output.failed.length)process.exitCode=1;
}
