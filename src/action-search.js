import { ACTION_LABELS } from './action-labels.js';

const aliases = [
  ['create', 'add'], ['edit', 'adjust', 'modify'], ['encode', 'map', 'mapping'],
  ['opacity', 'transparency', 'transparent', 'alpha', '투명도'],
  ['color', 'colour', '색상'], ['size', 'radius', '크기'],
  ['stroke', 'outline', 'border', '테두리'], ['width', 'thickness', '굵기'],
  ['dash', 'dashed', 'dotted', '점선'], ['shape', 'symbol', '모양'],
  ['facet', 'panel', 'small multiples', '패싯'], ['grid', 'gridlines', '격자'],
  ['axis', 'axes', '축'], ['legend', 'key', '범례'], ['title', '제목'],
  ['label', 'labels', 'text', '레이블'], ['sort', 'order', '정렬'],
  ['bin', 'bins', 'binning', '구간'], ['aggregate', 'aggregation', 'summary', 'summarize', '집계'],
  ['regression', 'trend', '회귀'], ['filter', 'filtering', '필터'],
];

export function normalizeSearchQuery(query = '') {
  if (typeof query !== 'string') throw new TypeError('searchQuery must be a string.');
  return query.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

function words(text) {
  return text.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

// Optimal-string-alignment distance includes adjacent transpositions (widht).
function withinEdits(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return false;
  const rows = [Array.from({ length: b.length + 1 }, (_, i) => i)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i], previous = rows[i - 1];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(row[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
    }
    rows.push(row);
  }
  return rows[a.length][b.length] <= limit;
}

const indexed = new WeakMap();
function searchableWords(recommendation) {
  if (indexed.has(recommendation)) return indexed.get(recommendation);
  const methods = new Set([recommendation.sourceMethod ?? recommendation.method,
    ...((recommendation.alternatives ?? []).map(a => a.args?.action?.method ?? a.method))]);
  const text = [...methods].flatMap(method => [method, ACTION_LABELS[method] ?? '']);
  text.push(recommendation.label ?? '', recommendation.feature ?? '');
  text.push(...Object.keys(recommendation.guideContext?.axes ?? {}), recommendation.args?.axis ?? '', recommendation.args?.channel ?? '');
  if (methods.has('createStatisticalReference')) text.push('statistic mean median min max percentile interval middle 50 95');
  const tokens = new Set(text.flatMap(words));
  for (const method of methods) tokens.add(method.toLowerCase());
  for (const group of aliases) if (group.some(term => words(term).every(word => tokens.has(word)))) {
    for (const term of group) for (const word of words(term)) tokens.add(word);
  }
  const result = [...tokens]; indexed.set(recommendation, result); return result;
}

export function filterActionRecommendations(recommendations, query = '') {
  const terms = words(normalizeSearchQuery(query));
  if (!terms.length) return recommendations;
  // Filtering never computes a relevance score or rearranges the paper ranking.
  return recommendations.filter(rec => {
    const tokens = searchableWords(rec);
    return terms.every(term => tokens.some(token => token === term || token.startsWith(term) ||
      (term.length >= 3 && token.includes(term)) ||
      (term.length >= 4 && withinEdits(term, token, term.length >= 8 ? 2 : 1))));
  });
}
