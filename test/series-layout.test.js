import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { createInitialChartRecommender, profileDataset, applyRecommendation } from '../src/index.js';
import { generateCandidates } from '../src/catalog.js';
import { defaultCanvasOptions, prepareGuidedAction, addDefaultGuides } from '../src/prepare.js';
import { selectionData } from '../web/selection-setup.js';
import { recommendationParameters, valuesFor } from '../web/parameters.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const initial = createInitialChartRecommender(json('../data/initial-model.json'));

for (const [dataset, method, selection] of [
  ['cars', 'createBarPlot', { x: 'Horsepower', y: 'Miles_per_Gallon', color: 'Origin' }],
  ['barley', 'createBarPlot', { x: 'variety', y: 'yield', color: 'site' }],
  ['cars', 'createAreaPlot', { x: 'Horsepower', y: 'Miles_per_Gallon', color: 'Origin' }],
]) test(`${dataset}/${method}: Layout series returns to Overlay from every offered layout`, () => {
  const rows = json(`../web/data/${dataset}.json`);
  const base = chart().createCanvas(defaultCanvasOptions()).createData({ id: 'dataset', values: rows });
  const profile = profileDataset(base, 'dataset'), setup = selectionData(base, profile, rows, selection);
  const rec = initial.recommend(rows, { ...profile, id: setup.data }, { selection })
    .recommendations.find(r => r.method === method);
  assert.ok(rec, 'The selected-variable chart must be available');
  const starting = prepareGuidedAction(setup.program, { method, args: rec.build(rec.values) },
    setup.program, rec.setup(rec.values));
  const layoutEditor = program => {
    const layer = program.semanticSpec.layers.find(l => l.id === 'plot');
    const bound = profileDataset(program, layer.data);
    const candidate = generateCandidates(program, { layer, profile: bound }).find(r => r.method === 'layoutSeries');
    assert.ok(candidate, 'The action must remain discoverable after changing layout');
    const editor = recommendationParameters(candidate, bound);
    return { editor, key: editor.controls.find(c => c.label === 'Layout').key };
  };
  const { editor, key } = layoutEditor(starting.authoringPreview);
  for (const { value: mode } of editor.controls.find(c => c.key === key).choices.filter(c => c.value !== 'overlay')) {
    const source = starting.authoringPreview;
    const arranged = source.layoutSeries(editor.build({ ...valuesFor(editor.controls), [key]: mode }));
    const { editor: nextEditor, key: nextKey } = layoutEditor(arranged);
    const action = { method: 'layoutSeries', args: nextEditor.build({ ...valuesFor(nextEditor.controls), [nextKey]: 'overlay' }) };
    assert.deepEqual(action.args, { target: 'plot', mode: 'overlay' });
    const prepared = prepareGuidedAction(arranged, action, addDefaultGuides(arranged));
    assert.equal(prepared.recommendation.validation.topLevelActions, 1);
    assert.equal(prepared.authoringPreview.semanticSpec.layers.find(l => l.id === 'plot').layout.mode, 'overlay');
    assert.deepEqual(addDefaultGuides(applyRecommendation(prepared.actionBase, prepared.recommendation),
      prepared.guideCall).graphicSpec, prepared.preview.graphicSpec, 'Apply must match the Overlay preview');
    assert.throws(() => prepareGuidedAction(prepared.authoringPreview, action, prepared.preview),
      error => error.reason === 'no-change', 'Repeating Overlay is a no-op, not a native layout failure');
    if (method === 'createBarPlot') {
      const layer = prepared.authoringPreview.semanticSpec.layers.find(l => l.id === 'plot');
      assert.equal(layer.encoding.xOffset, undefined, 'Overlay must clear Dodge offsets');
      assert.equal(layer.encoding.yOffset, undefined);
      assert.notDeepEqual(prepared.authoringPreview.resolvedScales[layer.encoding.y.scale].domain, [0, 1],
        'Overlay must restore the measure domain after Normalize');
    }
  }
});
