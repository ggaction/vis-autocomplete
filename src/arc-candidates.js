// editArcMark contains two independent decisions. Corpus examples may combine
// them, but a geometry recommendation must not also remove the user's outline.
const geometryKeys = ['innerRadius', 'padAngle'];
const appearanceKeys = ['opacity', 'stroke', 'strokeWidth'];
const pick = (object, keys) => Object.fromEntries(keys.filter(key => Object.hasOwn(object, key)).map(key => [key, object[key]]));
const contexts = new WeakMap();

function arcContext(program, layer) {
  if (!contexts.has(program)) contexts.set(program, new Map());
  if (contexts.get(program).has(layer.id)) return contexts.get(program).get(layer.id);
  const config = program.markConfigs[layer.id] ?? {};
  const theta = layer.encoding.theta, radius = layer.encoding.radius;
  const scale = program.resolvedScales[theta?.scale];
  const measured = Boolean(program.semanticSpec.scales.find(s => s.id === radius?.scale)?.radialMapping);
  let sweep = scale?.bandwidth ?? 360;
  const proportional = theta?.fieldType === 'quantitative' || theta?.aggregate;
  if (proportional && scale?.range) {
    const rows = program.semanticSpec.datasets.find(d => d.id === layer.data)?.values ?? [];
    const groups = new Map();
    for (const [i, row] of rows.entries()) {
      const key = theta.fieldType === 'quantitative' ? i : row[theta.field];
      const weight = theta.fieldType === 'quantitative' ? row[theta.field] : theta.aggregate === 'count' ? 1 : row[theta.weight];
      if (Number.isFinite(weight) && weight > 0) groups.set(key, (groups.get(key) ?? 0) + weight);
    }
    const weights = [...groups.values()], largest = Math.max(...weights);
    const scaled = weights.map(value => value / largest), total = scaled.reduce((sum, value) => sum + value, 0);
    if (total > 0) sweep = Math.abs(scale.range[1] - scale.range[0]) * Math.min(...scaled) / total;
  }
  // Use the allocated plot frame, including an explicitly resized polar frame.
  const canvas = program.graphicSpec.objects.canvas.properties, margin = program.materializationConfigs.canvas.margin;
  let width = canvas.width - margin.left - margin.right, height = canvas.height - margin.top - margin.bottom;
  const coordinate = program.semanticSpec.coordinates.find(c => c.id === layer.coordinate);
  const ratio = coordinate?.aspect?.ratio;
  if (ratio > 0) { width = Math.min(width, height * ratio); height = Math.min(height, width / ratio); }
  const frame = coordinate?.polarFrame;
  const available = frame && frame !== 'auto'
    ? Math.min(width * frame.center.x, width * (1 - frame.center.x), height * frame.center.y, height * (1 - frame.center.y))
    : Math.min(width, height) / 2;
  const outer = frame?.radius?.unit === 'px' ? frame.radius.value : available * (frame?.radius?.value ?? 1);
  const context = { innerRadius: config.innerRadius ?? 0, padAngle: config.padAngle ?? 0,
    innerEditable: Boolean(proportional && !radius), gapEditable: !measured,
    maxInnerPixels: Math.max(Math.floor(outer * .95), config.innerRadius?.unit === 'px' ? config.innerRadius.value : 0),
    // Native padAngle is in degrees, and must be smaller than EVERY sector.
    maxGap: Math.max(config.padAngle ?? 0, Number(Math.min(20, sweep * .8).toPrecision(3))),
    opacity: config.opacity ?? 1, stroke: config.stroke ?? '#ffffff', strokeWidth: config.strokeWidth ?? 1,
    strokeMapped: Boolean(layer.encoding.stroke) };
  // A source edit replays in each facet. Its controls must fit the smallest
  // actual panel/sector as well as the unfaceted source.
  for (const child of Object.values(program.children)) {
    const owner = child.semanticSpec.layers.find(l => l.id === layer.id && l.mark?.type === 'arc');
    if (!owner) continue;
    const limit = arcContext(child, owner);
    context.maxGap = Math.min(context.maxGap, limit.maxGap);
    context.maxInnerPixels = Math.min(context.maxInnerPixels, limit.maxInnerPixels);
  }
  contexts.get(program).set(layer.id, context);
  return context;
}

export function arcMarkCandidates(program, layer, patch) {
  const context = arcContext(program, layer), target = layer.id, out = [];
  const geometry = patch ? pick(patch, geometryKeys)
    : context.innerEditable ? { innerRadius: .4 } : { padAngle: Math.min(2, context.maxGap) };
  // Measured rose/radial sectors get their inner radius from the radial scale.
  if (!context.innerEditable) delete geometry.innerRadius;
  if (!context.gapEditable) delete geometry.padAngle;
  if (Object.keys(geometry).length) out.push({ method: 'editArcMark', args: { target, ...geometry },
    category: 'encoding', feature: 'action.editArcMark', label: 'Adjust arc geometry', arcContext: context });
  const appearance = patch ? pick(patch, appearanceKeys) : { opacity: context.opacity === .8 ? .7 : .8 };
  if (context.strokeMapped) delete appearance.stroke;
  if (Object.keys(appearance).length) out.push({ method: 'editArcMark', args: { target, ...appearance },
    category: 'style', feature: 'action.editArcMark', label: 'Adjust arc appearance', arcContext: context });
  return out;
}
