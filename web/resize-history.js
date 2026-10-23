// A direct-edit run owns one history entry. Keys separate moved guide owners
// from the canvas/plot resize run. Only successful commits advance it;
// previews and cancelled gestures leave both its baseline and history intact.
export function createResizeHistory(history) {
  let run = null;
  return {
    begin(key = 'canvas') {
      const current = history.entries[history.index];
      return run?.last === current && run.key === key ? run.before : current;
    },
    commit(before, snapshot, key = 'canvas') {
      const current = history.entries[history.index];
      if (run?.last === current && run.before === before && run.key === key) history.replace(snapshot);
      else history.push(snapshot);
      run = { before, last: snapshot, key };
    },
    reset() { run = null; },
  };
}

// Resize options are absolute. Carry composition padding forward as well when
// replaying a later plot gesture against the beginning of the resize run.
export function rebaseResizeAction(action, current, baseline) {
  // Returning to the run's original size is still a change from the latest
  // displayed size. Validate/render it even though its baseline is equivalent.
  action = { ...action, allowUnchanged: true };
  if (!current.composition || action.method === 'editCompositionLayout') return action;
  const padding = action.setupCalls?.find(call => call.method === 'editCompositionLayout')?.args.padding ?? current.padding;
  const changed = Object.keys(padding).some(side => padding[side] !== baseline.padding[side]);
  return { ...action, setupCalls: changed ? [{ method: 'editCompositionLayout', args: { padding } }] : [] };
}
