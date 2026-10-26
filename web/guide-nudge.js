const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function guideNudgeDelta(event) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null;
  const direction = directions[event.key];
  if (!direction) return null;
  const step = event.shiftKey ? 10 : 1;
  return direction.map(value => value * step);
}

// OS key repeats are input, not separate edits. Keep one accumulated gesture
// through a held key or a burst of taps, and retain taps arriving during commit.
export function createGuideNudge(callbacks, { delay = 160, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let run = null, timer = null, queued = [0, 0];
  const held = new Set();
  const stopTimer = () => { if (timer !== null) unschedule(timer); timer = null; };
  function settle() {
    stopTimer();
    if (run && !run.ending && !held.size) timer = schedule(finish, delay);
  }
  function move(dx, dy) {
    if (!run) {
      const handle = callbacks.begin();
      if (!handle) return false;
      run = { handle, dx: 0, dy: 0, ending: false };
    }
    if (run.ending) { queued[0] += dx; queued[1] += dy; return true; }
    run.dx += dx; run.dy += dy;
    callbacks.update(run.handle, run.dx, run.dy);
    return true;
  }
  async function finish() {
    stopTimer();
    const current = run;
    if (!current || current.ending) return;
    current.ending = true;
    try { await callbacks.end(current.handle); }
    catch (error) { callbacks.error?.(error); }
    finally {
      if (run === current) {
        run = null;
        const [dx, dy] = queued; queued = [0, 0];
        if ((dx || dy) && move(dx, dy)) settle();
        else if (!run) held.clear();
      }
    }
  }
  return {
    down(event) {
      const delta = guideNudgeDelta(event);
      if (!delta || !move(...delta)) return false;
      held.add(event.key); stopTimer(); return true;
    },
    up(key) { if (held.delete(key)) settle(); },
    flush() { held.clear(); return finish(); },
    cancel() {
      stopTimer(); held.clear(); queued = [0, 0];
      const current = run; run = null;
      if (current) callbacks.cancel(current.handle);
    },
  };
}
