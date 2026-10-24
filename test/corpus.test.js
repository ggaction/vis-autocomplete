import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProgramSource } from '../src/corpus.js';
import { trainCorpus } from '../scripts/train-corpus.js';

test('public actions without create/edit/encode prefixes stay in corpus evidence', () => {
  const parsed = parseProgramSource(`chart().applyTheme({ theme: "light" })
    .layoutSeries({ target: "bars", mode: "stack" })
    .removeEncoding({ target: "bars", channel: "color" })
    .bindMarkData({ target: "bars", data: "summary" });`);
  for (const method of ['applyTheme', 'layoutSeries', 'removeEncoding', 'bindMarkData']) {
    assert.equal(parsed.methods[method], 1);
    assert.ok(parsed.features.includes(`action.${method}`));
    assert.ok(parsed.calls.some(c => c.method === method));
  }
});

test('all source variants contribute semantics without executing corpus code', () => {
  const parsed = parseProgramSource(`
    import { chart } from 'ggaction';
    const X = { field: 'year', fieldType: 'temporal' };
    globalThis.this_must_never_run = true;
    export function buildChart() { return chart().createLinePlot({ x: X, y: 'value', guides: false })
      .encodeColor({ field: 'category' }).createAxes().editPointMark({ opacity: 0.7 }); }
  `);
  assert.equal(globalThis.this_must_never_run, undefined);
  assert.ok(parsed.features.includes('mark.line'));
  assert.ok(parsed.features.includes('encoding.x'));
  assert.ok(parsed.features.includes('encoding.color'));
  assert.ok(parsed.features.includes('guide.axis'));
  assert.equal(parsed.temporal, true);
  assert.equal(parsed.dynamicOptions, 0);
});

test('training discovers newly added charts, unions every stage, and preserves the model on bad input', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ggaction-corpus-test-'));
  const outputRoot = join(root, 'out');
  const sha = value => createHash('sha256').update(value).digest('hex');
  async function addChart(id, programs) {
    const directory = join(root, 'charts', id);
    await mkdir(directory, { recursive: true });
    const data = JSON.stringify([{ x: 1, y: 2 }]);
    const files = { 'data.json': { sha256: sha(data) } };
    const stages = [];
    await writeFile(join(directory, 'data.json'), data);
    for (const [i, source] of programs.entries()) {
      const code = `G${i + 1}.gg.mjs`;
      await writeFile(join(directory, code), source);
      files[code] = { sha256: sha(source) };
      stages.push({ code });
    }
    await writeFile(join(directory, 'metadata.json'), JSON.stringify({ id, status: 'completed', stages, files }));
  }
  try {
    await addChart('chart-one', ['chart().createPointMark().encodeOpacity({value:0.7})', 'chart().encodeColor({field:"group"}).encodeOpacity({value:0.7})']);
    const first = await trainCorpus({ corpusRoot: root, outputRoot });
    assert.equal(first.model.chartCount, 1);
    assert.equal(first.model.featureCounts['encoding.color'], 1);
    assert.equal(first.report.programCount, 2);
    assert.equal(first.initialReport.chartCount, 1);
    assert.equal(first.model.parameterDefaults.methods.encodeOpacity.settings.value.charts, 1);
    assert.deepEqual(first.initialModel.parameterDefaults, first.model.parameterDefaults);
    assert.deepEqual(JSON.parse(await readFile(join(outputRoot, 'parameter-defaults.json'), 'utf8')), first.model.parameterDefaults);
    assert.deepEqual(first.initialModel.groups[0].distribution, { createScatterPlot: 1 });
    await addChart('chart-two', ['chart().createLineMark().encodeOpacity({value:1})']);
    const second = await trainCorpus({ corpusRoot: root, outputRoot });
    assert.equal(second.model.chartCount, 2);
    assert.equal(second.model.featureCounts['mark.line'], 1);
    assert.equal(second.initialReport.chartCount, 2);
    assert.equal(second.model.parameterDefaults.methods.encodeOpacity.settings.value.charts, 2);
    assert.deepEqual(second.initialReport.indexedChartIds, ['chart-one', 'chart-two']);
    assert.deepEqual(second.initialModel.groups[0].distribution, { createLinePlot: 0.5, createScatterPlot: 0.5 });
    const initialBefore = await readFile(join(outputRoot, 'initial-model.json'), 'utf8');
    const before = await readFile(join(outputRoot, 'model.json'), 'utf8');
    const defaultsBefore = await readFile(join(outputRoot, 'parameter-defaults.json'), 'utf8');
    await writeFile(join(root, 'charts/chart-two/G1.gg.mjs'), 'tampered');
    await assert.rejects(trainCorpus({ corpusRoot: root, outputRoot }), /SHA-256 mismatch/);
    assert.equal(await readFile(join(outputRoot, 'model.json'), 'utf8'), before);
    assert.equal(await readFile(join(outputRoot, 'initial-model.json'), 'utf8'), initialBefore);
    assert.equal(await readFile(join(outputRoot, 'parameter-defaults.json'), 'utf8'), defaultsBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('program graph separates equal mark IDs, lexical bindings and raw tables across adjacent views', () => {
  const parsed = parseProgramSource(`import { chart, hconcat } from 'ggaction';
    import first from './data.json'; import second from './other.json';
    const unused = chart().createPiePlot({category:'unused',value:'v'});
    function left() { const x = 'Date'; return chart().createData({values:first}).createLineMark({id:'plot'}).encodeX({field:x}).encodeY({field:'Revenue'}); }
    function right() { const x = 'Group'; return chart().createData({values:second}).createBarMark({id:'plot'}).encodeX({field:x}).encodeY({field:'Count'}); }
    export function buildChart() { return hconcat({programs:[{id:'left',program:left()},{id:'right',program:right()}]}); }`);
  assert.equal(parsed.structure.resolved, true);
  assert.equal(parsed.methods.createPiePlot, undefined, 'unreturned programs are not part of the chart');
  assert.ok(parsed.features.includes('composition.hconcat'));
  assert.deepEqual(parsed.structure.views.map(view => [view.path, view.layers[0].encodings.encodeX.field, view.layers[0].call.dataFiles]), [
    [['left'], 'Date', ['data.json']], [['right'], 'Group', ['other.json']],
  ]);
});

test('lookup provenance keeps its primary observation table separate from the lookup dictionary', () => {
  const parsed = parseProgramSource(`import {chart} from 'ggaction'; import rows from './data.json'; import names from './lookup.json';
    export function buildChart(){return chart().createData({id:'names',values:names}).createData({id:'rows',values:rows})
    .createLookupData({id:'joined',field:'id',lookup:{data:'names',key:'id',fields:['name']}})
    .createScatterPlot({x:'x',y:'y',color:'name'});}`);
  assert.deepEqual(parsed.structure.views[0].layers[0].call.dataFiles, ['data.json']);
  assert.deepEqual(parsed.structure.views[0].datasets.names.files, ['lookup.json']);
});

test('omitted facade and mark IDs retain distinct native owners', () => {
  const source = `import { chart } from 'ggaction';
    const p = chart().createData({values: []}).createBarPlot({x:'X',y:'Y'})
      .createLineMark({x:'X',y:'Z'}).encodeColor({target:'barPlot',field:'G'});
    export default p;`;
  const result = parseProgramSource(source);
  assert.equal(result.structure.views[0].layers.length, 2);
  assert.deepEqual(result.structure.views[0].layers.map(l => l.id), ['barPlot','line']);
  assert.equal(result.structure.views[0].layers[0].encodings.encodeColor.field, 'G');
  assert.deepEqual(result.structure.views[0].layers[1].encodings, {});
});
