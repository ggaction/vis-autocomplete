// Require a brief dwell before hover can change a parameter. Once armed,
// pointer travel stays immediate until it leaves this particular control.
export function createSliderHover({ delay = 200, valid = () => true,
  schedule = setTimeout, cancel = clearTimeout } = {}) {
  let target = null, latest = null, follow = null, timer = null, armed = false;
  const reset = () => {
    if (timer !== null) cancel(timer);
    target = latest = follow = timer = null; armed = false;
  };
  const apply = (checkHit = true) => {
    if (checkHit && !valid(target, latest)) { reset(); return; }
    follow(latest);
  };
  return {
    reset,
    move(control, event, callback) {
      if (!control || !callback || event.pointerType === 'touch') { reset(); return; }
      if (target !== control) {
        reset(); target = control;
        timer = schedule(() => { timer = null; armed = true; apply(); }, delay);
      }
      latest = event; follow = callback;
      // Physical moves already carry the live hit target. Hit-test only delayed
      // work so armed sliders do not introduce another layout read per frame.
      if (armed) apply(false);
    },
    activate(control, event, callback) {
      reset(); target = control; latest = event; follow = callback; armed = true;
      apply();
    },
  };
}
