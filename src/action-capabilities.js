import { chart } from 'ggaction';
import { describeAction } from 'ggaction/inspection';
import { PUBLIC_ACTION_NAMES } from './public-actions.js';

// Public inspection is the authority. A new library action must not be silently
// blocked by the application's old hand-written execution allowlist.
const runtime = chart();
export const PUBLIC_ACTION_METHODS = Object.freeze(PUBLIC_ACTION_NAMES.filter(name =>
  typeof runtime[name] === 'function' && ['supported', 'needs-input', 'incompatible'].includes(describeAction(runtime, { action: name }).applicability)));

export const dataEditors = Object.freeze({
  computed: 'editComputedData', filter: 'editFilteredData', fold: 'editFoldData',
  summary: 'editSummaryData', bin: 'editBinData', bin2d: 'editBin2DData',
  timeUnit: 'editTimeUnitData', window: 'editWindowData', density: 'editDensityData',
  stack: 'editStackData', regression: 'editRegressionData', sort: 'editSortedData',
  interval: 'editIntervalData', complete: 'editCompleteData', impute: 'editImputedData',
});

export function corpusActionPolicy(method) {
  if (['createOverlay', 'editOverlay', 'createAdjacentPlot', 'editCompositionScales'].includes(method)) return { role: 'recommendation', via: method, reason: 'Explicit native chart composition and scoped editing.' };
  if (['facet', 'facetGrid', 'repeatCharts'].includes(method) || /^editFacet/.test(method) || method === 'editCompositionLayout') {
    return { role: 'recommendation', via: method, reason: 'Retained facet templates support native source and layout editing.' };
  }
  if (['encodeRadius', 'encodePointRadius'].includes(method)) return { role: 'recommendation', via: 'encodeSize',
    reason: 'One point-size editor handles fixed area and variable mapping through encodeSize.' };
  if (['applyTextMetrics', 'applyTheme'].includes(method)) return { role: 'setup',
    reason: 'Font measurements and the initial theme belong to chart setup; corpus measurements cannot be copied to unrelated text.' };
  if (/^create.*(?:Plot|Heatmap|Histogram|ParallelCoordinates)$/.test(method)) return { role: 'initial-chart', via: method };
  if (['createData', 'createCanvas', 'createScale'].includes(method)) return { role: 'setup', reason: 'Resource creation; an existing chart already owns these resources.' };
  if (/^create.*Data$/.test(method) || method === 'filterData') {
    const editor = method === 'filterData' ? 'filterMarks' : `edit${method.slice(6)}`;
    return { role: 'data-preparation', via: PUBLIC_ACTION_METHODS.includes(editor) ? editor : undefined,
      reason: 'Creating an unused dataset does not change the current visualization; edit its live derivation or filter the mark.' };
  }
  if (/^create(?:Guides|Axes|[XY]Axis.*|Legend|.*Grid)$/.test(method)) return { role: 'existing-guide',
    via: method === 'createGuides' ? 'editAxes' : `edit${method.slice(6)}`,
    reason: 'Default guides already exist; recommend their native editors.' };
  if (/^create(?:Point|Bar|Line|Area|Rect|Arc|Tick|Text|Rule)Mark$/.test(method)) return { role: 'mark', via: `edit${method.slice(6)}` };
  if (/^editComposition/.test(method)) return { role: 'composition',
    reason: 'Requires a composed/faceted chart; the current UI edits one chart.' };
  if (method === 'selectMarks') return { role: 'selection', via: 'filterMarks', reason: 'A named selection alone does not change a chart.' };
  return { role: 'recommendation', via: method };
}
