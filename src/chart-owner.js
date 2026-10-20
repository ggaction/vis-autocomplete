// Resolve compound/derived marks before exposing source-variable editors.
// In particular Raincloud's primary layer is a violin, but the public owner
// must update its density, summary and observation layers together.
export function chartOwner(program, layer) {
  if (!layer) return null;
  for (const [id, mark] of Object.entries(program.markConfigs)) {
    const raincloud = mark.raincloudPlot;
    if (raincloud && (id === layer.id || raincloud.ownedChildIds.includes(layer.id) ||
        Object.values(raincloud.childIds).includes(layer.source))) {
      return { method: 'editRaincloudPlot', target: id, source: raincloud.source, config: raincloud };
    }
    const endpoint = mark.endpointPlot;
    if (endpoint && (id === layer.id || Object.values(endpoint.roles).includes(layer.id) ||
        Object.values(endpoint.roles).includes(layer.source))) {
      return { method: 'editEndpointPlot', target: id, source: endpoint.source, config: endpoint };
    }
  }
  const config = program.markConfigs[layer.id] ?? {};
  if (config.intervalPlot) return { method: 'editErrorBar', target: config.intervalPlot.intervalId,
    source: program.markConfigs[config.intervalPlot.intervalId].errorBar.source,
    config: program.markConfigs[config.intervalPlot.intervalId].errorBar };
  for (const [key, method] of Object.entries({ boxPlot: 'editBoxPlot', violinPlot: 'editViolinPlot',
    gradientPlot: 'editGradientPlot', endpointPlot: 'editEndpointPlot', ecdfPlot: 'editECDFPlot' })) {
    if (config[key]) return { method, target: layer.id, source: config[key].source, config: config[key] };
  }
  const dataset = program.semanticSpec.datasets.find(d => d.id === layer.data);
  const transform = dataset?.transform?.[0];
  if (config.compositionRole === 'radar') return {
    method: typeof program.editRadarPlot === 'function' ? 'editRadarPlot' : null,
    target: layer.id, source: dataset?.source ?? layer.data, dataset, transform, radar: true,
  };
  if (['bin2d', 'horizon', 'density'].includes(transform?.type)) return {
    method: { bin2d: 'editBin2DData', horizon: 'editHorizon', density: 'editDensity' }[transform.type],
    target: layer.id, source: dataset.source, dataset, transform,
    ...(transform.type === 'horizon' ? { statisticalAxes: ['x'],
      statisticalAxisReason: 'Horizon Y is a folded band coordinate, not the original measurement. Statistics require a quantitative X axis.' } : {}),
  };
  return null;
}

export function primaryChartLayer(program, preferred) {
  const layers = program.semanticSpec.layers, old = layers.find(layer => layer.id === preferred);
  const owner = chartOwner(program, old);
  if (owner?.method === 'editRaincloudPlot') return layers.find(layer => layer.id === owner.target);
  return old ?? layers.find(layer => layer.id === 'plot') ??
    layers.find(layer => program.markConfigs[layer.id]?.raincloudPlot) ??
    layers.find(layer => program.semanticSpec.datasets.find(d => d.id === layer.data)?.values?.length) ?? layers[0];
}
