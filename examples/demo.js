import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { renderToSVG } from 'ggaction/svg';
import { chart } from 'ggaction';
import { join } from 'node:path';
import { CORPUS_ROOT } from '../scripts/train-corpus.js';
import { createRecommendationEngine, applyRecommendation } from '../src/index.js';
import { makeScenarios } from './scenarios.js';

const model = JSON.parse(await readFile(new URL('../data/model.json', import.meta.url), 'utf8'));
const engine = createRecommendationEngine(model);
const output = new URL('../output/demo/', import.meta.url);
await mkdir(output, { recursive: true });
console.log(`ggaction ${model.provenance.ggactionVersion}; corpus ${model.chartCount} charts / ${model.provenance.programCount} programs`);
console.log('score = mean(number of charts containing both features / total chart count)\n');
const results = [];
async function saveSVG(program, name) {
  const pending = program.semanticSpec.layers.some(layer =>
    ['point', 'line', 'bar', 'area'].includes(layer.mark?.type) &&
    (!layer.encoding?.x || !layer.encoding?.y));
  if (!pending) await writeFile(new URL(name, output), renderToSVG(program));
}
const realRows = JSON.parse(await readFile(join(CORPUS_ROOT, 'charts/vl_0057/data.json'), 'utf8'));
const scenarios = [...makeScenarios(), {
  id: '07-real-corpus-numeric-strings', label: '실제 코퍼스 vl_0057: 숫자 문자열 데이터',
  program: chart().createCanvas({ width: 700, height: 450, margin: 80 })
    .createData({ id: 'sectors', values: realRows }),
}];
for (const { id, label, program } of scenarios) {
  const result = engine.recommend(program);
  console.log(`${id}: ${label}`);
  console.log(`  current: ${result.state.features.join(', ')}`);
  for (const [index, recommendation] of result.recommendations.entries()) {
    console.log(`  ${index + 1}. ${recommendation.score.toFixed(6)} ${recommendation.call}`);
    const next = applyRecommendation(program, recommendation);
    await saveSVG(next, `${id}-option-${index + 1}.svg`);
  }
  await saveSVG(program, `${id}-current.svg`);
  const first = result.recommendations[0];
  if (first) {
    console.log(`  first score = (${first.explanation.contributions.map(c => `${c.chartCount}/${model.chartCount}`).join(' + ')}) / ${first.explanation.contributions.length}`);
  }
  console.log();
  results.push({ id, label, ...result });
}
await writeFile(new URL('recommendations.json', output), `${JSON.stringify(results, null, 2)}\n`);
console.log('Full calls, alternatives, score contributions and SVGs: output/demo/');
