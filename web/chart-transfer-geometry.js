import { fitCanvasViewport } from './canvas-geometry.js';

// Poses map the native chart coordinate system into viewport CSS pixels.
// A camera transform belongs outside the chart's local fit calculation.
export function fittedChartPose(geometry, width, height, frame) {
  const fit = fitCanvasViewport(geometry, width, height);
  return { x: frame.x + fit.left * frame.scaleX, y: frame.y + fit.top * frame.scaleY,
    scaleX: fit.scale * frame.scaleX, scaleY: fit.scale * frame.scaleY };
}

export function containedChartPose(viewBox, rect) {
  const scale = Math.min(rect.width / viewBox.width, rect.height / viewBox.height);
  return { x: rect.left + (rect.width - viewBox.width * scale) / 2 - viewBox.x * scale,
    y: rect.top + (rect.height - viewBox.height * scale) / 2 - viewBox.y * scale,
    scaleX: scale, scaleY: scale };
}

export const chartPoseTransform = pose => `translate(${pose.x}px, ${pose.y}px) scale(${pose.scaleX}, ${pose.scaleY})`;

export function chartPoseClip(geometry, pose, clip) {
  const clamp = (value, size) => Math.max(0, Math.min(size, value));
  return `inset(${clamp((clip.top - pose.y) / pose.scaleY, geometry.height)}px ` +
    `${clamp(geometry.width - (clip.right - pose.x) / pose.scaleX, geometry.width)}px ` +
    `${clamp(geometry.height - (clip.bottom - pose.y) / pose.scaleY, geometry.height)}px ` +
    `${clamp((clip.left - pose.x) / pose.scaleX, geometry.width)}px)`;
}
