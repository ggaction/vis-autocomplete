# Preview chart transfer

Applying a Preview card animates the same native Canvas from Preview into the final Current view. Its destination uses the normal chart fit in local CSS pixels, then projects that fit through Current's camera scale and pan into screen coordinates. It does not mix transformed viewport positions with untransformed margins.

The departure uses the painted Preview Canvas and its cropped viewBox. Both endpoint clips are expressed in native chart coordinates, so zoomed content stays clipped to the destination viewport on landing. Moving or resizing either endpoint during a flight cancels the temporary overlay and displays the committed chart in its current layout. Unrelated code-panel scrolling does not cancel the animation. Reduced motion skips the flight.

Coverage: `test/chart-transfer-geometry.test.js` checks coordinate projection and clipping. `test/browser/chart-transfer-zoom.py` checks actual departures and landings after zoom, pan, unequal view resizing and native plot resizing, including both workspace layouts, facets, adjacent charts, high-DPI rendering, resize cancellation and reduced motion.
