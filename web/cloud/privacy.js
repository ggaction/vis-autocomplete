export const CONSENT_VERSION = 'history-only-v1';
export const RESEARCH_NOTICE = 'Help improve visualization tools by sharing interaction history for research. We record actions, option exploration, timing, and errors—not dataset contents, column names, chart text, or uploaded files. Your datasets and projects are stored privately to save your work and are not used for research. You can change this choice in Settings at any time.';
export const GUEST_RESEARCH_NOTICE = 'Help improve visualization tools by sharing interaction history for research. We store actions, option exploration, timing, and errors on our server under a guest session ID—not dataset contents, column names, chart text, or uploaded files. Your chart and dataset stay in this browser until you sign in to save them. You can change this choice in Settings at any time.';
export const EVENT_TYPES = ['options_shown', 'preview_start', 'preview_end', 'parameter', 'apply', 'history', 'selection', 'group', 'page', 'search', 'resize', 'error', 'export'];
const numeric = ['duration', 'index', 'count', 'revision', 'value', 'rank', 'score'];
// Research events never serialize action args or free text. This same projection
// is enforced again by the database ingestion function.
export function researchPayload(type, input = {}) {
  if (!EVENT_TYPES.includes(type)) return null;
  const payload = { type };
  if (typeof input.method === 'string' && /^(create|edit|encode|remove|filter|layout|add|apply|facet|repeat|sort|jitter)[A-Za-z]*$/.test(input.method) && input.method.length <= 80) payload.method = input.method;
  if (['encoding', 'transform', 'style', 'initial'].includes(input.group)) payload.group = input.group;
  for (const key of numeric) if (Number.isFinite(input[key])) payload[key] = input[key];
  if (typeof input.value === 'boolean') payload.value = input.value;
  return payload;
}
