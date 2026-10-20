// Shared names for option cards and keyword search.
export const ACTION_LABELS = {
  facet: 'Facet', facetGrid: 'Create facet grid', editFacetScales: 'Edit facet scales',
  editFacetHeaders: 'Edit facet headers', editFacetGuides: 'Edit facet guides', editCompositionLayout: 'Arrange facets',
  encodeR: 'Encode radius (R)', encodeTheta: 'Encode theta (angle)', encodeX2: 'Encode X end', encodeY2: 'Encode Y end',
  editViolinPlot: 'Adjust violin variables', editGradientPlot: 'Adjust gradient variables',
  editEndpointPlot: 'Adjust endpoint variables', editECDFPlot: 'Adjust ECDF variable', encodeParallelCoordinates: 'Encode parallel dimensions',
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
  editCanvas: 'Edit canvas background', editCoordinate: 'Edit chart aspect ratio',
  editXAxisTitle: 'Edit X axis title', editYAxisTitle: 'Edit Y axis title',
  editXAxisLine: 'Edit X axis line', editYAxisLine: 'Edit Y axis line',
  editXAxisLabels: 'Edit X axis labels', editYAxisLabels: 'Edit Y axis labels',
  editXAxisTicks: 'Edit X axis ticks', editYAxisTicks: 'Edit Y axis ticks',
  editXAxisTicksAndLabels: 'Edit X ticks and labels', editYAxisTicksAndLabels: 'Edit Y ticks and labels',
  editHorizontalGrid: 'Edit horizontal grid', editVerticalGrid: 'Edit vertical grid',
  editLegendTitle: 'Edit legend title', editLegendLabels: 'Edit legend labels', editLegendSymbols: 'Edit legend symbols',
  editLegendBlock: 'Edit legend block', editLegendLayout: 'Edit legend layout', editLegendBorder: 'Edit legend border',
  createAnnotation: 'Add annotation',
};

export function actionTitle(recommendation) {
  const method = recommendation.sourceMethod ?? recommendation.method;
  const args = recommendation.args?.action?.options ?? recommendation.args ?? {};
  if (method === 'editArcMark') return args.innerRadius !== undefined || args.padAngle !== undefined
    ? 'Adjust arc geometry' : 'Adjust arc appearance';
  const marks = { editPointMark: 'Point', editBarMark: 'Bar', editRectMark: 'Cell', editLineMark: 'Line', editAreaMark: 'Area' };
  const properties = Object.keys(args).filter(key => !['target', 'id'].includes(key));
  const propertyNames = { opacity: 'opacity', radius: 'radius', fill: 'fill', stroke: 'border color', strokeWidth: 'border width', strokeDash: 'dash' };
  if (marks[method] && properties.length === 1 && propertyNames[properties[0]]) return `Edit ${marks[method].toLowerCase()} ${propertyNames[properties[0]]}`;
  if (['createStatisticalReference', 'editGradientPlot'].includes(method) || recommendation.category === 'transform' && ['encodeX', 'encodeY', 'createComputedData', 'editComputedData', 'editSummaryData', 'editTimeUnitData', 'editFilterData'].includes(method)) return recommendation.label;
  return ACTION_LABELS[method] ?? recommendation.label;
}
