// Every progress message contains the small ranking/pagination metadata, but
// each native preview crosses the worker boundary only once per request.
export function createRecommendationStream() {
  const sent = new Set();
  return response => ({ ...response, defaultsDelta: true, defaults: response.defaults.filter(entry => {
    const key = JSON.stringify(entry.action);
    if (sent.has(key)) return false;
    sent.add(key); return true;
  }) });
}

export function collectRecommendationStream() {
  const defaults = new Map();
  return response => {
    if (!response.defaultsDelta) return response;
    for (const entry of response.defaults) defaults.set(JSON.stringify(entry.action), entry);
    const { defaultsDelta, ...rest } = response;
    return { ...rest, defaults: [...defaults.values()] };
  };
}
