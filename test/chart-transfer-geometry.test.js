import test from 'node:test';
import assert from 'node:assert/strict';
import { fittedChartPose, containedChartPose, chartPoseTransform, chartPoseClip } from '../web/chart-transfer-geometry.js';

test('destination fit is projected through the camera once, including its translation', () => {
  const geometry = { width: 700, height: 430 };
  const local = fittedChartPose(geometry, 800, 500, { x: 0, y: 0, scaleX: 1, scaleY: 1 });
  for (const zoom of [.5, 1, 1.728, 4]) {
    const frame = { x: 123.25 - (zoom - 1) * 400 + 31, y: 77.5 - (zoom - 1) * 250 - 19, scaleX: zoom, scaleY: zoom };
    const pose = fittedChartPose(geometry, 800, 500, frame);
    assert.equal(pose.x, frame.x + local.x * zoom);
    assert.equal(pose.y, frame.y + local.y * zoom);
    assert.equal(pose.scaleX, local.scaleX * zoom);
    assert.equal(pose.scaleY, pose.scaleX);
  }
});

test('cropped Preview maps the same native coordinates before departure', () => {
  const viewBox = { x: 50, y: 20, width: 400, height: 200 };
  const pose = containedChartPose(viewBox, { left: 900, top: 100, width: 600, height: 400 });
  assert.deepEqual(pose, { x: 825, y: 120, scaleX: 1.5, scaleY: 1.5 });
  assert.equal(pose.x + viewBox.x * pose.scaleX, 900);
  assert.equal(pose.y + viewBox.y * pose.scaleY, 150);
  assert.equal(chartPoseTransform(pose), 'translate(825px, 120px) scale(1.5, 1.5)');
});

test('landing clip preserves the zoomed viewport instead of revealing offscreen chart content', () => {
  const geometry = { width: 700, height: 430 }, pose = { x: -100, y: -50, scaleX: 2, scaleY: 2 };
  assert.equal(chartPoseClip(geometry, pose, { left: 0, top: 0, right: 800, bottom: 600 }), 'inset(25px 250px 105px 50px)');
  assert.equal(chartPoseClip(geometry, { x: 20, y: 30, scaleX: .5, scaleY: .5 }, { left: 0, top: 0, right: 800, bottom: 600 }), 'inset(0px 0px 0px 0px)');
});
