import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chart } from 'ggaction';
import { renderToSVG } from 'ggaction/svg';
import { profileDataset } from '../src/profile.js';
import { selectionData } from '../web/selection-setup.js';

test('single-variable distribution plots exclude only selected missing values through recorded native calls', () => {
  const rows = JSON.parse(readFileSync(new URL('../web/data/cars.json', import.meta.url)));
  const base = chart().createCanvas({width: 600, height: 600}).createData({id:'dataset',values:rows});
  const setup = selectionData(base, profileDataset(base, 'dataset'), rows, {x:'Miles_per_Gallon'});
  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0].method, 'filterData');
  assert.equal(setup.program.semanticSpec.datasets.find(d => d.id === setup.data).values.length, 398);
  assert.equal(base.semanticSpec.datasets[0].values.length, 406);
  const plot = setup.program.createHistogram({id:'hist',data:setup.data,field:'Miles_per_Gallon'});
  assert.ok(renderToSVG(plot).startsWith('<svg'));
  assert.deepEqual(setup.calls.reduce((p,c)=>p[c.method](c.args),base).semanticSpec,setup.program.semanticSpec);
});
