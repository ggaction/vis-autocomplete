// Progress messages carry ranking/pagination metadata, while each recommendation
// and native preview crosses the worker boundary only once per request.
export function createRecommendationStream() {
  const sent = new Set();
  let count = 0;
  return response => {
    const recommendations = response.result?.recommendations;
    const offset = count;
    if (recommendations) count = recommendations.length;
    return { ...response,
      ...(recommendations ? { recommendationOffset: offset, result: { ...response.result, recommendations: recommendations.slice(offset) } } : {}),
      defaultsDelta: true, defaults: response.defaults.filter(entry => {
        const key = JSON.stringify(entry.action);
        if (sent.has(key)) return false;
        sent.add(key); return true;
      }) };
  };
}

export function collectRecommendationStream() {
  const defaults = new Map();
  const recommendations = [];
  return response => {
    if (!response.defaultsDelta) return response;
    for (const entry of response.defaults) defaults.set(JSON.stringify(entry.action), entry);
    const { defaultsDelta, recommendationOffset, ...rest } = response;
    if (recommendationOffset !== undefined) {
      // Indexed writes also make collecting the final packet twice harmless.
      response.result.recommendations.forEach((value, index) => { recommendations[recommendationOffset + index] = value; });
      rest.result = { ...response.result, recommendations: [...recommendations] };
    }
    return { ...rest, defaults: [...defaults.values()] };
  };
}
