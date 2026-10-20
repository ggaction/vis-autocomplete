// Shared names for option cards and keyword search.
export const ACTION_LABELS = {
  facet: 'Facet', facetGrid: 'Facet grid', editFacetScales: 'Facet scales',
  editFacetHeaders: 'Facet headers', editFacetGuides: 'Facet guides', editCompositionLayout: 'Arrange facets',
  encodeX: 'Set the x variable', encodeY: 'Set the y variable', encodeColor: 'Encode color',
  encodeSize: 'Encode point size', encodeShape: 'Encode point shape', createRegression: 'Add regression',
  createAxes: 'Add axes', createLegend: 'Add a legend', createTitle: 'Add a title', editPointMark: 'Adjust points',
  createComputedData: 'Convert a numeric column', createSummaryData: 'Summarize by group',
  createPointMark: 'Create points', createLineMark: 'Create a line', createBarMark: 'Create bars', createAreaMark: 'Create an area',
  editBarMark: 'Adjust bars', editLineMark: 'Adjust line', editAreaMark: 'Adjust area', encodeStroke: 'Encode stroke color',
  encodeStrokeWidth: 'Encode stroke width', encodeStrokeDash: 'Encode stroke dash', encodeAngle: 'Encode angle',
  encodeGroup: 'Encode group', encodeXOffset: 'Offset X', encodeYOffset: 'Offset Y',
  encodeOpacity: 'Encode opacity', orderCategories: 'Sort categories', createMarkLabels: 'Add value labels',
  editAxes: 'Adjust axes', editLegend: 'Adjust legend', editXAxis: 'Adjust X axis', editYAxis: 'Adjust Y axis', editGrid: 'Adjust grid',
  editTitle: 'Edit title', editThetaAxis: 'Adjust angular axis', editRadialAxis: 'Adjust radial axis',
  editParallelAxis: 'Adjust parallel axis',
  editXScale: 'Adjust X scale', editYScale: 'Adjust Y scale', editSizeScale: 'Adjust size scale',
  editColorScale: 'Adjust color scale', editStrokeScale: 'Adjust stroke scale', editOpacityScale: 'Adjust opacity scale',
  editShapeScale: 'Adjust shape scale', editStrokeWidthScale: 'Adjust stroke width scale', editStrokeDashScale: 'Adjust dash scale',
  editXOffsetScale: 'Adjust X offset scale', editThetaScale: 'Adjust angular scale', editRScale: 'Adjust radial scale',
  editCanvas: 'Canvas background', editCoordinate: 'Chart aspect ratio',
  editXAxisTitle: 'X axis title', editYAxisTitle: 'Y axis title',
  editXAxisLine: 'X axis line', editYAxisLine: 'Y axis line',
  editXAxisLabels: 'X axis labels', editYAxisLabels: 'Y axis labels',
  editXAxisTicks: 'X axis ticks', editYAxisTicks: 'Y axis ticks',
  editXAxisTicksAndLabels: 'X ticks and labels', editYAxisTicksAndLabels: 'Y ticks and labels',
  editHorizontalGrid: 'Horizontal grid', editVerticalGrid: 'Vertical grid',
  editLegendTitle: 'Legend title', editLegendLabels: 'Legend labels', editLegendSymbols: 'Legend symbols',
  editLegendBlock: 'Legend block', editLegendLayout: 'Legend layout', editLegendBorder: 'Legend border',
  createAnnotation: 'Add annotation',
};

export function actionTitle(recommendation) {
  const method = recommendation.sourceMethod ?? recommendation.method;
  const args = recommendation.args?.action?.options ?? recommendation.args ?? {};
  const marks = { editPointMark: 'Point', editBarMark: 'Bar', editRectMark: 'Cell', editLineMark: 'Line', editAreaMark: 'Area' };
  const properties = Object.keys(args).filter(key => !['target', 'id'].includes(key));
  const propertyNames = { opacity: 'opacity', radius: 'radius', fill: 'fill', stroke: 'border color', strokeWidth: 'border width', strokeDash: 'dash' };
  if (marks[method] && properties.length === 1 && propertyNames[properties[0]]) return `${marks[method]} ${propertyNames[properties[0]]}`;
  if (method === 'createStatisticalReference' || recommendation.category === 'transform' && ['encodeX', 'encodeY', 'createComputedData', 'editComputedData', 'editSummaryData', 'editTimeUnitData', 'editFilterData'].includes(method)) return recommendation.label;
  return ACTION_LABELS[method] ?? recommendation.label;
}
