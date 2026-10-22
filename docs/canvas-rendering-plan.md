# Canvas rendering and transition migration

Status: API explicitly approved by the user on 2026-10-22; implementation and regression verification completed.

## Existing interfaces retained

Static chart surfaces consume the existing public `render(program, context, { pixelRatio })` Canvas renderer. Current, Preview, option thumbnails, history thumbnails, transfer animation and enlarged charts use actual Canvas surfaces. Downloads retain native SVG/PDF/PNG generation. Logical chart dimensions, code, persistence and recommendations do not change.

## Approved ggaction scene addition

`createTransitionScene(program, { format: 'canvas' })` returns a version 2 scene with the same stable semantic identity, ordered nodes, dimensions, offsets and nested clips as the existing version 1 SVG scene. Each version 2 node replaces `svg` with `properties`, the already-materialized concrete graphic properties (including path commands, text lines, gradients and blend mode). The default call still returns version 1. No new program state or persisted project schema is introduced.

`renderTransitionScene(scene, context, { pixelRatio })` paints version 2 concrete scenes with the same native Canvas primitive renderer, validation, clipping and isolated blend semantics used by ordinary `render`. It does not infer chart semantics. The transition package owns timing, matching, interpolation and cancellation, and calls this renderer with concrete intermediate frames. SVG version 1 support remains available.

## Transition package and app

Add `createCanvasTransitionPlayer(host, { render, duration, maxAnimatedNodes })`, with the same lifecycle as the SVG player. The render callback receives a concrete version 2 scene. Retarget from the last painted frame, cap outgoing records and compiled caches, honor reduced motion, and release observers/timers/surfaces on destroy. Interpolate numeric geometry, color, compatible gradients and compatible path topology; crossfade incompatible geometry/content. Canvas backing resolution follows display size and device pixel ratio, without changing logical dimensions.

Use worker-prepared graphicSpec for ordinary rendering and version 2 scenes for transition. Avoid SVG serialization/parsing and image decoding in display paths. Retain synchronous compositor feedback while native resizing runs in workers.

## Verification

Compare Canvas scene endpoints against the existing native Canvas renderer across Cartesian, distribution, polar, multivariate and faceted charts. Test paths, text, gradients, clipping, alpha/blend and interrupted transitions. Exercise initial selection, option hover/Apply, history, Undo/Redo, resize/Escape, downloads and refresh in both modes. Measure repeated rapid hover at high DPI and check bounded records, memory/DOM and frame work. Commit and push verified libraries before parent submodule references.
