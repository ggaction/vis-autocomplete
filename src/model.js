// Paper §4.1: c(a,b) = charts containing both / all charts.
// q(V,t) = arithmetic mean of c(s,t), for every s currently in V.
// There are deliberately no weights, bonuses, conditional probabilities or smoothing.
const pairKey = (a, b) => JSON.stringify([a, b].sort());

export function trainCooccurrenceModel(observations, provenance = {}) {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new TypeError('Training needs at least one chart.');
  }
  const ids = new Set();
  const featureCounts = Object.create(null);
  const pairCounts = Object.create(null);
  for (const { id, features } of observations) {
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new TypeError(`Missing or duplicate chart id: ${id}`);
    }
    ids.add(id);
    const unique = [...new Set(features)].sort();
    if (!unique.length || unique.some(f => typeof f !== 'string' || !f)) {
      throw new TypeError(`Invalid features for ${id}`);
    }
    for (const feature of unique) featureCounts[feature] = (featureCounts[feature] ?? 0) + 1;
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = pairKey(unique[i], unique[j]);
        pairCounts[key] = (pairCounts[key] ?? 0) + 1;
      }
    }
  }
  return {
    schemaVersion: 1,
    method: 'paper-cooccurrence-arithmetic-mean',
    chartCount: observations.length,
    provenance,
    featureCounts: Object.fromEntries(Object.entries(featureCounts).sort()),
    pairCounts: Object.fromEntries(Object.entries(pairCounts).sort()),
  };
}

export function scoreCandidate(model, currentFeatures, candidateFeature) {
  if (model?.schemaVersion !== 1 || !Number.isInteger(model.chartCount) || model.chartCount < 1) {
    throw new TypeError('Invalid co-occurrence model.');
  }
  const anchors = [...new Set(currentFeatures)].sort();
  if (!anchors.length) throw new TypeError('A chart state needs at least a dataset-type feature.');
  const contributions = anchors.map(feature => {
    const count = feature === candidateFeature
      ? (model.featureCounts[feature] ?? 0)
      : (model.pairCounts[pairKey(feature, candidateFeature)] ?? 0);
    return { feature, chartCount: count, cooccurrence: count / model.chartCount };
  });
  return {
    score: contributions.reduce((sum, c) => sum + c.cooccurrence, 0) / anchors.length,
    formula: 'mean(pairChartCount / corpusChartCount)',
    corpusChartCount: model.chartCount,
    candidateFeature,
    contributions,
    // Zero is evidence absence, never a fabricated probability or fallback bonus.
    unseenCandidate: !Object.hasOwn(model.featureCounts, candidateFeature),
    unseenContext: anchors.filter(f => !Object.hasOwn(model.featureCounts, f)),
  };
}
