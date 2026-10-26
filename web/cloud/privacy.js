export { CONSENT as CONSENT_VERSION } from '../research/protocol.js';
export const RESEARCH_NOTICE = 'Share how you explore and edit visualizations to improve recommendations. This includes field names, chart text, and search terms, but excludes dataset rows, uploaded files, and sign-in details. You can stop sharing or delete this history in Settings.';
export const GUEST_RESEARCH_NOTICE = RESEARCH_NOTICE + ' Guest history is linked to a pseudonymous guest session ID. Its chart and dataset stay in this browser until you sign in to save them.';
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
