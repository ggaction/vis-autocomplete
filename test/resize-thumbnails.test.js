import test from 'node:test';
import assert from 'node:assert/strict';
import { chart } from 'ggaction';
import { serializeProgram } from 'ggaction/persistence';
import { renderToSVG } from 'ggaction/svg';
import { createResizeThumbnails } from '../web/resize-thumbnails.js';
import { createCalculationService } from '../web/calculation-service.js';
import { canvasGeometry, resizeCanvasAction } from '../web/canvas-geometry.js';
import { addDefaultGuides, defaultCanvasOptions, prepareGuidedAction } from '../src/prepare.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
test('live thumbnail passes coalesce pointer intents and discard results after cancellation', async () => {
  const jobs = [], painted = [], release = [];
  const controller = createResizeThumbnails({
    prepare: (_, resize, card) => new Promise(resolve => {
      jobs.push([resize,card]); release.push(() => resolve({preview:[resize,card]}));
    }), render: (_, preview) => painted.push(preview),
  });
  controller.start({}); controller.update(1,['a','b']);
  controller.update(2,['a','b']); controller.update(3,['a','b']);
  assert.deepEqual(jobs,[[1,'a']]);
  release.shift()(); await flush(); release.shift()(); await flush();
  assert.deepEqual(jobs,[[1,'a'],[1,'b'],[3,'a']]);
  controller.stop(); release.shift()(); await flush();
  assert.deepEqual(painted,[[1,'a'],[1,'b']]);
  controller.start({}); controller.update(4,['a']);
  release.shift()(); await flush();
  assert.deepEqual(painted.at(-1),[4,'a']);
});

test('resized option thumbnails execute resize then the actual option, including facets', () => {
  for (const facet of [false,true]) {
    let program=chart().createCanvas(defaultCanvasOptions()).createData({id:'d',values:[{x:1,y:3,c:'A'},{x:2,y:4,c:'B'}]})
      .createScatterPlot({id:'plot',data:'d',x:'x',y:'y',color:'c'});
    if(facet) program=program.facet({field:'c',data:'d',columns:2,guides:{axes:'outer',legend:'shared'}});
    const view=addDefaultGuides(program), service=createCalculationService(null);
    service.execute({type:'state',stateId:1,snapshot:serializeProgram(program),guideCall:{method:'createGuides',args:{}}});
    const resize=resizeCanvasAction(canvasGeometry(view),'plot-se',35,70);
    const action=facet
      ? {method:'editFacetSource',args:{action:{method:'encodeOpacity',options:{target:'plot',value:.3}}}}
      : {method:'encodeOpacity',args:{target:'plot',value:.3}};
    const result=service.execute({type:'prepare-resized',stateId:1,resize,action});
    const resized=prepareGuidedAction(program,resize,view);
    const reference=prepareGuidedAction(resized.authoringPreview,action,resized.preview);
    assert.deepEqual(result.preview.graphicSpec, reference.preview.graphicSpec);
    assert.deepEqual(result.preview.canvasGeometry,canvasGeometry(reference.preview));
    assert.equal(service.execute({type:'prepare',stateId:1,action}).preview.canvasGeometry.plot.height,canvasGeometry(view).plot.height,
      'Transient thumbnails must not mutate the original state');
  }
});
