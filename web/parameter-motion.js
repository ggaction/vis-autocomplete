// Integer steps do not imply structural changes: font sizes and point sizes
// still track the pointer. Counts/bins/categories change chart topology.
export const CARD_TRANSITION_MS = 300;
export const FINE_TRANSITION_MS = 80;
export function parameterTransitionDuration(control) {
  if (control?.type !== 'number') return CARD_TRANSITION_MS;
  if (control.transition === 'continuous') return FINE_TRANSITION_MS;
  if (control.transition === 'structural') return CARD_TRANSITION_MS;
  const name = `${control.path ?? ''} ${control.key ?? ''} ${control.label ?? ''}`
    .replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return /\b(columns?|rows?|counts?|bins?|steps?|samples?|ticks?|degree|iterations?|dimensions?|levels?|bands?)\b/.test(name)
    ? CARD_TRANSITION_MS : FINE_TRANSITION_MS;
}
