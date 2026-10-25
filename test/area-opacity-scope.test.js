import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { serializeProgram, deserializeProgram } from 'ggaction/persistence';
import { createCalculationService } from '../web/calculation-service.js';
import { recommendationParameters, valuesFor, buildRecommendationCall } from '../web/parameters.js';
import { FOLLOWUP_RECOMMENDATION_OPTIONS } from '../web/option-groups.js';
const model = JSON.parse(readFileSync(new URL('../data/model.json', import.meta.url)));

test('All opacity is an executable public card across faceted Area and adjacent Line owners', () => {
  const program = chart().createCanvas({ plot: { width: 240, height: 200 }, margin: 150 })
    .createData({ id: 'data', values: [
      { x: 0, y: 1, g: 'A' }, { x: 1, y: 3, g: 'A' },
      { x: 0, y: 2, g: 'B' }, { x: 1, y: 4, g: 'B' }
    ] })
    .createAreaPlot({ id: 'area', x: 'x', y: 'y', groupBy: 'g', color: 'g', guides: false })
    .createOverlay({ id: 'overlay', source: 'area', type: 'line', basis: 'visibleItems', series: 'source' })
    .facet({ field: 'g', data: 'data', columns: 2 })
    .createAdjacentPlot({ id: 'line', source: 'area', position: 'right',
      plot: { action: 'createLinePlot', options: { data: 'data', x: 'x', y: 'y', color: 'g', guides: false } } });
  const service = createCalculationService(model);
  service.execute({ type: 'state', stateId: 'mixed', snapshot: serializeProgram(program) });
  const response = service.execute({ type: 'recommend', stateId: 'mixed', group: 'encoding', searchQuery: 'opacity',
    options: { ...FOLLOWUP_RECOMMENDATION_OPTIONS, scope: 'all' } });
  const rec = response.result.recommendations.find(rec => rec.method === 'encodeOpacity');
  assert.ok(rec, JSON.stringify(response.result.diagnostics.rejected));
  const editor = recommendationParameters(rec, response.profile);
  const action = buildRecommendationCall({ ...editor, method: rec.method }, { ...valuesFor(editor.controls), mode: 'fixed', value: .4 });
  assert.equal(action.method, 'encodeOpacity');
  assert.equal(action.args.target.length, 3);
  const result = service.execute({ type: 'materialize', stateId: 'mixed', action });
  const next = deserializeProgram(result.snapshot);
  for (const cell of Object.values(next.children.area.children)) {
    for (const id of ['area', 'overlay']) assert.ok(cell.graphicSpec.objects[id].items.every(item => item.properties.opacity === .4));
  }
  assert.ok(next.children.line.graphicSpec.objects.line.items.every(item => item.properties.opacity === .4));
  assert.equal(program.children.line.markConfigs.line.opacity, undefined);
});
