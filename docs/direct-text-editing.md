# Canvas text editing

## Interaction

- Double-click an individual visible text element to edit its complete string.
- Enter applies; Cmd+Enter (Ctrl+Enter on non-Mac keyboards) inserts a newline; Escape cancels.
- IME composition Enter only completes composition. Text is always literal, never HTML.
- One accepted edit creates one history entry and uses public ggaction calls; Undo/Redo, saved projects, and exports retain it.
- Picking is based on the rendered text bounds, including rotation and composition offsets. Text hit regions are resolved on demand, rather than adding one DOM element per label.

## Existing public owners

Use `editTitle` for title/subtitle, axis title editors for axis titles, `editLegendTitle` for legend titles, Cartesian axis `labels.labelMap` for category tick text, `editLegendBlock.labelMap` for categorical entries (including ordinal size), `editFacetHeaders.labelMap` for facet headings, and `encodeText({target,value})` for annotations. Keep typed data values and existing mappings; change only the selected display entry. Shared/faceted guides edit their authored owner, and adjacent charts retain their childPath scope.

## Approved public extensions

Approved by the user on 2026-10-26: “이 API 확장으로 진행”, reviewing commit `4cf2a84`. Implemented through native ggaction actions and the Canvas text editor.

The user subsequently narrowed the scope: numeric continuous axis ticks and continuous legend labels are not editable. Categorical labels (including numeric-coded categories), axis titles and legend titles remain editable. Existing continuous label APIs are not expanded by this work.

1. Add categorical `labels.labelMap` / `ticksAndLabels.labels.labelMap` to `editParallelAxis`. Reuse typed `{value,label}[] | 'auto'` mappings; reject maps on continuous parallel axes.
2. Extend `editLegendBlock.labelMap` to discrete size category domains. Existing categorical theta and Cartesian label APIs are reused. Discretized numeric intervals and continuous sampled/gradient labels are excluded from direct editing.
3. Add `editTextMark({target,textOverrides})`, where `textOverrides` is an array of `{match:{fields?:Record<string,scalar>,channels?:Record<string,scalar>},occurrence:number,text:string}` or `'auto'`. A scalar is string, boolean, null, or finite number. `match` must contain at least one nonempty dictionary; both dictionaries are conjunctive. `occurrence` is a required nonnegative index among matching semantic items, not an index into rendered graphics. Row-backed text matches its row fields/encoded channels; attached labels match their source item fields/channels. The app supplies the complete available identity for the selected item. Unmatched overrides are retained but do not alter another label. Arrays replace this policy; omission preserves it; `'auto'` clears it. Conflicting duplicate selectors are rejected. Missing/filtered items never cause an override to be reassigned by graphic index.

Target calls:

```js
program.editTextMark({target:'labels',textOverrides:[{
  match:{fields:{Region:'North',Sales:12},channels:{x:'North',y:12}},occurrence:0,text:'North\nsales'
}]});
```

All edited text must preserve explicit hard breaks, including blank lines, through the native text-layout pipeline in Canvas, SVG and PDF. Existing multiline title, legend and Cartesian-label behavior provides the visual primitive; this is not a new chart geometry or renderer.

## Compatibility and validation

Existing calls and schemas retain their behavior when new options are omitted. New policies belong to their existing guide/mark materialization config, not application-only state or raw graphic edits. Public declarations, inspection metadata, current contracts, generated references and documentation must accompany any native change.

Verification covers literal/duplicate labels, numeric and categorical values, multiline and blank lines, repeated edits, filter/scale/resize replay, unit/facet/adjacent/overlay scopes, all legend families, independent annotation/mark labels, IME, Undo/Redo, save/reload, exports, and dense text scenes. The current supported baseline uses native legend-content, size-label-map, title-hard-break and axis-title-hard-break tests.

### Verification on 2026-10-26

- App regression suite: 747 tests passed; production build passed.
- Browser exercise: 16 edits across Preview and Transition modes, covering titles, category legends, mark labels, facet headings, adjacent charts, parallel coordinates, polar and Cartesian category labels. Enter, Cmd/Ctrl+Enter, Escape, IME, Undo/Redo and account autosave/reload passed. Both modes also rejected double-click editing of continuous axis ticks, gradient legend values and sampled size legend values.
- Native guide/mark/facet suite: 1,389 tests passed. Focused coverage includes multiline Canvas/SVG/PDF output, semantic identity after filtering, typed numeric categories, persistence, reset, facet field-title bounds and polar titles. Public TypeScript/package checks also passed. Numeric-coded categories remain editable; sampled and interval legends remain read-only in the app.
- Dense-scene check: 5,000 text marks with 1,000 semantic overrides retained all requested edits. Target lookup is cached by immutable program, and pointer movement does not build text targets or per-label DOM nodes.
- The broad native contract suite retains one unrelated baseline failure: `cars-origin-histogram-facet` differs from its primitive fixture in title/subtitle Y placement. The same failure was reproduced from clean pre-change commit `d2b0fcd80e72fe48c3dd10c23faf9263f7e2da61`; the reference fixture was not rewritten to hide it.

Run `node --test test/text-editing.test.js` for the app target/semantic tests and `test/browser/text-editing.py --cdp <local-browser-endpoint>` against the isolated local account test session for browser interactions. Generated screenshots, project fixtures and logs stay under ignored `output/text-editing/`.
